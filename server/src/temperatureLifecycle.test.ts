import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOperationalIssues,
  getTemperatureEvents,
  type TemperatureReading,
  type WarehouseSnapshot,
  type Zone
} from "@twinops/shared";

const coldStorage: Zone = {
  id: "CS",
  name: "Cold Storage",
  code: "CS",
  temperatureMin: 2,
  temperatureMax: 8,
  capacityUnits: 1_200,
  currentTemperature: 5,
  fillPercent: 50,
  status: "normal",
  productTypes: []
};

function reading(minute: number, temperature: number): TemperatureReading {
  return {
    id: minute + 1,
    zoneId: coldStorage.id,
    temperature,
    timestamp: new Date(Date.UTC(2026, 6, 13, 10, minute)).toISOString(),
    withinBand: temperature >= coldStorage.temperatureMin && temperature <= coldStorage.temperatureMax,
    allowedMin: coldStorage.temperatureMin,
    allowedMax: coldStorage.temperatureMax,
    sensorId: "CS-TEMP-01",
    relatedSkuIds: [],
    relatedBatchIds: []
  };
}

function issuesFor(readings: TemperatureReading[]) {
  const temperatureEvents = getTemperatureEvents(readings, [coldStorage]);
  const snapshot = {
    temperatureEvents,
    inventoryPlacements: [],
    inventory: { stockPositions: [], inboundLines: [], outboundShipments: [] },
    routes: [],
    decisions: [],
    alerts: []
  } as unknown as WarehouseSnapshot;
  return { temperatureEvents, issues: buildOperationalIssues(snapshot) };
}

describe("temperature issue lifecycle", () => {
  it("keeps a current cold-storage breach in Open Alerts", () => {
    const { temperatureEvents, issues } = issuesFor([reading(0, 8.4)]);

    assert.equal(temperatureEvents[0]?.status, "Open");
    assert.equal(temperatureEvents[0]?.resolved, false);
    assert.ok(issues.some((issue) => issue.id === "temperature:CS"));
  });

  it("removes a recovered short excursion from Open Alerts", () => {
    const { temperatureEvents, issues } = issuesFor([reading(0, 8.4), reading(5, 5)]);

    assert.equal(temperatureEvents[0]?.status, "Resolved");
    assert.equal(temperatureEvents[0]?.durationMinutes, 5);
    assert.equal(temperatureEvents[0]?.resolved, true);
    assert.ok(!issues.some((issue) => issue.id === "temperature:CS"));
  });

  it("uses live sample timestamps instead of treating five-second samples as five minutes", () => {
    const atSecond = (second: number, temperature: number): TemperatureReading => ({
      ...reading(0, temperature),
      id: 100 + second,
      timestamp: new Date(Date.UTC(2026, 6, 13, 10, 0, second)).toISOString()
    });
    const { temperatureEvents } = issuesFor([
      atSecond(0, 8.4),
      atSecond(5, 8.5),
      atSecond(10, 8.4),
      atSecond(15, 5)
    ]);

    assert.equal(temperatureEvents[0]?.durationMinutes, 1);
    assert.equal(temperatureEvents[0]?.eventType, "Excursion");
    assert.equal(temperatureEvents[0]?.status, "Resolved");
  });

  it("retains repeated-excursion non-conformance classification only in history after recovery", () => {
    const { temperatureEvents, issues } = issuesFor([
      reading(0, 8.4),
      reading(5, 5),
      reading(10, 8.4),
      reading(15, 5),
      reading(20, 8.4),
      reading(25, 5)
    ]);
    const promoted = temperatureEvents.at(-1);

    assert.equal(promoted?.eventType, "Non-Conformance");
    assert.equal(promoted?.status, "Resolved");
    assert.equal(promoted?.resolved, true);
    assert.ok(promoted?.auditReference);
    assert.ok(!issues.some((issue) => issue.id === "temperature:CS"));
  });
});
