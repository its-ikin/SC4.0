import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InventoryControlView from "./InventoryControlView";
import { useAppStore } from "../store";
import { makeNavigationSnapshot } from "../test/navigationFixture";
import type { BatchStockPosition, Product } from "@twinops/shared";

const initialState = useAppStore.getInitialState();

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterAll(() => vi.unstubAllGlobals());

describe("Inventory workspace navigation", () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
    useAppStore.getState().setSnapshot(makeNavigationSnapshot());
  });

  it("offers Overview, Stock positions, Planning, and Movements", () => {
    render(<InventoryControlView />);

    const navigation = screen.getByRole("navigation", { name: "Inventory sections" });
    expect(within(navigation).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Overview",
      "Stock positions",
      "Planning",
      "Movements"
    ]);
    expect(within(navigation).queryByRole("button", { name: "Inbound" })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole("button", { name: "Outbound" })).not.toBeInTheDocument();
  });

  it("uses the existing Ask Assistant action pattern from Planning", async () => {
    const product: Product = {
      productId: "P-PLAN",
      productCode: "PLAN-SKU",
      productName: "Planning Product",
      productFamily: "Biologic",
      defaultTempBand: "2-8 C",
      storageClass: "Cold chain",
      unitType: "Pack",
      safetyStock: 20,
      reorderPoint: 40,
      targetStock: 100,
      leadTimeDays: 5,
      averageDailyDemand: 10,
      gtin: "00000000000000",
      manufacturer: "Test",
      dosageForm: "Test",
      strength: "Test",
      packSize: "1"
    };
    const batch: BatchStockPosition = {
      batchId: "B-PLAN-01",
      lotCode: "LOT-PLAN-01",
      productId: product.productId,
      expiryDate: "2026-08-01T00:00:00.000Z",
      manufactureDate: "2026-01-01T00:00:00.000Z",
      qualityStatus: "Released",
      tempBand: "2-8 C",
      serializationStatus: "Serialized",
      notes: null,
      stoNumber: "STO-PLAN",
      goodsReceiptNumber: "GR-PLAN",
      arrivalAt: "2026-07-01T00:00:00.000Z",
      putawayAt: "2026-07-01T02:00:00.000Z",
      handlingUnit: "HU-PLAN",
      inspectionLot: "IL-PLAN",
      countryOfOrigin: "Singapore",
      lastCycleCountAt: "2026-07-18T00:00:00.000Z",
      location: {
        locationId: "CS-PLAN-01",
        zone: "Cold Storage",
        rack: "CS-01",
        bin: "A01",
        tempBand: "2-8 C",
        capacity: 100,
        currentFill: 30
      },
      stockBalanceId: "STK-PLAN-01",
      qtyOnHand: 30,
      qtyAvailable: 20,
      qtyReserved: 10,
      qtyPicked: 0,
      qtyPacked: 0,
      qtyStaged: 0,
      qtyDispatched: 0,
      qtyOnHold: 0,
      linkedInboundIds: [],
      linkedShipmentIds: ["SHIP-PLAN"]
    };
    const snapshot = makeNavigationSnapshot();
    snapshot.inventory.products = [product];
    snapshot.inventory.stockPositions = [{
      product,
      totalOnHand: 30,
      totalAvailable: 30,
      totalReserved: 0,
      totalPicked: 0,
      totalPacked: 0,
      totalStaged: 0,
      totalQaHold: 0,
      earliestExpiry: null,
      batches: [batch]
    }];
    snapshot.inventory.summary.productCount = 1;
    useAppStore.getState().setSnapshot(snapshot);
    const user = userEvent.setup();
    render(<InventoryControlView />);

    await user.click(screen.getByRole("button", { name: "Planning" }));
    expect(screen.getByTestId("inventory-planning-workspace")).toBeInTheDocument();
    await user.click(screen.getByRole("row", { name: /PLAN-SKU/ }));
    expect(useAppStore.getState().selectedStockBalanceId).toBe("STK-PLAN-01");

    const askButton = screen.getByRole("button", { name: "Ask Assistant" });
    expect(askButton).toHaveClass("bg-twin-orange");
    await user.click(askButton);

    expect(useAppStore.getState().chatOpen).toBe(true);
    expect(useAppStore.getState().assistantQueryRequest?.text).toContain("PLAN-SKU");
    expect(useAppStore.getState().assistantQueryRequest?.text).toContain("displayed deterministic snapshot");
    expect(useAppStore.getState().assistantQueryRequest?.text).toContain("30 available now");
    expect(useAppStore.getState().assistantQueryRequest?.text).toContain("scenario assumptions");
  });

  it("routes compact inbound and outbound workload summaries to Logistics", async () => {
    const user = userEvent.setup();
    render(<InventoryControlView />);

    await user.click(screen.getByRole("button", { name: "Open inbound in Logistics" }));
    expect(useAppStore.getState()).toMatchObject({
      view: "Logistics",
      logisticsWorkspace: "inbound",
      selectedInboundAsnId: "ASN-IN",
      selectedShipmentId: null
    });

    await user.click(screen.getByRole("button", { name: "Open outbound in Logistics" }));
    expect(useAppStore.getState()).toMatchObject({
      view: "Logistics",
      logisticsWorkspace: "outbound",
      selectedInboundAsnId: null,
      selectedShipmentId: "SHIP-OUT"
    });
  });
});
