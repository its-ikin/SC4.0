import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditEvent, OperationalIssue } from "@twinops/shared";
import {
  AuditExportScopeError,
  filterAuditEventsForExport,
  parseAuditExportScope
} from "./auditExport";

function event(overrides: Partial<AuditEvent> & Pick<AuditEvent, "id">): AuditEvent {
  return {
    timestamp: "2026-07-14T04:00:00.000Z",
    category: "Warehouse",
    eventType: "Gate in",
    title: "Vehicle arrived",
    detail: "ASN-1001 arrived at D1",
    severity: "info",
    status: "recorded",
    actor: "WMS",
    affectedIds: ["ASN-1001", "D1"],
    correlationId: "LEG-IN-1001",
    metadata: { sourceSystem: "WMS" },
    ...overrides
  };
}

const events: AuditEvent[] = [
  event({
    id: "rfid-1",
    timestamp: "2026-07-14T03:00:00.000Z",
    eventType: "RFID scan",
    title: "Pallet entered PH-01",
    actor: "RFID System",
    metadata: {}
  }),
  event({ id: "operation-1" }),
  event({
    id: "temperature-1",
    timestamp: "2026-07-14T05:00:00.000Z",
    category: "Cold Chain",
    eventType: "Temperature Excursion",
    title: "Temperature excursion: Cold Storage",
    detail: "Observed 9.1 C",
    severity: "critical",
    status: "resolved",
    actor: "Temperature Monitoring",
    affectedIds: ["CS", "B-L2601"],
    correlationId: "AUD-1",
    metadata: { sourceSystem: "IoT" }
  }),
  event({
    id: "decision-1",
    timestamp: "2026-07-14T06:00:00.000Z",
    category: "AI Decision",
    eventType: "Recommendation",
    title: "Approve stock movement",
    status: "pending",
    actor: "Inventory Agent"
  })
];

const issue: OperationalIssue = {
  id: "temperature:CS",
  title: "Temperature excursion: Cold Storage",
  detail: "Observed 9.1 C.",
  category: "Cold Chain",
  severity: "critical",
  status: "open",
  importance: "important",
  urgency: "urgent",
  priority: "act_now",
  classificationReason: "Product integrity may be affected.",
  openedAt: "2026-07-14T05:00:00.000Z",
  affectedIds: ["CS", "B-L2601"],
  sourceType: "temperature",
  sourceId: "TE-1",
  target: "monitoring",
  targetId: "CS"
};

describe("audit JSON export scope", () => {
  it("keeps an empty export request backward compatible with the full ledger", () => {
    const scope = parseAuditExportScope({});
    assert.equal(scope.view, "all");
    assert.equal(scope.includeRoutine, true);
    assert.deepEqual(filterAuditEventsForExport(events, [issue], scope).map((item) => item.id), [
      "decision-1",
      "temperature-1",
      "operation-1",
      "rfid-1"
    ]);
  });

  it("exports the significant ledger without routine RFID scans", () => {
    const scope = parseAuditExportScope({ view: "significant" });
    assert.equal(scope.includeRoutine, false);
    assert.deepEqual(filterAuditEventsForExport(events, [issue], scope).map((item) => item.id), [
      "decision-1",
      "temperature-1",
      "operation-1"
    ]);
  });

  it("honours the visible date, domain, status and search scope together", () => {
    const scope = parseAuditExportScope({
      view: "all",
      query: "b-l2601",
      from: "2026-07-14T04:30:00.000Z",
      to: "2026-07-14T05:30:00.000Z",
      categories: ["Cold Chain"],
      severities: ["critical"],
      statuses: ["resolved"]
    });
    assert.deepEqual(filterAuditEventsForExport(events, [issue], scope).map((item) => item.id), ["temperature-1"]);
  });

  it("supports source-system, event-type and actor filters", () => {
    const sourceScope = parseAuditExportScope({ sourceSystems: ["IoT"], eventTypes: ["Temperature Excursion"] });
    assert.deepEqual(filterAuditEventsForExport(events, [issue], sourceScope).map((item) => item.id), ["temperature-1"]);

    const actorScope = parseAuditExportScope({ actors: ["Inventory Agent"], statuses: ["pending"] });
    assert.deepEqual(filterAuditEventsForExport(events, [issue], actorScope).map((item) => item.id), ["decision-1"]);
  });

  it("exports current operational issues for the action-required view", () => {
    const scope = parseAuditExportScope({ view: "action_required", query: "B-L2601" });
    const result = filterAuditEventsForExport(events, [issue], scope);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "current-issue-temperature:CS");
    assert.equal(result[0]?.status, "open");
  });

  it("accepts nested and singular filter aliases", () => {
    const scope = parseAuditExportScope({
      filters: {
        filter: "cold_chain",
        dateFrom: "2026-07-14T04:00:00.000Z",
        domain: "Cold Chain",
        outcome: "resolved",
        sourceSystem: "IoT"
      }
    });
    assert.equal(scope.view, "cold_chain");
    assert.deepEqual(scope.categories, ["Cold Chain"]);
    assert.deepEqual(scope.statuses, ["resolved"]);
    assert.deepEqual(filterAuditEventsForExport(events, [issue], scope).map((item) => item.id), ["temperature-1"]);
  });

  it("derives rolling ranges from the supplied clock", () => {
    const scope = parseAuditExportScope({ timeRange: "24h" }, new Date("2026-07-14T12:00:00.000Z"));
    assert.equal(scope.from, "2026-07-13T12:00:00.000Z");
  });

  it("rejects invalid dates, ranges, views and option types", () => {
    assert.throws(() => parseAuditExportScope({ from: "not-a-date" }), AuditExportScopeError);
    assert.throws(() => parseAuditExportScope({ from: "2026-07-15T00:00:00Z", to: "2026-07-14T00:00:00Z" }), AuditExportScopeError);
    assert.throws(() => parseAuditExportScope({ view: "unknown" }), AuditExportScopeError);
    assert.throws(() => parseAuditExportScope({ includeRoutine: "yes" }), AuditExportScopeError);
  });
});
