import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryPlacement, Shipment } from "@twinops/shared";
import { useAppStore } from "../store";
import { makeNavigationSnapshot } from "../test/navigationFixture";
import ChatPanel from "./ChatPanel";

const apiMocks = vi.hoisted(() => ({
  streamChat: vi.fn(async () => undefined),
  runTool: vi.fn(async () => ({})),
  getWarehouse: vi.fn()
}));

vi.mock("../api", () => ({
  streamChat: apiMocks.streamChat,
  runTool: apiMocks.runTool,
  getWarehouse: apiMocks.getWarehouse
}));

const initialState = useAppStore.getInitialState();

describe("ChatPanel impact handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState(initialState, true);
    const snapshot = makeNavigationSnapshot();
    const placement: InventoryPlacement = {
      stockBalanceId: "STK-100004-01",
      productId: "MAT-100004",
      productCode: "PH-COLD-ADAL40-PEN",
      batchId: "B-L2604-ADAL40-01",
      locationId: "CS-04-01-A10",
      productName: "Adalimumab injection",
      category: "Biologic",
      zoneId: "CS",
      zoneName: "Cold Storage",
      rack: "CS-04",
      bin: "01-A10",
      batchNo: "L2604-ADAL40-01",
      expiryDate: "2027-03-17T00:00:00.000Z",
      quantity: 122,
      priority: "HIGH",
      temperatureMin: 2,
      temperatureMax: 8,
      regField: "Released",
      qualityStatus: "Released",
      linkedShipmentId: "SHIP-006",
      currentStage: "Storage",
      dispatchSequence: 1,
      qtyAvailable: 0,
      qtyReserved: 122
    };
    const shipment: Shipment = {
      id: "SHIP-006",
      destination: "Changi General Hospital campus",
      priority: "NORMAL",
      dockId: "D-02",
      dispatchTime: "2026-07-20T08:00:00.000Z",
      status: "Allocated",
      productIds: ["MAT-100004"],
      batchIds: ["B-L2604-ADAL40-01"],
      stockBalanceIds: ["STK-100004-01"],
      coldChainRequired: true,
      slaDeadline: "2026-07-20T10:00:00.000Z",
      qualityFlags: []
    };
    snapshot.inventoryPlacements = [placement];
    snapshot.shipments = [shipment];
    useAppStore.setState({
      snapshot,
      view: "Inventory",
      inventoryWorkspace: "stock",
      selectedStockBalanceId: placement.stockBalanceId,
      selectedShipmentId: shipment.id
    });
  });

  it("switches from Inspector to Chat and submits the selected impact query", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    await user.click(screen.getByRole("button", { name: "Check Impact" }));

    expect(apiMocks.streamChat).toHaveBeenCalledWith(
      expect.stringContaining("STK-100004-01"),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      "balanced",
      expect.any(Object)
    );
    expect(screen.getByText(/Check FEFO and shipment impact for stock balance STK-100004-01/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check Impact" })).not.toBeInTheDocument();
  });
});
