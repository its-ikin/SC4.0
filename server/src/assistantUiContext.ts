import type {
  AppViewKey,
  AssistantUiContext,
  OperationalFocusType,
  OperationalWorkspace
} from "@twinops/shared";

const appViews: AppViewKey[] = ["Dashboard", "Warehouse", "Inventory", "Logistics", "Monitoring", "Audit", "Alerts"];
const operationalFocusTypes: OperationalFocusType[] = [
  "overview",
  "zone",
  "rack",
  "bin",
  "stock_balance",
  "asn",
  "shipment",
  "transport_leg",
  "route",
  "dock",
  "dock_appointment",
  "rfid",
  "partner_site"
];
const workspacesByView: Partial<Record<AppViewKey, OperationalWorkspace[]>> = {
  Warehouse: ["facility", "locations", "docks"],
  Inventory: ["overview", "stock", "movements"],
  Logistics: ["network", "inbound", "outbound", "transport"]
};

function shortString(value: unknown, maxLength = 160) {
  return typeof value === "string" && value.length <= maxLength ? value : undefined;
}

function shortOperationalId(value: unknown) {
  const id = shortString(value);
  return id && /^[A-Z0-9][A-Z0-9._:-]*$/i.test(id) ? id : undefined;
}

export function sanitizeAssistantUiContext(value: unknown): AssistantUiContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (!appViews.includes(input.activeView as AppViewKey)) return undefined;
  const rawSelected = input.selected && typeof input.selected === "object" && !Array.isArray(input.selected)
    ? input.selected as Record<string, unknown>
    : {};
  const rawFilters = input.filters && typeof input.filters === "object" && !Array.isArray(input.filters)
    ? input.filters as Record<string, unknown>
    : {};
  const focusType = operationalFocusTypes.includes(input.focusType as OperationalFocusType)
    ? input.focusType as OperationalFocusType
    : "overview";
  const activeView = input.activeView as AppViewKey;
  const allowedWorkspaces = workspacesByView[activeView] ?? [];
  const activeWorkspace = allowedWorkspaces.includes(input.activeWorkspace as OperationalWorkspace)
    ? input.activeWorkspace as OperationalWorkspace
    : null;

  return {
    activeView,
    activeWorkspace,
    focusType,
    selected: {
      zoneId: shortString(rawSelected.zoneId),
      rackId: shortString(rawSelected.rackId),
      binId: shortString(rawSelected.binId),
      stockBalanceId: shortString(rawSelected.stockBalanceId),
      stage: shortString(rawSelected.stage),
      dockId: shortString(rawSelected.dockId),
      dockAppointmentId: shortOperationalId(rawSelected.dockAppointmentId),
      shipmentId: shortString(rawSelected.shipmentId),
      rfidGateId: shortString(rawSelected.rfidGateId),
      routeId: shortString(rawSelected.routeId),
      transportLegId: shortString(rawSelected.transportLegId),
      partnerSiteId: shortString(rawSelected.partnerSiteId),
      inboundAsnId: shortString(rawSelected.inboundAsnId)
    },
    filters: {
      inventoryQuickFilter: shortString(rawFilters.inventoryQuickFilter, 80),
      logisticsRouteFilter: shortString(rawFilters.logisticsRouteFilter, 80),
      logisticsDirectionFilter: shortString(rawFilters.logisticsDirectionFilter, 80),
      auditFilter: shortString(rawFilters.auditFilter, 80)
    }
  };
}
