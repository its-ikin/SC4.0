import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock,
  FlaskConical,
  MapPinned,
  Search,
  X
} from "lucide-react";
import clsx from "clsx";
import type {
  InboundShipment,
  OutboundLine,
  OutboundShipment,
  ScheduleAdherence,
  WarehouseSnapshot
} from "@twinops/shared";
import { calculateScheduleAdherence, inboundScheduleAdherence } from "@twinops/shared";
import { useAppStore } from "../store";
import {
  expiryPresentation,
  formatLocalDate,
  formatLocalDateTime,
  liveElapsedPresentation,
  rawTime
} from "../lib/dateTime";
import { INVENTORY_POLICY } from "../lib/inventoryPolicy";
import { CompactMetricCard, StatusChip, type Tone } from "./ui";
import LogisticsSimulationDrawer from "./LogisticsSimulationDrawer";

type Direction = "inbound" | "outbound";
type SimulationRequest = { direction: Direction; referenceId: string };

type Props = {
  snapshot: WarehouseSnapshot;
  direction: Direction;
};

type OperationTraceLine = {
  id: string;
  productId: string;
  batchId: string;
  status: string;
  tempBand: string;
  quantities: Array<[string, string | number]>;
};

type OperationalTimestampState = "neutral" | "overdue" | "actual-on-time" | "actual-late";

const inboundStages = ["Expected", "In Transit", "Arrived", "Receiving", "Receipt / QA", "Put-away"];
const outboundStages = ["Order / Release", "Allocated", "Picking", "Packing", "Staging / Loading", "Goods Issue"];
const recentNewRecordIds = new Set<string>();

function useLiveNow(intervalMs = 1_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function toneForStatus(status: string): Tone {
  const lower = status.toLowerCase();
  if (
    lower.includes("block")
    || lower.includes("exception")
    || lower.includes("quarantine")
    || lower.includes("expired")
    || lower.includes("hold")
  ) return "critical";
  if (
    lower.includes("complete")
    || lower.includes("dispatch")
    || lower.includes("deliver")
    || lower === "released"
    || lower === "received"
  ) return "healthy";
  if (
    lower.includes("pending")
    || lower.includes("transit")
    || lower.includes("receiv")
    || lower.includes("pick")
    || lower.includes("pack")
    || lower.includes("load")
    || lower.includes("gate")
  ) return "warning";
  return "neutral";
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

function scheduleTone(status: ScheduleAdherence["status"]): Tone {
  if (status === "delayed") return "critical";
  if (status === "on-time") return "healthy";
  return "neutral";
}

function scheduleShortLabel(adherence: ScheduleAdherence) {
  if (adherence.status === "delayed") return "Delayed";
  if (adherence.status === "on-time") return adherence.completed ? "On time" : "On schedule";
  return "Schedule unknown";
}

function actualTimestampState(status: ScheduleAdherence["status"] | undefined): OperationalTimestampState {
  if (status === "delayed") return "actual-late";
  if (status === "on-time") return "actual-on-time";
  return "neutral";
}

function hasValidOperationalTimestamp(value: string | null | undefined) {
  return Boolean(value && Number.isFinite(new Date(value).getTime()));
}

function ScheduleAdherenceDisplay({
  adherence,
  compact = false
}: {
  adherence: ScheduleAdherence;
  compact?: boolean;
}) {
  const tone = scheduleTone(adherence.status);
  if (compact) {
    return (
      <span
        className={clsx(
          "mt-1 flex items-center gap-1 text-[10px] font-semibold",
          tone === "critical"
            ? "text-twin-critical"
            : tone === "healthy"
              ? "text-twin-green"
              : "text-twin-muted"
        )}
        title={adherence.label}
      >
        <span
          className={clsx(
            "h-1.5 w-1.5 rounded-full",
            tone === "critical"
              ? "bg-twin-critical"
              : tone === "healthy"
                ? "bg-twin-green"
                : "bg-twin-muted"
          )}
          aria-hidden="true"
        />
        {scheduleShortLabel(adherence)}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusChip tone={tone}>{scheduleShortLabel(adherence)}</StatusChip>
      <span className="font-normal text-twin-muted">{adherence.label}</span>
    </span>
  );
}

function OperationalTimestamp({
  value,
  label,
  state = "neutral"
}: {
  value: string | null | undefined;
  label?: string;
  state?: OperationalTimestampState;
}) {
  const recorded = hasValidOperationalTimestamp(value);
  const labelColour = state === "overdue"
    ? "text-twin-critical"
    : state === "actual-late" && recorded
      ? "text-twin-warning"
      : state === "actual-on-time" && recorded
        ? "text-twin-green"
        : "text-twin-muted";
  const visibleLabel = label ?? (
    state === "actual-on-time" && recorded
      ? "Recorded on time"
      : state === "actual-late" && recorded
        ? "Recorded late"
        : state === "overdue" && recorded
          ? "Missed target"
          : undefined
  );
  return (
    <span className="inline-flex flex-col">
      <span className="font-semibold tabular-nums text-twin-text">{formatLocalDateTime(value)}</span>
      {visibleLabel && <span className={clsx("text-[10px] font-normal", labelColour)}>{visibleLabel}</span>}
    </span>
  );
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

function inboundAction(status: InboundShipment["inboundStatus"]) {
  if (["ASN Received", "Appointment Booked", "Vehicle Assigned", "Scheduled", "In Transit"].includes(status)) return "Review arrival";
  if (status === "Gate In") return "Assign dock";
  if (["At Receiving", "Unloading"].includes(status)) return "Continue receipt";
  if (["Received", "QA Pending"].includes(status)) return "Continue QA";
  if (status === "QA Hold" || status === "Exception") return "Resolve exception";
  if (["Released", "Putaway"].includes(status)) return "Start put-away";
  return "View record";
}

function outboundAction(status: OutboundShipment["outboundStatus"]) {
  if (["Order Received", "Delivery Created", "Scheduled", "Wave Released", "Replenishment"].includes(status)) return "Allocate";
  if (["Allocated", "Picking"].includes(status)) return "Continue picking";
  if (status === "Picked") return "Start packing";
  if (["Packed", "QA Release", "Staged"].includes(status)) return "Start loading";
  if (status === "Loading") return "Dispatch";
  if (status === "Blocked" || status === "Exception") return "Resolve exception";
  return "View record";
}

function latestTimestamp(
  snapshot: WarehouseSnapshot,
  referenceId: string,
  fallbacks: Array<string | null | undefined>
) {
  const latestPermittedTime = Date.now() + 60_000;
  const candidates = [
    ...snapshot.operationalEvents
      .filter((event) => (
        event.referenceId === referenceId
        || event.asnId === referenceId
        || event.shipmentId === referenceId
      ))
      .map((event) => event.timestamp),
    ...snapshot.transportLegs
      .filter((leg) => leg.asnId === referenceId || leg.shipmentId === referenceId)
      .map((leg) => leg.lastUpdatedAt),
    ...fallbacks.filter((value): value is string => Boolean(value))
  ].filter((value) => rawTime(value) <= latestPermittedTime);
  return candidates.sort((a, b) => rawTime(b) - rawTime(a))[0] ?? null;
}

function occurredEvents<T extends { timestamp: string }>(events: T[]) {
  const latestPermittedTime = Date.now() + 60_000;
  return events.filter((event) => rawTime(event.timestamp) <= latestPermittedTime);
}

function Workflow({
  labels,
  counts,
  reachedCounts
}: {
  labels: string[];
  counts: number[];
  reachedCounts: number[];
}) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  return (
    <section className="overflow-hidden rounded-xl border border-twin-border/70 bg-white/70" aria-label="Operational workflow milestones">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pb-1 pt-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Workflow progression</div>
          <p className="mt-0.5 text-[10px] text-twin-subtle">Main count: milestone reached. Blue label: records currently at that stage.</p>
        </div>
        <span className="rounded-full bg-twin-bg px-2.5 py-1 text-[10px] font-semibold text-twin-muted">
          {total} active
        </span>
      </div>
      <div className="overflow-x-auto">
        <ol className="relative grid min-w-[760px] grid-cols-6 px-4 pb-3 pt-2 before:absolute before:left-[8.5%] before:right-[8.5%] before:top-7 before:h-px before:bg-twin-border">
          {labels.map((label, index) => {
            const reached = reachedCounts[index] ?? 0;
            const current = counts[index] ?? 0;
            return (
              <li key={label} className="relative z-10 flex min-w-0 flex-col items-center px-1 text-center">
                <span
                  className={clsx(
                    "flex h-10 w-10 items-center justify-center rounded-full border-2 bg-white text-sm font-semibold tabular-nums",
                    current
                      ? "border-twin-cyan text-twin-blue ring-4 ring-twin-cyan/10"
                      : reached
                        ? index === labels.length - 1
                          ? "border-twin-green text-twin-green"
                          : "border-twin-blue/60 text-twin-blue"
                        : "border-twin-border text-twin-subtle"
                  )}
                >
                  {reached}
                </span>
                <span className="mt-2 max-w-[112px] text-[10px] font-semibold leading-tight text-twin-text">{label}</span>
                <span className="mt-1 h-5">
                  {current > 0 && (
                    <span className="inline-flex rounded-full bg-twin-cyan/20 px-2 py-0.5 text-[9px] font-semibold tabular-nums text-twin-blue">
                      {current} now
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <>
      <button className="fixed inset-0 z-40 cursor-default bg-twin-text/25" onClick={onClose} aria-label="Close details" />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[760px] flex-col border-l border-twin-border bg-twin-bg shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title + " details"}
      >
        <header className="flex items-start justify-between gap-3 border-b border-twin-border bg-white/80 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-twin-text">{title}</h3>
            <p className="mt-0.5 truncate text-xs text-twin-muted">{subtitle}</p>
          </div>
          <button autoFocus className="rounded-lg border border-twin-border bg-white p-2 text-twin-muted hover:text-twin-text" onClick={onClose} aria-label="Close details">
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <footer className="border-t border-twin-border bg-white/95 px-5 py-3">{footer}</footer>}
      </aside>
    </>
  );
}

function DetailTabs({
  tabs,
  active,
  onChange
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-twin-border" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab}
          role="tab"
          aria-selected={active === tab}
          className={clsx(
            "whitespace-nowrap border-b-2 px-3 py-2 text-xs font-semibold",
            active === tab ? "border-twin-blue text-twin-blue" : "border-transparent text-twin-muted"
          )}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function DefinitionGrid({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-twin-border/70 bg-white/70 p-3">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">{label}</dt>
          <dd className="mt-1 text-xs font-semibold text-twin-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <Search size={20} className="text-twin-subtle" />
      <strong className="mt-2 text-sm">{title}</strong>
      <p className="mt-1 text-xs text-twin-muted">{detail}</p>
    </div>
  );
}

function findBatchTrace(snapshot: WarehouseSnapshot, batchId: string) {
  const positioned = snapshot.inventory.stockPositions
    .flatMap((position) => position.batches)
    .find((batch) => batch.batchId === batchId || batch.lotCode === batchId);
  const batch = positioned
    ?? snapshot.inventory.batches.find((item) => item.batchId === batchId || item.lotCode === batchId);
  const stockBalance = snapshot.inventory.stockBalances.find(
    (item) => item.batchId === batch?.batchId || item.batchId === batchId
  );
  const location = positioned?.location
    ?? snapshot.inventory.locations.find((item) => item.locationId === stockBalance?.locationId);
  return { batch, balance: positioned ?? stockBalance, location };
}

function ProductLotCards({
  snapshot,
  lines,
  direction,
  goodsReceiptNumber
}: {
  snapshot: WarehouseSnapshot;
  lines: OperationTraceLine[];
  direction: Direction;
  goodsReceiptNumber?: string | null;
}) {
  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-twin-border/70 bg-white/60 px-3 py-2 text-[10px] text-twin-muted">
        {direction === "inbound"
          ? "Line quantities and QA status belong to this ASN. Linked inventory identifiers come from the matching batch and stock record."
          : "Fulfilment quantities belong to this shipment. Lots are labelled allocated only after their allocated quantity is greater than zero."}
      </p>
      {lines.map((line) => {
        const product = snapshot.inventory.products.find((item) => item.productId === line.productId);
        const { batch, balance, location } = findBatchTrace(snapshot, line.batchId);
        const allocatedQuantity = direction === "outbound"
          ? Number(line.quantities.find(([label]) => label === "Allocated")?.[1] ?? 0)
          : 0;
        const provenanceLabel = direction === "inbound" ? "Linked" : allocatedQuantity > 0 ? "Allocated" : "Candidate";
        return (
          <article key={line.id} className="rounded-xl border border-twin-border/70 bg-white/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-twin-text">{product?.productCode ?? line.productId}</h4>
                <p className="text-[11px] text-twin-muted">{product?.productName ?? "Product master data unavailable"}</p>
              </div>
              <div className="text-right">
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-twin-muted">
                  {direction === "inbound" ? "ASN line QA" : "Allocation status"}
                </div>
                <StatusChip tone={toneForStatus(line.status)}>{line.status}</StatusChip>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {line.quantities.map(([label, value]) => (
                <div key={label} className="rounded-lg border border-twin-border/60 bg-twin-bg/70 px-3 py-2">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-twin-muted">{label}</div>
                  <div className="mt-0.5 text-xs font-semibold tabular-nums">
                    {typeof value === "number" ? value.toLocaleString() : value}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <DefinitionGrid rows={[
                ["Document line", line.id],
                ["Material / GTIN", (product?.productId ?? line.productId) + " / " + (product?.gtin || "GTIN not recorded")],
                ["Batch / lot", (batch?.batchId ?? line.batchId) + " / " + (batch?.lotCode ?? line.batchId)],
                ["Stock provenance STO", batch?.stoNumber || "Not recorded"],
                ["Linked inspection lot", batch?.inspectionLot || "Not recorded"],
                ["Linked handling unit", batch?.handlingUnit || "Not assigned"],
                [
                  provenanceLabel + " stock balance",
                  "stockBalanceId" in (balance ?? {})
                    ? String((balance as { stockBalanceId: string }).stockBalanceId)
                    : "Not yet created"
                ],
                [provenanceLabel + " WMS location", location?.locationId ?? "Not yet put away"],
                [
                  direction === "inbound" ? "ASN goods receipt" : "Stock receipt",
                  direction === "inbound"
                    ? goodsReceiptNumber || "Not posted"
                    : batch?.goodsReceiptNumber || "Not recorded"
                ],
                ["Linked inventory disposition", batch?.qualityStatus ?? "Not yet assigned"],
                ["Expiry", batch?.expiryDate ? formatLocalDate(batch.expiryDate) : "No expiry recorded"],
                ["Temperature band", line.tempBand || batch?.tempBand || "Not specified"],
                ["Country of origin", batch?.countryOfOrigin || "Not recorded"]
              ]} />
            </div>
          </article>
        );
      })}
      {!lines.length && <EmptyState title="No product lines recorded" detail="Product and lot traceability will appear when document lines are available." />}
    </div>
  );
}

function QualityCards({
  snapshot,
  lines,
  direction
}: {
  snapshot: WarehouseSnapshot;
  lines: OperationTraceLine[];
  direction: Direction;
}) {
  return (
    <div className="space-y-2">
      {lines.map((line) => {
        const product = snapshot.inventory.products.find((item) => item.productId === line.productId);
        const { batch, balance } = findBatchTrace(snapshot, line.batchId);
        const onHold = balance && "qtyOnHold" in balance ? Number(balance.qtyOnHold) : 0;
        return (
          <article key={line.id} className="rounded-xl border border-twin-border/70 bg-white/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong className="text-xs">{product?.productCode ?? line.productId}</strong>
                <span className="ml-2 font-mono text-[10px] text-twin-muted">{batch?.lotCode ?? line.batchId}</span>
              </div>
              <div className="text-right">
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-twin-muted">
                  {direction === "inbound" ? "ASN line QA" : "Allocation status"}
                </div>
                <StatusChip tone={toneForStatus(line.status)}>{line.status}</StatusChip>
              </div>
            </div>
            <div className="mt-3">
              <DefinitionGrid rows={[
                ["Linked inspection lot", batch?.inspectionLot || "Not recorded"],
                ["Linked inventory disposition", batch?.qualityStatus ?? "Not yet assigned"],
                ["Temperature requirement", line.tempBand || batch?.tempBand || "Not specified"],
                ["Linked inventory units on hold", onHold.toLocaleString()],
                [
                  "Expiry",
                  batch?.expiryDate
                    ? formatLocalDate(batch.expiryDate) + " / " + expiryPresentation(batch.expiryDate).label
                    : "No expiry recorded"
                ],
                ["Serialization", batch?.serializationStatus || "Not recorded"]
              ]} />
            </div>
          </article>
        );
      })}
      {!lines.length && <EmptyState title="No quality records" detail="Quality status will appear when product lines are linked." />}
    </div>
  );
}

function TransportDetails({
  snapshot,
  direction,
  referenceId,
  transportLegId,
  dockAppointmentId,
  routeId,
  vehicleId,
  sealNumber
}: {
  snapshot: WarehouseSnapshot;
  direction: Direction;
  referenceId: string;
  transportLegId: string | null;
  dockAppointmentId: string | null;
  routeId: string | null;
  vehicleId: string | null;
  sealNumber: string | null;
}) {
  const leg = snapshot.transportLegs.find(
    (item) => item.transportLegId === transportLegId
      || (direction === "inbound" ? item.asnId === referenceId : item.shipmentId === referenceId)
  );
  const appointment = snapshot.dockAppointments.find(
    (item) => item.dockAppointmentId === dockAppointmentId || item.transportLegId === leg?.transportLegId
  );
  const sites = new Map(snapshot.partnerSites.map((site) => [site.siteId, site.displayName]));
  const outboundShipment = direction === "outbound"
    ? snapshot.inventory.outboundShipments.find((item) => item.shipmentId === referenceId)
    : null;
  const dispatchAdherence = outboundShipment ? outboundDispatchAdherence(outboundShipment) : null;
  const adherenceStatus = dispatchAdherence?.status ?? leg?.scheduleAdherence;
  const adherenceDetail = dispatchAdherence?.label ?? leg?.scheduleAdherenceLabel;
  const scheduleCompleted = direction === "inbound"
    ? hasValidOperationalTimestamp(leg?.actualArrival)
    : hasValidOperationalTimestamp(leg?.actualDeparture);
  const scheduleLabel = adherenceStatus === "delayed"
    ? scheduleCompleted
      ? direction === "inbound" ? "Arrived late" : "Dispatched late"
      : "Delayed"
    : adherenceStatus === "on-time"
      ? scheduleCompleted ? "On time" : "On schedule"
      : "Unknown";
  return (
    <div className="space-y-4">
      <section>
        <h4 className="mb-2 text-xs font-semibold text-twin-text">Transport movement</h4>
        <DefinitionGrid rows={[
          ["Transport record", leg?.transportLegId ?? transportLegId ?? "Not linked"],
          ["Route", leg?.routeId ?? routeId ?? "Not linked"],
          ["Carrier", leg?.carrierName ?? appointment?.carrierName ?? "Not assigned"],
          [
            "Vehicle / plate",
            (leg?.vehicleId ?? appointment?.vehicleId ?? vehicleId ?? "Not assigned")
              + " / "
              + (leg?.licensePlate ?? appointment?.licensePlate ?? "plate not recorded")
          ],
          ["Driver", leg?.driverId ?? "Not recorded"],
          ["Seal", leg?.sealNumber ?? sealNumber ?? "Not recorded"],
          ["Origin", leg ? sites.get(leg.originSiteId) ?? leg.originSiteId : "Not linked"],
          ["Destination", leg ? sites.get(leg.destinationSiteId) ?? leg.destinationSiteId : "Not linked"],
          ["Planned departure", <OperationalTimestamp value={leg?.plannedDeparture} state={direction === "outbound" && adherenceStatus === "delayed" ? "overdue" : "neutral"} />],
          ["Actual departure", <OperationalTimestamp value={leg?.actualDeparture} state={direction === "outbound" ? actualTimestampState(adherenceStatus) : "neutral"} />],
          ["Planned arrival", <OperationalTimestamp value={leg?.plannedArrival} state={direction === "inbound" && adherenceStatus === "delayed" ? "overdue" : "neutral"} />],
          ["Estimated arrival", <OperationalTimestamp value={leg?.estimatedArrival} />],
          ["Actual arrival", <OperationalTimestamp value={leg?.actualArrival} state={direction === "inbound" ? actualTimestampState(adherenceStatus) : "neutral"} />],
          [
            "Schedule adherence",
            adherenceStatus
              ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={scheduleTone(adherenceStatus)}>{scheduleLabel}</StatusChip>
                    <span className="font-normal text-twin-muted">{adherenceDetail}</span>
                  </span>
                )
              : "Schedule state unavailable"
          ],
          ["Transport status", leg?.transportStatus ?? "Not linked"],
          ["Temperature", leg ? leg.temperatureRequirement + " / " + leg.temperatureStatus : "Not linked"],
          ["Logger", leg?.temperatureLoggerId ?? "Not recorded"],
          ["Risk / disruption", leg?.riskNote || leg?.disruptionType || "No active transport risk"],
          ["Transport updated", formatLocalDateTime(leg?.lastUpdatedAt)]
        ]} />
      </section>
      <section>
        <h4 className="mb-2 text-xs font-semibold text-twin-text">Dock appointment</h4>
        <DefinitionGrid rows={[
          ["Appointment", appointment?.dockAppointmentId ?? dockAppointmentId ?? "Not booked"],
          ["Dock", appointment?.dockId ?? "Not assigned"],
          ["Status", appointment?.status ?? "Not booked"],
          [
            "Scheduled window",
            appointment
              ? formatLocalDateTime(appointment.scheduledStart) + " - " + formatLocalDateTime(appointment.scheduledEnd)
              : "Not booked"
          ],
          ["Gate in", formatLocalDateTime(appointment?.actualGateIn)],
          ["Dock in", formatLocalDateTime(appointment?.actualDockIn)],
          ["Dock out", formatLocalDateTime(appointment?.actualDockOut)],
          ["Gate out", formatLocalDateTime(appointment?.actualGateOut)],
          ["Conflict", appointment?.conflictFlag ? "Scheduling conflict" : "None"],
          ["Appointment updated", formatLocalDateTime(appointment?.lastUpdatedAt)]
        ]} />
      </section>
    </div>
  );
}

function OperationDrawerActions({
  onViewNetwork,
  onOpenDockSchedule,
  onSimulate
}: {
  onViewNetwork: () => void;
  onOpenDockSchedule: () => void;
  onSimulate: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-twin-border bg-white px-3 text-xs font-semibold text-twin-blue hover:border-twin-blue/40"
        onClick={onViewNetwork}
      >
        <MapPinned size={14} />View on Network
      </button>
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-twin-border bg-white px-3 text-xs font-semibold text-twin-blue hover:border-twin-blue/40"
        onClick={onOpenDockSchedule}
      >
        <CalendarClock size={14} />Open Dock Schedule
      </button>
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-twin-blue px-3 text-xs font-semibold text-white"
        onClick={onSimulate}
      >
        <FlaskConical size={14} />Preview inventory impact
      </button>
    </div>
  );
}

function openNetwork(transportLegId: string | null) {
  const state = useAppStore.getState();
  if (transportLegId) state.openTransportLegInLogistics(transportLegId, "network");
  else state.setLogisticsWorkspace("network");
}

function openDockSchedule({
  direction,
  referenceId,
  dockId,
  appointmentId,
  transportLegId
}: {
  direction: Direction;
  referenceId: string;
  dockId: string | null;
  appointmentId: string | null;
  transportLegId: string | null;
}) {
  useAppStore.getState().openDockScheduleInWarehouse({
    dockId: dockId ?? undefined,
    appointmentId: appointmentId ?? undefined,
    transportLegId: transportLegId ?? undefined,
    asnId: direction === "inbound" ? referenceId : undefined,
    shipmentId: direction === "outbound" ? referenceId : undefined
  });
}

function clearFlowSelection() {
  useAppStore.setState({
    selectedInboundAsnId: null,
    selectedShipmentId: null,
    selectedTransportLegId: null,
    selectedRouteId: null,
    selectedPartnerSiteId: null,
    selectedDockAppointmentId: null,
    selectedDockId: null
  });
}

function InboundTab({
  snapshot,
  changedIds,
  onSimulate
}: {
  snapshot: WarehouseSnapshot;
  changedIds: Set<string>;
  onSimulate: (referenceId: string) => void;
}) {
  const now = useLiveNow();
  const currentTime = new Date(now);
  const selectedId = useAppStore((state) => state.selectedInboundAsnId);
  const openInboundInLogistics = useAppStore((state) => state.openInboundInLogistics);
  const [tab, setTab] = useState("Overview");
  const selected = snapshot.inventory.inboundShipments.find((item) => item.asnId === selectedId) ?? null;
  const linesFor = (id: string) => snapshot.inventory.inboundLines.filter((line) => line.asnId === id);
  const active = snapshot.inventory.inboundShipments.filter(
    (item) => !["Putaway Complete", "Closed"].includes(item.inboundStatus)
  );
  const queue = [...active].sort((a, b) => {
    const severity = (item: InboundShipment) => (
      ["Exception", "QA Hold"].includes(item.inboundStatus)
        ? 0
        : inboundScheduleAdherence(item, currentTime).status === "delayed"
          ? 1
          : 2
    );
    return severity(a) - severity(b)
      || rawTime(a.plannedArrival || a.eta) - rawTime(b.plannedArrival || b.eta);
  });
  const stageCounts = inboundStages.map(
    (_, index) => active.filter((item) => inboundStage(item.inboundStatus) === index).length
  );
  const stageReachedCounts = inboundStages.map(
    (_, index) => active.filter((item) => inboundStage(item.inboundStatus) >= index).length
  );
  const expectedToday = active.filter(
    (item) => new Date(item.plannedArrival || item.eta).toDateString() === currentTime.toDateString()
  ).length;
  const exceptions = active.filter(
    (item) => ["Exception", "QA Hold"].includes(item.inboundStatus)
      || inboundScheduleAdherence(item, currentTime).status === "delayed"
  ).length;
  const activeAsnIds = new Set(active.map((item) => item.asnId));
  const atGateOrDock = new Set(
    snapshot.dockAppointments
      .filter((appointment) => (
        appointment.direction === "inbound"
        && activeAsnIds.has(appointment.referenceId)
        && ["checked_in", "at_dock", "loading", "unloading"].includes(appointment.status)
      ))
      .map((appointment) => appointment.referenceId)
  ).size;

  useEffect(() => {
    setTab("Overview");
  }, [selectedId]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <CompactMetricCard label="Expected today" value={expectedToday.toLocaleString()} />
        <CompactMetricCard label="At gate / dock" value={atGateOrDock.toLocaleString()} tone="warning" />
        <CompactMetricCard label="Receiving now" value={active.filter((item) => ["At Receiving", "Unloading"].includes(item.inboundStatus)).length.toLocaleString()} />
        <CompactMetricCard label="QA / Put-away pending" value={active.filter((item) => ["Received", "QA Pending", "QA Hold", "Released", "Putaway"].includes(item.inboundStatus)).length.toLocaleString()} tone="warning" />
        <CompactMetricCard label="Delayed / exceptions" value={exceptions.toLocaleString()} tone={exceptions ? "critical" : "healthy"} />
      </div>
      <Workflow labels={inboundStages} counts={stageCounts} reachedCounts={stageReachedCounts} />
      <section className="panel overflow-hidden rounded-2xl">
        <div className="border-b border-twin-border px-3 py-2">
          <h3 className="text-sm font-semibold">Live inbound queue</h3>
          <p className="text-[10px] text-twin-muted">Select an ASN to inspect receipt, lot, quality, transport, and activity details.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-[11px]">
            <thead className="bg-twin-bg text-[10px] uppercase tracking-wide text-twin-muted">
              <tr>
                {["ASN", "Stage / Schedule", "Supplier / Source", "Vehicle / Transport", "Dock", "Receipt progress", "ETA / Arrival", "Last updated"].map((item) => (
                  <th key={item} className="border-b border-twin-border px-3 py-2">{item}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queue.map((shipment) => {
                const lines = linesFor(shipment.asnId);
                const expected = lines.reduce((sum, line) => sum + line.qtyExpected, 0);
                const received = lines.reduce((sum, line) => sum + line.qtyReceived, 0);
                const updated = latestTimestamp(snapshot, shipment.asnId, [shipment.actualArrival]);
                const adherence = inboundScheduleAdherence(shipment, currentTime);
                const openDetails = () => openInboundInLogistics(shipment.asnId);
                return (
                  <tr
                    key={shipment.asnId}
                    tabIndex={0}
                    aria-label={"Open " + shipment.asnId + " details"}
                    className={clsx(
                      "cursor-pointer border-b border-twin-border/60 transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-twin-cyan",
                      selectedId === shipment.asnId
                        ? "bg-twin-blue/10"
                        : changedIds.has(shipment.asnId)
                          ? "bg-twin-cyan/10"
                          : "hover:bg-twin-blue/5"
                    )}
                    onClick={openDetails}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openDetails();
                      }
                    }}
                  >
                    <td className="px-3 py-2 font-semibold">
                      {shipment.asnId}
                      {changedIds.has(shipment.asnId) && (
                        <span className="ml-1 rounded bg-twin-cyan/20 px-1 text-[9px] text-twin-blue">
                          {recentNewRecordIds.has(shipment.asnId) ? "New" : "Updated"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusChip tone={toneForStatus(shipment.inboundStatus)}>{shipment.inboundStatus}</StatusChip>
                      <ScheduleAdherenceDisplay adherence={adherence} compact />
                    </td>
                    <td className="max-w-[190px] truncate px-3 py-2" title={shipment.source}>{shipment.source}</td>
                    <td className="max-w-[190px] px-3 py-2">
                      <span className="block truncate" title={shipment.routeName}>{shipment.vehicleId ?? shipment.routeName}</span>
                      <span className="text-[10px] text-twin-muted">{shipment.transportLegId ?? "No transport link"}</span>
                    </td>
                    <td className="px-3 py-2 font-mono">{shipment.receivingDock}</td>
                    <td className="px-3 py-2">
                      <strong className="tabular-nums">{received.toLocaleString()} / {expected.toLocaleString()}</strong>
                      <div className="mt-1 h-1 w-24 rounded bg-twin-border">
                        <div className="h-full rounded bg-twin-green" style={{ width: (expected ? Math.round(received / expected * 100) : 0) + "%" }} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <OperationalTimestamp
                        value={shipment.actualArrival ?? shipment.plannedArrival ?? shipment.eta}
                        label={shipment.actualArrival ? "Actual arrival" : shipment.plannedArrival ? "Planned arrival" : "Estimated arrival"}
                        state={shipment.actualArrival ? actualTimestampState(adherence.status) : adherence.status === "delayed" ? "overdue" : "neutral"}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="block">{formatLocalDateTime(updated)}</span>
                      <span className="text-[10px] tabular-nums text-twin-muted">{liveElapsedPresentation(updated, currentTime)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!queue.length && <EmptyState title="No active inbound records" detail="Completed ASNs are available in activity history and movements." />}
        </div>
      </section>
      {selected && (
        <InboundDrawer
          snapshot={snapshot}
          shipment={selected}
          tab={tab}
          setTab={setTab}
          onClose={clearFlowSelection}
          onSimulate={() => onSimulate(selected.asnId)}
        />
      )}
    </div>
  );
}

function InboundDrawer({
  snapshot,
  shipment,
  tab,
  setTab,
  onClose,
  onSimulate
}: {
  snapshot: WarehouseSnapshot;
  shipment: InboundShipment;
  tab: string;
  setTab: (tab: string) => void;
  onClose: () => void;
  onSimulate: () => void;
}) {
  const lines = snapshot.inventory.inboundLines.filter((line) => line.asnId === shipment.asnId);
  const expected = lines.reduce((sum, line) => sum + line.qtyExpected, 0);
  const received = lines.reduce((sum, line) => sum + line.qtyReceived, 0);
  const events = occurredEvents(
    snapshot.operationalEvents.filter(
      (event) => event.asnId === shipment.asnId || event.referenceId === shipment.asnId
    )
  ).sort((a, b) => rawTime(b.timestamp) - rawTime(a.timestamp));
  const updated = latestTimestamp(snapshot, shipment.asnId, [shipment.actualArrival]);
  const adherence = inboundScheduleAdherence(shipment);
  const traceLines: OperationTraceLine[] = lines.map((line) => ({
    id: line.inboundLineId,
    productId: line.productId,
    batchId: line.batchId,
    status: line.qaStatus,
    tempBand: line.tempBand,
    quantities: [
      ["Expected", line.qtyExpected],
      ["Received", line.qtyReceived],
      ["Open", Math.max(0, line.qtyExpected - line.qtyReceived)]
    ]
  }));
  const footer = (
    <OperationDrawerActions
      onViewNetwork={() => openNetwork(shipment.transportLegId)}
      onOpenDockSchedule={() => openDockSchedule({
        direction: "inbound",
        referenceId: shipment.asnId,
        dockId: shipment.receivingDock,
        appointmentId: shipment.dockAppointmentId,
        transportLegId: shipment.transportLegId
      })}
      onSimulate={() => {
        onClose();
        onSimulate();
      }}
    />
  );
  return (
    <Drawer
      title={shipment.asnId}
      subtitle={shipment.inboundStatus + " / " + shipment.source}
      onClose={onClose}
      footer={footer}
    >
      <DetailTabs tabs={["Overview", "Products & Lots", "Quality", "Transport", "Activity"]} active={tab} onChange={setTab} />
      {tab === "Overview" && (
        <DefinitionGrid rows={[
          ["Current stage", <StatusChip tone={toneForStatus(shipment.inboundStatus)}>{shipment.inboundStatus}</StatusChip>],
          ["Receipt progress", received.toLocaleString() + " / " + expected.toLocaleString() + " units / " + Math.max(0, expected - received).toLocaleString() + " open"],
          ["Purchase order", shipment.purchaseOrderId ?? "Not linked"],
          ["Supplier site", shipment.supplierSiteId ?? shipment.source],
          ["Goods receipt", shipment.goodsReceiptNumber ?? "Not posted"],
          ["Cold-chain status", shipment.coldChainStatus],
          ["Dock", shipment.receivingDock],
          ["Vehicle / seal", (shipment.vehicleId ?? "Not assigned") + " / " + (shipment.sealNumber ?? "seal not recorded")],
          [shipment.plannedArrival ? "Planned arrival" : "Estimated arrival", <OperationalTimestamp value={shipment.plannedArrival || shipment.eta} state={adherence.status === "delayed" ? "overdue" : "neutral"} />],
          ["Actual arrival", <OperationalTimestamp value={shipment.actualArrival} state={actualTimestampState(adherence.status)} />],
          ["Schedule adherence", <ScheduleAdherenceDisplay adherence={adherence} />],
          ["Current blocker", ["QA Hold", "Exception"].includes(shipment.inboundStatus) ? shipment.inboundStatus : "None"],
          ["Next milestone", inboundAction(shipment.inboundStatus)],
          ["Last update", formatLocalDateTime(updated)]
        ]} />
      )}
      {tab === "Products & Lots" && (
        <ProductLotCards
          snapshot={snapshot}
          lines={traceLines}
          direction="inbound"
          goodsReceiptNumber={shipment.goodsReceiptNumber}
        />
      )}
      {tab === "Quality" && <QualityCards snapshot={snapshot} lines={traceLines} direction="inbound" />}
      {tab === "Transport" && (
        <TransportDetails
          snapshot={snapshot}
          direction="inbound"
          referenceId={shipment.asnId}
          transportLegId={shipment.transportLegId}
          dockAppointmentId={shipment.dockAppointmentId}
          routeId={shipment.linkedRouteId}
          vehicleId={shipment.vehicleId}
          sealNumber={shipment.sealNumber}
        />
      )}
      {tab === "Activity" && (
        <ActivityList
          events={events.map((event) => ({
            id: event.eventId,
            timestamp: event.timestamp,
            title: event.step + " / " + event.sourceSystem,
            detail: event.description
          }))}
        />
      )}
    </Drawer>
  );
}

function OutboundTab({
  snapshot,
  changedIds,
  onSimulate
}: {
  snapshot: WarehouseSnapshot;
  changedIds: Set<string>;
  onSimulate: (referenceId: string) => void;
}) {
  const now = useLiveNow();
  const currentTime = new Date(now);
  const selectedId = useAppStore((state) => state.selectedShipmentId);
  const openOutboundInLogistics = useAppStore((state) => state.openOutboundInLogistics);
  const [tab, setTab] = useState("Overview");
  const selected = snapshot.inventory.outboundShipments.find((item) => item.shipmentId === selectedId) ?? null;
  const linesFor = (id: string) => snapshot.inventory.outboundLines.filter((line) => line.shipmentId === id);
  const active = snapshot.inventory.outboundShipments.filter(
    (item) => !["Dispatched", "Delivered"].includes(item.outboundStatus)
  );
  const unallocatedQty = (item: OutboundShipment) => (
    linesFor(item.shipmentId).reduce(
      (sum, line) => sum + Math.max(0, line.qtyRequired - line.qtyAllocated),
      0
    )
  );
  const queue = [...active].sort((a, b) => {
    const severity = (item: OutboundShipment) => (
      ["Blocked", "Exception"].includes(item.outboundStatus)
        ? 0
        : outboundDispatchAdherence(item).status === "delayed"
          ? 1
          : 2
    );
    return severity(a) - severity(b)
      || rawTime(a.plannedDeparture || a.requiredBy) - rawTime(b.plannedDeparture || b.requiredBy)
      || unallocatedQty(b) - unallocatedQty(a);
  });
  const stageCounts = outboundStages.map(
    (_, index) => active.filter((item) => outboundStage(item.outboundStatus, linesFor(item.shipmentId)) === index).length
  );
  const stageReachedCounts = outboundStages.map(
    (_, index) => active.filter((item) => outboundStage(item.outboundStatus, linesFor(item.shipmentId)) >= index).length
  );
  const dueToday = active.filter(
    (item) => new Date(item.requiredBy).toDateString() === currentTime.toDateString()
  ).length;
  const blocked = active.filter(
    (item) => ["Blocked", "Exception"].includes(item.outboundStatus)
      || outboundDispatchAdherence(item, currentTime).status === "delayed"
  ).length;

  useEffect(() => {
    setTab("Overview");
  }, [selectedId]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <CompactMetricCard label="Due today" value={dueToday.toLocaleString()} />
        <CompactMetricCard label="Picking / Packing" value={active.filter((item) => ["Picking", "Picked", "Packed"].includes(item.outboundStatus)).length.toLocaleString()} />
        <CompactMetricCard label="Ready to load" value={active.filter((item) => ["QA Release", "Staged", "Loading"].includes(item.outboundStatus)).length.toLocaleString()} tone="warning" />
        <CompactMetricCard label="Dispatched today" value={snapshot.inventory.outboundShipments.filter((item) => item.actualDeparture && new Date(item.actualDeparture).toDateString() === new Date().toDateString()).length.toLocaleString()} tone="healthy" />
        <CompactMetricCard label="Blocked / delayed" value={blocked.toLocaleString()} tone={blocked ? "critical" : "healthy"} />
      </div>
      <Workflow labels={outboundStages} counts={stageCounts} reachedCounts={stageReachedCounts} />
      <section className="panel overflow-hidden rounded-2xl">
        <div className="border-b border-twin-border px-3 py-2">
          <h3 className="text-sm font-semibold">Live outbound queue</h3>
          <p className="text-[10px] text-twin-muted">Select a shipment to inspect fulfilment, allocated lots, transport, quality, and activity details.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-[11px]">
            <thead className="bg-twin-bg text-[10px] uppercase tracking-wide text-twin-muted">
              <tr>
                {["Shipment", "Stage / Schedule", "Customer / Destination", "Dispatch timing", "Dock / Vehicle", "Fulfilment progress", "Unallocated", "Last updated"].map((item) => (
                  <th key={item} className="border-b border-twin-border px-3 py-2">{item}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queue.map((shipment) => {
                const lines = linesFor(shipment.shipmentId);
                const required = lines.reduce((sum, line) => sum + line.qtyRequired, 0);
                const allocated = lines.reduce((sum, line) => sum + line.qtyAllocated, 0);
                const fulfilled = lines.reduce(
                  (sum, line) => sum + Math.max(line.qtyPicked, line.qtyPacked, line.qtyDispatched),
                  0
                );
                const unallocated = unallocatedQty(shipment);
                const adherence = outboundDispatchAdherence(shipment, currentTime);
                const updated = latestTimestamp(snapshot, shipment.shipmentId, [shipment.actualDeparture]);
                const dispatchTarget = shipment.plannedDeparture || shipment.requiredBy;
                const openDetails = () => openOutboundInLogistics(shipment.shipmentId);
                return (
                  <tr
                    key={shipment.shipmentId}
                    tabIndex={0}
                    aria-label={"Open " + shipment.shipmentId + " details"}
                    className={clsx(
                      "cursor-pointer border-b border-twin-border/60 transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-twin-cyan",
                      selectedId === shipment.shipmentId
                        ? "bg-twin-blue/10"
                        : changedIds.has(shipment.shipmentId)
                          ? "bg-twin-cyan/10"
                          : "hover:bg-twin-blue/5"
                    )}
                    onClick={openDetails}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openDetails();
                      }
                    }}
                  >
                    <td className="px-3 py-2 font-semibold">
                      {shipment.shipmentId}
                      {changedIds.has(shipment.shipmentId) && (
                        <span className="ml-1 rounded bg-twin-cyan/20 px-1 text-[9px] text-twin-blue">Updated</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusChip tone={toneForStatus(shipment.outboundStatus)}>{shipment.outboundStatus}</StatusChip>
                      <ScheduleAdherenceDisplay adherence={adherence} compact />
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2" title={shipment.destination}>{shipment.destination}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <OperationalTimestamp
                        value={shipment.actualDeparture ?? dispatchTarget}
                        label={shipment.actualDeparture ? "Actual departure" : shipment.plannedDeparture ? "Planned departure" : "Delivery deadline"}
                        state={shipment.actualDeparture ? actualTimestampState(adherence.status) : adherence.status === "delayed" ? "overdue" : "neutral"}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono">{shipment.dock}</span>
                      <span className="block text-[10px] text-twin-muted">{shipment.vehicleId ?? "No vehicle"}</span>
                    </td>
                    <td className="px-3 py-2">
                      <strong>{fulfilled.toLocaleString()} / {required.toLocaleString()}</strong>
                      <div className="mt-1 h-1 w-24 rounded bg-twin-border">
                        <div className="h-full rounded bg-twin-blue" style={{ width: (required ? Math.round(fulfilled / required * 100) : 0) + "%" }} />
                      </div>
                      <span className="text-[10px] text-twin-muted">{allocated.toLocaleString()} allocated</span>
                    </td>
                    <td className={clsx("px-3 py-2 font-semibold tabular-nums", unallocated ? "text-twin-warning" : "text-twin-green")}>
                      {unallocated ? unallocated.toLocaleString() + " units unallocated" : "Fully allocated"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="block">{formatLocalDateTime(updated)}</span>
                      <span className="text-[10px] tabular-nums text-twin-muted">{liveElapsedPresentation(updated, currentTime)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!queue.length && <EmptyState title="No active outbound records" detail="Dispatched shipments remain available in history and movements." />}
        </div>
      </section>
      {selected && (
        <OutboundDrawer
          snapshot={snapshot}
          shipment={selected}
          tab={tab}
          setTab={setTab}
          onClose={clearFlowSelection}
          onSimulate={() => onSimulate(selected.shipmentId)}
        />
      )}
    </div>
  );
}

function OutboundDrawer({
  snapshot,
  shipment,
  tab,
  setTab,
  onClose,
  onSimulate
}: {
  snapshot: WarehouseSnapshot;
  shipment: OutboundShipment;
  tab: string;
  setTab: (tab: string) => void;
  onClose: () => void;
  onSimulate: () => void;
}) {
  const lines = snapshot.inventory.outboundLines.filter((line) => line.shipmentId === shipment.shipmentId);
  const required = lines.reduce((sum, line) => sum + line.qtyRequired, 0);
  const allocated = lines.reduce((sum, line) => sum + line.qtyAllocated, 0);
  const picked = lines.reduce((sum, line) => sum + line.qtyPicked, 0);
  const packed = lines.reduce((sum, line) => sum + line.qtyPacked, 0);
  const issued = lines.reduce((sum, line) => sum + line.qtyDispatched, 0);
  const unallocated = Math.max(0, required - allocated);
  const events = occurredEvents(
    snapshot.operationalEvents.filter(
      (event) => event.shipmentId === shipment.shipmentId || event.referenceId === shipment.shipmentId
    )
  ).sort((a, b) => rawTime(b.timestamp) - rawTime(a.timestamp));
  const updated = latestTimestamp(snapshot, shipment.shipmentId, [shipment.actualDeparture]);
  const adherence = outboundDispatchAdherence(shipment);
  const traceLines: OperationTraceLine[] = lines.map((line) => ({
    id: line.outboundLineId,
    productId: line.productId,
    batchId: line.batchId,
    status: line.allocationStatus,
    tempBand: findBatchTrace(snapshot, line.batchId).batch?.tempBand ?? "",
    quantities: [
      ["Required", line.qtyRequired],
      ["Allocated", line.qtyAllocated],
      ["Picked", line.qtyPicked],
      ["Packed", line.qtyPacked],
      ["Issued", line.qtyDispatched],
      ["Unallocated", Math.max(0, line.qtyRequired - line.qtyAllocated)]
    ]
  }));
  const footer = (
    <OperationDrawerActions
      onViewNetwork={() => openNetwork(shipment.transportLegId)}
      onOpenDockSchedule={() => openDockSchedule({
        direction: "outbound",
        referenceId: shipment.shipmentId,
        dockId: shipment.dock,
        appointmentId: shipment.dockAppointmentId,
        transportLegId: shipment.transportLegId
      })}
      onSimulate={() => {
        onClose();
        onSimulate();
      }}
    />
  );
  return (
    <Drawer
      title={shipment.shipmentId}
      subtitle={shipment.outboundStatus + " / " + shipment.destination}
      onClose={onClose}
      footer={footer}
    >
      <DetailTabs tabs={["Overview", "Products & Lots", "Quality", "Transport", "Activity"]} active={tab} onChange={setTab} />
      {tab === "Overview" && (
        <DefinitionGrid rows={[
          ["Current stage", <StatusChip tone={toneForStatus(shipment.outboundStatus)}>{shipment.outboundStatus}</StatusChip>],
          ["Priority", shipment.priorityLevel ?? "Normal"],
          ["Customer order", shipment.customerOrderId ?? "Not linked"],
          ["Delivery", shipment.deliveryId ?? "Not linked"],
          ["Customer site", shipment.customerSiteId ?? shipment.destination],
          ["Delivery deadline", <OperationalTimestamp value={shipment.requiredBy} />],
          ["Allocation", allocated.toLocaleString() + " / " + required.toLocaleString() + " units"],
          ["Pick / pack / issue", picked.toLocaleString() + " / " + packed.toLocaleString() + " / " + issued.toLocaleString()],
          ["Unallocated quantity", unallocated ? unallocated.toLocaleString() + " units" : "Fully allocated"],
          ["Dock", shipment.dock],
          ["Vehicle / seal", (shipment.vehicleId ?? "Not assigned") + " / " + (shipment.sealNumber ?? "seal not recorded")],
          ["Planned departure", <OperationalTimestamp value={shipment.plannedDeparture} state={adherence.status === "delayed" ? "overdue" : "neutral"} />],
          ["Actual departure", <OperationalTimestamp value={shipment.actualDeparture} state={actualTimestampState(adherence.status)} />],
          ["Delivery window", formatLocalDateTime(shipment.deliveryWindowStart) + " - " + formatLocalDateTime(shipment.deliveryWindowEnd)],
          ["Schedule adherence", <ScheduleAdherenceDisplay adherence={adherence} />],
          ["Goods issue", shipment.goodsIssueNumber ?? "Not issued"],
          ["Proof of delivery", shipment.proofOfDeliveryId ?? "Not recorded"],
          ["Current blocker", ["Blocked", "Exception"].includes(shipment.outboundStatus) ? shipment.outboundStatus : "None"],
          ["Next milestone", outboundAction(shipment.outboundStatus)],
          ["Last update", formatLocalDateTime(updated)]
        ]} />
      )}
      {tab === "Products & Lots" && <ProductLotCards snapshot={snapshot} lines={traceLines} direction="outbound" />}
      {tab === "Quality" && <QualityCards snapshot={snapshot} lines={traceLines} direction="outbound" />}
      {tab === "Transport" && (
        <TransportDetails
          snapshot={snapshot}
          direction="outbound"
          referenceId={shipment.shipmentId}
          transportLegId={shipment.transportLegId}
          dockAppointmentId={shipment.dockAppointmentId}
          routeId={shipment.routeId}
          vehicleId={shipment.vehicleId}
          sealNumber={shipment.sealNumber}
        />
      )}
      {tab === "Activity" && (
        <ActivityList
          events={events.map((event) => ({
            id: event.eventId,
            timestamp: event.timestamp,
            title: event.step + " / " + event.sourceSystem,
            detail: event.description
          }))}
        />
      )}
    </Drawer>
  );
}

function ActivityList({
  events
}: {
  events: Array<{ id: string; timestamp: string; title: string; detail: string }>;
}) {
  return (
    <div className="space-y-2">
      {events.map((event) => (
        <div key={event.id} className="rounded-xl border border-twin-border bg-white/70 p-3">
          <div className="flex justify-between gap-3">
            <strong className="text-xs">{event.title}</strong>
            <span className="whitespace-nowrap text-[10px] text-twin-muted">{formatLocalDateTime(event.timestamp)}</span>
          </div>
          <p className="mt-1 text-[11px] text-twin-muted">{event.detail}</p>
        </div>
      ))}
      {!events.length && <EmptyState title="No activity recorded" detail="Operational milestones will appear here." />}
    </div>
  );
}

export default function LogisticsFlowView({ snapshot, direction }: Props) {
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const [simulationRequest, setSimulationRequest] = useState<SimulationRequest | null>(null);
  const previousSignatures = useRef<Map<string, string>>(new Map());
  const signaturesInitialized = useRef(false);

  useEffect(() => {
    setSimulationRequest(null);
  }, [direction]);

  useEffect(() => {
    const signatures = new Map<string, string>();
    snapshot.inventory.inboundShipments.forEach((item) => {
      signatures.set(item.asnId, JSON.stringify([
        item.inboundStatus,
        item.actualArrival,
        snapshot.inventory.inboundLines
          .filter((line) => line.asnId === item.asnId)
          .map((line) => line.qtyReceived)
      ]));
    });
    snapshot.inventory.outboundShipments.forEach((item) => {
      signatures.set(item.shipmentId, JSON.stringify([
        item.outboundStatus,
        item.actualDeparture,
        snapshot.inventory.outboundLines
          .filter((line) => line.shipmentId === item.shipmentId)
          .map((line) => [line.qtyAllocated, line.qtyPicked, line.qtyPacked, line.qtyDispatched])
      ]));
    });
    const changed = new Set<string>();
    recentNewRecordIds.clear();
    signatures.forEach((signature, id) => {
      const previous = previousSignatures.current.get(id);
      if (!signaturesInitialized.current) return;
      if (previous === undefined) recentNewRecordIds.add(id);
      if (previous === undefined || previous !== signature) changed.add(id);
    });
    previousSignatures.current = signatures;
    signaturesInitialized.current = true;
    if (!changed.size) return;
    setChangedIds(changed);
    const timer = window.setTimeout(() => {
      recentNewRecordIds.clear();
      setChangedIds(new Set());
    }, INVENTORY_POLICY.recentChangeMs);
    return () => window.clearTimeout(timer);
  }, [snapshot]);

  return (
    <div className="space-y-3">
      {direction === "inbound"
        ? (
            <InboundTab
              snapshot={snapshot}
              changedIds={changedIds}
              onSimulate={(referenceId) => setSimulationRequest({ direction: "inbound", referenceId })}
            />
          )
        : (
            <OutboundTab
              snapshot={snapshot}
              changedIds={changedIds}
              onSimulate={(referenceId) => setSimulationRequest({ direction: "outbound", referenceId })}
            />
          )}
      {simulationRequest && (
        <LogisticsSimulationDrawer
          snapshot={snapshot}
          direction={simulationRequest.direction}
          referenceId={simulationRequest.referenceId}
          onClose={() => setSimulationRequest(null)}
        />
      )}
    </div>
  );
}
