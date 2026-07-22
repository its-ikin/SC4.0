import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  check_cold_chain_status,
  check_dock_schedule,
  check_fefo_allocation,
  get_inventory_planning,
  get_inventory_summary,
  get_transport_context,
  locate_sku,
  runTool,
  simulate_shipment_allocation,
  simulate_transport_impact
} from "./tools";
import { db, getDockAppointments, getProductStockPositions, getProducts, getInventoryPlacements, getStockBalances, getTransportLegs, getWarehouseLocations, getZones } from "./db/database";
import { buildWarehouseBins, getSector, getSectorMetrics, wmsLocationLabel } from "../../client/src/warehouseLayout";

before(async () => {
  const { seedIfEmpty } = await import("./db/seed");
  seedIfEmpty();
});

describe("locate_sku", () => {
  it("locates a real batch with its zone, rack, and bin", () => {
    const result = locate_sku("STK-100001-01");
    assert.equal(result.stockBalanceId, "STK-100001-01");
    assert.equal(result.zone.name, "Cold Storage");
    assert.ok(result.rack);
    assert.ok(result.bin);
  });

  it("throws for a batch that does not exist, instead of returning a fabricated location", () => {
    assert.throws(() => locate_sku("GSK-VAX-9999"), /was not found/);
  });
});

describe("check_cold_chain_status", () => {
  it("reports no breach when the zone is within its temperature band", () => {
    // Seeded Cold Storage band is 2-8 C. The live reading drifts slightly over time via the
    // simulated temperature history, so assert the invariant (in-band, no breach) rather than
    // a specific reading.
    const result = check_cold_chain_status("Cold Storage");
    assert.equal(result.requiredMin, 2);
    assert.equal(result.requiredMax, 8);
    assert.ok(result.currentTemperature >= result.requiredMin && result.currentTemperature <= result.requiredMax);
    assert.equal(result.breachSeverity, "none");
  });

  it("throws for a zone that does not exist", () => {
    assert.throws(() => check_cold_chain_status("Nonexistent Zone"), /was not found/);
  });
});

describe("check_fefo_allocation", () => {
  it("excludes QA Hold batches from FEFO-eligible allocation", () => {
    // The second adalimumab lot is QA Hold and must never be eligible.
    const result = check_fefo_allocation("PH-COLD-ADAL40-PEN", 1);
    const excludedLotCodes = result.excludedBatches.map((batch) => batch.lotCode);
    assert.ok(excludedLotCodes.includes("L2604-ADAL40-02"));
    const excludedEntry = result.excludedBatches.find((batch) => batch.lotCode === "L2604-ADAL40-02");
    assert.ok(excludedEntry?.reasons.includes("QA Hold"));
    const eligibleLotCodes = result.eligibleBatches.map((batch) => batch.lotCode);
    assert.ok(!eligibleLotCodes.includes("L2604-ADAL40-02"));
  });

  it("reports a shortfall when the requested quantity exceeds eligible available stock", () => {
    const result = check_fefo_allocation("PH-COLD-ADAL40-PEN", 1_000_000);
    assert.ok(result.shortfallQty > 0);
  });
});

describe("check_dock_schedule", () => {
  it("returns a well-formed schedule scan for the requested time window", () => {
    const result = check_dock_schedule("next 4 hours");
    assert.equal(result.timeWindow, "next 4 hours");
    assert.ok(Array.isArray(result.dockSlotConflicts));
    assert.ok(Array.isArray(result.availableSlots));
  });
});

describe("get_inventory_summary", () => {
  it("returns non-negative aggregate quantities", () => {
    const summary = get_inventory_summary();
    assert.ok(summary.onHand >= 0);
    assert.ok(summary.available >= 0);
    assert.ok(summary.reserved >= 0);
  });
});

describe("get_inventory_planning", () => {
  it("reproduces a product planning scenario from canonical inventory data", () => {
    const product = getProducts()[0];
    assert.ok(product);
    const result = get_inventory_planning(product.productCode, 14, 1.25);
    assert.equal(result.product.productCode, product.productCode);
    assert.equal(result.horizonDays, 14);
    assert.equal(result.demandMultiplier, 1.25);
    assert.equal(result.curve.length, 15);
    assert.ok(result.availableNow >= 0);
    assert.ok(["critical", "warning", "expiry", "healthy"].includes(result.risk));
  });
});

describe("read-only assistant tools", () => {
  it("stores shipment analysis without creating an approval action or changing stock", () => {
    const beforeActions = (db.prepare("SELECT COUNT(*) AS count FROM approval_actions").get() as { count: number }).count;
    const beforeStock = getStockBalances();
    db.exec("BEGIN");
    try {
      const result = simulate_shipment_allocation("SHIP-001");
      const afterActions = (db.prepare("SELECT COUNT(*) AS count FROM approval_actions").get() as { count: number }).count;
      assert.equal(result.recommendedActionId, null);
      assert.equal(result.mutationApplied, false);
      assert.match(result.scenarioId, /^SCN-/);
      assert.equal(afterActions, beforeActions);
      assert.deepEqual(getStockBalances(), beforeStock);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("joins exact transport, WMS, yard, dock, site, and event records", () => {
    const result = get_transport_context("SHIP-005");
    assert.equal(result.recordCount, 1);
    const record = result.records[0];
    assert.equal(record.transportLeg.transportLegId, "LEG-OUT-005");
    assert.equal(record.transportLeg.shipmentId, "SHIP-005");
    assert.ok(record.wmsDocument && "shipmentId" in record.wmsDocument);
    assert.equal(record.wmsDocument.shipmentId, "SHIP-005");
    assert.equal(record.dockAppointment?.dockAppointmentId, "APT-OUT-005");
    assert.equal(record.physicalDock?.id, "D5");
    assert.equal(record.originSite?.siteId, record.transportLeg.originSiteId);
    assert.equal(record.destinationSite?.siteId, record.transportLeg.destinationSiteId);
    assert.ok(record.wmsLines.length > 0);
    assert.ok(record.operationalEvents.length > 0);
  });

  it("resolves the same canonical movement from an ASN or dock appointment", () => {
    const byAsn = get_transport_context("ASN-1001").records[0];
    const byAppointment = get_transport_context("APT-IN-1001").records[0];
    assert.equal(byAsn.transportLeg.transportLegId, "LEG-IN-1001");
    assert.equal(byAppointment.transportLeg.transportLegId, byAsn.transportLeg.transportLegId);
    assert.ok(byAppointment.wmsDocument && "asnId" in byAppointment.wmsDocument);
    assert.equal(byAppointment.wmsDocument.asnId, "ASN-1001");
  });

  it("rejects unknown transport identifiers instead of fabricating links", () => {
    assert.throws(() => get_transport_context("LEG-OUT-9999"), /was not found/i);
  });

  it("projects a cross-domain transport scenario without mutating operational records", () => {
    const beforeLegs = getTransportLegs();
    const beforeAppointments = getDockAppointments();
    const beforeStock = getStockBalances();
    const beforeActions = (db.prepare("SELECT COUNT(*) AS count FROM approval_actions").get() as { count: number }).count;
    db.exec("BEGIN");
    try {
      const result = simulate_transport_impact("SHIP-005", "vehicle_breakdown", 90);
      assert.equal(result.transportLegId, "LEG-OUT-005");
      assert.equal(result.delayMinutes, 90);
      assert.equal(result.mutationApplied, false);
      assert.equal(result.recommendedActionId, null);
      assert.ok(result.affectedSkus.length > 0);
      assert.ok(result.affectedStages.includes("Delivery"));
      assert.equal(result.options.length, 3);
      assert.match(result.scenarioId, /^SCN-/);
      assert.deepEqual(getTransportLegs(), beforeLegs);
      assert.deepEqual(getDockAppointments(), beforeAppointments);
      assert.deepEqual(getStockBalances(), beforeStock);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM approval_actions").get() as { count: number }).count, beforeActions);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("rejects legacy mutation tool names", async () => {
    await assert.rejects(runTool("apply_approved_action", { actionId: "ACT-LEGACY" }), /read-only/i);
    await assert.rejects(runTool("apply_approved_inventory_action", { actionId: "ACT-LEGACY" }), /read-only/i);
  });
});

describe("inventory-to-warehouse integrity", () => {
  it("projects every active stock balance onto its exact WMS rack or controlled area", () => {
    const positions = getProductStockPositions().flatMap((position) => position.batches);
    const skus = getInventoryPlacements();
    const bins = buildWarehouseBins(skus);

    assert.equal(skus.length, positions.length);
    assert.equal(bins.length, positions.length);

    for (const position of positions) {
      const sku = skus.find((item) => item.stockBalanceId === position.stockBalanceId);
      assert.ok(sku, `Missing warehouse projection for ${position.stockBalanceId}`);
      assert.equal(sku.productId, position.productId);
      assert.equal(sku.batchId, position.batchId);
      assert.equal(sku.locationId, position.location.locationId);
      assert.equal(sku.rack, position.location.rack);
      assert.equal(sku.bin, position.location.bin);
      assert.equal(wmsLocationLabel(sku), position.location.locationId);

      const bin = bins.find((item) => item.placement.stockBalanceId === position.stockBalanceId);
      assert.ok(bin, `Missing warehouse bin for ${position.stockBalanceId}`);
      const controlledZone = sku.zoneId === "QA" || sku.zoneId === "QAC" || sku.zoneId === "QT";
      const visualControlledZone = sku.zoneId === "QAC" ? "QA" : sku.zoneId;
      const expectedRackId = controlledZone
        ? `${visualControlledZone}-CONTROLLED`
        : position.location.rack.replace(/^([A-Z]+)-/, "$1-R");
      assert.equal(bin.rackId, expectedRackId);
      assert.equal(bin.storageKind, controlledZone ? "controlled-area" : "rack");
    }

    const visualLocations = bins.map((bin) => `${bin.rackId}/${bin.label}`);
    assert.equal(new Set(visualLocations).size, visualLocations.length, "Warehouse bin projections must not collide");
  });

  it("physically segregates restricted stock in QA Hold and Quarantine", () => {
    const placements = getInventoryPlacements();
    for (const placement of placements) {
      if (placement.qualityStatus === "QA Hold" || placement.qualityStatus === "Pending QA") {
        if (placement.temperatureMin === 2 && placement.temperatureMax === 8) {
          assert.equal(placement.zoneId, "QAC", `${placement.stockBalanceId} is not in cold QA Hold`);
          assert.match(placement.locationId ?? "", /^QA-COLD-/);
        } else {
          assert.equal(placement.zoneId, "QA", `${placement.stockBalanceId} is not in QA Hold`);
          assert.match(placement.locationId ?? "", /^QA-HOLD-/);
        }
      }
      if (placement.qualityStatus === "Quarantine") {
        assert.equal(placement.zoneId, "QT", `${placement.stockBalanceId} is not in Quarantine`);
        assert.match(placement.locationId ?? "", /^QT-/);
      }
    }
  });

  it("reports controlled-area fill and stock-position counts from the same zone truth", () => {
    const placements = getInventoryPlacements();
    const zones = getZones();
    for (const zoneId of ["QA", "QT"] as const) {
      const metrics = getSectorMetrics(getSector(zoneId), zones, placements);
      assert.equal(metrics.dataZone?.id, zoneId);
      const expectedPlacements = placements.filter((placement) =>
        zoneId === "QA" ? placement.zoneId === "QA" || placement.zoneId === "QAC" : placement.zoneId === zoneId
      );
      assert.equal(metrics.sectorPlacements.length, expectedPlacements.length);
      assert.ok((metrics.dataZone?.fillPercent ?? 0) > 0, `${zoneId} should report occupied capacity`);
    }
  });

  it("keeps warehouse location fill equal to live on-hand inventory", () => {
    const balances = getStockBalances();
    const onHandByLocation = new Map<string, number>();
    balances.forEach((balance) => onHandByLocation.set(balance.locationId, (onHandByLocation.get(balance.locationId) ?? 0) + balance.qtyOnHand));

    for (const location of getWarehouseLocations()) {
      assert.equal(location.currentFill, onHandByLocation.get(location.locationId) ?? 0, `Stale fill at ${location.locationId}`);
    }
  });
});
