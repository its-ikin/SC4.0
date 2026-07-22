import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateScheduleAdherence,
  inboundScheduleAdherence,
  outboundScheduleAdherence,
  type InboundShipment,
  type OutboundShipment
} from "@twinops/shared";
import { TRANSPORT_ROUTE_CONFIGS } from "./routeData";

const now = new Date("2026-07-13T12:00:00.000Z");

describe("shared schedule adherence", () => {
  it("marks an unfinished milestone overdue after its target", () => {
    const result = calculateScheduleAdherence({
      targetTime: "2026-07-13T10:30:00.000Z",
      pendingMilestone: "Arrival",
      completedMilestone: "Arrived"
    }, now);
    assert.equal(result.status, "delayed");
    assert.equal(result.varianceMinutes, 90);
    assert.equal(result.label, "Arrival overdue by 1h 30m");
  });

  it("keeps a future unfinished milestone on schedule", () => {
    const result = calculateScheduleAdherence({
      targetTime: "2026-07-13T13:00:00.000Z",
      pendingMilestone: "Dispatch",
      completedMilestone: "Dispatched"
    }, now);
    assert.equal(result.status, "on-time");
    assert.equal(result.label, "On schedule");
  });

  it("uses the actual timestamp for a completed late milestone", () => {
    const result = calculateScheduleAdherence({
      targetTime: "2026-07-13T10:00:00.000Z",
      actualTime: "2026-07-13T10:07:00.000Z",
      pendingMilestone: "Arrival",
      completedMilestone: "Arrived"
    }, now);
    assert.equal(result.status, "delayed");
    assert.equal(result.label, "Arrived 7 min late");
  });

  it("treats even a sub-minute miss as delayed instead of rounding it on time", () => {
    const result = calculateScheduleAdherence({
      targetTime: "2026-07-13T10:00:00.000Z",
      actualTime: "2026-07-13T10:00:20.000Z",
      pendingMilestone: "Arrival",
      completedMilestone: "Arrived"
    }, now);
    assert.equal(result.status, "delayed");
    assert.equal(result.varianceMinutes, 1);
    assert.equal(result.label, "Arrived 1 min late");
  });

  it("does not turn an early completed milestone late as time passes", () => {
    const result = calculateScheduleAdherence({
      targetTime: "2026-07-13T10:00:00.000Z",
      actualTime: "2026-07-13T09:45:00.000Z",
      pendingMilestone: "Dispatch",
      completedMilestone: "Dispatched"
    }, now);
    assert.equal(result.status, "on-time");
    assert.equal(result.label, "Dispatched on time");
  });

  it("reports unknown when completion is claimed without an actual timestamp", () => {
    const result = calculateScheduleAdherence({
      targetTime: "2026-07-13T10:00:00.000Z",
      completed: true,
      pendingMilestone: "Dispatch",
      completedMilestone: "Dispatched"
    }, now);
    assert.equal(result.status, "unknown");
    assert.equal(result.label, "Dispatched time not recorded");
  });

  it("reports unknown instead of on-time when the target is missing", () => {
    const result = calculateScheduleAdherence({
      targetTime: null,
      pendingMilestone: "Arrival",
      completedMilestone: "Arrived"
    }, now);
    assert.equal(result.status, "unknown");
    assert.equal(result.varianceMinutes, null);
  });

  it("uses planned arrival for inbound and planned departure for outbound", () => {
    const inbound = {
      inboundStatus: "In Transit",
      plannedArrival: "2026-07-13T11:00:00.000Z",
      eta: "2026-07-13T14:00:00.000Z",
      actualArrival: null
    } as InboundShipment;
    const outbound = {
      outboundStatus: "Loading",
      requiredBy: "2026-07-13T15:00:00.000Z",
      plannedDeparture: "2026-07-13T11:30:00.000Z",
      actualDeparture: null
    } as OutboundShipment;
    assert.equal(inboundScheduleAdherence(inbound, now).status, "delayed");
    assert.equal(outboundScheduleAdherence(outbound, now).label, "Dispatch overdue by 30 min");
  });

  it("keeps an overdue inbound schedule separate from its physical WMS stage", () => {
    const inbound = {
      inboundStatus: "In Transit",
      plannedArrival: "2026-07-13T11:00:00.000Z",
      eta: "2026-07-13T11:15:00.000Z",
      actualArrival: null
    } as InboundShipment;

    const adherence = inboundScheduleAdherence(inbound, now);

    assert.equal(inbound.inboundStatus, "In Transit");
    assert.equal(adherence.status, "delayed");
    assert.equal(adherence.completed, false);
    assert.equal(adherence.actualTime, null);
    assert.equal(adherence.label, "Arrival overdue by 1h");
  });

  it("uses a recorded arrival to complete adherence without hiding a late arrival", () => {
    const inbound = {
      inboundStatus: "At Receiving",
      plannedArrival: "2026-07-13T11:00:00.000Z",
      eta: "2026-07-13T11:00:00.000Z",
      actualArrival: "2026-07-13T11:08:00.000Z"
    } as InboundShipment;

    const adherence = inboundScheduleAdherence(inbound, now);

    assert.equal(adherence.completed, true);
    assert.equal(adherence.status, "delayed");
    assert.equal(adherence.actualTime, inbound.actualArrival);
    assert.equal(adherence.label, "Arrived 8 min late");
  });

  it("keeps an overdue outbound schedule separate from fulfilment stage", () => {
    const outbound = {
      outboundStatus: "Picking",
      requiredBy: "2026-07-13T11:30:00.000Z",
      plannedDeparture: "2026-07-13T11:30:00.000Z",
      actualDeparture: null
    } as OutboundShipment;

    const adherence = outboundScheduleAdherence(outbound, now);

    assert.equal(outbound.outboundStatus, "Picking");
    assert.equal(adherence.status, "delayed");
    assert.equal(adherence.completed, false);
    assert.equal(adherence.actualTime, null);
    assert.equal(adherence.label, "Dispatch overdue by 30 min");
  });

  it("keeps the seeded inbound and outbound schedules operationally varied", () => {
    const inboundTargets = TRANSPORT_ROUTE_CONFIGS
      .filter((route) => route.direction === "inbound" && route.actualArrivalOffsetMinutes === null)
      .map((route) => route.plannedArrivalOffsetMinutes);
    const outboundTargets = TRANSPORT_ROUTE_CONFIGS
      .filter((route) => route.direction === "outbound")
      .map((route) => route.plannedDepartureOffsetMinutes);
    assert.ok(inboundTargets.some((offset) => offset < 0), "at least one pending inbound ASN should be overdue");
    assert.ok(inboundTargets.some((offset) => offset > 0), "at least one pending inbound ASN should be on schedule");
    assert.ok(outboundTargets.some((offset) => offset < 0), "at least one outbound shipment should be overdue");
    assert.ok(outboundTargets.some((offset) => offset > 0), "at least one outbound shipment should be on schedule");
  });
});
