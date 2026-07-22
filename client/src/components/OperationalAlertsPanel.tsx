import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, BellRing, CalendarClock, CircleDot, Eye, Siren } from "lucide-react";
import clsx from "clsx";
import { buildOperationalIssues, type AlertPriority, type OperationalIssue, type WarehouseSnapshot } from "@twinops/shared";
import { useAppStore, type AppState } from "../store";
import { formatLocalDateTime } from "../lib/dateTime";
import { resolveOperationalReference } from "../lib/operationalReference";
import { StatusChip, toneForSeverity } from "./ui";

const prioritySections: Array<{
  key: AlertPriority;
  label: string;
  context: string;
  guidance: string;
  icon: typeof Siren;
  className: string;
  iconClassName: string;
}> = [
  { key: "act_now", label: "Act Now", context: "Important + urgent", guidance: "Immediate intervention", icon: Siren, className: "border-red-200/80 bg-red-50/75", iconClassName: "bg-red-100 text-red-600" },
  { key: "plan", label: "Plan", context: "Important + not urgent", guidance: "Schedule and protect time", icon: CalendarClock, className: "border-amber-200/80 bg-amber-50/75", iconClassName: "bg-amber-100 text-amber-700" },
  { key: "review", label: "Review", context: "Urgent + lower impact", guidance: "Triage and delegate", icon: Eye, className: "border-blue-200/80 bg-blue-50/75", iconClassName: "bg-blue-100 text-blue-700" },
  { key: "monitor", label: "Monitor", context: "Lower impact + not urgent", guidance: "Watch for material change", icon: CircleDot, className: "border-cyan-200/80 bg-cyan-50/75", iconClassName: "bg-cyan-100 text-cyan-700" }
];

type IssueNavigationActions = Pick<AppState,
  | "setView"
  | "setSelectedZone"
  | "setWarehouseWorkspace"
  | "setInventoryWorkspace"
  | "setLogisticsWorkspace"
  | "focusPhysicalDockInWarehouse"
  | "openDockScheduleInWarehouse"
  | "openTransportLegInLogistics"
  | "openRouteInLogistics"
  | "openInboundInLogistics"
  | "openOutboundInLogistics"
  | "openStockBalanceInInventory"
  | "setInventoryQuickFilter"
  | "setAuditFilter"
>;

function issueWorkspaceAction(issue: OperationalIssue, snapshot: WarehouseSnapshot, actions: IssueNavigationActions): () => void {
  const affected = new Set(issue.affectedIds);
  if (issue.target === "monitoring") {
    const zone = snapshot.zones.find((item) => item.id === issue.targetId || affected.has(item.id));
    return () => {
      actions.setSelectedZone(zone?.id ?? issue.targetId);
      actions.setView("Monitoring");
    };
  }
  if (issue.target === "logistics") {
    const reference = resolveOperationalReference(snapshot, [issue.targetId, ...issue.affectedIds]);
    if (reference?.kind === "dock_appointment") return () => actions.openDockScheduleInWarehouse({
      dockId: reference.dockId,
      appointmentId: reference.id,
      transportLegId: reference.transportLegId,
      asnId: reference.asnId,
      shipmentId: reference.shipmentId
    });
    if (reference?.kind === "dock") return () => actions.focusPhysicalDockInWarehouse({ dockId: reference.id });
    if (reference?.kind === "asn") return () => actions.openInboundInLogistics(reference.id);
    if (reference?.kind === "shipment") return () => actions.openOutboundInLogistics(reference.id);
    if (reference?.kind === "transport_leg") return () => actions.openTransportLegInLogistics(reference.id, "transport");
    if (reference?.kind === "route") return () => actions.openRouteInLogistics(reference.id, "network");
    return () => { actions.setLogisticsWorkspace("network"); actions.setView("Logistics"); };
  }
  if (issue.target === "inventory") {
    const sku = snapshot.inventoryPlacements.find((item) => item.stockBalanceId === issue.targetId || affected.has(item.stockBalanceId) || affected.has(item.batchNo));
    if (sku) return () => actions.openStockBalanceInInventory(sku.stockBalanceId);
    return () => {
      actions.setInventoryQuickFilter(issue.id.startsWith("replenishment:") ? "Reorder Required" : issue.id.startsWith("expiry:") ? "Expiring Soon" : "Attention Required");
      actions.setInventoryWorkspace("stock");
      actions.setView("Inventory");
    };
  }
  if (issue.target === "audit") return () => { actions.setAuditFilter("pending"); actions.setView("Audit"); };

  const reference = resolveOperationalReference(snapshot, [issue.targetId, ...issue.affectedIds]);
  if (reference?.kind === "dock_appointment") return () => actions.openDockScheduleInWarehouse({
    dockId: reference.dockId,
    appointmentId: reference.id,
    transportLegId: reference.transportLegId,
    asnId: reference.asnId,
    shipmentId: reference.shipmentId
  });
  if (reference?.kind === "dock") return () => actions.focusPhysicalDockInWarehouse({ dockId: reference.id });
  if (reference?.kind === "asn") return () => actions.openInboundInLogistics(reference.id);
  if (reference?.kind === "shipment") return () => actions.openOutboundInLogistics(reference.id);
  if (reference?.kind === "route") return () => actions.openRouteInLogistics(reference.id, "network");
  if (reference?.kind === "transport_leg") return () => actions.openTransportLegInLogistics(reference.id, "transport");
  if (reference?.kind === "stock_balance") return () => actions.openStockBalanceInInventory(reference.id);
  if (reference?.kind === "zone") return () => { actions.setWarehouseWorkspace("facility"); actions.setSelectedZone(reference.id); actions.setView("Warehouse"); };
  return () => {
    if (issue.target === "warehouse") actions.setWarehouseWorkspace("facility");
    actions.setView(issue.target === "warehouse" ? "Warehouse" : "Dashboard");
  };
}

export default function OperationalAlertsPanel() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const alertsPageRequest = useAppStore((state) => state.alertsPageRequest);
  const clearAlertsPageRequest = useAppStore((state) => state.clearAlertsPageRequest);
  const focusAuditIssue = useAppStore((state) => state.focusAuditIssue);
  const navigationActions: IssueNavigationActions = {
    setView: useAppStore((state) => state.setView),
    setSelectedZone: useAppStore((state) => state.setSelectedZone),
    setWarehouseWorkspace: useAppStore((state) => state.setWarehouseWorkspace),
    setInventoryWorkspace: useAppStore((state) => state.setInventoryWorkspace),
    setLogisticsWorkspace: useAppStore((state) => state.setLogisticsWorkspace),
    focusPhysicalDockInWarehouse: useAppStore((state) => state.focusPhysicalDockInWarehouse),
    openDockScheduleInWarehouse: useAppStore((state) => state.openDockScheduleInWarehouse),
    openTransportLegInLogistics: useAppStore((state) => state.openTransportLegInLogistics),
    openRouteInLogistics: useAppStore((state) => state.openRouteInLogistics),
    openInboundInLogistics: useAppStore((state) => state.openInboundInLogistics),
    openOutboundInLogistics: useAppStore((state) => state.openOutboundInLogistics),
    openStockBalanceInInventory: useAppStore((state) => state.openStockBalanceInInventory),
    setInventoryQuickFilter: useAppStore((state) => state.setInventoryQuickFilter),
    setAuditFilter: useAppStore((state) => state.setAuditFilter)
  };
  const issues = useMemo(() => snapshot.operationalIssues ?? buildOperationalIssues(snapshot), [snapshot]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<AlertPriority, HTMLElement | null>>>({});
  const consumedRequestIdRef = useRef<number | null>(null);
  const [focusedPriority, setFocusedPriority] = useState<AlertPriority | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ id: number; priority: AlertPriority | null } | null>(null);

  useEffect(() => {
    if (!alertsPageRequest || consumedRequestIdRef.current === alertsPageRequest.id) return;
    consumedRequestIdRef.current = alertsPageRequest.id;
    setFocusTarget(alertsPageRequest);
    clearAlertsPageRequest(alertsPageRequest.id);
  }, [alertsPageRequest, clearAlertsPageRequest]);

  useEffect(() => {
    if (!focusTarget) return;
    const frame = window.requestAnimationFrame(() => {
      if (focusTarget.priority) {
        setFocusedPriority(focusTarget.priority);
        sectionRefs.current[focusTarget.priority]?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
    const timer = window.setTimeout(() => setFocusedPriority(null), 2200);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusTarget]);

  const openWorkspace = (issue: OperationalIssue) => {
    issueWorkspaceAction(issue, snapshot, navigationActions)();
  };

  const openAudit = (issue: OperationalIssue) => {
    focusAuditIssue(issue.id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <section className="panel shrink-0 rounded-2xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-twin-muted"><BellRing size={17} className="text-twin-orange" />Operations workspace</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-twin-text">Alerts</h1>
            <p className="mt-1 text-sm text-twin-muted">Prioritized by importance and urgency. Open the source workspace to act, or review the complete audit trail.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {prioritySections.map((section) => {
              const count = issues.filter((issue) => issue.priority === section.key).length;
              return <button key={section.key} className="rounded-xl border border-twin-border/70 bg-white/70 px-3 py-2 text-left hover:border-twin-blue/40 hover:bg-twin-blue/5" onClick={() => sectionRefs.current[section.key]?.scrollIntoView({ behavior: "smooth", block: "start" })}><span className="block text-[10px] font-semibold uppercase tracking-wide text-twin-muted">{section.label}</span><span className="mt-0.5 block text-lg font-bold leading-none tabular-nums text-twin-text">{count}</span></button>;
            })}
          </div>
        </div>
      </section>

      <div ref={scrollRef} className="panel min-h-0 flex-1 overflow-y-auto rounded-2xl p-4">
        <div className="space-y-4">
        {prioritySections.map((section) => {
        const sectionIssues = issues.filter((issue) => issue.priority === section.key);
        const Icon = section.icon;
        return (
          <section
            key={section.key}
            ref={(element) => { sectionRefs.current[section.key] = element; }}
            data-alert-priority={section.key}
            className={clsx("scroll-mt-4 rounded-2xl border p-3 transition duration-700", section.className, focusedPriority === section.key && "ring-2 ring-twin-cyan/70 shadow-card")}
          >
            <div className="flex items-center gap-2">
              <span className={clsx("flex h-8 w-8 items-center justify-center rounded-xl", section.iconClassName)}><Icon size={15} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-twin-text">{section.label}</div>
                <div className="text-[10px] uppercase tracking-wide text-twin-muted">{section.context} · {section.guidance}</div>
              </div>
              <span className="rounded-full bg-white/95 px-2 py-1 text-xs font-bold tabular-nums text-twin-text shadow-sm">{sectionIssues.length}</span>
            </div>

            <div className="mt-3 grid gap-2 xl:grid-cols-2">
              {sectionIssues.length ? sectionIssues.map((issue) => (
                <article key={issue.id} className="rounded-xl border border-twin-border/70 bg-white/95 p-3 shadow-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={15} className={clsx("mt-0.5 shrink-0", issue.severity === "critical" ? "text-twin-critical" : issue.severity === "warn" ? "text-twin-warning" : "text-twin-muted")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-semibold leading-relaxed text-twin-text">{issue.title}</div>
                        <StatusChip tone={toneForSeverity(issue.severity)}>{issue.severity}</StatusChip>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-twin-muted">{issue.detail}</p>
                      <div className="mt-2 rounded-lg bg-sky-50/80 px-2 py-1.5 text-[10px] leading-relaxed text-twin-muted">{issue.classificationReason}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button className="flex items-center gap-1 rounded-lg bg-twin-blue px-2.5 py-1.5 text-[11px] font-semibold text-white" onClick={() => openWorkspace(issue)}>Open workspace <ArrowUpRight size={12} /></button>
                        <button className="rounded-lg border border-twin-border bg-white px-2.5 py-1.5 text-[11px] font-semibold text-twin-text" onClick={() => openAudit(issue)}>View audit</button>
                        <span className="ml-auto text-[9px] tabular-nums text-twin-muted">Opened {formatLocalDateTime(issue.openedAt)}</span>
                      </div>
                    </div>
                  </div>
                </article>
              )) : <div className="rounded-xl border border-dashed border-twin-border/70 bg-white/50 px-3 py-5 text-center text-xs text-twin-muted">No alerts in this quadrant.</div>}
            </div>
          </section>
        );
        })}
        </div>
      </div>
    </div>
  );
}
