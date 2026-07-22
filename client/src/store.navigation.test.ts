import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./store";
import { makeNavigationSnapshot } from "./test/navigationFixture";

const initialState = useAppStore.getInitialState();

function state() {
  return useAppStore.getState();
}

function linkedSelection() {
  const current = state();
  return {
    asn: current.selectedInboundAsnId,
    shipment: current.selectedShipmentId,
    leg: current.selectedTransportLegId,
    route: current.selectedRouteId,
    appointment: current.selectedDockAppointmentId,
    dock: current.selectedDockId
  };
}

describe("typed workspace navigation", () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
    state().setSnapshot(makeNavigationSnapshot());
  });

  it("starts in the three default workspaces", () => {
    expect(state()).toMatchObject({
      warehouseWorkspace: "facility",
      inventoryWorkspace: "overview",
      logisticsWorkspace: "network"
    });
  });

  it("ordinary page navigation preserves each page's last workspace", () => {
    state().setWarehouseWorkspace("locations");
    state().setInventoryWorkspace("movements");
    state().setLogisticsWorkspace("transport");

    state().setView("Warehouse");
    state().setView("Inventory");
    state().setView("Logistics");

    expect(state()).toMatchObject({
      view: "Logistics",
      warehouseWorkspace: "locations",
      inventoryWorkspace: "movements",
      logisticsWorkspace: "transport"
    });
  });
});

describe("atomic operational navigation", () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
    state().setSnapshot(makeNavigationSnapshot());
    useAppStore.setState({
      selectedZoneId: "STALE-ZONE",
      selectedRackId: "STALE-RACK",
      selectedStockBalanceId: "STALE-STOCK",
      selectedPartnerSiteId: "STALE-SITE"
    });
  });

  it("opens and fully resolves a valid inbound ASN while clearing an outbound selection", () => {
    useAppStore.setState({
      selectedShipmentId: "STALE-SHIPMENT",
      logisticsDirectionFilter: "outbound",
      logisticsRouteFilter: "disrupted"
    });

    state().openInboundInLogistics("ASN-IN");

    expect(state()).toMatchObject({
      view: "Logistics",
      logisticsWorkspace: "inbound",
      logisticsDirectionFilter: "all",
      logisticsRouteFilter: "all",
      selectedZoneId: null,
      selectedRackId: null,
      selectedStockBalanceId: null,
      selectedPartnerSiteId: null
    });
    expect(linkedSelection()).toEqual({
      asn: "ASN-IN",
      shipment: null,
      leg: "LEG-IN",
      route: "ROUTE-IN",
      appointment: "APPT-IN",
      dock: "D-01"
    });
  });

  it("retains only a missing inbound ASN and clears every unverified relationship", () => {
    useAppStore.setState({
      selectedShipmentId: "SHIP-OUT",
      selectedTransportLegId: "LEG-OUT",
      selectedRouteId: "ROUTE-OUT",
      selectedDockAppointmentId: "APPT-OUT",
      selectedDockId: "D-02",
      logisticsDirectionFilter: "inbound",
      logisticsRouteFilter: "cold"
    });

    state().openInboundInLogistics("ASN-MISSING");

    expect(state()).toMatchObject({
      view: "Logistics",
      logisticsWorkspace: "inbound",
      logisticsDirectionFilter: "inbound",
      logisticsRouteFilter: "all"
    });
    expect(linkedSelection()).toEqual({
      asn: "ASN-MISSING",
      shipment: null,
      leg: null,
      route: null,
      appointment: null,
      dock: null
    });
  });

  it("opens and fully resolves a valid outbound shipment while preserving a visible direction filter", () => {
    useAppStore.setState({
      selectedInboundAsnId: "STALE-ASN",
      logisticsDirectionFilter: "outbound",
      logisticsRouteFilter: "cold"
    });

    state().openOutboundInLogistics("SHIP-OUT");

    expect(state()).toMatchObject({
      view: "Logistics",
      logisticsWorkspace: "outbound",
      logisticsDirectionFilter: "outbound",
      logisticsRouteFilter: "all"
    });
    expect(linkedSelection()).toEqual({
      asn: null,
      shipment: "SHIP-OUT",
      leg: "LEG-OUT",
      route: "ROUTE-OUT",
      appointment: "APPT-OUT",
      dock: "D-02"
    });
  });

  it("retains only a missing outbound shipment", () => {
    state().openOutboundInLogistics("SHIP-MISSING");

    expect(state()).toMatchObject({ view: "Logistics", logisticsWorkspace: "outbound" });
    expect(linkedSelection()).toEqual({
      asn: null,
      shipment: "SHIP-MISSING",
      leg: null,
      route: null,
      appointment: null,
      dock: null
    });
  });

  it("opens a linked transport leg in the default or explicitly requested workspace", () => {
    state().openTransportLegInLogistics("LEG-IN");
    expect(state()).toMatchObject({ view: "Logistics", logisticsWorkspace: "transport" });
    expect(linkedSelection()).toEqual({
      asn: "ASN-IN",
      shipment: null,
      leg: "LEG-IN",
      route: "ROUTE-IN",
      appointment: "APPT-IN",
      dock: "D-01"
    });

    state().openTransportLegInLogistics("LEG-OUT", "network");
    expect(state()).toMatchObject({ view: "Logistics", logisticsWorkspace: "network" });
    expect(linkedSelection()).toEqual({
      asn: null,
      shipment: "SHIP-OUT",
      leg: "LEG-OUT",
      route: "ROUTE-OUT",
      appointment: "APPT-OUT",
      dock: "D-02"
    });
  });

  it("retains only a missing transport leg and resets filters that could hide it", () => {
    useAppStore.setState({
      selectedInboundAsnId: "ASN-IN",
      selectedShipmentId: "SHIP-OUT",
      logisticsDirectionFilter: "outbound",
      logisticsRouteFilter: "delayed"
    });

    state().openTransportLegInLogistics("LEG-MISSING");

    expect(state()).toMatchObject({
      view: "Logistics",
      logisticsWorkspace: "transport",
      logisticsDirectionFilter: "all",
      logisticsRouteFilter: "all"
    });
    expect(linkedSelection()).toEqual({
      asn: null,
      shipment: null,
      leg: "LEG-MISSING",
      route: null,
      appointment: null,
      dock: null
    });
  });

  it("opens a valid route atomically using its canonical route ID", () => {
    useAppStore.setState({
      selectedInboundAsnId: "STALE-ASN",
      selectedShipmentId: "STALE-SHIPMENT",
      logisticsDirectionFilter: "inbound",
      logisticsRouteFilter: "delayed"
    });

    state().openRouteInLogistics("LEGACY-ROUTE-OUT");

    expect(state()).toMatchObject({
      view: "Logistics",
      logisticsWorkspace: "network",
      logisticsDirectionFilter: "all",
      logisticsRouteFilter: "all"
    });
    expect(linkedSelection()).toEqual({
      asn: null,
      shipment: "SHIP-OUT",
      leg: "LEG-OUT",
      route: "ROUTE-OUT",
      appointment: "APPT-OUT",
      dock: "D-02"
    });
  });

  it("retains only a missing route and clears every unverified relationship", () => {
    useAppStore.setState({
      selectedInboundAsnId: "ASN-IN",
      selectedTransportLegId: "LEG-IN",
      selectedDockAppointmentId: "APPT-IN",
      selectedDockId: "D-01"
    });

    state().openRouteInLogistics("ROUTE-MISSING");

    expect(state()).toMatchObject({ view: "Logistics", logisticsWorkspace: "network" });
    expect(linkedSelection()).toEqual({
      asn: null,
      shipment: null,
      leg: null,
      route: "ROUTE-MISSING",
      appointment: null,
      dock: null
    });
  });

  it("opens the dock schedule and resolves its most-specific appointment anchor", () => {
    state().openDockScheduleInWarehouse({
      appointmentId: "APPT-IN",
      shipmentId: "SHIP-OUT",
      dockId: "D-02"
    });

    expect(state()).toMatchObject({
      view: "Warehouse",
      warehouseWorkspace: "docks",
      selectedZoneId: null,
      selectedRackId: null,
      selectedStockBalanceId: null
    });
    expect(linkedSelection()).toEqual({
      asn: "ASN-IN",
      shipment: null,
      leg: "LEG-IN",
      route: "ROUTE-IN",
      appointment: "APPT-IN",
      dock: "D-01"
    });
  });

  it("retains a missing appointment but no unverified dock-schedule relationships", () => {
    state().openDockScheduleInWarehouse({ appointmentId: "APPT-MISSING" });

    expect(state()).toMatchObject({ view: "Warehouse", warehouseWorkspace: "docks" });
    expect(linkedSelection()).toEqual({
      asn: null,
      shipment: null,
      leg: null,
      route: null,
      appointment: "APPT-MISSING",
      dock: null
    });
  });

  it("focuses a physical dock and keeps verified related context for the same dock", () => {
    state().focusPhysicalDockInWarehouse({
      dockId: "D-01",
      relatedContext: { appointmentId: "APPT-IN" }
    });

    expect(state()).toMatchObject({ view: "Warehouse", warehouseWorkspace: "facility" });
    expect(linkedSelection()).toEqual({
      asn: "ASN-IN",
      shipment: null,
      leg: "LEG-IN",
      route: "ROUTE-IN",
      appointment: "APPT-IN",
      dock: "D-01"
    });
  });

  it("retains the explicit physical dock but rejects related context for another dock", () => {
    state().focusPhysicalDockInWarehouse({
      dockId: "D-MISSING",
      relatedContext: { appointmentId: "APPT-OUT" }
    });

    expect(state()).toMatchObject({ view: "Warehouse", warehouseWorkspace: "facility" });
    expect(linkedSelection()).toEqual({
      asn: null,
      shipment: null,
      leg: null,
      route: null,
      appointment: null,
      dock: "D-MISSING"
    });
  });
});
