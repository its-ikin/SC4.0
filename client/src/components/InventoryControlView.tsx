import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Calculator,
  CheckCircle2,
  Columns3,
  History,
  LayoutDashboard,
  LocateFixed,
  PackageSearch,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  X
} from "lucide-react";
import clsx from "clsx";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type {
  BatchStockPosition,
  InventoryWorkspace,
  InboundShipment,
  OutboundLine,
  OutboundShipment,
  Product,
  ProductStockPosition,
  QualityStatus,
  WarehouseSnapshot
} from "@twinops/shared";
import { calculateScheduleAdherence, inboundScheduleAdherence } from "@twinops/shared";
import { useAppStore } from "../store";
import { calendarDaysBetween, dwellDays, expiryPresentation, formatLocalDate, formatLocalDateTime, rawTime } from "../lib/dateTime";
import { INVENTORY_POLICY } from "../lib/inventoryPolicy";
import { getSector } from "../warehouseLayout";
import { StatusChip, WorkspaceNav, type Tone } from "./ui";
import InventoryPlanningView from "./InventoryPlanningView";


type ExceptionKey = "quality" | "expiring" | "expired" | "dwell" | "count" | "low" | "overstock";
type StockSort = "expiry" | "onHand" | "available" | "dwell" | "location" | "status";
type AdvancedFilters = {
  product: string;
  lot: string;
  handlingUnit: string;
  sto: string;
  inspectionLot: string;
  quality: string;
  expiryFrom: string;
  expiryTo: string;
  dwellMin: string;
  dwellMax: string;
  shelfMin: string;
  shelfMax: string;
  category: string;
};

const emptyAdvanced: AdvancedFilters = { product: "", lot: "", handlingUnit: "", sto: "", inspectionLot: "", quality: "", expiryFrom: "", expiryTo: "", dwellMin: "", dwellMax: "", shelfMin: "", shelfMax: "", category: "" };
const inboundStages = ["Expected", "In Transit", "Arrived", "Receiving", "Receipt / QA", "Put-away"];
const outboundStages = ["Order / Release", "Allocated", "Picking", "Packing", "Staging / Loading", "Goods Issue"];


type StockRow = { product: Product; position: ProductStockPosition; batch: BatchStockPosition };

function toneForStatus(status: string): Tone {
  const lower = status.toLowerCase();
  if (lower.includes("block") || lower.includes("exception") || lower.includes("quarantine") || lower.includes("expired") || lower.includes("hold")) return "critical";
  if (lower.includes("complete") || lower.includes("dispatch") || lower.includes("deliver") || lower === "released" || lower === "received") return "healthy";
  if (lower.includes("pending") || lower.includes("transit") || lower.includes("receiv") || lower.includes("pick") || lower.includes("pack") || lower.includes("load") || lower.includes("gate")) return "warning";
  return "neutral";
}

function inventoryZoneCode(zone: string) {
  const value = zone.toLowerCase();
  if (value.includes("cold")) return "CS";
  if (value.includes("ambient")) return "AM";
  if (value.includes("pharmaceutical")) return "PH";
  if (value.includes("qa")) return "QA";
  if (value.includes("quarantine")) return "QT";
  if (value.includes("receiving")) return "RCV";
  if (value.includes("dispatch")) return "DS";
  return zone;
}

function outboundDispatchAdherence(shipment: OutboundShipment, now = new Date()) {
  const departureRecordedByStatus = ["Goods Issued", "Dispatched", "Delivered"].includes(shipment.outboundStatus);
  return calculateScheduleAdherence({
    targetTime: shipment.plannedDeparture,
    actualTime: shipment.actualDeparture,
    completed: departureRecordedByStatus,
    pendingMilestone: "Departure",
    completedMilestone: "Departed"
  }, now);
}

function inboundStage(status: InboundShipment["inboundStatus"]) {
  if (["ASN Received", "Appointment Booked", "Vehicle Assigned", "Scheduled"].includes(status)) return 0;
  if (status === "In Transit") return 1;
  if (status === "Gate In") return 2;
  if (["At Receiving", "Unloading"].includes(status)) return 3;
  if (["Received", "QA Pending", "QA Hold", "Released", "Exception"].includes(status)) return 4;
  return 5;
}

function outboundStage(status: OutboundShipment["outboundStatus"], lines: OutboundLine[] = []) {
  if (["Order Received", "Delivery Created", "Scheduled", "Wave Released"].includes(status)) return 0;
  if (["Allocated", "Replenishment"].includes(status)) return 1;
  if (["Picking", "Picked"].includes(status)) return 2;
  if (["Packed", "QA Release"].includes(status)) return 3;
  if (["Staged", "Loading"].includes(status)) return 4;
  if (["Goods Issued", "Dispatched", "Delivered"].includes(status)) return 5;
  if (lines.some((line) => line.qtyDispatched > 0)) return 5;
  if (lines.some((line) => line.qtyPacked > 0)) return 3;
  if (lines.some((line) => line.qtyPicked > 0)) return 2;
  if (lines.some((line) => line.qtyAllocated > 0)) return 1;
  return 0;
}

function Drawer({ title, subtitle, onClose, children, footer }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  return <><button className="fixed inset-0 z-40 cursor-default bg-twin-text/25" onClick={onClose} aria-label="Close details" /><aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[760px] flex-col border-l border-twin-border bg-twin-bg shadow-2xl" role="dialog" aria-modal="true" aria-label={`${title} details`}><header className="flex items-start justify-between gap-3 border-b border-twin-border bg-white/80 px-5 py-4"><div className="min-w-0"><h3 className="truncate text-lg font-semibold text-twin-text">{title}</h3><p className="mt-0.5 truncate text-xs text-twin-muted">{subtitle}</p></div><button autoFocus className="rounded-lg border border-twin-border bg-white p-2 text-twin-muted hover:text-twin-text" onClick={onClose} aria-label="Close details"><X size={16} /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>{footer && <footer className="border-t border-twin-border bg-white/95 px-5 py-3">{footer}</footer>}</aside></>;
}

function DefinitionGrid({ rows }: { rows: Array<[string, ReactNode]> }) {
  return <dl className="grid gap-3 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="rounded-xl border border-twin-border/70 bg-white/70 p-3"><dt className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">{label}</dt><dd className="mt-1 text-xs font-semibold text-twin-text">{value}</dd></div>)}</dl>;
}

function Overview({ snapshot, onNavigate, onOpenInbound, onOpenOutbound }: { snapshot: WarehouseSnapshot; onNavigate: (mode: InventoryWorkspace) => void; onOpenInbound: (asnId: string) => void; onOpenOutbound: (shipmentId: string) => void }) {
  const { inventory } = snapshot;
  const openStockBalanceInInventory = useAppStore((state) => state.openStockBalanceInInventory);
  const setInventoryQuickFilter = useAppStore((state) => state.setInventoryQuickFilter);
  const rows = inventory.stockPositions.flatMap((position) => position.batches.map((batch) => ({ product: position.product, batch })));
  const committedUnits = rows.reduce((sum, { batch }) => sum + batch.qtyReserved + batch.qtyPicked + batch.qtyPacked + batch.qtyStaged, 0);
  const restrictedRows = rows.filter(({ batch }) => batch.qualityStatus !== "Released");
  const restrictedUnits = restrictedRows.reduce((sum, { batch }) => sum + batch.qtyOnHand, 0);
  const availableShare = inventory.summary.onHand ? Math.round((inventory.summary.available / inventory.summary.onHand) * 100) : 0;
  const restrictedShare = inventory.summary.onHand ? (restrictedUnits / inventory.summary.onHand) * 100 : 0;
  const committedShare = inventory.summary.onHand ? Math.round((committedUnits / inventory.summary.onHand) * 100) : 0;
  const activeInbound = inventory.inboundShipments.filter((shipment) => !["Putaway Complete", "Closed"].includes(shipment.inboundStatus));
  const activeOutbound = inventory.outboundShipments.filter((shipment) => !["Dispatched", "Delivered"].includes(shipment.outboundStatus));
  const openInboundWorkload = () => {
    const shipment = activeInbound[0];
    if (shipment) onOpenInbound(shipment.asnId);
  };
  const openOutboundWorkload = () => {
    const shipment = activeOutbound[0];
    if (shipment) onOpenOutbound(shipment.shipmentId);
  };
  const inboundCounts = inboundStages.map((_, index) => activeInbound.filter((shipment) => inboundStage(shipment.inboundStatus) === index).length);
  const outboundCounts = outboundStages.map((_, index) => activeOutbound.filter((shipment) => outboundStage(shipment.outboundStatus, inventory.outboundLines.filter((line) => line.shipmentId === shipment.shipmentId)) === index).length);
  const riskData = inventory.stockPositions
    .map((position) => {
      const onHand = position.batches.reduce((sum, batch) => sum + batch.qtyOnHand, 0);
      const restricted = position.batches.filter((batch) => batch.qualityStatus !== "Released").reduce((sum, batch) => sum + batch.qtyOnHand, 0);
      return { product: position.product.productCode, restricted, share: onHand ? Math.round((restricted / onHand) * 100) : 0 };
    })
    .filter((product) => product.restricted > 0)
    .sort((a, b) => b.restricted - a.restricted);
  const topRiskProduct = riskData[0] ?? null;
  const topRiskContribution = topRiskProduct && restrictedUnits ? Math.round((topRiskProduct.restricted / restrictedUnits) * 100) : 0;
  const flowData = [
    { stage: "Start", inbound: inboundCounts[0], outbound: outboundCounts[0] },
    { stage: "Transit / allocated", inbound: inboundCounts[1], outbound: outboundCounts[1] },
    { stage: "Arrived / picking", inbound: inboundCounts[2], outbound: outboundCounts[2] },
    { stage: "Receiving / packing", inbound: inboundCounts[3], outbound: outboundCounts[3] },
    { stage: "QA / loading", inbound: inboundCounts[4], outbound: outboundCounts[4] },
    { stage: "Completion", inbound: inboundCounts[5], outbound: outboundCounts[5] }
  ];
  const storageData = snapshot.zones
    .filter((zone) => ["CS", "PH", "AM", "QA", "QT"].includes(zone.code))
    .map((zone) => ({ zone: zone.name, utilization: zone.fillPercent }))
    .sort((a, b) => b.utilization - a.utilization);
  const averageUtilization = storageData.length ? Math.round(storageData.reduce((sum, zone) => sum + zone.utilization, 0) / storageData.length) : 0;
  const delayedInbound = activeInbound.filter((shipment) => inboundScheduleAdherence(shipment).status === "delayed").length;
  const delayedOutbound = activeOutbound.filter((shipment) => outboundDispatchAdherence(shipment).status === "delayed").length;
  const recordedMovements = inventory.movements.filter((movement) => Number.isFinite(rawTime(movement.timestamp)));
  const latestMovementTime = recordedMovements.reduce((latest, movement) => Math.max(latest, rawTime(movement.timestamp)), 0);
  const currentActivity = recordedMovements.filter((movement) => rawTime(movement.timestamp) > latestMovementTime - 86_400_000);
  const priorActivity = recordedMovements.filter((movement) => rawTime(movement.timestamp) > latestMovementTime - 172_800_000 && rawTime(movement.timestamp) <= latestMovementTime - 86_400_000);
  const activityDelta = currentActivity.length - priorActivity.length;
  const delayedWorkload = delayedInbound + delayedOutbound;
  const inventoryNeedsAttention = restrictedShare > 5 || availableShare < 85 || delayedWorkload > 0;
  const attentionRows = rows
    .map(({ product, batch }) => {
      const expiry = expiryPresentation(batch.expiryDate);
      const reason = batch.qualityStatus !== "Released" ? batch.qualityStatus : expiry.days !== null && expiry.days <= INVENTORY_POLICY.expiryWarningDays ? expiry.label : null;
      const priority = batch.qualityStatus === "Quarantine" || batch.qualityStatus === "QA Hold" || expiry.state === "expired" ? 0 : expiry.state === "critical" ? 1 : 2;
      return { product, batch, reason, priority };
    })
    .filter((row): row is typeof row & { reason: string } => Boolean(row.reason))
    .sort((a, b) => a.priority - b.priority || (expiryPresentation(a.batch.expiryDate).days ?? 99999) - (expiryPresentation(b.batch.expiryDate).days ?? 99999))
    .slice(0, 5);
  const chartTooltipStyle = { borderRadius: 12, border: "1px solid #d8e2ec", fontSize: 11, boxShadow: "0 8px 24px rgba(31, 55, 77, 0.08)" };
  const reviewRestricted = () => {
    setInventoryQuickFilter("Restricted Stock");
    onNavigate("stock");
  };

  return (
    <div className="inventory-overview space-y-4">
      <section className={clsx("inventory-summary-bar", inventoryNeedsAttention && "inventory-summary-bar--attention")} aria-labelledby="inventory-health-heading">
        <div className="inventory-summary-copy">
          <div className="inventory-summary-title">
            <h3 id="inventory-health-heading">Inventory summary</h3>
            <StatusChip tone={inventoryNeedsAttention ? "critical" : "healthy"} className="gap-1">
              {inventoryNeedsAttention ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
              {inventoryNeedsAttention ? "Attention" : "Normal"}
            </StatusChip>
          </div>
          <p>{inventory.summary.productCount} products · {inventory.summary.batchCount} lots · {inventory.movements.length} movements{delayedWorkload ? ` · ${delayedWorkload} delayed` : ""}</p>
        </div>
        <div className="inventory-summary-actions">
          <button className="inventory-summary-action inventory-summary-action--primary" onClick={() => onNavigate("stock")}><PackageSearch size={14} /> Stock positions</button>
          <button className="inventory-summary-action" onClick={reviewRestricted}><ShieldAlert size={14} /> Restricted</button>
          <button className="inventory-summary-action" onClick={() => onNavigate("planning")}><Calculator size={14} /> Plan replenishment</button>
        </div>
      </section>

      <section className="inventory-indicator-rail" aria-label="Inventory indicators">
        {[
          { label: "Available", value: inventory.summary.available.toLocaleString(), ratio: availableShare, benchmark: 85, tone: "healthy", onClick: () => onNavigate("stock") },
          { label: "Committed", value: committedUnits.toLocaleString(), ratio: committedShare, benchmark: null, tone: "warning", onClick: openOutboundWorkload },
          { label: "Restricted", value: restrictedUnits.toLocaleString(), ratio: restrictedShare, benchmark: 5, tone: restrictedShare <= 5 ? "healthy" : "critical", onClick: reviewRestricted },
          { label: "Utilization", value: `${averageUtilization}%`, ratio: averageUtilization, benchmark: 75, tone: averageUtilization >= 85 ? "critical" : averageUtilization >= 70 ? "warning" : "healthy", onClick: () => onNavigate("stock") }
        ].map((indicator) => (
          <button key={indicator.label} className={clsx("inventory-indicator", `inventory-indicator--${indicator.tone}`)} onClick={indicator.onClick}>
            <span className="inventory-indicator-heading"><span>{indicator.label}</span><strong>{indicator.value}</strong></span>
            <span className="inventory-indicator-visual">
              <span className="inventory-indicator-track" role="img" aria-label={`${indicator.label} ${indicator.ratio.toFixed(indicator.ratio % 1 ? 1 : 0)} percent${indicator.benchmark === null ? "" : `, reference ${indicator.benchmark} percent`}`}>
                <i style={{ width: `${Math.max(0, Math.min(indicator.ratio, 100))}%` }} />
                {indicator.benchmark !== null && <b style={{ left: `${indicator.benchmark}%` }} aria-hidden="true" />}
              </span>
              <span>{indicator.ratio.toFixed(indicator.ratio % 1 ? 1 : 0)}%</span>
            </span>
          </button>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="panel rounded-2xl p-4" aria-labelledby="composition-heading">
          <div className="inventory-section-heading"><div><h3 id="composition-heading">Restricted stock</h3><p>{restrictedUnits.toLocaleString()} units · {restrictedRows.length} lots</p></div><button onClick={reviewRestricted}>View stock <ArrowRight size={12} /></button></div>
          <div className="mt-3 grid items-stretch gap-3 lg:grid-cols-[230px_minmax(0,1fr)]">
            <div className="inventory-risk-summary">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-critical">Restricted</div>
              <div className="mt-2 text-3xl font-semibold tabular-nums text-twin-critical">{restrictedShare.toFixed(1)}%</div>
              <div className="mt-1 text-[11px] text-twin-muted">{restrictedUnits.toLocaleString()} units · limit 5%</div>
              {topRiskProduct && <div className="mt-3 border-t border-red-100 pt-3 text-[10px] text-twin-muted"><span className="block font-semibold text-twin-text">Largest</span><span className="mt-1 block break-words">{topRiskProduct.product}</span><span className="mt-0.5 block font-semibold text-twin-critical">{topRiskProduct.restricted.toLocaleString()} units · {topRiskContribution}%</span></div>}
            </div>
            <div className="h-[230px] min-w-0">
              {riskData.length ? <ResponsiveContainer width="100%" height="100%">
                <BarChart data={riskData} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#dfe7ef" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#6f8193" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="product" width={132} tick={{ fontSize: 10, fill: "#34495e" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="restricted" name="Restricted units" fill="#cc3f3f" radius={[0, 5, 5, 0]} label={{ position: "right", fontSize: 10, fill: "#8f3947" }} />
                </BarChart>
              </ResponsiveContainer> : <div className="flex h-full items-center justify-center text-xs text-twin-muted">No restricted inventory.</div>}
            </div>
          </div>
        </section>

        <section className="panel rounded-2xl p-4" aria-labelledby="attention-heading">
          <div className="inventory-section-heading"><div><h3 id="attention-heading">Stock exceptions</h3><p>{attentionRows.length} priority lots</p></div><button onClick={() => onNavigate("stock")}>View all <ArrowRight size={12} /></button></div>
          <div className="mt-3 space-y-2">
            {attentionRows.map(({ product, batch, reason }) => (
              <button key={batch.stockBalanceId} className="inventory-exception-row" onClick={() => openStockBalanceInInventory(batch.stockBalanceId)}>
                <span className="min-w-0"><span className="block truncate text-xs font-semibold">{product.productCode}</span><span className="block truncate text-[10px] text-twin-muted">Lot {batch.lotCode} · {batch.location.locationId} · {batch.qtyOnHand.toLocaleString()} units</span></span>
                <StatusChip tone={toneForStatus(reason)}>{reason}</StatusChip>
              </button>
            ))}
            {!attentionRows.length && <div className="rounded-xl border border-dashed border-twin-border p-5 text-center text-xs text-twin-muted">No immediate stock exceptions.</div>}
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="panel rounded-2xl p-4" aria-labelledby="flow-heading">
          <div className="inventory-section-heading"><div><h3 id="flow-heading">Inbound / outbound</h3><p>{activeInbound.length} inbound · {activeOutbound.length} outbound</p></div><span className={clsx("inventory-delay-badge", delayedWorkload && "inventory-delay-badge--critical")}>{delayedWorkload} delayed</span></div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <article className="inventory-flow-card inventory-flow-card--inbound">
              <header><span className="inventory-flow-icon"><ArrowDownToLine size={16} /></span><span><small>Inbound</small><strong>{activeInbound.length} documents</strong></span><button aria-label="Open inbound in Logistics" disabled={!activeInbound.length} onClick={openInboundWorkload}>View <ArrowRight size={11} /></button></header>
              <div className="inventory-stage-list">{flowData.map((stage) => <div key={stage.stage}><span>{stage.stage}</span><span className="inventory-stage-track"><i style={{ width: `${activeInbound.length ? Math.max(6, stage.inbound / activeInbound.length * 100) : 0}%` }} /></span><strong>{stage.inbound}</strong></div>)}</div>
            </article>
            <article className="inventory-flow-card inventory-flow-card--outbound">
              <header><span className="inventory-flow-icon"><ArrowUpFromLine size={16} /></span><span><small>Outbound</small><strong>{activeOutbound.length} documents</strong></span><button aria-label="Open outbound in Logistics" disabled={!activeOutbound.length} onClick={openOutboundWorkload}>View <ArrowRight size={11} /></button></header>
              <div className="inventory-stage-list">{flowData.map((stage) => <div key={stage.stage}><span>{stage.stage}</span><span className="inventory-stage-track"><i style={{ width: `${activeOutbound.length ? Math.max(6, stage.outbound / activeOutbound.length * 100) : 0}%` }} /></span><strong>{stage.outbound}</strong></div>)}</div>
            </article>
          </div>
          <div className="inventory-activity-foot"><CheckCircle2 size={13} /><span><strong>{currentActivity.length} movements</strong> · latest 24h</span><span className={clsx("ml-auto font-semibold", priorActivity.length && activityDelta > 0 ? "text-twin-warning" : activityDelta < 0 ? "text-twin-green" : "text-twin-muted")}>{priorActivity.length ? `${activityDelta > 0 ? "+" : ""}${activityDelta} vs prior` : "No prior period"}</span></div>
        </section>

        <section className="panel rounded-2xl p-4" aria-labelledby="capacity-heading">
          <div className="inventory-section-heading"><div><h3 id="capacity-heading">Storage utilization</h3><p>{storageData.length} controlled areas</p></div><strong className="inventory-capacity-total">{averageUtilization}%<small>average</small></strong></div>
          <div className="inventory-capacity-list">
            {storageData.map((zone) => (
              <div key={zone.zone}>
                <span><strong>{zone.zone}</strong><small>{zone.utilization >= 85 ? "High" : zone.utilization >= 70 ? "Watch" : "Normal"}</small></span>
                <span className="inventory-capacity-track"><i className={clsx(zone.utilization >= 85 ? "inventory-capacity-fill--critical" : zone.utilization >= 70 ? "inventory-capacity-fill--warning" : "inventory-capacity-fill--healthy")} style={{ width: `${zone.utilization}%` }} /></span>
                <strong>{zone.utilization}%</strong>
              </div>
            ))}
          </div>
          <button className="inventory-capacity-action" onClick={() => onNavigate("stock")}>View locations <ArrowRight size={12} /></button>
        </section>
      </div>
    </div>
  );
}

function InventoryTab({ snapshot }: { snapshot: WarehouseSnapshot }) {
  const selectedStockBalanceId = useAppStore((state) => state.selectedStockBalanceId);
  const selectedZoneId = useAppStore((state) => state.selectedZoneId);
  const quickFilter = useAppStore((state) => state.inventoryQuickFilter);
  const setSelectedStockBalance = useAppStore((state) => state.setSelectedStockBalance);
  const setSelectedZone = useAppStore((state) => state.setSelectedZone);
  const setQuickFilter = useAppStore((state) => state.setInventoryQuickFilter);
  const locateStockBalanceInWarehouse = useAppStore((state) => state.locateStockBalanceInWarehouse);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [location, setLocation] = useState("All");
  const [sort, setSort] = useState<StockSort>("expiry");
  const [exception, setException] = useState<ExceptionKey | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedFilters>(emptyAdvanced);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [optionalColumns, setOptionalColumns] = useState<string[]>([]);
  const rows = useMemo<StockRow[]>(() => snapshot.inventory.stockPositions.flatMap((position) => position.batches.map((batch) => ({ product: position.product, position, batch }))), [snapshot.inventory.stockPositions]);
  const locations = useMemo(() => [...new Set(rows.map((row) => row.batch.location.zone))].sort(), [rows]);
  const productLow = useMemo(() => new Set(snapshot.inventory.stockPositions.filter((item) => item.totalAvailable < item.product.reorderPoint).map((item) => item.product.productId)), [snapshot.inventory.stockPositions]);
  const productOver = useMemo(() => new Set(snapshot.inventory.stockPositions.filter((item) => item.totalAvailable > item.product.targetStock).map((item) => item.product.productId)), [snapshot.inventory.stockPositions]);
  const matchesException = useCallback((row: StockRow, key: ExceptionKey | null) => {
    if (!key) return true;
    const expiry = expiryPresentation(row.batch.expiryDate);
    if (key === "quality") return row.batch.qualityStatus !== "Released" || row.batch.qtyOnHold > 0;
    if (key === "expiring") return expiry.days !== null && expiry.days >= 0 && expiry.days <= INVENTORY_POLICY.expiryWarningDays;
    if (key === "expired") return expiry.state === "expired" || row.batch.qualityStatus === "Expired";
    if (key === "dwell") return (dwellDays(row.batch.arrivalAt) ?? 0) > INVENTORY_POLICY.longDwellDays;
    if (key === "count") return (dwellDays(row.batch.lastCycleCountAt) ?? 0) > INVENTORY_POLICY.cycleCountIntervalDays;
    if (key === "low") return productLow.has(row.product.productId);
    return productOver.has(row.product.productId);
  }, [productLow, productOver]);
  const matchesQuickFilter = useCallback((row: StockRow) => {
    if (quickFilter === "All") return true;
    if (quickFilter === "Attention Required") return ["quality", "expiring", "expired", "dwell", "count", "low"].some((key) => matchesException(row, key as ExceptionKey));
    if (quickFilter === "Restricted Stock") return matchesException(row, "quality");
    if (quickFilter === "Reorder Required") return matchesException(row, "low");
    if (quickFilter === "Overstock") return matchesException(row, "overstock");
    if (quickFilter === "Shelf Life ≤ 90 Days" || quickFilter === "Expiring Soon") return matchesException(row, "expiring");
    if (quickFilter === "Long Dwell") return matchesException(row, "dwell");
    if (quickFilter === "Count Overdue") return matchesException(row, "count");
    if (quickFilter === "Expired") return matchesException(row, "expired");
    return true;
  }, [matchesException, quickFilter]);
  const exceptionDefinitions = useMemo(() => {
    const definition = (key: ExceptionKey, label: string, explanation: string, action: string, threshold: string, tone: Tone) => { const affected = rows.filter((row) => matchesException(row, key)); return { key, label, explanation, action, threshold, tone, lots: affected.length, units: affected.reduce((sum, row) => sum + row.batch.qtyOnHand, 0) }; };
    return [
      definition("quality", "Quality Hold", "Lots blocked from allocation and picking", "Resolve quality disposition", "Any non-released quality status", "critical"),
      definition("expiring", "Expiring Soon", "Shelf life is inside the configured warning period", "Review FEFO allocation", `≤ ${INVENTORY_POLICY.expiryWarningDays} days`, "warning"),
      definition("expired", "Expired", "Stock is already past its stored expiry date", "Quarantine and dispose", "Expiry date before today", "critical"),
      definition("dwell", "Long-Dwell Stock", "Inventory exceeds permitted storage dwell", "Review demand or relocation", `> ${INVENTORY_POLICY.longDwellDays} days`, "warning"),
      definition("count", "Cycle Count Overdue", "Locations are overdue for inventory counting", "Schedule cycle count", `> ${INVENTORY_POLICY.cycleCountIntervalDays} days`, "warning"),
      definition("low", "Low Stock", "Available stock is below the product reorder point", "Review replenishment", "Product reorder point", "critical"),
      definition("overstock", "Overstock", "Available stock exceeds the configured target maximum", "Review transfers or demand", "Product target stock", "warning")
    ];
  }, [matchesException, rows]);
  const contextualZoneId = selectedStockBalanceId || quickFilter !== "All" ? null : selectedZoneId;
  const contextualZoneName = contextualZoneId ? getSector(contextualZoneId)?.name ?? contextualZoneId : null;
  const visible = useMemo(() => rows.filter((row) => {
    const haystack = [row.product.productCode, row.product.productName, row.batch.lotCode, row.batch.location.locationId, row.batch.handlingUnit, row.batch.stoNumber, row.batch.inspectionLot].join(" ").toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (status !== "All" && row.batch.qualityStatus !== status) return false;
    if (location !== "All" && row.batch.location.zone !== location) return false;
    if (contextualZoneId && inventoryZoneCode(row.batch.location.zone) !== (contextualZoneId === "QAC" ? "QA" : contextualZoneId)) return false;
    if (!matchesQuickFilter(row)) return false;
    if (!matchesException(row, exception)) return false;
    if (advanced.product && !`${row.product.productCode} ${row.product.productName}`.toLowerCase().includes(advanced.product.toLowerCase())) return false;
    if (advanced.lot && !row.batch.lotCode.toLowerCase().includes(advanced.lot.toLowerCase())) return false;
    if (advanced.handlingUnit && !row.batch.handlingUnit.toLowerCase().includes(advanced.handlingUnit.toLowerCase())) return false;
    if (advanced.sto && !row.batch.stoNumber.toLowerCase().includes(advanced.sto.toLowerCase())) return false;
    if (advanced.inspectionLot && !row.batch.inspectionLot.toLowerCase().includes(advanced.inspectionLot.toLowerCase())) return false;
    if (advanced.quality && row.batch.qualityStatus !== advanced.quality) return false;
    if (advanced.category && row.product.productFamily !== advanced.category) return false;
    if (advanced.expiryFrom && rawTime(row.batch.expiryDate) < rawTime(advanced.expiryFrom)) return false;
    if (advanced.expiryTo && rawTime(row.batch.expiryDate) > rawTime(advanced.expiryTo)) return false;
    const dwell = dwellDays(row.batch.arrivalAt) ?? 0;
    if (advanced.dwellMin && dwell < Number(advanced.dwellMin)) return false;
    if (advanced.dwellMax && dwell > Number(advanced.dwellMax)) return false;
    const shelf = calendarDaysBetween(row.batch.expiryDate);
    if (advanced.shelfMin && (shelf === null || shelf < Number(advanced.shelfMin))) return false;
    if (advanced.shelfMax && (shelf === null || shelf > Number(advanced.shelfMax))) return false;
    return true;
  }).sort((a, b) => sort === "expiry" ? rawTime(a.batch.expiryDate) - rawTime(b.batch.expiryDate) : sort === "onHand" ? b.batch.qtyOnHand - a.batch.qtyOnHand : sort === "available" ? b.batch.qtyAvailable - a.batch.qtyAvailable : sort === "dwell" ? (dwellDays(b.batch.arrivalAt) ?? 0) - (dwellDays(a.batch.arrivalAt) ?? 0) : sort === "location" ? a.batch.location.locationId.localeCompare(b.batch.location.locationId) : a.batch.qualityStatus.localeCompare(b.batch.qualityStatus)), [advanced, contextualZoneId, exception, location, matchesException, matchesQuickFilter, rows, search, sort, status]);
  const activeAdvanced = Object.entries(advanced).filter(([, value]) => value);
  const hasFilters = Boolean(search || status !== "All" || location !== "All" || exception || quickFilter !== "All" || contextualZoneId || activeAdvanced.length);
  const selected = rows.find((row) => row.batch.stockBalanceId === selectedStockBalanceId) ?? null;
  const toggleOptional = (column: string) => setOptionalColumns((current) => current.includes(column) ? current.filter((item) => item !== column) : [...current, column]);
  return <div className="space-y-3">
    <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_180px_180px_auto_180px]">
      <label className="relative"><span className="sr-only">Search inventory</span><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-twin-muted" size={16} /><input className="h-10 w-full rounded-xl border border-twin-border bg-white/80 pl-9 pr-3 text-xs outline-none focus:border-twin-cyan" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, lot, location or handling unit" /></label>
      <select aria-label="Status or exception filter" className="h-10 rounded-xl border border-twin-border bg-white/80 px-3 text-xs" value={status} onChange={(event) => { setStatus(event.target.value); setException(null); setQuickFilter("All"); }}><option>All</option>{(["Released", "Pending QA", "QA Hold", "Quarantine", "Expired"] as QualityStatus[]).map((item) => <option key={item}>{item}</option>)}</select>
      <select aria-label="Location filter" className="h-10 rounded-xl border border-twin-border bg-white/80 px-3 text-xs" value={location} onChange={(event) => setLocation(event.target.value)}><option>All</option>{locations.map((item) => <option key={item}>{item}</option>)}</select>
      <button className={clsx("inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold", advancedOpen ? "border-twin-blue bg-twin-blue/5 text-twin-blue" : "border-twin-border bg-white/80 text-twin-muted")} onClick={() => setAdvancedOpen((value) => !value)}><SlidersHorizontal size={14} />Advanced Filters</button>
      <select aria-label="Sort inventory" className="h-10 rounded-xl border border-twin-border bg-white/80 px-3 text-xs" value={sort} onChange={(event) => setSort(event.target.value as StockSort)}><option value="expiry">Expiry date</option><option value="onHand">On-hand quantity</option><option value="available">Available quantity</option><option value="dwell">Dwell time</option><option value="location">Location</option><option value="status">Quality status</option></select>
    </div>
    {advancedOpen && <section className="rounded-xl border border-twin-border bg-white/90 p-3"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{[["product", "Product or material"], ["lot", "Lot or batch"], ["handlingUnit", "Handling unit"], ["sto", "STO"], ["inspectionLot", "Inspection lot"]].map(([key, label]) => <label key={key} className="text-[10px] font-semibold text-twin-muted">{label}<input className="mt-1 h-9 w-full rounded-lg border border-twin-border bg-white px-2 text-xs font-normal text-twin-text" value={advanced[key as keyof AdvancedFilters]} onChange={(event) => setAdvanced((current) => ({ ...current, [key]: event.target.value }))} /></label>)}<label className="text-[10px] font-semibold text-twin-muted">Quality status<select className="mt-1 h-9 w-full rounded-lg border border-twin-border bg-white px-2 text-xs font-normal text-twin-text" value={advanced.quality} onChange={(event) => setAdvanced((current) => ({ ...current, quality: event.target.value }))}><option value="">Any</option>{["Released", "Pending QA", "QA Hold", "Quarantine", "Expired"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-[10px] font-semibold text-twin-muted">Stock category<select className="mt-1 h-9 w-full rounded-lg border border-twin-border bg-white px-2 text-xs font-normal text-twin-text" value={advanced.category} onChange={(event) => setAdvanced((current) => ({ ...current, category: event.target.value }))}><option value="">Any</option>{[...new Set(rows.map((row) => row.product.productFamily))].sort().map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-[10px] font-semibold text-twin-muted">Expiry from<input type="date" className="mt-1 h-9 w-full rounded-lg border border-twin-border bg-white px-2 text-xs font-normal text-twin-text" value={advanced.expiryFrom} onChange={(event) => setAdvanced((current) => ({ ...current, expiryFrom: event.target.value }))} /></label><label className="text-[10px] font-semibold text-twin-muted">Expiry to<input type="date" className="mt-1 h-9 w-full rounded-lg border border-twin-border bg-white px-2 text-xs font-normal text-twin-text" value={advanced.expiryTo} onChange={(event) => setAdvanced((current) => ({ ...current, expiryTo: event.target.value }))} /></label><label className="text-[10px] font-semibold text-twin-muted">Minimum shelf-life days<input type="number" className="mt-1 h-9 w-full rounded-lg border border-twin-border bg-white px-2 text-xs font-normal text-twin-text" value={advanced.shelfMin} onChange={(event) => setAdvanced((current) => ({ ...current, shelfMin: event.target.value }))} /></label><label className="text-[10px] font-semibold text-twin-muted">Maximum shelf-life days<input type="number" className="mt-1 h-9 w-full rounded-lg border border-twin-border bg-white px-2 text-xs font-normal text-twin-text" value={advanced.shelfMax} onChange={(event) => setAdvanced((current) => ({ ...current, shelfMax: event.target.value }))} /></label><label className="text-[10px] font-semibold text-twin-muted">Minimum dwell days<input type="number" className="mt-1 h-9 w-full rounded-lg border border-twin-border bg-white px-2 text-xs font-normal text-twin-text" value={advanced.dwellMin} onChange={(event) => setAdvanced((current) => ({ ...current, dwellMin: event.target.value }))} /></label><label className="text-[10px] font-semibold text-twin-muted">Maximum dwell days<input type="number" className="mt-1 h-9 w-full rounded-lg border border-twin-border bg-white px-2 text-xs font-normal text-twin-text" value={advanced.dwellMax} onChange={(event) => setAdvanced((current) => ({ ...current, dwellMax: event.target.value }))} /></label></div></section>}
    {hasFilters && <div className="flex flex-wrap items-center gap-1.5">{search && <FilterChip label={`Search: ${search}`} onRemove={() => setSearch("")} />}{status !== "All" && <FilterChip label={status} onRemove={() => setStatus("All")} />}{location !== "All" && <FilterChip label={location} onRemove={() => setLocation("All")} />}{quickFilter !== "All" && <FilterChip label={`Quick filter: ${quickFilter}`} onRemove={() => setQuickFilter("All")} />}{contextualZoneName && <FilterChip label={`Warehouse area: ${contextualZoneName}`} onRemove={() => setSelectedZone(null)} />}{exception && <FilterChip label={exceptionDefinitions.find((item) => item.key === exception)?.label ?? exception} onRemove={() => setException(null)} />}{activeAdvanced.map(([key, value]) => <FilterChip key={key} label={`${key}: ${value}`} onRemove={() => setAdvanced((current) => ({ ...current, [key]: "" }))} />)}<button className="ml-1 text-[11px] font-semibold text-twin-blue" onClick={() => { setSearch(""); setStatus("All"); setLocation("All"); setException(null); setQuickFilter("All"); setSelectedZone(null); setAdvanced(emptyAdvanced); }}>Clear all</button></div>}
    <section className="panel rounded-2xl p-3"><div className="mb-2 flex items-center justify-between"><div><h3 className="text-sm font-semibold">Inventory exceptions</h3><p className="text-[10px] text-twin-muted">Select an exception to filter the stock ledger</p></div><AlertTriangle size={16} className="text-twin-warning" /></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{exceptionDefinitions.map((item) => <button key={item.key} title={`Threshold: ${item.threshold}. Action: ${item.action}`} className={clsx("rounded-xl border px-3 py-2.5 text-left transition", exception === item.key ? "border-twin-blue bg-twin-blue/5 ring-1 ring-twin-blue/20" : "border-twin-border/70 bg-white/70 hover:border-twin-cyan")} onClick={() => { setQuickFilter("All"); setException((current) => current === item.key ? null : item.key); }}><div className="flex items-center justify-between gap-2"><strong className="text-xs">{item.label}</strong><StatusChip tone={item.tone}>{item.lots} lots</StatusChip></div><div className="mt-1 text-[11px] font-semibold tabular-nums">{item.units.toLocaleString()} units affected</div><p className="mt-0.5 text-[10px] text-twin-muted">{item.explanation}</p><p className="mt-1 text-[10px] font-semibold text-twin-blue">{item.action}</p></button>)}</div></section>
    <section className="panel overflow-hidden rounded-2xl"><div className="flex items-center justify-between border-b border-twin-border px-3 py-2"><div><strong className="text-xs">Stock ledger</strong><span className="ml-2 text-[10px] text-twin-muted">{visible.length} lots</span></div><div className="relative"><button className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-twin-border bg-white px-2 text-[11px] font-semibold" onClick={() => setColumnsOpen((value) => !value)}><Columns3 size={13} />Columns</button>{columnsOpen && <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-twin-border bg-white p-2 shadow-card">{["Handling unit", "STO", "Inspection lot"].map((item) => <label key={item} className="flex items-center gap-2 px-1 py-1 text-[11px]"><input type="checkbox" checked={optionalColumns.includes(item)} onChange={() => toggleOptional(item)} />{item}</label>)}</div>}</div></div><div className="max-h-[58vh] overflow-auto"><table className="w-full min-w-[1020px] border-collapse text-left text-[11px]"><thead className="sticky top-0 z-10 bg-twin-bg text-[10px] uppercase tracking-wide text-twin-muted"><tr>{["Product", "Lot / batch", "Location", "On hand", "Available", "Allocated", "Quality status", "Expiry date", "Shelf life remaining", "Dwell time", ...optionalColumns].map((column) => <th key={column} className={clsx("border-b border-twin-border px-3 py-2", ["On hand", "Available", "Allocated"].includes(column) && "text-right")}>{column}</th>)}</tr></thead><tbody>{visible.map(({ product, batch }) => { const expiry = expiryPresentation(batch.expiryDate); const allocated = batch.qtyReserved + batch.qtyPicked + batch.qtyPacked + batch.qtyStaged; return <tr key={batch.stockBalanceId} tabIndex={0} className="cursor-pointer border-b border-twin-border/60 hover:bg-twin-blue/5 focus:bg-twin-blue/5 focus:outline-none" onClick={() => setSelectedStockBalance(batch.stockBalanceId)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedStockBalance(batch.stockBalanceId); }}><td className="px-3 py-2"><strong className="block text-twin-text">{product.productCode}</strong><span className="block max-w-[220px] truncate text-[10px] text-twin-muted" title={product.productName}>{product.productName}</span></td><td className="px-3 py-2"><span className="font-mono">{batch.lotCode}</span><span className="block text-[10px] text-twin-muted">{batch.batchId}</span></td><td className="px-3 py-2 font-mono">{batch.location.locationId}</td><td className="px-3 py-2 text-right tabular-nums">{batch.qtyOnHand.toLocaleString()}</td><td className="px-3 py-2 text-right tabular-nums font-semibold">{batch.qtyAvailable.toLocaleString()}</td><td className="px-3 py-2 text-right tabular-nums">{allocated.toLocaleString()}</td><td className="px-3 py-2"><StatusChip tone={toneForStatus(batch.qualityStatus)}>{batch.qualityStatus}</StatusChip></td><td className="px-3 py-2 whitespace-nowrap">{formatLocalDate(batch.expiryDate)}</td><td className={clsx("px-3 py-2 whitespace-nowrap", expiry.state === "expired" || expiry.state === "critical" ? "font-semibold text-twin-critical" : expiry.state === "expiring" ? "font-semibold text-twin-warning" : "text-twin-muted")}>{expiry.label}</td><td className="px-3 py-2 whitespace-nowrap">{dwellDays(batch.arrivalAt) ?? "-"} days</td>{optionalColumns.includes("Handling unit") && <td className="px-3 py-2 font-mono">{batch.handlingUnit}</td>}{optionalColumns.includes("STO") && <td className="px-3 py-2 font-mono">{batch.stoNumber}</td>}{optionalColumns.includes("Inspection lot") && <td className="px-3 py-2 font-mono">{batch.inspectionLot}</td>}</tr>; })}</tbody></table>{!visible.length && <EmptyState title="No inventory found" detail="Change or clear filters to view stock positions." />}</div></section>
    {selected && <Drawer title={selected.product.productCode} subtitle={`${selected.batch.lotCode} · ${selected.batch.location.locationId}`} onClose={() => setSelectedStockBalance(null)} footer={<button type="button" className="inline-flex h-9 items-center gap-2 rounded-lg bg-twin-blue px-3 text-xs font-semibold text-white" onClick={() => locateStockBalanceInWarehouse(selected.batch.stockBalanceId)}><LocateFixed size={14} />Locate in Warehouse</button>}><DefinitionGrid rows={[["Product", selected.product.productName], ["Stock balance", selected.batch.stockBalanceId], ["Quality status", <StatusChip tone={toneForStatus(selected.batch.qualityStatus)}>{selected.batch.qualityStatus}</StatusChip>], ["Expiry", `${formatLocalDate(selected.batch.expiryDate)} · ${expiryPresentation(selected.batch.expiryDate).label}`], ["On hand", selected.batch.qtyOnHand.toLocaleString()], ["Available", selected.batch.qtyAvailable.toLocaleString()], ["Handling unit", selected.batch.handlingUnit], ["Inspection lot", selected.batch.inspectionLot], ["STO", selected.batch.stoNumber], ["Last cycle count", formatLocalDateTime(selected.batch.lastCycleCountAt)]]} /></Drawer>}
  </div>;
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) { return <span className="inline-flex items-center gap-1 rounded-full border border-twin-cyan/40 bg-twin-cyan/10 px-2 py-1 text-[10px] font-semibold text-twin-blue">{label}<button onClick={onRemove} aria-label={`Remove ${label} filter`}><X size={11} /></button></span>; }
function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="flex flex-col items-center justify-center px-4 py-12 text-center"><Search size={20} className="text-twin-subtle" /><strong className="mt-2 text-sm">{title}</strong><p className="mt-1 text-xs text-twin-muted">{detail}</p></div>; }

function MovementsTab({ snapshot }: { snapshot: WarehouseSnapshot }) { const [search, setSearch] = useState(""); const [type, setType] = useState("All"); const products = new Map(snapshot.inventory.products.map((product) => [product.productId, product])); const movements = snapshot.inventory.movements.filter((movement) => type === "All" || movement.movementType === type).filter((movement) => !search || [movement.movementId, movement.batchId, movement.referenceId, movement.fromLocationId, movement.toLocationId, products.get(movement.productId)?.productCode].join(" ").toLowerCase().includes(search.toLowerCase())).sort((a, b) => rawTime(b.timestamp) - rawTime(a.timestamp)); return <div className="space-y-3"><div className="grid gap-2 sm:grid-cols-[1fr_220px]"><label className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-twin-muted" size={15} /><input aria-label="Search movements" className="h-10 w-full rounded-xl border border-twin-border bg-white/80 pl-9 pr-3 text-xs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search movement, product, batch, location or reference" /></label><select aria-label="Movement type" className="h-10 rounded-xl border border-twin-border bg-white/80 px-3 text-xs" value={type} onChange={(event) => setType(event.target.value)}><option>All</option>{[...new Set(snapshot.inventory.movements.map((item) => item.movementType))].map((item) => <option key={item}>{item}</option>)}</select></div><section className="panel overflow-hidden rounded-2xl"><div className="border-b border-twin-border px-3 py-2"><h3 className="text-sm font-semibold">Inventory movement history</h3><p className="text-[10px] text-twin-muted">Append-only transaction and audit view</p></div><div className="max-h-[64vh] overflow-auto"><table className="w-full min-w-[980px] text-left text-[11px]"><thead className="sticky top-0 bg-twin-bg text-[10px] uppercase text-twin-muted"><tr>{["Timestamp", "Movement", "Product / Batch", "From", "To", "Quantity", "Reference", "Actor", "Note"].map((item) => <th key={item} className="border-b border-twin-border px-3 py-2">{item}</th>)}</tr></thead><tbody>{movements.map((movement) => <tr key={movement.movementId} className="border-b border-twin-border/60"><td className="whitespace-nowrap px-3 py-2">{formatLocalDateTime(movement.timestamp)}</td><td className="px-3 py-2"><StatusChip tone={toneForStatus(movement.movementType)}>{movement.movementType}</StatusChip></td><td className="px-3 py-2"><strong>{products.get(movement.productId)?.productCode ?? movement.productId}</strong><span className="block font-mono text-[10px] text-twin-muted">{movement.batchId}</span></td><td className="px-3 py-2 font-mono">{movement.fromLocationId ?? "—"}</td><td className="px-3 py-2 font-mono">{movement.toLocationId ?? "—"}</td><td className="px-3 py-2 text-right tabular-nums">{movement.qty.toLocaleString()}</td><td className="px-3 py-2">{movement.referenceType}<span className="block font-mono text-[10px] text-twin-muted">{movement.referenceId}</span></td><td className="px-3 py-2">{movement.userOrSystem}</td><td className="max-w-[260px] truncate px-3 py-2" title={movement.note}>{movement.note}</td></tr>)}</tbody></table>{!movements.length && <EmptyState title="No movements found" detail="Change the movement filters to see historical transactions." />}</div></section></div>; }

export default function InventoryControlView() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const mode = useAppStore((state) => state.inventoryWorkspace);
  const setMode = useAppStore((state) => state.setInventoryWorkspace);
  const inventoryQuickFilter = useAppStore((state) => state.inventoryQuickFilter);
  const openInboundInLogistics = useAppStore((state) => state.openInboundInLogistics);
  const openOutboundInLogistics = useAppStore((state) => state.openOutboundInLogistics);

  useEffect(() => {
    if (inventoryQuickFilter !== "All") setMode("stock");
  }, [inventoryQuickFilter, setMode]);

  return (
    <div className="scroll-optimized flex min-h-full min-w-0 flex-col gap-3 px-2 pb-4">
      <section className="shrink-0 px-1 pt-1">
        <h2 className="text-2xl font-semibold tracking-tight">Inventory</h2>
        <p className="mt-1 text-xs text-twin-muted">Stock, lots, planning and movements</p>
      </section>
      <WorkspaceNav
        label="Inventory sections"
        value={mode}
        onChange={setMode}
        items={[
          { id: "overview", label: "Overview", detail: "Summary", icon: LayoutDashboard },
          { id: "stock", label: "Stock positions", detail: `${snapshot.inventory.summary.batchCount} lots`, icon: PackageSearch },
          { id: "planning", label: "Planning", detail: "Risk & replenishment", icon: Calculator },
          { id: "movements", label: "Movements", detail: `${snapshot.inventory.movements.length} records`, icon: History }
        ]}
      />
      {mode === "overview" && (
        <Overview
          snapshot={snapshot}
          onNavigate={setMode}
          onOpenInbound={openInboundInLogistics}
          onOpenOutbound={openOutboundInLogistics}
        />
      )}
      {mode === "stock" && <InventoryTab snapshot={snapshot} />}
      {mode === "planning" && <InventoryPlanningView snapshot={snapshot} />}
      {mode === "movements" && <MovementsTab snapshot={snapshot} />}
    </div>
  );
}
