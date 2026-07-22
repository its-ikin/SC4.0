import { describe, expect, it } from "vitest";
import {
  buildInventoryPlanning,
  type BatchStockPosition,
  type InventoryData,
  type Product
} from "@twinops/shared";

const asOf = "2026-07-20T00:00:00.000Z";

function product(overrides: Partial<Product> = {}): Product {
  return {
    productId: "P-1",
    productCode: "TEST-PRODUCT",
    productName: "Planning Test Product",
    productFamily: "Biologic",
    defaultTempBand: "2-8 C",
    storageClass: "Cold chain",
    unitType: "Pack",
    safetyStock: 30,
    reorderPoint: 50,
    targetStock: 100,
    leadTimeDays: 5,
    averageDailyDemand: 10,
    gtin: "00000000000000",
    manufacturer: "Test Manufacturer",
    dosageForm: "Test",
    strength: "Test",
    packSize: "1",
    ...overrides
  };
}

function batch(productId: string, overrides: Partial<BatchStockPosition> = {}): BatchStockPosition {
  return {
    batchId: "B-1",
    lotCode: "LOT-1",
    productId,
    expiryDate: "2026-09-20T00:00:00.000Z",
    manufactureDate: null,
    qualityStatus: "Released",
    tempBand: "2-8 C",
    serializationStatus: null,
    notes: null,
    stoNumber: "STO-1",
    goodsReceiptNumber: "GR-1",
    arrivalAt: "2026-07-01T00:00:00.000Z",
    putawayAt: "2026-07-01T01:00:00.000Z",
    handlingUnit: "HU-1",
    inspectionLot: "IL-1",
    countryOfOrigin: "SG",
    lastCycleCountAt: "2026-07-19T00:00:00.000Z",
    location: { locationId: "CS-R01-B01", zone: "Cold Storage", rack: "R01", bin: "B01", tempBand: "2-8 C", capacity: 500, currentFill: 100 },
    stockBalanceId: "STK-1",
    qtyOnHand: 40,
    qtyAvailable: 40,
    qtyReserved: 0,
    qtyPicked: 0,
    qtyPacked: 0,
    qtyStaged: 0,
    qtyDispatched: 0,
    qtyOnHold: 0,
    linkedInboundIds: [],
    linkedShipmentIds: [],
    ...overrides
  };
}

function inventory(productRecord: Product, available: number, batches: BatchStockPosition[] = [batch(productRecord.productId, { qtyOnHand: available, qtyAvailable: available })]): InventoryData {
  return {
    products: [productRecord],
    batches: [],
    locations: [],
    stockBalances: [],
    inboundShipments: [],
    inboundLines: [],
    outboundShipments: [],
    outboundLines: [],
    movements: [],
    stockPositions: [{
      product: productRecord,
      totalOnHand: available,
      totalAvailable: available,
      totalReserved: 0,
      totalPicked: 0,
      totalPacked: 0,
      totalStaged: 0,
      totalQaHold: 0,
      earliestExpiry: batches[0]?.expiryDate ?? null,
      batches
    }],
    summary: { onHand: available, available, reserved: 0, incomingToday: 0, outboundToday: 0, qaHold: 0, productCount: 1, batchCount: batches.length }
  };
}

describe("inventory planning projection", () => {
  it("classifies a stock-out before supplier lead time as critical", () => {
    const data = inventory(product(), 20);
    const result = buildInventoryPlanning(data, { horizonDays: 14, demandMultiplier: 1, asOf });
    const row = result.rows[0];

    expect(row.risk).toBe("critical");
    expect(row.stockoutDay).toBe(2);
    expect(row.projectedAtLeadTime).toBe(-30);
    expect(row.recommendedOrderQty).toBe(130);
    expect(result.summary.stockoutsBeforeReplenishment).toBe(1);
  });

  it("counts only quality-released outstanding inbound as conditional supply", () => {
    const record = product();
    const data = inventory(record, 40);
    data.inboundShipments = [
      { asnId: "ASN-RELEASED", plannedArrival: "2026-07-23T00:00:00.000Z", eta: "2026-07-23T00:00:00.000Z" },
      { asnId: "ASN-PENDING", plannedArrival: "2026-07-22T00:00:00.000Z", eta: "2026-07-22T00:00:00.000Z" }
    ] as InventoryData["inboundShipments"];
    data.inboundLines = [
      { inboundLineId: "IN-1", asnId: "ASN-RELEASED", productId: record.productId, batchId: "B-IN-1", qtyExpected: 60, qtyReceived: 10, tempBand: "2-8 C", receivingStatus: "Expected", qaStatus: "Released" },
      { inboundLineId: "IN-2", asnId: "ASN-PENDING", productId: record.productId, batchId: "B-IN-2", qtyExpected: 100, qtyReceived: 0, tempBand: "2-8 C", receivingStatus: "Expected", qaStatus: "Pending QA" }
    ];

    const row = buildInventoryPlanning(data, { horizonDays: 14, demandMultiplier: 1, asOf }).rows[0];

    expect(row.plannedInbound).toBe(50);
    expect(row.curve.find((point) => point.day === 2)?.plannedInbound).toBe(0);
    expect(row.curve.find((point) => point.day === 3)?.plannedInbound).toBe(50);
    expect(row.projectedAtLeadTime).toBe(40);
  });

  it("responds deterministically to a higher demand scenario", () => {
    const data = inventory(product(), 100);
    const normal = buildInventoryPlanning(data, { horizonDays: 14, demandMultiplier: 1, asOf }).rows[0];
    const surge = buildInventoryPlanning(data, { horizonDays: 14, demandMultiplier: 2, asOf }).rows[0];

    expect(normal.scaledDailyDemand).toBe(10);
    expect(surge.scaledDailyDemand).toBe(20);
    expect(normal.stockoutDay).toBe(10);
    expect(surge.stockoutDay).toBe(5);
    expect(surge.projectedAtHorizon).toBeLessThan(normal.projectedAtHorizon);
  });

  it("projects FEFO quantity that remains when a released lot expires", () => {
    const record = product({ safetyStock: 0, reorderPoint: 0, leadTimeDays: 1 });
    const expiring = batch(record.productId, { expiryDate: "2026-07-23T00:00:00.000Z", qtyOnHand: 100, qtyAvailable: 100 });
    const row = buildInventoryPlanning(inventory(record, 100, [expiring]), { horizonDays: 7, demandMultiplier: 1, asOf }).rows[0];

    expect(row.expiryRiskUnits).toBe(70);
    expect(row.expiryRiskLots[0]).toMatchObject({ lotCode: "LOT-1", projectedRemainingAtExpiry: 70 });
    expect(row.risk).toBe("expiry");
  });

  it("handles products with no configured demand without inventing a stock-out", () => {
    const record = product({ averageDailyDemand: 0 });
    const row = buildInventoryPlanning(inventory(record, 40), { horizonDays: 30, demandMultiplier: 2, asOf }).rows[0];

    expect(row.daysOfCover).toBeNull();
    expect(row.stockoutDay).toBeNull();
    expect(row.projectedAtHorizon).toBe(40);
  });
});
