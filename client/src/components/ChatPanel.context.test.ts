import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../store";
import { makeNavigationSnapshot } from "../test/navigationFixture";
import { currentAssistantUiContext } from "./ChatPanel";

const initialState = useAppStore.getInitialState();

describe("assistant workspace context", () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
    useAppStore.getState().setSnapshot(makeNavigationSnapshot());
  });

  it("reports directional Logistics ownership and its primary document focus", () => {
    useAppStore.getState().openInboundInLogistics("ASN-IN");
    expect(currentAssistantUiContext()).toMatchObject({
      activeView: "Logistics",
      activeWorkspace: "inbound",
      focusType: "asn",
      selected: { inboundAsnId: "ASN-IN", shipmentId: null }
    });

    useAppStore.getState().openOutboundInLogistics("SHIP-OUT");
    expect(currentAssistantUiContext()).toMatchObject({
      activeView: "Logistics",
      activeWorkspace: "outbound",
      focusType: "shipment",
      selected: { inboundAsnId: null, shipmentId: "SHIP-OUT" }
    });
  });

  it("prioritises a Warehouse appointment and no longer treats flows as Inventory workspaces", () => {
    useAppStore.getState().openDockScheduleInWarehouse({ appointmentId: "APPT-IN" });
    expect(currentAssistantUiContext()).toMatchObject({
      activeView: "Warehouse",
      activeWorkspace: "docks",
      focusType: "dock_appointment",
      selected: { dockAppointmentId: "APPT-IN", dockId: "D-01" }
    });

    useAppStore.setState({ view: "Inventory", inventoryWorkspace: "overview", selectedInboundAsnId: "STALE-ASN" });
    expect(currentAssistantUiContext()).toMatchObject({
      activeView: "Inventory",
      activeWorkspace: "overview",
      focusType: "overview"
    });
  });
});
