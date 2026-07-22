import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceOperationsSimulation,
  createOperationsSimulation,
  projectedInboundLineReceipts,
  projectedOutboundLineAllocations
} from "../../client/src/lib/operationsSimulation";
import { db, getWarehouseSnapshot } from "./db/database";

function movementCount() {
  return (db.prepare("SELECT COUNT(*) AS count FROM inventory_movements").get() as { count: number }).count;
}

function runUntilTerminal<T extends ReturnType<typeof createOperationsSimulation>>(simulation: T, timestamp: string): T {
  let result = simulation;
  let safety = 20;
  while (!result.completed && !result.blocker && safety > 0) {
    result = advanceOperationsSimulation(result, timestamp) as T;
    safety -= 1;
  }
  assert.ok(safety > 0, `${simulation.referenceId} scenario did not reach a terminal state`);
  return result;
}

describe("isolated operations simulation", () => {
  it("keeps ASN-1002 ordered, received, and remaining quantities distinct", () => {
    const snapshot = getWarehouseSnapshot();
    let simulation = createOperationsSimulation(snapshot, "inbound", "ASN-1002", "2026-07-14T09:00:00.000Z");

    assert.equal(simulation.baseline.expected, 210);
    assert.equal(simulation.baseline.received, 110);
    assert.equal(simulation.baseline.expected - simulation.baseline.received, 100);

    simulation = advanceOperationsSimulation(simulation, "2026-07-14T09:05:00.000Z");
    assert.equal(simulation.stages[simulation.stageIndex], "Unloading");
    assert.equal(simulation.projected.expected, 210);
    assert.equal(simulation.projected.received, 160);

    simulation = advanceOperationsSimulation(simulation, "2026-07-14T09:10:00.000Z");
    assert.equal(simulation.stages[simulation.stageIndex], "Received");
    assert.equal(simulation.projected.expected, 210);
    assert.equal(simulation.projected.received, 210);
    assert.equal(simulation.impact.onHandDelta, 210, "the unposted goods receipt adds the full expected quantity");

    simulation = advanceOperationsSimulation(simulation, "2026-07-14T09:15:00.000Z");
    assert.equal(simulation.stages[simulation.stageIndex], "QA Pending");
    assert.equal(simulation.blocker?.code, "quality_disposition_required");
    assert.equal(simulation.impact.availableDelta, 0, "Pending QA stock must not become available implicitly");
    const projectedLines = projectedInboundLineReceipts(
      simulation,
      snapshot.inventory.inboundLines.filter((line) => line.asnId === "ASN-1002")
    );
    assert.deepEqual(projectedLines.map((line) => [line.expected, line.received]), [[90, 90], [120, 120]]);
  });

  it("keeps every seeded ASN header, line projection, and baseline delta aligned", () => {
    const snapshot = getWarehouseSnapshot();
    snapshot.inventory.inboundShipments.forEach((shipment) => {
      const lines = snapshot.inventory.inboundLines.filter((line) => line.asnId === shipment.asnId);
      const expected = lines.reduce((total, line) => total + line.qtyExpected, 0);
      const received = lines.reduce((total, line) => total + line.qtyReceived, 0);
      let simulation = createOperationsSimulation(snapshot, "inbound", shipment.asnId, "2026-07-14T09:30:00.000Z");

      assert.equal(simulation.baseline.expected, expected, `${shipment.asnId} expected total`);
      assert.equal(simulation.baseline.received, received, `${shipment.asnId} received total`);
      simulation = runUntilTerminal(simulation, "2026-07-14T09:35:00.000Z");
      const projectedLines = projectedInboundLineReceipts(simulation, lines);
      const receiptAlreadyPosted = Boolean(shipment.goodsReceiptNumber)
        || ["Received", "QA Pending", "QA Hold", "Released", "Putaway", "Put-away", "Putaway Complete", "Put-away Complete", "Closed"].includes(shipment.inboundStatus);
      const postingQuantity = receiptAlreadyPosted ? 0 : expected;

      assert.equal(simulation.projected.received, expected, `${shipment.asnId} projected receipt total`);
      assert.equal(projectedLines.reduce((total, line) => total + line.received, 0), expected, `${shipment.asnId} projected line receipt total`);
      assert.equal(simulation.impact.onHandDelta, postingQuantity, `${shipment.asnId} on-hand posting delta`);
      const hasUnreleasedLine = lines.some((line) => line.qaStatus !== "Released");
      assert.equal(simulation.impact.availableDelta, hasUnreleasedLine ? 0 : postingQuantity, `${shipment.asnId} available delta`);
      assert.equal(Boolean(simulation.blocker), hasUnreleasedLine, `${shipment.asnId} quality blocker`);
    });
  });

  it("does not add ASN-1005 again when all 897 units are already received in the baseline", () => {
    const snapshot = getWarehouseSnapshot();
    let simulation = createOperationsSimulation(snapshot, "inbound", "ASN-1005", "2026-07-14T09:40:00.000Z");

    assert.equal(simulation.baseline.expected, 897);
    assert.equal(simulation.baseline.received, 897);
    simulation = runUntilTerminal(simulation, "2026-07-14T09:41:00.000Z");

    assert.equal(simulation.completed, true);
    assert.equal(simulation.projected.received, 897);
    assert.equal(simulation.impact.onHandDelta, 0);
    assert.equal(simulation.impact.availableDelta, 0);
    assert.equal(simulation.projected.onHand, simulation.baseline.onHand);
    assert.equal(simulation.projected.available, simulation.baseline.available);
  });

  it("stops quarantined and QA-held inbound lines at quality disposition", () => {
    const snapshot = getWarehouseSnapshot();
    const quarantined = createOperationsSimulation(snapshot, "inbound", "ASN-1006", "2026-07-14T09:42:00.000Z");

    assert.equal(quarantined.blocker?.code, "quality_disposition_required");
    assert.equal(quarantined.stages[quarantined.stageIndex], "QA Pending");
    assert.equal(quarantined.impact.availableDelta, 0);
    assert.equal(advanceOperationsSimulation(quarantined), quarantined);

    let qaHeld = createOperationsSimulation(snapshot, "inbound", "ASN-1004", "2026-07-14T09:43:00.000Z");
    qaHeld = runUntilTerminal(qaHeld, "2026-07-14T09:44:00.000Z");
    assert.equal(qaHeld.blocker?.code, "quality_disposition_required");
    assert.equal(qaHeld.stages[qaHeld.stageIndex], "QA Pending");
    assert.equal(qaHeld.impact.onHandDelta, 130);
    assert.equal(qaHeld.impact.availableDelta, 0);
  });

  it("keeps every seeded outbound header and projected line allocation aligned", () => {
    const snapshot = getWarehouseSnapshot();
    snapshot.inventory.outboundShipments.forEach((shipment) => {
      const lines = snapshot.inventory.outboundLines.filter((line) => line.shipmentId === shipment.shipmentId);
      const required = lines.reduce((total, line) => total + line.qtyRequired, 0);
      const allocated = lines.reduce((total, line) => total + line.qtyAllocated, 0);
      let simulation = createOperationsSimulation(snapshot, "outbound", shipment.shipmentId, "2026-07-14T09:45:00.000Z");

      assert.equal(simulation.baseline.required, required, `${shipment.shipmentId} required total`);
      assert.equal(simulation.baseline.allocated, allocated, `${shipment.shipmentId} allocated total`);
      simulation = runUntilTerminal(simulation, "2026-07-14T09:50:00.000Z");
      const projectedLines = projectedOutboundLineAllocations(simulation, lines);

      assert.equal(projectedLines.reduce((total, line) => total + line.required, 0), required, `${shipment.shipmentId} projected required total`);
      assert.equal(projectedLines.reduce((total, line) => total + line.allocated, 0), simulation.projected.allocated, `${shipment.shipmentId} projected allocation total`);
      assert.ok(projectedLines.every((line) => line.allocated <= line.required), `${shipment.shipmentId} allocation must not exceed required quantity`);
      if (shipment.shipmentId === "SHIP-005") {
        assert.equal(simulation.blocker?.code, "outbound_blocked");
        assert.equal(simulation.projected.dispatched, 0);
        assert.equal(simulation.transportStatus, "Planned");
      } else {
        assert.equal(simulation.completed, true, `${shipment.shipmentId} should complete with eligible stock`);
        assert.equal(simulation.projected.dispatched, required, `${shipment.shipmentId} dispatched total`);
      }
    });
  });

  it("does not silently release or dispatch blocked SHIP-005", () => {
    const snapshot = getWarehouseSnapshot();
    const simulation = createOperationsSimulation(snapshot, "outbound", "SHIP-005", "2026-07-14T09:55:00.000Z");

    assert.equal(simulation.baseline.required, 20);
    assert.equal(simulation.baseline.allocated, 0);
    assert.equal(simulation.blocker?.code, "outbound_blocked");
    assert.match(simulation.blocker?.detail ?? "", /not eligible|blocker/i);
    assert.equal(simulation.projected.allocated, 0);
    assert.equal(simulation.projected.dispatched, 0);
    assert.deepEqual(simulation.impact, {
      onHandDelta: 0,
      availableDelta: 0,
      reservedDelta: 0,
      pickedDelta: 0,
      packedDelta: 0,
      stagedDelta: 0
    });
    assert.equal(advanceOperationsSimulation(simulation, "2026-07-14T09:56:00.000Z"), simulation);
  });

  it("projects inbound receipt without changing the warehouse snapshot or movement ledger", () => {
    const snapshot = getWarehouseSnapshot();
    const shipment = snapshot.inventory.inboundShipments.find((item) => !["Putaway Complete", "Closed"].includes(item.inboundStatus));
    assert.ok(shipment, "an active inbound baseline is required");
    const snapshotBefore = JSON.stringify(snapshot);
    const movementsBefore = movementCount();
    let simulation = createOperationsSimulation(snapshot, "inbound", shipment.asnId, "2026-07-14T10:00:00.000Z");

    while (!simulation.completed && !simulation.blocker && simulation.stages[simulation.stageIndex] !== "Received") {
      simulation = advanceOperationsSimulation(simulation, "2026-07-14T10:05:00.000Z");
    }

    assert.equal(simulation.projected.received, simulation.projected.expected);
    assert.ok(simulation.ledger.every((event) => event.eventId.startsWith("SIM-")));
    assert.equal(JSON.stringify(snapshot), snapshotBefore);
    assert.equal(movementCount(), movementsBefore);
  });

  it("projects outbound bucket transfers without mutating stock balances", () => {
    const snapshot = getWarehouseSnapshot();
    const shipment = snapshot.inventory.outboundShipments.find((item) => item.shipmentId === "SHIP-008");
    assert.ok(shipment, "an active outbound baseline is required");
    const balancesBefore = JSON.stringify(snapshot.inventory.stockBalances);
    const movementsBefore = movementCount();
    let simulation = createOperationsSimulation(snapshot, "outbound", shipment.shipmentId, "2026-07-14T11:00:00.000Z");

    simulation = advanceOperationsSimulation(simulation, "2026-07-14T11:05:00.000Z");

    assert.equal(simulation.projected.allocated, simulation.baseline.required);
    assert.ok(simulation.projected.allocated > simulation.baseline.allocated);
    assert.equal(JSON.stringify(snapshot.inventory.stockBalances), balancesBefore);
    assert.equal(movementCount(), movementsBefore);
  });

  it("stops producing events after a scenario reaches its final stage", () => {
    const snapshot = getWarehouseSnapshot();
    const shipment = snapshot.inventory.outboundShipments.find((item) => item.shipmentId === "SHIP-008");
    assert.ok(shipment);
    let simulation = createOperationsSimulation(snapshot, "outbound", shipment.shipmentId, "2026-07-14T12:00:00.000Z");
    simulation = runUntilTerminal(simulation, "2026-07-14T12:05:00.000Z");
    const ledgerLength = simulation.ledger.length;

    const unchanged = advanceOperationsSimulation(simulation, "2026-07-14T12:10:00.000Z");

    assert.equal(unchanged, simulation);
    assert.equal(unchanged.ledger.length, ledgerLength);
  });
});
