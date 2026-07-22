import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { AssistantUiContext } from "@twinops/shared";
import { db } from "./db/database";
import { processUserQuery, scenarioPlanFromLanguage } from "./orchestrator";
import { simulate_facility_disruption } from "./tools";

before(async () => {
  const { seedIfEmpty } = await import("./db/seed");
  seedIfEmpty();
});

async function withoutModel<T>(operation: () => Promise<T>) {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return await operation();
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
}

describe("transport-grounded assistant", () => {
  it("answers an exact stock traceability question with the requested record fields", async () => {
    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery(
        "Where is stock item STK-100001-01, and what are its lot, STO, expiry, and quality status?"
      ));
      const located = response.toolResults?.locate_sku as any;
      const facts = Object.fromEntries(response.agentResponse.facts.map((fact) => [fact.label, fact.value]));

      assert.equal(response.agentResponse.intent, "sku_location");
      assert.equal(response.toolsCalled.some((tool) => tool.toolName === "locate_sku"), true);
      assert.equal(located.stockBalanceId, "STK-100001-01");
      assert.equal(facts["Lot / batch"], located.lotCode);
      assert.equal(facts.STO, located.stoNumber);
      assert.equal(facts["Quality status"], located.qualityReleaseStatus);
      assert.match(facts.Location, /Cold Storage.*Rack.*Bin/i);
      assert.doesNotMatch(response.agentResponse.summary, /data is unavailable/i);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("normalises a spoken dock number and returns that dock's actual appointments", async () => {
    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery("tell me dock 1 schedule"));
      const schedule = response.toolResults?.check_dock_schedule as any;

      assert.equal(response.agentResponse.intent, "route_status");
      assert.equal(schedule.dockId, "D1");
      assert.equal(schedule.dockState.id, "D1");
      assert.ok(schedule.scheduledAppointments.length > 0);
      assert.equal(schedule.scheduledAppointments.every((appointment: any) => appointment.dockId === "D1"), true);
      assert.match(response.agentResponse.summary, /Dock 1.*appointment/i);
      assert.doesNotMatch(response.agentResponse.summary, /Operational scan completed/i);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("answers a current-temperature question with the current reading rather than event history", async () => {
    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery("what is the temperature of cold chain room"));
      const cold = response.toolResults?.check_cold_chain_status as any;

      assert.equal(response.agentResponse.intent, "temperature_event");
      assert.equal(response.toolsCalled.some((tool) => tool.toolName === "check_cold_chain_status"), true);
      assert.equal(response.toolsCalled.some((tool) => tool.toolName === "get_temperature_events"), false);
      assert.match(response.agentResponse.summary, new RegExp(`${cold.currentTemperature}.*${cold.requiredMin}-${cold.requiredMax}`, "i"));
      assert.match(response.agentResponse.facts.find((fact) => fact.label === "Current temperature")?.value ?? "", new RegExp(String(cold.currentTemperature)));
      assert.doesNotMatch(response.agentResponse.summary, /has an? (?:Excursion|Non-Conformance)/i);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("returns the verified open-alert count instead of falling through to a dock scan", async () => {
    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery("how many alerts do i have"));
      const alerts = response.toolResults?.get_operational_alerts as any;

      assert.equal(response.toolsCalled.some((tool) => tool.toolName === "get_operational_alerts"), true);
      assert.equal(response.toolsCalled.some((tool) => tool.toolName === "check_dock_schedule"), false);
      assert.equal(alerts.statusFilter, "open");
      assert.match(response.agentResponse.summary, new RegExp(`\\b${alerts.alertCount}\\b.*open operational alert`, "i"));
      assert.equal(response.agentResponse.facts.find((fact) => fact.label === "Open alerts")?.value, String(alerts.alertCount));
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("answers warehouse fullness from physical capacity and occupied stock", async () => {
    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery("how full is my warehouse"));
      const capacity = response.toolResults?.get_warehouse_capacity as any;

      assert.equal(response.toolsCalled.some((tool) => tool.toolName === "get_warehouse_capacity"), true);
      assert.equal(capacity.fillPercent, Math.round(capacity.occupiedUnits / capacity.totalCapacity * 100));
      assert.equal(capacity.availableCapacity, capacity.totalCapacity - capacity.occupiedUnits);
      assert.match(response.agentResponse.summary, new RegExp(`warehouse is ${capacity.fillPercent}% full`, "i"));
      assert.equal(response.agentResponse.facts.find((fact) => fact.label === "Overall utilisation")?.value, `${capacity.fillPercent}%`);
      assert.equal(response.agentResponse.nextAction.type, "locate_warehouse");
      assert.doesNotMatch(response.agentResponse.summary, /Read-Only Assistant|cannot create/i);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("parses a future event, separate facility scope, and article duration without an event whitelist", async () => {
    const query = "typhoon is going to hit singapore, my western DC is going down for a week. what is the fefo impact";
    const plan = scenarioPlanFromLanguage(query);
    const unseenPlan = scenarioPlanFromLanguage(
      "A geomagnetic storm will affect Singapore; our warehouse is expected to be offline for twelve hours. How will inventory be affected?"
    );

    assert.equal(plan?.event, "typhoon");
    assert.equal(plan?.scope?.toLowerCase(), "western dc");
    assert.equal(plan?.scopeType, "facility");
    assert.equal(plan?.durationMinutes, 7 * 24 * 60);
    assert.equal(unseenPlan?.event, "geomagnetic storm");
    assert.equal(unseenPlan?.scope?.toLowerCase(), "warehouse");
    assert.equal(unseenPlan?.durationMinutes, 12 * 60);

    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery(query));
      const simulation = response.toolResults?.simulate_facility_disruption as any;

      assert.equal(simulation.eventType, "typhoon");
      assert.equal(simulation.scope.toLowerCase(), "western dc");
      assert.equal(simulation.durationMinutes, 7 * 24 * 60);
      assert.equal(response.agentResponse.intent, "scenario_simulation");
      assert.match(response.agentResponse.summary, /7-day shutdown.*western DC.*FEFO/i);
      assert.doesNotMatch(response.agentResponse.summary, /external operational disruption|scope not specified|duration.*unavailable/i);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("accepts arbitrary external hazards and keeps warning time separate from unknown downtime", () => {
    const plan = scenarioPlanFromLanguage("Tsunami is hitting Singapore in 30 minutes, what is going to happen to my outbound");
    const simulation = simulate_facility_disruption("tsunami", undefined, "Singapore", 30, "outbound");

    assert.equal(plan?.requestType, "scenario");
    assert.equal(plan?.event?.toLowerCase(), "tsunami");
    assert.equal(plan?.scope, "Singapore");
    assert.equal(plan?.leadTimeMinutes, 30);
    assert.equal(plan?.durationMinutes, null);
    assert.equal(plan?.affectedFlow, "outbound");
    assert.equal(simulation.eventType, "tsunami");
    assert.equal(simulation.scope, "Singapore");
    assert.equal(simulation.leadTimeMinutes, 30);
    assert.equal(simulation.durationKnown, false);
    assert.equal(simulation.durationMinutes, null);
    assert.equal(simulation.affectedFlow, "outbound");
    assert.equal(simulation.inboundAffected.length, 0);
    assert.match(simulation.dataGaps.join(" "), /duration.*not provided/i);
    assert.doesNotMatch(simulation.operationalImpact.join(" "), /30[- ]day|30[- ]minute (?:outage|duration)/i);
  });

  it("answers an exact transport enquiry from the canonical joined record without an LLM key", async () => {
    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery("Show transport data for LEG-OUT-005"));
      const context = response.toolResults?.get_transport_context as any;
      assert.equal(response.fallbackUsed, false);
      assert.equal(response.agentResponse.intent, "transport_status");
      assert.equal(context.recordCount, 1);
      assert.equal(context.records[0].transportLeg.shipmentId, "SHIP-005");
      assert.equal(context.records[0].dockAppointment.dockAppointmentId, "APT-OUT-005");
      assert.match(response.agentResponse.summary, /SHIP-005|LEG-OUT-005/);
      assert.equal(response.requiresApproval, false);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("never describes an overdue inbound ASN as on schedule", async () => {
    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery("Tell me about ASN-1001"));
      const record = (response.toolResults?.get_transport_context as any)?.records?.[0];

      assert.equal(record.transportLeg.scheduleAdherence, "delayed");
      assert.match(record.transportLeg.scheduleAdherenceLabel, /overdue|late/i);
      assert.equal(response.agentResponse.status, "attention");
      assert.match(response.agentResponse.summary, /overdue|late/i);
      assert.doesNotMatch(response.agentResponse.summary, /on schedule|on-time/i);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("uses selected transport context for a complex deictic what-if", async () => {
    const uiContext: AssistantUiContext = {
      activeView: "Logistics",
      activeWorkspace: "transport",
      focusType: "transport_leg",
      selected: { transportLegId: "LEG-OUT-005", shipmentId: "SHIP-005" },
      filters: {
        logisticsRouteFilter: "all",
        logisticsDirectionFilter: "all"
      }
    };
    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery(
        "What if this transport leg has a vehicle breakdown and is delayed by 2 hours?",
        undefined,
        "cold_chain",
        uiContext
      ));
      const simulation = response.toolResults?.simulate_transport_impact as any;
      assert.equal(response.fallbackUsed, false);
      assert.equal(response.agentResponse.intent, "scenario_simulation");
      assert.equal(simulation.transportLegId, "LEG-OUT-005");
      assert.equal(simulation.referenceId, "SHIP-005");
      assert.equal(simulation.delayMinutes, 120);
      assert.ok(simulation.affectedSkus.length > 0);
      assert.ok(Array.isArray(simulation.dockConflictsCreated));
      assert.equal(simulation.mutationApplied, false);
      assert.equal(response.requiresApproval, false);
      assert.match(response.agentResponse.summary, /120 minutes/);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("returns a real inbound and outbound transport overview instead of a dock-only fallback", async () => {
    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery("Give me the current transport overview"));
      const context = response.toolResults?.get_transport_context as any;
      assert.ok(context.recordCount > 0);
      assert.ok(context.summary.inbound > 0);
      assert.ok(context.summary.outbound > 0);
      assert.equal(response.toolsCalled[0]?.toolName, "get_transport_context");
      assert.equal(response.agentResponse.intent, "transport_status");
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("treats a week-long tornado closure as a facility-wide FEFO scenario without assuming a route", async () => {
    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery(
        "A tornado is hitting Singapore Western DC, and it is expected to be down for one week. tell me how that affects my FEFO operations"
      ));
      const simulation = response.toolResults?.simulate_facility_disruption as any;

      assert.equal(response.agentResponse.intent, "scenario_simulation");
      assert.equal(simulation.scope, "Singapore Western DC");
      assert.equal(simulation.durationMinutes, 10_080);
      assert.equal(simulation.mutationApplied, false);
      assert.ok(Array.isArray(simulation.expiresDuringOutage));
      assert.ok(Array.isArray(simulation.expiresWithin7DaysAfterRecovery));
      assert.ok(Array.isArray(simulation.inboundAffected));
      assert.ok(Array.isArray(simulation.outboundAffected));
      assert.equal(response.toolsCalled.some((tool) => tool.toolName === "simulate_facility_disruption"), true);
      assert.equal(response.toolsCalled.some((tool) => tool.toolName === "simulate_event_impact" || tool.toolName === "simulate_transport_impact"), false);
      assert.match(response.agentResponse.summary, /7-day shutdown.*Singapore Western DC.*FEFO/i);
      assert.doesNotMatch(response.agentResponse.summary, /Changi|could not verify FEFO/i);
      assert.ok(response.actionPayload.affectedStages.includes("Receiving"));
      assert.ok(response.actionPayload.affectedStages.includes("Dispatch"));
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("preserves a one-year facility outage instead of truncating it to 30 days", async () => {
    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery(
        "A tornado is hitting Singapore Western DC, and it is expected to be down for one year. tell me how that affects my FEFO operations"
      ));
      const simulation = response.toolResults?.simulate_facility_disruption as any;

      assert.equal(simulation.durationMinutes, 365 * 24 * 60);
      assert.match(response.agentResponse.summary, /1-year shutdown/i);
      assert.equal(response.agentResponse.facts.find((fact) => fact.label === "Outage duration")?.value, "1 year (365 days)");
      assert.doesNotMatch(response.agentResponse.summary, /30-day/i);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("covers every named condition in a multi-entity facility scenario using existing lookup tools", async () => {
    db.exec("BEGIN");
    try {
      const response = await withoutModel(() => processUserQuery(
        "What if Singapore Western DC is forced to close for 72 hours because of severe flooding while ASN-1001 is overdue, Dock D2 is unavailable, STK-200006-02 is approaching expiry, and SHIP-005 is urgently needed but remains under quality restriction—how would this affect FEFO operations and the wider warehouse plan?"
      ));
      const calls = response.toolsCalled;
      const factLabels = response.agentResponse.facts.map((fact) => fact.label);
      const operationalText = response.agentResponse.impact.join(" ");

      assert.equal((response.toolResults?.simulate_facility_disruption as any).durationMinutes, 72 * 60);
      for (const referenceId of ["ASN-1001", "SHIP-005", "D2"]) {
        assert.equal(calls.some((call) => call.toolName === "get_transport_context" && call.input.referenceId === referenceId), true);
        assert.ok(factLabels.includes(referenceId));
      }
      assert.equal(calls.some((call) => call.toolName === "locate_sku" && call.input.stockBalanceId === "STK-200006-02"), true);
      assert.equal(calls.some((call) => call.toolName === "check_fefo_allocation" && call.input.productId === "STK-200006-02"), true);
      assert.ok(factLabels.includes("STK-200006-02"));
      assert.match(operationalText, /STK-200006-02.*restart-critical/i);
      assert.match(operationalText, /ASN-1001.*received|received.*ASN-1001/i);
      assert.match(operationalText, /SHIP-005.*blocked.*regardless.*urgency/i);
      assert.equal(calls.some((call) => call.toolName === "simulate_event_impact" || call.toolName === "simulate_transport_impact"), false);
    } finally {
      db.exec("ROLLBACK");
    }
  });
});
