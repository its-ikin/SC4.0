import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Box,
  Boxes,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Gauge,
  LocateFixed,
  Map as MapIcon,
  Radio,
  Route,
  ShieldCheck,
  Snowflake,
  Thermometer,
  Warehouse as WarehouseIcon,
  Wifi,
  X
} from "lucide-react";
import clsx from "clsx";
import type { InventoryPlacement } from "@twinops/shared";
import { runTool } from "../api";
import { useAppStore } from "../store";
import WarehouseModelView from "./WarehouseModelView";
import WarehouseDockSchedule from "./WarehouseDockSchedule";
import WarehouseLocationsView from "./WarehouseLocationsView";
import {
  buildInternalRoute,
  buildWarehouseBins,
  getRack,
  getRackForPlacement,
  getRackMetrics,
  getRfidCheckpoint,
  getSector,
  getSectorMetrics,
  isExpiryRisk,
  rackDisplayLabel,
  resolveDockIdForPlacement,
  stockBalanceLabel,
  stockDisplayCode,
  wmsLocationLabel,
  warehouseRacks,
  warehouseSectors,
  type InternalRoute,
  type WarehouseBin,
} from "../warehouseLayout";
import { StatusChip, WorkspaceNav } from "./ui";

type SceneClickEvent = ThreeEvent<MouseEvent>;
type PopupType = "zone" | "rack" | "sku" | "dock" | "rfid" | "sensor";
type PopupView = "summary" | "racks" | "skus" | "scans" | "telemetry";
type PopupAnchor = { x: number; y: number };
type WarehousePopupState = {
  type: PopupType;
  id: string;
  anchor: PopupAnchor;
  target: PopupAnchor;
  view?: PopupView;
  sectorId?: string;
  sensorLabel?: string;
};

function statusTone(status?: string | null) {
  if (status === "critical" || status === "Blocked" || status === "QA Hold" || status === "Quarantine") return "critical";
  if (status === "warn" || status === "Pending QA" || status === "occupied") return "warning";
  if (status === "normal" || status === "Released" || status === "available") return "healthy";
  return "neutral";
}

function formatDate(value?: string | null) {
  if (!value) return "not scheduled";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(value?: string | null) {
  if (!value) return "not scheduled";
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function routeStatusLabel(route: InternalRoute) {
  if (route.state === "blocked") return "Blocked route";
  if (route.state === "warning") return "Warning route";
  return route.points.length ? "Valid route" : "No active route";
}

function PopupActionButton({
  children,
  onClick,
  disabled,
  primary
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      className={clsx(
        "rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
        primary
          ? "border-twin-cyan/40 bg-twin-cyan/20 text-twin-blue hover:bg-twin-cyan/25"
          : "border-twin-border/80 bg-white/75 text-twin-text hover:border-twin-blue/50 hover:bg-twin-blue/5"
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function WarehouseContextPopup({
  popup,
  routeVisible,
  onClose,
  onPatch,
  onViewRoute
}: {
  popup: WarehousePopupState;
  routeVisible: boolean;
  onClose: () => void;
  onPatch: (patch: Partial<WarehousePopupState>) => void;
  onViewRoute: () => void;
}) {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const rfidFeed = useAppStore((state) => state.rfidFeed);
  const selectedZoneId = useAppStore((state) => state.selectedZoneId);
  const selectedRackId = useAppStore((state) => state.selectedRackId);
  const selectedStockBalanceId = useAppStore((state) => state.selectedStockBalanceId);
  const selectedDockId = useAppStore((state) => state.selectedDockId);
  const selectedStage = useAppStore((state) => state.selectedStage);
  const setSelectedZone = useAppStore((state) => state.setSelectedZone);
  const setSelectedRack = useAppStore((state) => state.setSelectedRack);
  const setSelectedBin = useAppStore((state) => state.setSelectedBin);
  const setSelectedStockBalance = useAppStore((state) => state.setSelectedStockBalance);
  const setSelectedStage = useAppStore((state) => state.setSelectedStage);
  const setInventoryWorkspace = useAppStore((state) => state.setInventoryWorkspace);
  const openTransportLegInLogistics = useAppStore((state) => state.openTransportLegInLogistics);
  const openInboundInLogistics = useAppStore((state) => state.openInboundInLogistics);
  const openOutboundInLogistics = useAppStore((state) => state.openOutboundInLogistics);
  const openDockScheduleInWarehouse = useAppStore((state) => state.openDockScheduleInWarehouse);
  const setView = useAppStore((state) => state.setView);
  const requestAssistantQuery = useAppStore((state) => state.requestAssistantQuery);
  const openStockBalanceInInventory = useAppStore((state) => state.openStockBalanceInInventory);
  const bins = useMemo(() => buildWarehouseBins(snapshot.inventoryPlacements), [snapshot.inventoryPlacements]);
  const popupSector = popup.type === "zone" ? getSector(popup.id) : popup.sectorId ? getSector(popup.sectorId) : null;
  const popupRack = popup.type === "rack" ? getRack(popup.id) : getRack(selectedRackId);
  const popupSku = popup.type === "sku" ? snapshot.inventoryPlacements.find((item) => item.stockBalanceId === popup.id) ?? null : snapshot.inventoryPlacements.find((item) => item.stockBalanceId === selectedStockBalanceId) ?? null;
  const popupDock = popup.type === "dock" ? snapshot.docks.find((dock) => dock.id === popup.id) ?? null : selectedDockId ? snapshot.docks.find((dock) => dock.id === selectedDockId) ?? null : null;
  const popupAppointment = popupDock
    ? [...(snapshot.dockAppointments ?? [])]
        .filter((appointment) => appointment.dockId === popupDock.id)
        .sort((a, b) => {
          const active = (status: string) => ["checked_in", "at_dock", "loading", "unloading"].includes(status) ? 0 : status === "booked" ? 1 : 2;
          return active(a.status) - active(b.status) || new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime();
        })[0] ?? null
    : null;
  const popupTransportLeg = popupAppointment
    ? (snapshot.transportLegs ?? []).find((leg) => leg.transportLegId === popupAppointment.transportLegId) ?? null
    : null;
  const popupRfid = popup.type === "rfid" ? getRfidCheckpoint(popup.id) : null;
  const selectedSku = snapshot.inventoryPlacements.find((sku) => sku.stockBalanceId === selectedStockBalanceId) ?? null;
  const activeRack = getRack(selectedRackId) ?? getRackForPlacement(selectedSku);
  const activeSector = getSector(selectedZoneId) ?? getSector(activeRack?.zoneId) ?? getSector(selectedSku?.zoneId) ?? popupSector;
  const dockId = selectedDockId ?? resolveDockIdForPlacement(selectedSku, snapshot.docks);
  const route = buildInternalRoute({
    placement: selectedSku,
    rackId: activeRack?.id,
    sectorId: activeSector?.id,
    dockId,
    stage: selectedStage
  });
  const routeTone = route.state === "blocked" ? "critical" : route.state === "warning" ? "warning" : route.points.length ? "focus" : "neutral";
  const selectedRouteText = route.message;
  const popupRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; anchor: PopupAnchor } | null>(null);
  const [dragging, setDragging] = useState(false);
  const popupWidth = 310;
  const popupHeight = routeVisible ? 338 : popup.type === "dock" ? 360 : popup.type === "zone" && popup.view !== "summary" ? 350 : 258;
  const edgeX = popup.target.x < popup.anchor.x ? popup.anchor.x : popup.target.x > popup.anchor.x + popupWidth ? popup.anchor.x + popupWidth : popup.target.x;
  const edgeY = Math.max(popup.anchor.y + 28, Math.min(popup.anchor.y + popupHeight - 18, popup.target.y));

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      const element = popupRef.current;
      const parent = element?.parentElement;
      if (!drag || !element || !parent) return;
      const bounds = parent.getBoundingClientRect();
      const nextX = drag.anchor.x + event.clientX - drag.startX;
      const nextY = drag.anchor.y + event.clientY - drag.startY;
      onPatch({
        anchor: {
          x: Math.min(Math.max(nextX, 12), Math.max(12, bounds.width - element.offsetWidth - 12)),
          y: Math.min(Math.max(nextY, 12), Math.max(12, bounds.height - element.offsetHeight - 12))
        }
      });
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, onPatch]);

  const startDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      anchor: popup.anchor
    };
    setDragging(true);
  };

  const showRoute = () => {
    if (popupRfid) setSelectedStage(popupRfid.stage);
    if (popupDock) setSelectedStage("Dispatch");
    if (popupSector) setSelectedStage(popupSector.stage);
    onViewRoute();
  };
  const selectRackFromPopup = (rackId: string) => {
    setSelectedRack(rackId);
    setSelectedStage("Storage");
    onPatch({ type: "rack", id: rackId, view: "summary", sectorId: undefined, sensorLabel: undefined });
  };
  const selectStockBalanceFromPopup = (bin: WarehouseBin) => {
    setSelectedStockBalance(bin.placement.stockBalanceId);
    setSelectedBin(bin.label);
    setSelectedStage(bin.placement.currentStage);
    onPatch({ type: "sku", id: bin.placement.stockBalanceId, view: "summary", sectorId: undefined, sensorLabel: undefined });
  };
  const askAgent = (sku: InventoryPlacement) => {
    requestAssistantQuery(
      `Review warehouse context for ${stockDisplayCode(sku)} (${stockBalanceLabel(sku)}): ${getSector(sku.zoneId)?.name ?? sku.zoneId}, ${wmsLocationLabel(sku)}, ${sku.qualityStatus}, ${isExpiryRisk(sku) ? "expiry within 7 days" : "no near-term expiry warning"}. Run the authoritative FEFO allocation check if sequencing is relevant.`
    );
  };

  let title = "Warehouse";
  let subtitle = "Select an element";
  let body: ReactNode = null;
  let actions: ReactNode = null;

  if (popup.type === "zone" && popupSector) {
    const metrics = getSectorMetrics(popupSector, snapshot.zones, snapshot.inventoryPlacements);
    const hasRacks = popupSector.racks.length > 0;
    const controlledZoneId = popupSector.dataZoneId ?? popupSector.id;
    const controlledAreaBins = bins.filter((bin) => bin.placement.zoneId === controlledZoneId || (controlledZoneId === "QA" && bin.placement.zoneId === "QAC"));
    const topControlledStock = controlledAreaBins[0]?.placement ?? null;
    const fill = metrics.dataZone?.fillPercent ?? 0;
    title = popupSector.name;
    subtitle = hasRacks ? `${popupSector.racks.length} racks - ${fill}% fill` : `Controlled storage - ${fill}% occupied`;
    body = (
      <div className="space-y-2 text-[11px]">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg border border-twin-border/70 bg-white/95 p-2">
            <div className="text-twin-muted">{hasRacks ? "Fill rate" : "Stored lots"}</div>
            <div className="mt-0.5 font-semibold">{hasRacks ? `${fill}%` : controlledAreaBins.length}</div>
          </div>
          <div className="rounded-lg border border-twin-border/70 bg-white/95 p-2">
            <div className="text-twin-muted">{hasRacks ? "Stock positions" : "Occupancy"}</div>
            <div className="mt-0.5 font-semibold">{hasRacks ? metrics.sectorPlacements.length : `${fill}%`}</div>
          </div>
        </div>
        {!hasRacks && <div className="text-[11px]"><span className="text-twin-muted">Top product:</span> {topControlledStock ? stockDisplayCode(topControlledStock) : "empty area"}</div>}
        {hasRacks && popup.view === "racks" && (
          <div className="grid max-h-28 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
            {popupSector.racks.map((rackId) => {
              const rackMetrics = getRackMetrics(getRack(rackId), bins);
              return (
                <button key={rackId} className="rounded-lg border border-twin-border/70 bg-white/95 px-2 py-1.5 text-left text-[11px] hover:border-twin-blue/50 hover:bg-twin-blue/5" onClick={() => selectRackFromPopup(rackId)}>
                  <div className="font-semibold text-twin-text">{rackDisplayLabel(rackId)}</div>
                  <div className="text-twin-muted">{rackMetrics.occupancy}% occupied</div>
                </button>
              );
            })}
          </div>
        )}
        {!hasRacks && popup.view === "skus" && (
          <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
            {controlledAreaBins.map((bin) => (
              <button key={bin.id} className="flex w-full items-center justify-between gap-2 rounded-lg border border-twin-border/70 bg-white/95 px-2 py-1.5 text-left hover:border-twin-blue/50 hover:bg-twin-blue/5" onClick={() => selectStockBalanceFromPopup(bin)}>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{stockDisplayCode(bin.placement)}</span>
                  <span className="block truncate text-[10px] text-twin-muted">{wmsLocationLabel(bin.placement)} · {stockBalanceLabel(bin.placement)}</span>
                </span>
                <StatusChip tone={statusTone(bin.placement.qualityStatus)}>{bin.placement.qualityStatus}</StatusChip>
              </button>
            ))}
            {!controlledAreaBins.length && <div className="rounded-lg border border-dashed border-twin-border/70 px-2 py-3 text-center text-[11px] text-twin-muted">No stock positions in this controlled area.</div>}
          </div>
        )}
      </div>
    );
    actions = (
      <>
        <PopupActionButton
          disabled={hasRacks ? false : !controlledAreaBins.length}
          onClick={() => onPatch({ view: hasRacks ? (popup.view === "racks" ? "summary" : "racks") : (popup.view === "skus" ? "summary" : "skus") })}
        >
          {hasRacks ? "View Racks" : "View Stock"}
        </PopupActionButton>
        <PopupActionButton onClick={() => {
          setSelectedZone(popupSector.id);
          setInventoryWorkspace("stock");
          setView("Inventory");
        }}>Open Inventory</PopupActionButton>
        {!hasRacks && <PopupActionButton primary onClick={showRoute}>View Route</PopupActionButton>}
      </>
    );
  }

  if (popup.type === "rack" && popupRack) {
    const metrics = getRackMetrics(popupRack, bins);
    const sector = getSector(popupRack.zoneId);
    const topSku = metrics.bins[0]?.placement ?? null;
    title = rackDisplayLabel(popupRack.id);
    subtitle = `${sector?.name ?? popupRack.zoneId} - ${metrics.occupancy}% occupied`;
    body = (
      <div className="space-y-2 text-[11px]">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-twin-border/70 bg-white/95 p-2">
            <div className="text-twin-muted">Stored lots</div>
            <div className="mt-0.5 font-semibold">{metrics.bins.length}</div>
          </div>
          <div className="rounded-lg border border-twin-border/70 bg-white/95 p-2">
            <div className="text-twin-muted">Occupancy</div>
            <div className="mt-0.5 font-semibold">{metrics.occupancy}%</div>
          </div>
        </div>
        <div><span className="text-twin-muted">Top product:</span> {topSku ? stockDisplayCode(topSku) : "empty rack"}</div>
        {popup.view === "skus" && (
          <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
            {metrics.bins.map((bin) => (
              <button key={bin.id} className="flex w-full items-center justify-between gap-2 rounded-lg border border-twin-border/70 bg-white/95 px-2 py-1.5 text-left hover:border-twin-blue/50 hover:bg-twin-blue/5" onClick={() => selectStockBalanceFromPopup(bin)}>
                <span className="min-w-0"><span className="block truncate font-semibold">{stockDisplayCode(bin.placement)}</span><span className="block truncate text-[10px] text-twin-muted">{wmsLocationLabel(bin.placement)} · {stockBalanceLabel(bin.placement)}</span></span>
                <StatusChip tone={statusTone(bin.placement.qualityStatus)}>{bin.placement.qualityStatus}</StatusChip>
              </button>
            ))}
          </div>
        )}
      </div>
    );
    actions = (
      <>
        <PopupActionButton onClick={() => onPatch({ view: popup.view === "skus" ? "summary" : "skus" })}>View Stock</PopupActionButton>
        <PopupActionButton disabled={!topSku} onClick={() => topSku ? openStockBalanceInInventory(topSku.stockBalanceId) : setView("Inventory")}>Open Inventory</PopupActionButton>
        <PopupActionButton primary onClick={showRoute}>View Route</PopupActionButton>
      </>
    );
  }

  if (popup.type === "sku" && popupSku) {
    const sector = getSector(popupSku.zoneId);
    const shipment = popupSku.linkedShipmentId ? snapshot.shipments.find((item) => item.id === popupSku.linkedShipmentId) ?? null : null;
    title = stockDisplayCode(popupSku);
    subtitle = `${sector?.name ?? popupSku.zoneId} - ${wmsLocationLabel(popupSku)}`;
    body = (
      <div className="space-y-2 text-[11px]">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-twin-border/70 bg-white/95 p-2">
            <div className="text-twin-muted">Expiry</div>
            <div className="mt-0.5 font-semibold">{formatDate(popupSku.expiryDate)}</div>
          </div>
          <div className="rounded-lg border border-twin-border/70 bg-white/95 p-2">
            <div className="text-twin-muted">Quality</div>
            <div className="mt-0.5 font-semibold">{popupSku.qualityStatus}</div>
          </div>
        </div>
        <div><span className="text-twin-muted">WMS location:</span> <span className="font-mono">{wmsLocationLabel(popupSku)}</span></div>
        <div><span className="text-twin-muted">Stock balance:</span> <span className="font-mono">{stockBalanceLabel(popupSku)}</span></div>
        <div><span className="text-twin-muted">Linked shipment:</span> {shipment?.id ?? popupSku.linkedShipmentId ?? "none"}</div>
      </div>
    );
    actions = (
      <>
        <PopupActionButton onClick={() => openStockBalanceInInventory(popupSku.stockBalanceId)}>Open Inventory</PopupActionButton>
        <PopupActionButton primary onClick={showRoute}>View Route</PopupActionButton>
        <PopupActionButton onClick={() => askAgent(popupSku)}>Ask Assistant</PopupActionButton>
      </>
    );
  }

  if (popup.type === "dock" && popupDock) {
    const shipment = popupDock.currentShipmentId ? snapshot.shipments.find((item) => item.id === popupDock.currentShipmentId) ?? null : null;
    title = popupDock.id;
    subtitle = popupAppointment ? `${popupAppointment.direction} · ${popupAppointment.status.replaceAll("_", " ")}` : `${popupDock.status} dock`;
    body = (
      <div className="space-y-2 text-[11px]">
        <div><span className="text-twin-muted">Appointment:</span> {popupAppointment?.dockAppointmentId ?? "none"}</div>
        <div><span className="text-twin-muted">Reference:</span> {popupAppointment ? `${popupAppointment.referenceType} ${popupAppointment.referenceId}` : shipment?.id ?? popupDock.currentShipmentId ?? "none"}</div>
        <div><span className="text-twin-muted">Window:</span> {popupAppointment ? `${formatTime(popupAppointment.scheduledStart)} – ${formatTime(popupAppointment.scheduledEnd)}` : formatTime(shipment?.dispatchTime ?? popupDock.nextAvailableAt)}</div>
        <div><span className="text-twin-muted">Carrier / vehicle:</span> {popupAppointment ? `${popupAppointment.carrierName} · ${popupAppointment.licensePlate}` : "not assigned"}</div>
        <div><span className="text-twin-muted">Temperature:</span> {popupAppointment?.temperatureRequirement ?? (shipment?.coldChainRequired ? "2-8C" : "ambient")}</div>
        {popupAppointment?.conflictFlag && <div className="rounded-lg border border-twin-warning/40 bg-twin-warning/10 px-2 py-1.5 font-semibold text-twin-warning">Dock-window conflict requires review.</div>}
      </div>
    );
    actions = (
      <>
        <PopupActionButton disabled={!popupTransportLeg && !shipment && !popupAppointment} onClick={() => {
          if (popupTransportLeg) openTransportLegInLogistics(popupTransportLeg.transportLegId, "transport");
          else if (popupAppointment?.direction === "inbound") openInboundInLogistics(popupAppointment.referenceId);
          else if (popupAppointment?.direction === "outbound") openOutboundInLogistics(popupAppointment.referenceId);
          else if (shipment) openOutboundInLogistics(shipment.id);
        }}>Open Transport</PopupActionButton>
        <PopupActionButton onClick={() => openDockScheduleInWarehouse({
          dockId: popupDock.id,
          appointmentId: popupAppointment?.dockAppointmentId ?? null,
          transportLegId: popupAppointment?.transportLegId ?? null,
          asnId: popupAppointment?.direction === "inbound" ? popupAppointment.referenceId : null,
          shipmentId: popupAppointment?.direction === "outbound" ? popupAppointment.referenceId : shipment?.id ?? null
        })}>View Schedule</PopupActionButton>
        <PopupActionButton primary onClick={showRoute}>View Route</PopupActionButton>
      </>
    );
  }

  if (popup.type === "rfid" && popupRfid) {
    const events = [...rfidFeed, ...snapshot.rfidEvents].filter((event) => popupRfid.scanZoneIds.includes(event.zoneId)).slice(0, 3);
    title = popupRfid.name.replace("RFID Gate 1", "Inbound RFID Gate").replace("RFID Gate 2", "Storage Exit RFID Gate").replace("RFID Gate 3", "Dispatch RFID Gate");
    subtitle = `Stage: ${popupRfid.stage}`;
    body = (
      <div className="space-y-2 text-[11px]">
        <p className="leading-relaxed text-twin-muted">{popupRfid.purpose}</p>
        {popup.view === "scans" ? (
          <div className="space-y-1">
            {events.length ? events.map((event) => (
              <div key={`${event.id}-${event.timestamp}`} className="rounded-lg border border-twin-border/70 bg-white/95 px-2 py-1.5">
                {event.action} {event.skuId} - {event.zoneId}
              </div>
            )) : <div className="rounded-lg border border-twin-border/70 bg-white/95 p-2 text-twin-muted">No recent scan attached.</div>}
          </div>
        ) : (
          <div><span className="text-twin-muted">Latest scan count:</span> {events.length}</div>
        )}
      </div>
    );
    actions = (
      <>
        <PopupActionButton onClick={() => onPatch({ view: popup.view === "scans" ? "summary" : "scans" })}>View Scans</PopupActionButton>
        <PopupActionButton primary onClick={showRoute}>View Route</PopupActionButton>
      </>
    );
  }

  if (popup.type === "sensor") {
    const sector = popupSector ?? getSector(popup.sectorId);
    const zone = snapshot.zones.find((item) => item.id === sector?.dataZoneId);
    const readings = snapshot.temperatureReadings.filter((reading) => reading.zoneId === zone?.id);
    const latest = readings[readings.length - 1] ?? null;
    title = popup.sensorLabel ?? "Temperature Sensor";
    subtitle = sector?.name ?? "Warehouse sensor";
    body = (
      <div className="space-y-2 text-[11px]">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-twin-border/70 bg-white/95 p-2">
            <div className="text-twin-muted">Current</div>
            <div className="mt-0.5 font-semibold">{(latest?.temperature ?? zone?.currentTemperature)?.toFixed(1) ?? "--"} C</div>
          </div>
          <div className="rounded-lg border border-twin-border/70 bg-white/95 p-2">
            <div className="text-twin-muted">Band</div>
            <div className="mt-0.5 font-semibold">{sector?.temperatureRange ?? "ambient"}</div>
          </div>
        </div>
        <div><span className="text-twin-muted">Status:</span> {zone?.status ?? "--"}</div>
        <div><span className="text-twin-muted">Latest:</span> {latest ? formatTime(latest.timestamp) : "--"}</div>
      </div>
    );
    actions = (
      <>
        <PopupActionButton onClick={() => onPatch({ view: popup.view === "telemetry" ? "summary" : "telemetry" })}>View Telemetry</PopupActionButton>
      </>
    );
  }

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 z-[19] h-full w-full">
        <line x1={popup.target.x} y1={popup.target.y} x2={edgeX} y2={edgeY} stroke="#19a7c7" strokeWidth="1.5" strokeDasharray="4 5" opacity="0.72" />
        <circle cx={popup.target.x} cy={popup.target.y} r="4" fill="#19a7c7" opacity="0.9" />
      </svg>
      <div
        ref={popupRef}
        className="pointer-events-auto absolute z-20 w-[310px] rounded-2xl border border-twin-cyan/30 bg-white/80 p-3 text-twin-text shadow-[0_18px_50px_rgba(31,45,61,0.16)] backdrop-blur-md"
        style={{ left: popup.anchor.x, top: popup.anchor.y }}
        onMouseDown={(event) => event.stopPropagation()}
      >
      <div className={clsx("flex items-start justify-between gap-3 rounded-xl border border-twin-border/60 bg-white/75 px-2.5 py-2", dragging ? "cursor-grabbing" : "cursor-grab")} onMouseDown={startDrag}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-twin-cyan shadow-[0_0_14px_rgba(25,167,199,0.35)]" />
            <h3 className="truncate text-sm font-semibold">{title}</h3>
          </div>
          <p className="mt-1 truncate text-[11px] text-twin-muted">{subtitle}</p>
        </div>
        <button className="rounded-lg border border-twin-border/70 bg-white/80 p-1 text-twin-muted hover:text-twin-text" onMouseDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="Close warehouse callout">
          <X size={13} />
        </button>
      </div>
      <div className="mt-3">{body}</div>
      {routeVisible && (
        <div className="mt-3 rounded-xl border border-twin-border/70 bg-white/95 p-2 text-[11px] leading-relaxed">
          <div className="mb-1 flex items-center justify-between gap-2">
            <StatusChip tone={routeTone}>{routeStatusLabel(route)}</StatusChip>
            <span className="text-twin-muted">{route.segments.length} segments</span>
          </div>
          <p className="text-twin-muted">{selectedRouteText}</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">{actions}</div>
      </div>
    </>
  );
}

function ManagementKpiCard({
  label,
  value,
  detail,
  icon,
  tone = "blue"
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone?: "blue" | "green" | "amber" | "red" | "slate";
}) {
  return (
    <article className={clsx("warehouse-kpi-card", `warehouse-kpi-card--${tone}`)}>
      <div className="warehouse-kpi-icon" aria-hidden="true">{icon}</div>
      <div className="min-w-0">
        <div className="warehouse-kpi-label">{label}</div>
        <div className="warehouse-kpi-value">{value}</div>
        <div className="warehouse-kpi-detail">{detail}</div>
      </div>
    </article>
  );
}

function UtilisationBar({ value, status }: { value: number; status: "normal" | "warn" | "critical" }) {
  return (
    <div className="warehouse-util-track" aria-label={`${value}% utilised`}>
      <span
        className={clsx(
          "warehouse-util-fill",
          status === "critical" ? "warehouse-util-fill--critical" : status === "warn" || value >= 85 ? "warehouse-util-fill--warning" : "warehouse-util-fill--healthy"
        )}
        style={{ width: `${Math.max(3, Math.min(value, 100))}%` }}
      />
    </div>
  );
}

export default function WarehouseView() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const clearSelection = useAppStore((state) => state.clearSelection);
  const selectedStockBalanceId = useAppStore((state) => state.selectedStockBalanceId);
  const selectedZoneId = useAppStore((state) => state.selectedZoneId);
  const selectedDockId = useAppStore((state) => state.selectedDockId);
  const setSelectedZone = useAppStore((state) => state.setSelectedZone);
  const setSelectedDock = useAppStore((state) => state.setSelectedDock);
  const setSelectedStage = useAppStore((state) => state.setSelectedStage);
  const warehouseWorkspace = useAppStore((state) => state.warehouseWorkspace);
  const setWarehouseWorkspace = useAppStore((state) => state.setWarehouseWorkspace);
  const setView = useAppStore((state) => state.setView);
  const mapSectionRef = useRef<HTMLElement | null>(null);
  const [popup, setPopup] = useState<WarehousePopupState | null>(null);
  const [routeVisible, setRouteVisible] = useState(false);
  const [sceneKey, setSceneKey] = useState(0);
  const storedPositions = snapshot.inventoryPlacements;
  const storageBins = useMemo(() => buildWarehouseBins(storedPositions), [storedPositions]);
  const totalStockPositions = storedPositions.length;
  const occupiedRackCount = new Set(storageBins.filter((bin) => bin.storageKind === "rack").map((bin) => bin.rackId)).size;
  const totalLocationCapacity = snapshot.inventory.locations.reduce((sum, location) => sum + location.capacity, 0);
  const totalUnits = snapshot.inventory.stockBalances.reduce((sum, balance) => sum + balance.qtyOnHand, 0);
  const overallFillRate = totalLocationCapacity ? Math.round(totalUnits / totalLocationCapacity * 100) : 0;
  const openAlerts = [...snapshot.alerts]
    .filter((alert) => alert.status === "open")
    .sort((a, b) => (a.severity === "critical" ? -1 : b.severity === "critical" ? 1 : new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
  const criticalAlertCount = openAlerts.filter((alert) => alert.severity === "critical").length;
  const holdCount = storedPositions.filter((item) => item.qualityStatus !== "Released").length;
  const monitoredZones = snapshot.zones.filter((zone) => ["CS", "AM", "PH", "DS"].includes(zone.id));
  const compliantZoneCount = monitoredZones.filter((zone) => zone.status === "normal").length;
  const availableDockCount = snapshot.docks.filter((dock) => dock.status === "available").length;
  const occupiedDockCount = snapshot.docks.filter((dock) => dock.status === "occupied").length;
  const availableRackRows = Math.max(0, warehouseRacks.length - occupiedRackCount);
  const latestActivityMs = [
    ...snapshot.temperatureReadings.map((reading) => new Date(reading.timestamp).getTime()),
    ...snapshot.rfidEvents.map((event) => new Date(event.timestamp).getTime()),
    ...snapshot.alerts.map((alert) => new Date(alert.timestamp).getTime())
  ].filter(Number.isFinite).reduce((latest, value) => Math.max(latest, value), 0);
  const lastUpdatedLabel = latestActivityMs
    ? new Date(latestActivityMs).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" })
    : "Live";
  const managementZones = ["CS", "AM", "PH", "DS"]
    .map((id) => snapshot.zones.find((zone) => zone.id === id))
    .filter((zone): zone is NonNullable<typeof zone> => Boolean(zone));
  const targetFromEvent = (event?: SceneClickEvent): PopupAnchor => {
    const native = event?.nativeEvent;
    return { x: native?.offsetX ?? 360, y: native?.offsetY ?? 210 };
  };
  const anchorFromEvent = (event?: SceneClickEvent): PopupAnchor => {
    const native = event?.nativeEvent;
    const bounds = mapSectionRef.current?.getBoundingClientRect();
    const width = 310;
    const height = 238;
    const rawX = (native?.offsetX ?? 320) + 16;
    const rawY = (native?.offsetY ?? 140) - 18;
    const maxX = Math.max(12, (bounds?.width ?? 720) - width - 12);
    const maxY = Math.max(70, (bounds?.height ?? 560) - height - 12);
    return { x: Math.min(Math.max(rawX, 12), maxX), y: Math.min(Math.max(rawY, 76), maxY) };
  };
  const openPopup = (nextPopup: Omit<WarehousePopupState, "anchor" | "target">, event: SceneClickEvent) => {
    setPopup({ ...nextPopup, anchor: anchorFromEvent(event), target: targetFromEvent(event) });
    setRouteVisible(false);
  };
  const patchPopup = (patch: Partial<WarehousePopupState>) => {
    setPopup((current) => (current ? { ...current, ...patch } : current));
    if (patch.id || patch.type) setRouteVisible(false);
  };
  const closePopup = () => {
    setPopup(null);
    setRouteVisible(false);
  };
  const clearMapSelection = () => {
    clearSelection();
    closePopup();
  };
  const resetView = () => {
    clearSelection();
    closePopup();
    setSceneKey((value) => value + 1);
  };
  const managementPopupPosition = () => {
    const bounds = mapSectionRef.current?.getBoundingClientRect();
    const canvasWidth = bounds?.width ?? 780;
    const canvasHeight = bounds?.height ?? 620;
    return {
      target: { x: Math.round(canvasWidth * 0.58), y: Math.round(canvasHeight * 0.44) },
      anchor: {
        x: Math.max(12, Math.min(canvasWidth - 326, canvasWidth * 0.62)),
        y: Math.max(84, Math.min(canvasHeight - 252, 112))
      }
    };
  };
  const focusZone = (zoneId: string) => {
    const sector = getSector(zoneId);
    if (!sector) return;
    setSelectedZone(sector.id);
    setSelectedStage(sector.stage);
    setPopup({ type: "zone", id: sector.id, view: "summary", ...managementPopupPosition() });
    setRouteVisible(false);
  };
  const focusDock = (dockId: string) => {
    setSelectedDock(dockId);
    setSelectedStage("Dispatch");
    setPopup({ type: "dock", id: dockId, view: "summary", ...managementPopupPosition() });
    setRouteVisible(false);
  };

  useEffect(() => {
    if (warehouseWorkspace !== "facility" || !selectedDockId || (popup?.type === "dock" && popup.id === selectedDockId)) return;
    setPopup({ type: "dock", id: selectedDockId, view: "summary", ...managementPopupPosition() });
    setRouteVisible(false);
  }, [selectedDockId, warehouseWorkspace]);

  useEffect(() => {
    if (warehouseWorkspace !== "facility" || !selectedStockBalanceId) return;
    const bounds = mapSectionRef.current?.getBoundingClientRect();
    const target = { x: Math.round((bounds?.width ?? 720) * 0.56), y: Math.round((bounds?.height ?? 520) * 0.46) };
    setPopup({
      type: "sku",
      id: selectedStockBalanceId,
      view: "summary",
      target,
      anchor: {
        x: Math.min(Math.max(target.x + 28, 12), Math.max(12, (bounds?.width ?? 720) - 322)),
        y: Math.min(Math.max(target.y - 36, 76), Math.max(76, (bounds?.height ?? 520) - 250))
      }
    });
    setRouteVisible(false);
  }, [selectedStockBalanceId, warehouseWorkspace]);

  return (
    <div className="warehouse-management-view">
      <header className="warehouse-management-header">
        <div className="flex min-w-0 items-center gap-3">
          <div className="warehouse-title-mark" aria-hidden="true"><WarehouseIcon size={22} /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="warehouse-management-title">Western Distribution Centre</h1>
              <span className="warehouse-live-badge"><Wifi size={12} /> Live operations</span>
            </div>
            <p className="warehouse-management-subtitle">Warehouse control view · Singapore · Current shift</p>
          </div>
        </div>
        <div className="warehouse-refresh-status">
          <span className="warehouse-refresh-dot" />
          <div>
            <div className="warehouse-refresh-label">Data synchronised</div>
            <div className="warehouse-refresh-time"><Clock3 size={12} /> Updated {lastUpdatedLabel} SGT</div>
          </div>
        </div>
      </header>

      <WorkspaceNav
        label="Warehouse workspace"
        value={warehouseWorkspace}
        onChange={setWarehouseWorkspace}
        items={[
          { id: "facility", label: "Facility", detail: "Live physical operation", icon: MapIcon },
          { id: "locations", label: "Storage locations", detail: `${snapshot.inventory.locations.length} WMS locations`, icon: Boxes },
          { id: "docks", label: "Dock schedule", detail: `${snapshot.dockAppointments.length || snapshot.dockSchedule.length} appointments`, icon: CalendarClock }
        ]}
      />

      <section className="warehouse-kpi-grid" aria-label="Warehouse management metrics">
        <ManagementKpiCard label="Space utilisation" value={`${overallFillRate}%`} detail={`${totalUnits.toLocaleString()} of ${totalLocationCapacity.toLocaleString()} capacity units`} icon={<Gauge size={19} />} tone={overallFillRate >= 90 ? "amber" : "blue"} />
        <ManagementKpiCard label="Rack activity" value={`${occupiedRackCount} / ${warehouseRacks.length}`} detail={`${availableRackRows} rack rows available`} icon={<Boxes size={19} />} tone="blue" />
        <ManagementKpiCard label="Temperature control" value={`${compliantZoneCount} / ${monitoredZones.length}`} detail="monitored zones within range" icon={<Snowflake size={19} />} tone={compliantZoneCount === monitoredZones.length ? "green" : "red"} />
        <ManagementKpiCard label="Dock readiness" value={`${availableDockCount} / ${snapshot.docks.length}`} detail={`${occupiedDockCount} doors currently active`} icon={<WarehouseIcon size={19} />} tone={availableDockCount ? "green" : "amber"} />
        <ManagementKpiCard label="Quality attention" value={`${holdCount}`} detail={`${criticalAlertCount} critical · ${openAlerts.length} open alerts`} icon={<ShieldCheck size={19} />} tone={criticalAlertCount ? "red" : holdCount ? "amber" : "green"} />
      </section>

      {warehouseWorkspace === "facility" && <section className="warehouse-control-grid">
        <section ref={mapSectionRef} className="warehouse-map-shell" aria-label="Interactive warehouse floor plan">
          <div className="warehouse-map-topbar">
            <div className="warehouse-map-heading">
              <span className="warehouse-map-eyebrow"><Activity size={12} /> Live floor</span>
              <strong>Operational layout</strong>
            </div>
            <button className="warehouse-reset-button" onClick={resetView}><Route size={14} /> Reset</button>
          </div>

          <WarehouseModelView key={`${sceneKey}-${snapshot.inventoryPlacements.length}`} mode="Overview" popup={popup} routeVisible={routeVisible} onOpenPopup={openPopup} onClearSelection={clearMapSelection} />

          <div className="warehouse-map-legend" aria-label="Map legend">
            <span><i className="warehouse-legend-dot warehouse-legend-dot--healthy" /> Available / normal</span>
            <span><i className="warehouse-legend-dot warehouse-legend-dot--occupied" /> Occupied / active</span>
            <span><i className="warehouse-legend-dot warehouse-legend-dot--warning" /> Attention</span>
            <span><i className="warehouse-legend-dot warehouse-legend-dot--critical" /> Blocked / hold</span>
          </div>
          <div className="warehouse-map-hint"><LocateFixed size={13} /> Select any room, rack, sensor, RFID gate, pallet or dock for details</div>

          {popup && <WarehouseContextPopup popup={popup} routeVisible={routeVisible} onClose={closePopup} onPatch={patchPopup} onViewRoute={() => setRouteVisible(true)} />}
        </section>

        <aside className="warehouse-command-rail" aria-label="Warehouse operational summary">
          <section className="warehouse-rail-card warehouse-rail-card--status">
            <div className="warehouse-rail-heading">
              <div><span className="warehouse-rail-eyebrow">Facility status</span><h2>{criticalAlertCount ? "Attention required" : "Operations stable"}</h2></div>
              <span className={clsx("warehouse-health-mark", criticalAlertCount && "warehouse-health-mark--critical")}>{criticalAlertCount ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}</span>
            </div>
            <p>{criticalAlertCount ? `${criticalAlertCount} critical condition${criticalAlertCount === 1 ? "" : "s"} need management review.` : "No critical operating conditions are currently open."}</p>
          </section>

          <section className="warehouse-rail-card">
            <div className="warehouse-rail-heading">
              <div><span className="warehouse-rail-eyebrow">Storage conditions</span><h2>Zone utilisation</h2></div>
              <span className="warehouse-rail-count">{totalStockPositions} lots</span>
            </div>
            <div className="warehouse-zone-list">
              {managementZones.map((zone) => (
                <button key={zone.id} className={clsx("warehouse-zone-row", selectedZoneId === zone.id && "warehouse-zone-row--active")} onClick={() => focusZone(zone.id)}>
                  <div className="warehouse-zone-row-top">
                    <span className="warehouse-zone-code">{zone.code || zone.id}</span>
                    <span className="warehouse-zone-name">{zone.name}</span>
                    <span className={clsx("warehouse-zone-temp", zone.status !== "normal" && "warehouse-zone-temp--alert")}>{zone.currentTemperature.toFixed(1)}°C</span>
                  </div>
                  <div className="warehouse-zone-row-bottom"><UtilisationBar value={zone.fillPercent} status={zone.status} /><strong>{zone.fillPercent}%</strong></div>
                </button>
              ))}
            </div>
          </section>

          <section className="warehouse-rail-card">
            <div className="warehouse-rail-heading">
              <div><span className="warehouse-rail-eyebrow">Door activity</span><h2>Loading docks</h2></div>
              <span className="warehouse-rail-count">{availableDockCount} ready</span>
            </div>
            <div className="warehouse-dock-grid">
              {snapshot.docks.map((dock) => (
                <button key={dock.id} className={clsx("warehouse-dock-button", `warehouse-dock-button--${dock.status}`, selectedDockId === dock.id && "warehouse-dock-button--selected")} onClick={() => focusDock(dock.id)} aria-label={`${dock.id}, ${dock.status}`}>
                  <span>{dock.id}</span><i />
                </button>
              ))}
            </div>
          </section>

          <section className="warehouse-rail-card warehouse-rail-card--alerts">
            <div className="warehouse-rail-heading">
              <div><span className="warehouse-rail-eyebrow">Live exceptions</span><h2>Management attention</h2></div>
              <span className={clsx("warehouse-alert-count", criticalAlertCount && "warehouse-alert-count--critical")}>{openAlerts.length}</span>
            </div>
            <div className="warehouse-alert-list">
              {openAlerts.length ? openAlerts.slice(0, 2).map((alert) => (
                <div key={alert.id} className={clsx("warehouse-alert-row", alert.severity === "critical" && "warehouse-alert-row--critical")}>
                  <AlertTriangle size={14} />
                  <div><strong>{alert.severity === "critical" ? "Critical exception" : "Action recommended"}</strong><p>{alert.message}</p></div>
                </div>
              )) : <div className="warehouse-alert-empty"><CheckCircle2 size={16} /> No open exceptions</div>}
            </div>
            <button className="warehouse-rail-link" onClick={() => setView("Alerts")}>Review all operational alerts <ArrowRight size={14} /></button>
          </section>
        </aside>
      </section>}

      {warehouseWorkspace === "locations" && <WarehouseLocationsView snapshot={snapshot} />}
      {warehouseWorkspace === "docks" && <WarehouseDockSchedule snapshot={snapshot} />}

      <footer className="warehouse-management-footer">
        <span><Box size={13} /> {totalStockPositions} stored lots</span>
        <span><Radio size={13} /> {snapshot.rfidEvents.length} RFID events in feed</span>
        <span><Thermometer size={13} /> {monitoredZones.length} monitored environments</span>
        <span><CheckCircle2 size={13} /> WMS, TMS and sensor connections online</span>
      </footer>
    </div>
  );
}
