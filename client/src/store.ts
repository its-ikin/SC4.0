import { create } from "zustand";
import type {
  Alert,
  AlertPriority,
  AppViewKey,
  ChatMessage,
  InventoryWorkspace,
  LogisticsWorkspace,
  OrchestratorResponse,
  RfidEvent,
  WarehouseSnapshot,
  WarehouseWorkspace
} from "@twinops/shared";
import { buildWarehouseBins, getRack, getRackForPlacement, getRfidCheckpoint, getSector } from "./warehouseLayout";
import { effectiveDockAppointments } from "./lib/dockAppointments";

export type ViewKey = AppViewKey;
export type InventoryFilterState = {
  quick: string;
  expiryDate: string | null;
};
export type InventoryQuickFilter =
  | "All"
  | "Attention Required"
  | "Restricted Stock"
  | "Reorder Required"
  | "Overstock"
  | "Shelf Life ≤ 90 Days"
  | "Long Dwell"
  | "Count Overdue"
  | "Expiring Soon"
  | "Expired";
export type LogisticsRouteFilter = "all" | "cold" | "delayed" | "disrupted";
export type LogisticsDirectionFilter = "all" | "inbound" | "outbound";
export type AuditDecisionFilter = "significant" | "all" | "action_required" | "issue_lifecycle" | "inventory" | "cold_chain" | "logistics" | "warehouse" | "ai_decisions" | "pending";

export type DockScheduleNavigationContext = {
  dockId?: string | null;
  appointmentId?: string | null;
  transportLegId?: string | null;
  asnId?: string | null;
  shipmentId?: string | null;
};

export type PhysicalDockNavigationContext = {
  dockId: string;
  relatedContext?: Omit<DockScheduleNavigationContext, "dockId">;
};

type HighlightState = {
  stockBalances: string[];
  zones: string[];
  racks: string[];
  bins: string[];
  stages: string[];
  shipments: string[];
  docks: string[];
};

type AssistantQueryRequest = {
  id: number;
  text: string;
};

type AuditFocusRequest = {
  id: number;
  issueId: string;
};

type AlertsPageRequest = {
  id: number;
  priority: AlertPriority | null;
};

export type AppState = {
  view: ViewKey;
  chatOpen: boolean;
  forceChatTab: boolean;
  assistantQueryRequest: AssistantQueryRequest | null;
  auditFocusRequest: AuditFocusRequest | null;
  alertsPageRequest: AlertsPageRequest | null;
  snapshot: WarehouseSnapshot | null;
  messages: ChatMessage[];
  selectedZoneId: string | null;
  selectedRackId: string | null;
  selectedBinId: string | null;
  selectedStockBalanceId: string | null;
  selectedStage: string | null;
  selectedDockId: string | null;
  selectedDockAppointmentId: string | null;
  selectedShipmentId: string | null;
  selectedRfidGateId: string | null;
  selectedRouteId: string | null;
  selectedTransportLegId: string | null;
  selectedPartnerSiteId: string | null;
  selectedInboundAsnId: string | null;
  warehouseWorkspace: WarehouseWorkspace;
  inventoryWorkspace: InventoryWorkspace;
  logisticsWorkspace: LogisticsWorkspace;
  inventoryFilters: InventoryFilterState;
  inventoryQuickFilter: InventoryQuickFilter;
  logisticsRouteFilter: LogisticsRouteFilter;
  logisticsDirectionFilter: LogisticsDirectionFilter;
  auditFilter: AuditDecisionFilter;
  highlight: HighlightState;
  scenarioResult: any | null;
  rfidFeed: RfidEvent[];
  toasts: Alert[];
  setView: (view: ViewKey) => void;
  setWarehouseWorkspace: (workspace: WarehouseWorkspace) => void;
  setInventoryWorkspace: (workspace: InventoryWorkspace) => void;
  setLogisticsWorkspace: (workspace: LogisticsWorkspace) => void;
  setSnapshot: (snapshot: WarehouseSnapshot) => void;
  setChatOpen: (open: boolean) => void;
  requestAssistantQuery: (text: string) => void;
  clearAssistantQueryRequest: (id: number) => void;
  focusAuditIssue: (issueId: string) => void;
  clearAuditFocusRequest: (id: number) => void;
  openAlertsPage: (priority?: AlertPriority | null) => void;
  clearAlertsPageRequest: (id: number) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  selectZone: (zoneId: string | null) => void;
  selectRack: (rackId: string | null) => void;
  selectBin: (binId: string | null) => void;
  selectStockBalance: (stockBalanceId: string | null) => void;
  selectShipment: (shipmentId: string | null) => void;
  clearSelection: () => void;
  locateStockBalanceInWarehouse: (stockBalanceId: string) => void;
  openStockBalanceInInventory: (stockBalanceId: string) => void;
  applyInventoryFilter: (filter: Partial<InventoryFilterState>) => void;
  setSelectedZone: (zoneId: string | null) => void;
  setSelectedRack: (rackId: string | null) => void;
  setSelectedBin: (binId: string | null) => void;
  setSelectedStockBalance: (stockBalanceId: string | null) => void;
  setSelectedStage: (stage: string | null) => void;
  setSelectedDock: (dockId: string | null) => void;
  setSelectedDockAppointment: (appointmentId: string | null) => void;
  openDockScheduleInWarehouse: (context: DockScheduleNavigationContext) => void;
  focusPhysicalDockInWarehouse: (context: PhysicalDockNavigationContext) => void;
  setSelectedShipment: (shipmentId: string | null) => void;
  setSelectedRfidGate: (gateId: string | null) => void;
  setSelectedRoute: (routeId: string | null) => void;
  setSelectedTransportLeg: (transportLegId: string | null) => void;
  setSelectedPartnerSite: (siteId: string | null) => void;
  setSelectedInboundAsn: (asnId: string | null) => void;
  setInventoryQuickFilter: (filter: InventoryQuickFilter) => void;
  setLogisticsRouteFilter: (filter: LogisticsRouteFilter) => void;
  setLogisticsDirectionFilter: (filter: LogisticsDirectionFilter) => void;
  openInboundInLogistics: (asnId: string) => void;
  openOutboundInLogistics: (shipmentId: string) => void;
  openTransportLegInLogistics: (transportLegId: string, workspace?: LogisticsWorkspace) => void;
  openRouteInLogistics: (routeId: string, workspace?: LogisticsWorkspace) => void;
  setAuditFilter: (filter: AuditDecisionFilter) => void;
  setHighlightFromResponse: (response: OrchestratorResponse) => void;
  clearHighlight: () => void;
  setScenarioResult: (result: any | null) => void;
  addRfidEvent: (event: RfidEvent) => void;
  pushToast: (alert: Alert) => void;
  dismissToast: (id: string) => void;
};

const emptyHighlight: HighlightState = {
  stockBalances: [],
  zones: [],
  racks: [],
  bins: [],
  stages: [],
  shipments: [],
  docks: []
};

const defaultInventoryFilters: InventoryFilterState = {
  quick: "all",
  expiryDate: null
};

let nextAssistantQueryRequestId = 0;
let nextAuditFocusRequestId = 0;
let nextAlertsPageRequestId = 0;

function toDateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function selectionForStockBalance(snapshot: WarehouseSnapshot | null, stockBalanceId: string | null) {
  const placement = snapshot?.inventoryPlacements.find((item) => item.stockBalanceId === stockBalanceId) ?? null;
  if (!placement) {
    return {
      selectedZoneId: null,
      selectedRackId: null,
      selectedBinId: null,
      selectedStockBalanceId: stockBalanceId,
      selectedStage: null,
      selectedShipmentId: null
    };
  }
  const rack = getRackForPlacement(placement);
  return {
    selectedZoneId: placement.zoneId,
    selectedRackId: rack?.id ?? placement.rack,
    selectedBinId: placement.bin,
    selectedStockBalanceId: placement.stockBalanceId,
    selectedStage: placement.currentStage,
    selectedShipmentId: placement.linkedShipmentId
  };
}

type LinkedOperationalSelection = {
  selectedInboundAsnId: string | null;
  selectedShipmentId: string | null;
  selectedTransportLegId: string | null;
  selectedRouteId: string | null;
  selectedDockAppointmentId: string | null;
  selectedDockId: string | null;
};

const emptyLinkedOperationalSelection = (): LinkedOperationalSelection => ({
  selectedInboundAsnId: null,
  selectedShipmentId: null,
  selectedTransportLegId: null,
  selectedRouteId: null,
  selectedDockAppointmentId: null,
  selectedDockId: null
});

function verifiedRouteId(snapshot: WarehouseSnapshot, routeId: string | null | undefined) {
  if (!routeId) return null;
  return snapshot.routes.find((route) => route.id === routeId || route.routeId === routeId)?.routeId ?? null;
}

function verifiedDockId(snapshot: WarehouseSnapshot, dockId: string | null | undefined) {
  if (!dockId) return null;
  return snapshot.docks.some((dock) => dock.id === dockId) ? dockId : null;
}

function appointmentFor(
  snapshot: WarehouseSnapshot,
  appointmentId: string | null | undefined,
  transportLegId?: string | null,
  referenceId?: string | null
) {
  const appointments = effectiveDockAppointments(snapshot);
  return appointments.find((appointment) => appointment.dockAppointmentId === appointmentId)
    ?? appointments.find((appointment) => Boolean(transportLegId) && appointment.transportLegId === transportLegId)
    ?? appointments.find((appointment) => Boolean(referenceId) && appointment.referenceId === referenceId)
    ?? null;
}

function linkedSelectionForInbound(snapshot: WarehouseSnapshot | null, asnId: string): LinkedOperationalSelection {
  const empty = emptyLinkedOperationalSelection();
  if (!snapshot) return { ...empty, selectedInboundAsnId: asnId };
  const inbound = snapshot.inventory.inboundShipments.find((shipment) => shipment.asnId === asnId);
  if (!inbound) return { ...empty, selectedInboundAsnId: asnId };
  const leg = snapshot.transportLegs.find((item) => item.transportLegId === inbound.transportLegId)
    ?? snapshot.transportLegs.find((item) => item.asnId === inbound.asnId)
    ?? null;
  const appointment = appointmentFor(snapshot, inbound.dockAppointmentId, leg?.transportLegId, inbound.asnId);
  return {
    ...empty,
    selectedInboundAsnId: inbound.asnId,
    selectedTransportLegId: leg?.transportLegId ?? null,
    selectedRouteId: verifiedRouteId(snapshot, leg?.routeId ?? inbound.linkedRouteId),
    selectedDockAppointmentId: appointment?.dockAppointmentId ?? null,
    selectedDockId: verifiedDockId(snapshot, appointment?.dockId ?? inbound.receivingDock)
  };
}

function linkedSelectionForOutbound(snapshot: WarehouseSnapshot | null, shipmentId: string): LinkedOperationalSelection {
  const empty = emptyLinkedOperationalSelection();
  if (!snapshot) return { ...empty, selectedShipmentId: shipmentId };
  const outbound = snapshot.inventory.outboundShipments.find((shipment) => shipment.shipmentId === shipmentId);
  const compatibilityShipment = snapshot.shipments.find((shipment) => shipment.id === shipmentId);
  if (!outbound && !compatibilityShipment) return { ...empty, selectedShipmentId: shipmentId };
  const legId = outbound?.transportLegId ?? compatibilityShipment?.transportLegId;
  const leg = snapshot.transportLegs.find((item) => item.transportLegId === legId)
    ?? snapshot.transportLegs.find((item) => item.shipmentId === shipmentId)
    ?? null;
  const appointment = appointmentFor(
    snapshot,
    outbound?.dockAppointmentId ?? compatibilityShipment?.dockAppointmentId,
    leg?.transportLegId,
    shipmentId
  );
  return {
    ...empty,
    selectedShipmentId: shipmentId,
    selectedTransportLegId: leg?.transportLegId ?? null,
    selectedRouteId: verifiedRouteId(snapshot, leg?.routeId ?? outbound?.routeId ?? compatibilityShipment?.routeId),
    selectedDockAppointmentId: appointment?.dockAppointmentId ?? null,
    selectedDockId: verifiedDockId(snapshot, appointment?.dockId ?? outbound?.dock ?? compatibilityShipment?.dockId)
  };
}

function linkedSelectionForTransportLeg(snapshot: WarehouseSnapshot | null, transportLegId: string): LinkedOperationalSelection {
  const empty = emptyLinkedOperationalSelection();
  if (!snapshot) return { ...empty, selectedTransportLegId: transportLegId };
  const leg = snapshot.transportLegs.find((item) => item.transportLegId === transportLegId);
  if (!leg) return { ...empty, selectedTransportLegId: transportLegId };
  const inbound = leg.asnId
    ? snapshot.inventory.inboundShipments.find((shipment) => shipment.asnId === leg.asnId) ?? null
    : null;
  const outbound = leg.shipmentId
    ? snapshot.inventory.outboundShipments.find((shipment) => shipment.shipmentId === leg.shipmentId) ?? null
    : null;
  const compatibilityShipment = leg.shipmentId
    ? snapshot.shipments.find((shipment) => shipment.id === leg.shipmentId) ?? null
    : null;
  const appointment = appointmentFor(snapshot, leg.dockAppointmentId, leg.transportLegId, leg.asnId ?? leg.shipmentId);
  return {
    ...empty,
    selectedInboundAsnId: inbound?.asnId ?? null,
    selectedShipmentId: outbound?.shipmentId ?? compatibilityShipment?.id ?? null,
    selectedTransportLegId: leg.transportLegId,
    selectedRouteId: verifiedRouteId(snapshot, leg.routeId),
    selectedDockAppointmentId: appointment?.dockAppointmentId ?? null,
    selectedDockId: verifiedDockId(snapshot, appointment?.dockId ?? inbound?.receivingDock ?? outbound?.dock ?? compatibilityShipment?.dockId)
  };
}

function linkedSelectionForRoute(snapshot: WarehouseSnapshot | null, routeId: string): LinkedOperationalSelection {
  const empty = emptyLinkedOperationalSelection();
  if (!snapshot) return { ...empty, selectedRouteId: routeId };
  const route = snapshot.routes.find((item) => item.routeId === routeId || item.id === routeId);
  if (!route) return { ...empty, selectedRouteId: routeId };
  const leg = snapshot.transportLegs.find((item) => item.transportLegId === route.transportLegId)
    ?? snapshot.transportLegs.find((item) => item.routeId === route.routeId || item.routeId === route.id)
    ?? null;
  if (!leg) return { ...empty, selectedRouteId: route.routeId };
  return { ...linkedSelectionForTransportLeg(snapshot, leg.transportLegId), selectedRouteId: route.routeId };
}

function linkedSelectionForAppointment(snapshot: WarehouseSnapshot | null, appointmentId: string): LinkedOperationalSelection {
  const empty = emptyLinkedOperationalSelection();
  if (!snapshot) return { ...empty, selectedDockAppointmentId: appointmentId };
  const appointment = effectiveDockAppointments(snapshot).find((item) => item.dockAppointmentId === appointmentId);
  if (!appointment) return { ...empty, selectedDockAppointmentId: appointmentId };
  const leg = snapshot.transportLegs.find((item) => item.transportLegId === appointment.transportLegId) ?? null;
  const asnId = appointment.referenceType === "ASN" ? appointment.referenceId : leg?.asnId;
  const shipmentId = appointment.referenceType === "Outbound Shipment" ? appointment.referenceId : leg?.shipmentId;
  const inbound = asnId ? snapshot.inventory.inboundShipments.find((item) => item.asnId === asnId) ?? null : null;
  const outbound = shipmentId ? snapshot.inventory.outboundShipments.find((item) => item.shipmentId === shipmentId) ?? null : null;
  const compatibilityShipment = shipmentId ? snapshot.shipments.find((item) => item.id === shipmentId) ?? null : null;
  return {
    ...empty,
    selectedInboundAsnId: inbound?.asnId ?? null,
    selectedShipmentId: outbound?.shipmentId ?? compatibilityShipment?.id ?? null,
    selectedTransportLegId: leg?.transportLegId ?? null,
    selectedRouteId: verifiedRouteId(snapshot, leg?.routeId),
    selectedDockAppointmentId: appointment.dockAppointmentId,
    selectedDockId: verifiedDockId(snapshot, appointment.dockId)
  };
}

/** Resolve one navigation anchor, in order from the most-specific booking to its physical dock. */
function linkedSelectionForDockContext(snapshot: WarehouseSnapshot | null, context: DockScheduleNavigationContext) {
  if (context.appointmentId) return linkedSelectionForAppointment(snapshot, context.appointmentId);
  if (context.transportLegId) return linkedSelectionForTransportLeg(snapshot, context.transportLegId);
  if (context.asnId) return linkedSelectionForInbound(snapshot, context.asnId);
  if (context.shipmentId) return linkedSelectionForOutbound(snapshot, context.shipmentId);
  return {
    ...emptyLinkedOperationalSelection(),
    selectedDockId: context.dockId ?? null
  };
}

function legForSelection(snapshot: WarehouseSnapshot | null, selection: LinkedOperationalSelection) {
  return snapshot?.transportLegs.find((leg) => leg.transportLegId === selection.selectedTransportLegId) ?? null;
}

function logisticsFilterPatch(
  state: AppState,
  selection: LinkedOperationalSelection,
  expectedDirection?: "inbound" | "outbound"
) {
  const leg = legForSelection(state.snapshot, selection);
  const direction = expectedDirection ?? leg?.direction;
  const directionFilterVisible = state.logisticsDirectionFilter === "all"
    || (Boolean(direction) && state.logisticsDirectionFilter === direction);
  const routeFilterVisible = state.logisticsRouteFilter === "all"
    || (Boolean(leg) && state.logisticsRouteFilter === "cold" && leg?.temperatureRequirement !== "ambient")
    || (Boolean(leg) && state.logisticsRouteFilter === "delayed" && leg?.routeStatus === "delayed")
    || (Boolean(leg) && state.logisticsRouteFilter === "disrupted" && leg?.routeStatus === "disrupted");
  return {
    logisticsDirectionFilter: directionFilterVisible ? state.logisticsDirectionFilter : "all" as LogisticsDirectionFilter,
    logisticsRouteFilter: routeFilterVisible ? state.logisticsRouteFilter : "all" as LogisticsRouteFilter
  };
}

const clearedLocationSelection = {
  selectedZoneId: null,
  selectedRackId: null,
  selectedBinId: null,
  selectedStockBalanceId: null,
  selectedStage: null,
  selectedRfidGateId: null,
  selectedPartnerSiteId: null
};

export const useAppStore = create<AppState>((set) => ({
  view: "Dashboard",
  chatOpen: false,
  assistantQueryRequest: null,
  auditFocusRequest: null,
  alertsPageRequest: null,
  snapshot: null,
  messages: [],
  selectedZoneId: null,
  selectedRackId: null,
  selectedBinId: null,
  selectedStockBalanceId: null,
  selectedStage: null,
  selectedDockId: null,
  selectedDockAppointmentId: null,
  selectedShipmentId: null,
  selectedRfidGateId: null,
  selectedRouteId: null,
  selectedTransportLegId: null,
  selectedPartnerSiteId: null,
  selectedInboundAsnId: null,
  warehouseWorkspace: "facility",
  inventoryWorkspace: "overview",
  logisticsWorkspace: "network",
  inventoryFilters: defaultInventoryFilters,
  inventoryQuickFilter: "All",
  logisticsRouteFilter: "all",
  logisticsDirectionFilter: "all",
  auditFilter: "significant",
  highlight: emptyHighlight,
  scenarioResult: null,
  rfidFeed: [],
  toasts: [],
  forceChatTab: false,
  setView: (view) => set({ view }),
  setWarehouseWorkspace: (warehouseWorkspace) => set({ warehouseWorkspace }),
  setInventoryWorkspace: (inventoryWorkspace) => set({ inventoryWorkspace }),
  setLogisticsWorkspace: (logisticsWorkspace) => set({ logisticsWorkspace }),
  setSnapshot: (snapshot) => set({ snapshot }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
  requestAssistantQuery: (text) => set({
    chatOpen: true,
    forceChatTab: true,
    assistantQueryRequest: { id: ++nextAssistantQueryRequestId, text }
  }),
  clearAssistantQueryRequest: (id) => set((state) => ({
    assistantQueryRequest: state.assistantQueryRequest?.id === id ? null : state.assistantQueryRequest
  })),
  focusAuditIssue: (issueId) => set({
    view: "Audit",
    auditFilter: "action_required",
    auditFocusRequest: { id: ++nextAuditFocusRequestId, issueId }
  }),
  clearAuditFocusRequest: (id) => set((state) => ({
    auditFocusRequest: state.auditFocusRequest?.id === id ? null : state.auditFocusRequest
  })),
  openAlertsPage: (priority = null) => set({
    view: "Alerts",
    alertsPageRequest: { id: ++nextAlertsPageRequestId, priority }
  }),
  clearAlertsPageRequest: (id) => set((state) => ({
    alertsPageRequest: state.alertsPageRequest?.id === id ? null : state.alertsPageRequest
  })),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, patch) =>
    set((state) => ({ messages: state.messages.map((message) => (message.id === id ? { ...message, ...patch } : message)) })),
  selectZone: (selectedZoneId) => set({
    selectedZoneId,
    selectedRackId: null,
    selectedBinId: null,
    selectedStockBalanceId: null,
    selectedStage: selectedZoneId ? getSector(selectedZoneId)?.stage ?? "Storage" : null,
    selectedDockId: null,
    selectedDockAppointmentId: null,
    selectedShipmentId: null,
    selectedRfidGateId: null
  }),
  selectRack: (selectedRackId) => {
    const rack = getRack(selectedRackId);
    set({
      selectedZoneId: rack?.zoneId ?? null,
      selectedRackId,
      selectedBinId: null,
      selectedStockBalanceId: null,
      selectedStage: selectedRackId ? "Storage" : null,
      selectedDockId: null,
      selectedDockAppointmentId: null,
      selectedShipmentId: null,
      selectedRfidGateId: null
    });
  },
  selectBin: (selectedBinId) =>
    set((state) => {
      if (!selectedBinId) return { selectedBinId: null, selectedStockBalanceId: null };
      const bins = state.snapshot ? buildWarehouseBins(state.snapshot.inventoryPlacements) : [];
      const bin = bins.find((item) => item.id === selectedBinId || (item.label === selectedBinId && item.rackId === state.selectedRackId));
      if (!bin) return { selectedBinId };
      return {
        selectedZoneId: bin.placement.zoneId,
        selectedRackId: bin.rackId,
        selectedBinId: bin.label,
        selectedStockBalanceId: bin.placement.stockBalanceId,
        selectedStage: bin.placement.currentStage,
        selectedShipmentId: bin.placement.linkedShipmentId,
        selectedRfidGateId: null
      };
    }),
  selectStockBalance: (selectedStockBalanceId) => set((state) => ({ ...selectionForStockBalance(state.snapshot, selectedStockBalanceId), selectedDockId: null, selectedDockAppointmentId: null, selectedRfidGateId: null })),
  selectShipment: (selectedShipmentId) =>
    set((state) => {
      const shipment = state.snapshot?.shipments.find((item) => item.id === selectedShipmentId);
      if (!shipment) return { selectedShipmentId, selectedStage: null };
      const preferredStockBalanceId = state.selectedStockBalanceId && shipment.stockBalanceIds.includes(state.selectedStockBalanceId)
        ? state.selectedStockBalanceId
        : state.snapshot?.inventoryPlacements.find((placement) => placement.linkedShipmentId === selectedShipmentId)?.stockBalanceId
          ?? shipment.stockBalanceIds[0]
          ?? null;
      return {
        ...selectionForStockBalance(state.snapshot, preferredStockBalanceId),
        selectedShipmentId,
        selectedDockId: shipment.dockId,
        selectedDockAppointmentId: shipment.dockAppointmentId ?? null,
        selectedRfidGateId: null
      };
    }),
  clearSelection: () => set({
    selectedZoneId: null,
    selectedRackId: null,
    selectedBinId: null,
    selectedStockBalanceId: null,
    selectedStage: null,
    selectedDockId: null,
    selectedDockAppointmentId: null,
    selectedShipmentId: null,
    selectedRfidGateId: null,
    selectedRouteId: null,
    selectedTransportLegId: null,
    selectedPartnerSiteId: null,
    selectedInboundAsnId: null,
    highlight: emptyHighlight
  }),
  locateStockBalanceInWarehouse: (stockBalanceId) => set((state) => ({ ...selectionForStockBalance(state.snapshot, stockBalanceId), selectedDockId: null, selectedDockAppointmentId: null, selectedRfidGateId: null, warehouseWorkspace: "facility", view: "Warehouse" })),
  openStockBalanceInInventory: (stockBalanceId) => set((state) => ({
    ...selectionForStockBalance(state.snapshot, stockBalanceId),
    selectedDockId: null,
    selectedRfidGateId: null,
    inventoryQuickFilter: "All",
    inventoryWorkspace: "stock",
    view: "Inventory"
  })),
  applyInventoryFilter: (filter) =>
    set((state) => {
      const inventoryFilters = { ...state.inventoryFilters, ...filter };
      let highlight = state.highlight;
      if (inventoryFilters.expiryDate && state.snapshot) {
        const affectedSkus = state.snapshot.inventoryPlacements.filter((sku) => toDateKey(sku.expiryDate) === inventoryFilters.expiryDate);
        const bins = buildWarehouseBins(affectedSkus);
        highlight = {
          ...state.highlight,
          stockBalances: affectedSkus.map((placement) => placement.stockBalanceId),
          zones: [...new Set(affectedSkus.map((sku) => sku.zoneId))],
          racks: [...new Set(bins.map((bin) => bin.rackId))],
          bins: bins.map((bin) => bin.label),
          stages: affectedSkus.length ? ["Storage"] : []
        };
      } else if (filter.expiryDate === null) {
        highlight = emptyHighlight;
      }
      return { inventoryFilters, highlight };
    }),
  setSelectedZone: (selectedZoneId) => set({
    selectedZoneId,
    selectedRackId: null,
    selectedBinId: null,
    selectedStockBalanceId: null,
    selectedStage: selectedZoneId ? getSector(selectedZoneId)?.stage ?? "Storage" : null,
    selectedDockId: null,
    selectedDockAppointmentId: null,
    selectedShipmentId: null,
    selectedRfidGateId: null
  }),
  setSelectedRack: (selectedRackId) => {
    const rack = getRack(selectedRackId);
    set({
      selectedZoneId: rack?.zoneId ?? null,
      selectedRackId,
      selectedBinId: null,
      selectedStockBalanceId: null,
      selectedStage: selectedRackId ? "Storage" : null,
      selectedDockId: null,
      selectedDockAppointmentId: null,
      selectedShipmentId: null,
      selectedRfidGateId: null
    });
  },
  setSelectedBin: (selectedBinId) => set({ selectedBinId }),
  setSelectedStockBalance: (selectedStockBalanceId) => set((state) => ({ ...selectionForStockBalance(state.snapshot, selectedStockBalanceId), selectedDockId: null, selectedDockAppointmentId: null, selectedRfidGateId: null })),
  setSelectedStage: (selectedStage) => set({ selectedStage }),
  setSelectedDock: (selectedDockId) => set({ selectedDockId, selectedDockAppointmentId: null, selectedStage: null, selectedZoneId: null, selectedRackId: null, selectedBinId: null, selectedStockBalanceId: null, selectedRfidGateId: null }),
  setSelectedDockAppointment: (selectedDockAppointmentId) => set({ selectedDockAppointmentId }),
  openDockScheduleInWarehouse: (context) => set((state) => ({
    view: "Warehouse",
    warehouseWorkspace: "docks",
    ...clearedLocationSelection,
    ...linkedSelectionForDockContext(state.snapshot, context)
  })),
  focusPhysicalDockInWarehouse: ({ dockId, relatedContext }) => set((state) => {
    const linked = relatedContext
      ? linkedSelectionForDockContext(state.snapshot, relatedContext)
      : emptyLinkedOperationalSelection();
    const linkedDockMatches = !linked.selectedDockId || linked.selectedDockId === dockId;
    return {
      view: "Warehouse",
      warehouseWorkspace: "facility",
      ...clearedLocationSelection,
      ...(linkedDockMatches ? linked : emptyLinkedOperationalSelection()),
      selectedDockId: dockId
    };
  }),
  setSelectedShipment: (selectedShipmentId) =>
    set((state) => {
      const shipment = state.snapshot?.shipments.find((item) => item.id === selectedShipmentId);
      if (!shipment) return { selectedShipmentId, selectedStage: null };
      const preferredStockBalanceId = state.selectedStockBalanceId && shipment.stockBalanceIds.includes(state.selectedStockBalanceId)
        ? state.selectedStockBalanceId
        : state.snapshot?.inventoryPlacements.find((placement) => placement.linkedShipmentId === selectedShipmentId)?.stockBalanceId
          ?? shipment.stockBalanceIds[0]
          ?? null;
      return {
        ...selectionForStockBalance(state.snapshot, preferredStockBalanceId),
        selectedShipmentId,
        selectedDockId: shipment.dockId,
        selectedDockAppointmentId: shipment.dockAppointmentId ?? null,
        selectedRfidGateId: null
      };
    }),
  setSelectedRoute: (selectedRouteId) => set({ selectedRouteId }),
  setSelectedTransportLeg: (selectedTransportLegId) => set({ selectedTransportLegId, selectedPartnerSiteId: null }),
  setSelectedPartnerSite: (selectedPartnerSiteId) => set({ selectedPartnerSiteId, selectedTransportLegId: null, selectedRouteId: null }),
  setSelectedInboundAsn: (selectedInboundAsnId) => set({ selectedInboundAsnId }),
  setInventoryQuickFilter: (inventoryQuickFilter) => set({ inventoryQuickFilter }),
  setLogisticsRouteFilter: (logisticsRouteFilter) => set({ logisticsRouteFilter }),
  setLogisticsDirectionFilter: (logisticsDirectionFilter) => set({ logisticsDirectionFilter }),
  openInboundInLogistics: (asnId) => set((state) => {
    const linked = linkedSelectionForInbound(state.snapshot, asnId);
    return {
      view: "Logistics",
      logisticsWorkspace: "inbound",
      ...clearedLocationSelection,
      ...linked,
      ...logisticsFilterPatch(state, linked, "inbound")
    };
  }),
  openOutboundInLogistics: (shipmentId) => set((state) => {
    const linked = linkedSelectionForOutbound(state.snapshot, shipmentId);
    return {
      view: "Logistics",
      logisticsWorkspace: "outbound",
      ...clearedLocationSelection,
      ...linked,
      ...logisticsFilterPatch(state, linked, "outbound")
    };
  }),
  openTransportLegInLogistics: (transportLegId, logisticsWorkspace = "transport") => set((state) => {
    const linked = linkedSelectionForTransportLeg(state.snapshot, transportLegId);
    return {
      view: "Logistics",
      logisticsWorkspace,
      ...clearedLocationSelection,
      ...linked,
      ...logisticsFilterPatch(state, linked)
    };
  }),
  openRouteInLogistics: (routeId, logisticsWorkspace = "network") => set((state) => {
    const linked = linkedSelectionForRoute(state.snapshot, routeId);
    return {
      view: "Logistics",
      logisticsWorkspace,
      ...clearedLocationSelection,
      ...linked,
      ...logisticsFilterPatch(state, linked)
    };
  }),
  setAuditFilter: (auditFilter) => set({ auditFilter }),
  setSelectedRfidGate: (selectedRfidGateId) => {
    const gate = getRfidCheckpoint(selectedRfidGateId);
    set({
      selectedRfidGateId,
      selectedStage: gate?.stage ?? null,
      selectedZoneId: null,
      selectedRackId: null,
      selectedBinId: null,
      selectedStockBalanceId: null,
      selectedDockId: null,
      selectedDockAppointmentId: null,
      selectedShipmentId: null,
      highlight: emptyHighlight
    });
  },
  setHighlightFromResponse: (response) =>
    set((state) => {
      const affectedSkuId = response.actionPayload.affectedSKUs[0] ?? null;
      const selected = affectedSkuId ? selectionForStockBalance(state.snapshot, affectedSkuId) : null;
      const affectedSkus = state.snapshot?.inventoryPlacements.filter((placement) =>
        response.actionPayload.affectedSKUs.some((id) =>
          id === placement.stockBalanceId || id === placement.productCode || id === placement.productId || id === placement.batchId
        )
      ) ?? [];
      const bins = buildWarehouseBins(affectedSkus);
      const affectedZone = response.actionPayload.affectedZones[0] ?? null;
      return {
        ...(selected ?? {}),
        selectedZoneId: selected?.selectedZoneId ?? affectedZone ?? state.selectedZoneId,
        selectedShipmentId: response.actionPayload.affectedShipments[0] ?? selected?.selectedShipmentId ?? state.selectedShipmentId,
        selectedDockId: response.actionPayload.affectedDocks[0] ?? state.selectedDockId,
        selectedStage: response.actionPayload.affectedStages[0] ?? selected?.selectedStage ?? state.selectedStage,
        selectedRfidGateId: null,
        highlight: {
          stockBalances: affectedSkus.map((placement) => placement.stockBalanceId),
          zones: response.actionPayload.affectedZones,
          racks: [...new Set(bins.map((bin) => bin.rackId))],
          bins: bins.map((bin) => bin.label),
          stages: response.actionPayload.affectedStages,
          shipments: response.actionPayload.affectedShipments,
          docks: response.actionPayload.affectedDocks
        },
        scenarioResult:
          response.toolResults?.simulate_transport_impact ?? response.toolResults?.simulate_event_impact ?? response.toolResults?.simulate_reprioritisation ?? null
      };
    }),
  clearHighlight: () => set({ highlight: emptyHighlight }),
  setScenarioResult: (scenarioResult) => set({ scenarioResult }),
  addRfidEvent: (event) => set((state) => ({ rfidFeed: [event, ...state.rfidFeed].slice(0, 30) })),
  pushToast: (alert) => set((state) => ({ toasts: [alert, ...state.toasts].slice(0, 4) })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
}));
