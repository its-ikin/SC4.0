import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildInventoryPlanning } from "@twinops/shared";
import { processUserQuery } from "./orchestrator";
import {
  getInventoryData,
  getInventoryPlacements,
  getOperationalEvents,
  getProducts
} from "./db/database";
import { get_transport_context } from "./tools";

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

describe("inventory-planning assistant handoff", () => {
  it("verifies the dashboard horizon and demand scenario without a model", async () => {
    const product = getProducts()[0];
    assert.ok(product);
    const response = await withoutModel(() => processUserQuery(
      `Review replenishment and expiry risk for ${product.productCode} (${product.productId}). The Inventory Planning screen is testing a 14-day horizon at 1.25x average demand. Use the authoritative inventory-planning calculation to verify this displayed snapshot and suggest a safe read-only action.`
    ));
    const planning = response.toolResults?.get_inventory_planning as any;

    assert.equal(response.fallbackUsed, false);
    assert.equal(response.agentResponse.title, "Inventory Planning Review");
    assert.equal(response.toolsCalled[0]?.toolName, "get_inventory_planning");
    assert.equal(planning.product.productCode, product.productCode);
    assert.equal(planning.horizonDays, 14);
    assert.equal(planning.demandMultiplier, 1.25);
    assert.match(response.agentResponse.summary, /14-day.*1\.25x/i);
    assert.equal(response.requiresApproval, false);
  });

  it("routes a selected stock-balance impact request through location and FEFO evidence", async () => {
    const response = await withoutModel(() => processUserQuery(
      "Check FEFO and shipment impact for stock balance STK-100004-01 against linked shipment SHIP-006. Explain the affected warehouse stages and any sequencing risk."
    ));

    assert.equal(response.fallbackUsed, false);
    assert.equal(response.agentResponse.intent, "sku_location");
    assert.deepEqual(
      response.toolsCalled.map((tool) => tool.toolName),
      ["locate_sku", "check_fefo_impact"]
    );
    assert.match(response.agentResponse.summary, /STK-100004-01|PH-COLD-ADAL40-PEN/);
  });

  it("checks product-level FEFO evidence when the selected stock balance has no shipment", async () => {
    const response = await withoutModel(() => processUserQuery(
      "Check FEFO and warehouse impact for stock balance STK-200006-02. No linked shipment is selected, so do not assume one."
    ));

    assert.equal(response.fallbackUsed, false);
    assert.deepEqual(
      response.toolsCalled.map((tool) => tool.toolName),
      ["locate_sku", "check_fefo_allocation"]
    );
    assert.equal((response.toolResults?.check_fefo_allocation as any)?.requestedQty, 267);
    assert.doesNotMatch(response.agentResponse.summary, /could not verify FEFO|FEFO eligibility is still unverified/i);
    assert.ok(response.agentResponse.dataGaps.every((gap) => !/FEFO eligibility requires/i.test(gap)));
  });

  it("exposes connected critical, warning, and expiry examples across operational views", () => {
    const inventory = getInventoryData();
    const latestStockUpdate = Math.max(...inventory.stockBalances.map((balance) => new Date(balance.lastUpdated).getTime()));
    const plan = buildInventoryPlanning(inventory, {
      horizonDays: 14,
      demandMultiplier: 1,
      asOf: new Date(latestStockUpdate)
    });
    const rows = new Map(plan.rows.map((row) => [row.product.productCode, row]));

    assert.equal(rows.get("PH-COLD-ADAL40-PEN")?.risk, "critical");
    assert.equal(rows.get("PH-COLD-FLUVAX-PFS")?.risk, "warning");
    assert.equal(rows.get("PH-CRT-OMEP20-CAP")?.risk, "expiry");
    assert.equal(rows.get("PH-COLD-ADAL40-PEN")?.stockoutDay, 5);
    assert.ok((rows.get("PH-CRT-OMEP20-CAP")?.expiryRiskUnits ?? 0) > 0);

    const connectedCodes = new Set(["PH-COLD-ADAL40-PEN", "PH-COLD-FLUVAX-PFS", "PH-CRT-OMEP20-CAP"]);
    const connectedProductIds = new Set(plan.rows
      .filter((row) => connectedCodes.has(row.product.productCode))
      .map((row) => row.product.productId));
    assert.equal(connectedProductIds.size, 3);
    assert.ok(getInventoryPlacements().filter((placement) => connectedCodes.has(placement.productCode ?? "")).length >= 6);
    assert.ok(inventory.movements.filter((movement) => connectedProductIds.has(movement.productId)).length >= 3);

    for (const position of inventory.stockPositions.filter((item) => connectedProductIds.has(item.product.productId))) {
      for (const batch of position.batches) {
        assert.equal(
          batch.qtyOnHand,
          batch.qtyAvailable + batch.qtyReserved + batch.qtyPicked + batch.qtyPacked + batch.qtyStaged + batch.qtyOnHold,
          `${batch.stockBalanceId} execution buckets must reconcile to on-hand stock`
        );
      }
    }

    const fluTransport = get_transport_context("SHIP-002").records[0];
    const adalimumabTransport = get_transport_context("SHIP-006").records[0];
    assert.equal(fluTransport.wmsLines.filter((line: any) => line.product?.productCode === "PH-COLD-FLUVAX-PFS").length, 3);
    assert.equal(adalimumabTransport.wmsLines.filter((line: any) => line.product?.productCode === "PH-COLD-ADAL40-PEN").length, 2);
    assert.ok(getOperationalEvents().some((event) => event.eventId === "EVT-SYSTEM-INVENTORY-PLANNING-RISK-V1"));
  });
});
