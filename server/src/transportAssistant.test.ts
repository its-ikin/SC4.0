import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { AssistantUiContext } from "@twinops/shared";
import { db } from "./db/database";
import { processUserQuery } from "./orchestrator";

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
