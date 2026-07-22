import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogisticsView from "./LogisticsView";
import { useAppStore } from "../store";
import { makeNavigationSnapshot } from "../test/navigationFixture";

const initialState = useAppStore.getInitialState();

describe("Logistics workspace navigation", () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
    useAppStore.getState().setSnapshot(makeNavigationSnapshot());
    useAppStore.getState().setLogisticsWorkspace("transport");
  });

  it("offers Network, Inbound, Outbound, and Transport board without Dock Schedule", () => {
    render(<LogisticsView />);

    const navigation = screen.getByRole("navigation", { name: "Logistics workspace" });
    expect(within(navigation).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Network",
      "Inbound",
      "Outbound",
      "Transport board"
    ]);
    expect(within(navigation).queryByRole("button", { name: /dock schedule/i })).not.toBeInTheDocument();
  });

  it("renders every active inbound and outbound document with line-level quantity aggregation", async () => {
    const user = userEvent.setup();
    const snapshot = makeNavigationSnapshot();
    snapshot.inventory.inboundShipments.push({
      ...snapshot.inventory.inboundShipments[0],
      asnId: "ASN-IN-2",
      transportLegId: null,
      dockAppointmentId: null,
      linkedRouteId: null
    });
    snapshot.inventory.inboundLines.push(
      { inboundLineId: "IN-LINE-1", asnId: "ASN-IN", productId: "P-1", batchId: "B-1", qtyExpected: 10, qtyReceived: 4, tempBand: "2-8C", receivingStatus: "Open", qaStatus: "Released" },
      { inboundLineId: "IN-LINE-2", asnId: "ASN-IN", productId: "P-2", batchId: "B-2", qtyExpected: 5, qtyReceived: 1, tempBand: "2-8C", receivingStatus: "Open", qaStatus: "Released" },
      { inboundLineId: "IN-LINE-3", asnId: "ASN-IN-2", productId: "P-3", batchId: "B-3", qtyExpected: 7, qtyReceived: 7, tempBand: "ambient", receivingStatus: "Received", qaStatus: "Released" }
    );
    snapshot.inventory.outboundShipments.push({
      ...snapshot.inventory.outboundShipments[0],
      shipmentId: "SHIP-OUT-2",
      transportLegId: null,
      dockAppointmentId: null,
      routeId: null
    });
    snapshot.inventory.outboundLines.push(
      { outboundLineId: "OUT-LINE-1", shipmentId: "SHIP-OUT", productId: "P-1", batchId: "B-1", qtyRequired: 12, qtyAllocated: 8, qtyPicked: 4, qtyPacked: 2, qtyDispatched: 0, allocationStatus: "Partial" },
      { outboundLineId: "OUT-LINE-2", shipmentId: "SHIP-OUT-2", productId: "P-2", batchId: "B-2", qtyRequired: 9, qtyAllocated: 9, qtyPicked: 9, qtyPacked: 9, qtyDispatched: 0, allocationStatus: "Allocated" }
    );
    useAppStore.getState().setSnapshot(snapshot);
    useAppStore.getState().setLogisticsWorkspace("inbound");
    render(<LogisticsView />);

    expect(screen.getByLabelText("Open ASN-IN details")).toBeInTheDocument();
    expect(screen.getByLabelText("Open ASN-IN-2 details")).toBeInTheDocument();
    expect(screen.getByText("5 / 15")).toBeInTheDocument();
    expect(screen.getByText("7 / 7")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Outbound" }));
    expect(screen.getByLabelText("Open SHIP-OUT details")).toBeInTheDocument();
    expect(screen.getByLabelText("Open SHIP-OUT-2 details")).toBeInTheDocument();
    expect(screen.getByText("4 / 12")).toBeInTheDocument();
    expect(screen.getByText("9 / 9")).toBeInTheDocument();
  });

  it("opens the exact Warehouse dock appointment from an inbound flow drawer", async () => {
    const user = userEvent.setup();
    useAppStore.getState().openInboundInLogistics("ASN-IN");
    render(<LogisticsView />);

    expect(screen.getByRole("dialog", { name: /ASN-IN details/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Dock Schedule" }));

    expect(useAppStore.getState()).toMatchObject({
      view: "Warehouse",
      warehouseWorkspace: "docks",
      selectedDockId: "D-01",
      selectedDockAppointmentId: "APPT-IN",
      selectedTransportLegId: "LEG-IN",
      selectedInboundAsnId: "ASN-IN",
      selectedShipmentId: null
    });
  });

  it("clears the primary assistant focus when a flow drawer closes", async () => {
    const user = userEvent.setup();
    useAppStore.getState().openOutboundInLogistics("SHIP-OUT");
    render(<LogisticsView />);

    expect(screen.getByRole("dialog", { name: /SHIP-OUT details/i })).toBeInTheDocument();
    const closeButtons = screen.getAllByRole("button", { name: "Close details" });
    await user.click(closeButtons[closeButtons.length - 1]);

    expect(useAppStore.getState().selectedShipmentId).toBeNull();
  });
});
