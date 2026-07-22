import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Download,
  ExternalLink,
  FileJson,
  History,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X
} from "lucide-react";
import clsx from "clsx";
import {
  buildAuditEvents,
  buildOperationalIssues,
  type AiDecision,
  type AuditEvent,
  type AuditEventCategory,
  type OperationalIssue,
  type WarehouseSnapshot
} from "@twinops/shared";
import { fetchJson } from "../api";
import { useAppStore } from "../store";
import { elapsedPresentation, formatLocalDateTime } from "../lib/dateTime";
import { resolveOperationalReference, type OperationalReference } from "../lib/operationalReference";
import { StatusChip, toneForRisk, toneForSeverity } from "./ui";

type AuditWorkspace = "ledger" | "cases" | "decisions";
type TimeRange = "24h" | "7d" | "all";
type OutcomeFilter = "all" | "action" | "pending" | "resolved" | "recorded";

type AuditCase = {
  id: string;
  title: string;
  detail: string;
  category: AuditEventCategory;
  severity: AuditEvent["severity"];
  status: string;
  openedAt: string;
  updatedAt: string;
  affectedIds: string[];
  events: AuditEvent[];
  currentIssue: OperationalIssue | null;
};

type AuditSelection =
  | { kind: "event"; event: AuditEvent }
  | { kind: "case"; auditCase: AuditCase }
  | { kind: "decision"; event: AuditEvent; decision: AiDecision | null };

const CLOSED_STATUSES = new Set(["resolved", "closed", "dismissed", "approved", "rejected", "recorded", "completed"]);
const RESOLVED_STATUSES = new Set(["resolved", "closed", "dismissed"]);
const RECORDED_STATUSES = new Set(["recorded", "completed", "approved", "rejected", "not_required"]);
const PAGE_SIZE = 75;

const categoryOptions: Array<{ value: "all" | AuditEventCategory; label: string }> = [
  { value: "all", label: "All domains" },
  { value: "Inventory", label: "Inventory" },
  { value: "Cold Chain", label: "Cold chain" },
  { value: "Logistics", label: "Logistics" },
  { value: "Warehouse", label: "Warehouse" },
  { value: "AI Decision", label: "Assistant enquiries" }
];

const outcomeOptions: Array<{ value: OutcomeFilter; label: string }> = [
  { value: "all", label: "All outcomes" },
  { value: "action", label: "Action required" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved / closed" },
  { value: "recorded", label: "Completed / recorded" }
];

function needsAction(event: AuditEvent) {
  return event.status === "open"
    || event.status === "under_review"
    || event.status === "escalated"
    || event.status === "pending"
    || event.severity === "critical" && !CLOSED_STATUSES.has(event.status);
}

function matchesOutcome(event: AuditEvent, outcome: OutcomeFilter) {
  if (outcome === "action") return needsAction(event);
  if (outcome === "pending") return event.status === "pending";
  if (outcome === "resolved") return RESOLVED_STATUSES.has(event.status);
  if (outcome === "recorded") return RECORDED_STATUSES.has(event.status);
  return true;
}

function issueAsAuditEvent(issue: OperationalIssue): AuditEvent {
  return {
    id: `current-issue-${issue.id}`,
    timestamp: issue.openedAt,
    category: issue.category,
    eventType: "Current issue",
    title: issue.title,
    detail: `${issue.detail} ${issue.classificationReason}`,
    severity: issue.severity,
    status: issue.status,
    actor: issue.sourceType,
    affectedIds: [...new Set(issue.affectedIds)],
    correlationId: issue.id,
    metadata: { operationalIssue: issue }
  };
}

function titleWithoutLifecyclePrefix(title: string) {
  return title.replace(/^(Opened|Reopened|Updated|Resolved):\s*/i, "");
}

function buildCases(events: AuditEvent[], issues: OperationalIssue[]): AuditCase[] {
  const lifecycleByIssue = new Map<string, AuditEvent[]>();
  events.forEach((event) => {
    if (!event.eventType.startsWith("Issue ") || !event.correlationId) return;
    const existing = lifecycleByIssue.get(event.correlationId) ?? [];
    existing.push(event);
    lifecycleByIssue.set(event.correlationId, existing);
  });

  const currentById = new Map(issues.map((issue) => [issue.id, issue]));
  const ids = new Set([...lifecycleByIssue.keys(), ...currentById.keys()]);
  return [...ids].map((id) => {
    const currentIssue = currentById.get(id) ?? null;
    const lifecycle = [...(lifecycleByIssue.get(id) ?? [])].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const currentEvent = currentIssue ? issueAsAuditEvent(currentIssue) : null;
    const timeline = lifecycle.length ? lifecycle : currentEvent ? [currentEvent] : [];
    const first = timeline[0];
    const last = timeline[timeline.length - 1];
    return {
      id,
      title: currentIssue?.title ?? titleWithoutLifecyclePrefix(last?.title ?? id),
      detail: currentIssue?.detail ?? last?.detail ?? "No case summary recorded.",
      category: currentIssue?.category ?? last?.category ?? "Warehouse",
      severity: currentIssue?.severity ?? last?.severity ?? "info",
      status: currentIssue?.status ?? last?.status ?? "resolved",
      openedAt: first?.timestamp ?? currentIssue?.openedAt ?? new Date(0).toISOString(),
      updatedAt: last?.timestamp ?? currentIssue?.openedAt ?? new Date(0).toISOString(),
      affectedIds: [...new Set([...(currentIssue?.affectedIds ?? []), ...timeline.flatMap((event) => event.affectedIds)])],
      events: timeline,
      currentIssue
    };
  }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function decisionFromEvent(event: AuditEvent, decisions: AiDecision[]) {
  const embedded = (event.metadata as { decision?: AiDecision }).decision;
  return embedded ?? decisions.find((decision) => `decision-${decision.id}` === event.id) ?? null;
}

function displayStatus(status: string) {
  return status.replaceAll("_", " ");
}

function statusTone(event: AuditEvent) {
  if (event.status === "approved" || event.status === "resolved" || event.status === "completed") return "healthy" as const;
  if (event.status === "rejected" || event.status === "escalated") return "critical" as const;
  if (needsAction(event)) return "warning" as const;
  return "neutral" as const;
}

function AuditStat({ label, value, tone = "neutral", detail }: { label: string; value: string | number; tone?: "neutral" | "warning" | "critical" | "healthy" | "focus"; detail: string }) {
  return (
    <div className="rounded-xl border border-twin-border/70 bg-white/70 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">{label}</div>
      <div className={clsx("mt-1 text-2xl font-semibold leading-none text-twin-text", tone === "critical" && "text-twin-critical", tone === "warning" && "text-twin-warning", tone === "healthy" && "text-twin-green", tone === "focus" && "text-twin-blue")}>{value}</div>
      <div className="mt-1.5 text-[10px] text-twin-muted">{detail}</div>
    </div>
  );
}

function WorkspaceTab({ active, icon: Icon, label, count, onClick }: { active: boolean; icon: typeof History; label: string; count: number; onClick: () => void }) {
  return (
    <button
      className={clsx(
        "flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-twin-blue/50",
        active ? "border-twin-cyan/40 bg-twin-cyan/10 text-twin-blue shadow-sm" : "border-transparent text-twin-muted hover:border-twin-border hover:bg-white/60 hover:text-twin-text"
      )}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon size={16} className="shrink-0" />
      <span className="truncate text-xs font-semibold">{label}</span>
      <span className={clsx("ml-auto rounded-full px-2 py-0.5 text-[10px] tabular-nums", active ? "bg-white/75" : "bg-twin-bg")}>{count}</span>
    </button>
  );
}

function EmptyWorkspace({ workspace }: { workspace: AuditWorkspace }) {
  const content = workspace === "cases"
    ? { icon: CheckCircle2, title: "No exception cases match", detail: "There are no cases within the selected date, domain, and outcome filters." }
    : workspace === "decisions"
      ? { icon: Bot, title: "No assistant enquiries match", detail: "There are no read-only assistant enquiries in this scope." }
      : { icon: FileJson, title: "No audit events match", detail: "Change or clear the filters to view loaded audit records." };
  const Icon = content.icon;
  return <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center text-twin-muted"><Icon className="mb-3" size={28} /><strong className="text-sm text-twin-text">{content.title}</strong><span className="mt-1 text-xs">{content.detail}</span></div>;
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="rounded-xl border border-twin-border/70 bg-white/70 px-3 py-2.5"><div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">{label}</div><div className="mt-1 break-words text-sm text-twin-text">{children}</div></div>;
}

function SourcePayload({ value }: { value: unknown }) {
  return (
    <details className="rounded-xl border border-twin-border/70 bg-white/90">
      <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold text-twin-muted hover:text-twin-text">Technical evidence and source payload</summary>
      <pre className="max-h-72 overflow-auto border-t border-twin-border/60 p-3 whitespace-pre-wrap break-all text-[10px] leading-relaxed text-twin-muted">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function DetailDrawer({ selection, onClose, workspaceActionFor }: { selection: AuditSelection; onClose: () => void; workspaceActionFor: (event: AuditEvent) => (() => void) | undefined }) {
  const event = selection.kind === "event" || selection.kind === "decision" ? selection.event : null;
  const auditCase = selection.kind === "case" ? selection.auditCase : null;
  const decision = selection.kind === "decision" ? selection.decision : null;
  const title = event?.title ?? auditCase?.title ?? "Audit details";
  const drawerLabel = selection.kind === "case" ? "Exception case details" : selection.kind === "decision" ? "Assistant enquiry details" : "Audit event details";
  const workspaceAction = event ? workspaceActionFor(event) : auditCase?.events.map(workspaceActionFor).find(Boolean);

  useEffect(() => {
    const closeOnEscape = (keyboardEvent: KeyboardEvent) => { if (keyboardEvent.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <>
      <button className="fixed inset-0 z-40 cursor-default bg-twin-text/25" onClick={onClose} aria-label="Dismiss audit detail overlay" />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[680px] flex-col border-l border-twin-border bg-twin-bg shadow-2xl" role="dialog" aria-modal="true" aria-label={drawerLabel}>
        <header className="flex items-start justify-between gap-3 border-b border-twin-border bg-white/95 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={selection.kind === "case" ? toneForSeverity(auditCase?.severity) : event?.category === "AI Decision" ? "focus" : toneForSeverity(event?.severity)}>{selection.kind === "case" ? "Exception case" : selection.kind === "decision" ? "Assistant enquiry" : event?.category}</StatusChip>
              {auditCase && <StatusChip tone={auditCase.currentIssue ? "warning" : "healthy"}>{displayStatus(auditCase.status)}</StatusChip>}
              {event && <StatusChip tone={statusTone(event)}>{displayStatus(event.status)}</StatusChip>}
            </div>
            <h3 className="mt-2 line-clamp-2 text-lg font-semibold leading-tight text-twin-text">{title}</h3>
          </div>
          <button autoFocus className="rounded-lg border border-twin-border bg-white p-2 text-twin-muted hover:text-twin-text" onClick={onClose} aria-label="Close audit details"><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {selection.kind === "event" && event && (
            <>
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Event summary</div>
                <p className="mt-2 text-sm leading-relaxed text-twin-text">{event.detail}</p>
              </section>
              <div className="grid gap-2 sm:grid-cols-2">
                <DetailField label="Occurred at">{formatLocalDateTime(event.timestamp)}</DetailField>
                <DetailField label="Recorded at">Not separately captured</DetailField>
                <DetailField label="Source / actor">{event.actor}</DetailField>
                <DetailField label="Event type">{event.eventType}</DetailField>
                <DetailField label="Immutable record ID"><span className="font-mono text-xs">{event.id}</span></DetailField>
                <DetailField label="Correlation / case ID"><span className="font-mono text-xs">{event.correlationId ?? "Not recorded"}</span></DetailField>
              </div>
              <DetailField label="Affected warehouse identifiers">{event.affectedIds.length ? [...new Set(event.affectedIds)].join(", ") : "None recorded"}</DetailField>
              <SourcePayload value={event.metadata} />
            </>
          )}

          {selection.kind === "case" && auditCase && (
            <>
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Case summary</div>
                <p className="mt-2 text-sm leading-relaxed text-twin-text">{auditCase.detail}</p>
                {auditCase.currentIssue?.classificationReason && <p className="mt-2 rounded-xl border border-twin-warning/25 bg-twin-warning/10 p-3 text-xs leading-relaxed text-twin-text">{auditCase.currentIssue.classificationReason}</p>}
              </section>
              <div className="grid gap-2 sm:grid-cols-3">
                <DetailField label="Opened">{formatLocalDateTime(auditCase.openedAt)}</DetailField>
                <DetailField label="Last transition">{formatLocalDateTime(auditCase.updatedAt)}</DetailField>
                <DetailField label="Lifecycle transitions">{auditCase.events.length}</DetailField>
              </div>
              <DetailField label="Case / correlation ID"><span className="font-mono text-xs">{auditCase.id}</span></DetailField>
              <DetailField label="Affected warehouse identifiers">{auditCase.affectedIds.length ? auditCase.affectedIds.join(", ") : "None recorded"}</DetailField>
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Case lifecycle</div>
                <div className="mt-3 space-y-0">
                  {auditCase.events.map((timelineEvent, index) => (
                    <div key={timelineEvent.id} className="relative grid grid-cols-[18px_1fr] gap-3 pb-4 last:pb-0">
                      {index < auditCase.events.length - 1 && <span className="absolute left-[8px] top-4 h-full w-px bg-twin-border" />}
                      <span className={clsx("relative z-10 mt-1 h-4 w-4 rounded-full border-4 border-twin-bg", timelineEvent.status === "resolved" ? "bg-twin-green" : timelineEvent.eventType.includes("reopened") ? "bg-twin-warning" : "bg-twin-blue")} />
                      <div className="rounded-xl border border-twin-border/70 bg-white/70 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs text-twin-text">{timelineEvent.eventType}</strong><span className="text-[10px] tabular-nums text-twin-muted">{formatLocalDateTime(timelineEvent.timestamp)}</span></div>
                        <p className="mt-1 text-xs leading-relaxed text-twin-muted">{timelineEvent.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <SourcePayload value={{ currentIssue: auditCase.currentIssue, lifecycleEvents: auditCase.events.map((item) => item.metadata) }} />
            </>
          )}

          {selection.kind === "decision" && event && (
            <>
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Assistant response</div>
                <p className="mt-2 text-sm leading-relaxed text-twin-text">{decision?.narrative ?? event.detail}</p>
              </section>
              <div className="grid gap-2 sm:grid-cols-2">
                <DetailField label="Asked at">{formatLocalDateTime(decision?.timestamp ?? event.timestamp)}</DetailField>
                <DetailField label="Answered by">{decision?.agentsUsed.join(", ") || event.actor}</DetailField>
                <DetailField label="Operating mode"><StatusChip tone="focus">Read-only analysis</StatusChip></DetailField>
                <DetailField label="Record status"><StatusChip tone="healthy">Recorded</StatusChip></DetailField>
                <DetailField label="Risk"><StatusChip tone={toneForRisk(decision?.riskLevel)}>{decision?.riskLevel ?? event.severity}</StatusChip></DetailField>
                <DetailField label="Confidence">{decision ? `${Math.round(decision.confidence * (decision.confidence <= 1 ? 100 : 1))}%` : "Not recorded"}</DetailField>
              </div>
              {decision?.actionPayload && (
                <section className="rounded-xl border border-twin-border/70 bg-white/70 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Referenced operational scope</div>
                  <div className="mt-2 text-sm font-semibold text-twin-text">{decision.actionPayload.type.replaceAll("_", " ")}</div>
                  <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-twin-muted">SKUs</dt><dd>{decision.actionPayload.affectedSKUs.join(", ") || "None"}</dd>
                    <dt className="text-twin-muted">Shipments</dt><dd>{decision.actionPayload.affectedShipments.join(", ") || "None"}</dd>
                    <dt className="text-twin-muted">Zones / docks</dt><dd>{[...decision.actionPayload.affectedZones, ...decision.actionPayload.affectedDocks].join(", ") || "None"}</dd>
                  </dl>
                </section>
              )}
              {decision?.decisionEvidence && (
                <section>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Answer evidence</div>
                  <p className="mt-2 rounded-xl border border-twin-cyan/20 bg-twin-cyan/5 p-3 text-xs leading-relaxed text-twin-text">{decision.decisionEvidence.whyRecommendationWasMade}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <DetailField label="Data used">{decision.decisionEvidence.dataUsed.join(", ") || "Not recorded"}</DetailField>
                    <DetailField label="Constraints applied">{decision.decisionEvidence.constraintsApplied.join(", ") || "Not recorded"}</DetailField>
                    <DetailField label="Alternatives considered">{decision.decisionEvidence.alternativesConsidered.join(", ") || "Not recorded"}</DetailField>
                    <DetailField label="Uncertainties">{decision.decisionEvidence.uncertainties.join(", ") || "None recorded"}</DetailField>
                  </div>
                </section>
              )}
              <SourcePayload value={decision ?? event.metadata} />
            </>
          )}
        </div>
        {workspaceAction && (
          <footer className="border-t border-twin-border bg-white/95 px-5 py-3">
            <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-twin-blue px-3 py-2.5 text-sm font-semibold text-white hover:brightness-105" onClick={() => { onClose(); workspaceAction(); }}><ExternalLink size={15} />View current state</button>
          </footer>
        )}
      </aside>
    </>
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function printAuditReport(events: AuditEvent[], issues: OperationalIssue[], movementCount: number, periodLabel: string) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("The PDF report window was blocked. Allow pop-ups and try again.");
  const categories = ["Inventory", "Cold Chain", "Logistics", "AI Decision", "Warehouse"] as const;
  const categorySummary = categories.map((category) => `<tr><td>${category}</td><td>${events.filter((event) => event.category === category).length}</td></tr>`).join("");
  const issueRows = issues.map((issue) => `<tr><td>${escapeHtml(issue.priority.replaceAll("_", " "))}</td><td><strong>${escapeHtml(issue.title)}</strong><br><span>${escapeHtml(issue.detail)}</span></td><td>${escapeHtml(issue.classificationReason)}</td><td>${escapeHtml(issue.status)}</td></tr>`).join("");
  const rows = events.map((event) => `<tr><td>${escapeHtml(formatLocalDateTime(event.timestamp))}</td><td>${escapeHtml(event.category)}</td><td><strong>${escapeHtml(event.title)}</strong><br><span>${escapeHtml(event.detail)}</span></td><td>${escapeHtml(event.actor)}</td><td>${escapeHtml(event.severity)}</td><td>${escapeHtml(event.status)}</td><td>${escapeHtml(event.correlationId ?? "-")}</td></tr>`).join("");
  popup.document.write(`<!doctype html><html><head><title>TwinOps Warehouse Audit Report</title><style>
    @page { size: A4 landscape; margin: 12mm; } * { box-sizing: border-box; }
    body { margin: 0; color: #172033; font: 10px Arial, sans-serif; } h1 { margin: 0 0 4px; font-size: 22px; } h2 { margin: 18px 0 8px; font-size: 14px; }
    .muted { color: #64748b; } .summary { display: flex; gap: 10px; margin: 16px 0; } .card { min-width: 130px; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; } .card b { display: block; margin-top: 4px; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; } th, td { padding: 6px; border: 1px solid #cbd5e1; text-align: left; vertical-align: top; } th { background: #eaf0f7; font-size: 9px; text-transform: uppercase; } td span { color: #475569; } tr { break-inside: avoid; } .category { width: 260px; }
  </style></head><body><h1>TwinOps Audit &amp; Compliance Report</h1><div class="muted">Generated ${escapeHtml(formatLocalDateTime(new Date().toISOString()))} · Scope: ${escapeHtml(periodLabel)}</div>
    <div class="summary"><div class="card">Scoped records<b>${events.length}</b></div><div class="card">Open cases<b>${issues.length}</b></div><div class="card">Critical records<b>${events.filter((event) => event.severity === "critical").length}</b></div><div class="card">Inventory movements<b>${movementCount}</b></div></div>
    <h2>Open exception cases</h2>${issues.length ? `<table><thead><tr><th>Priority</th><th>Issue</th><th>Classification reason</th><th>Status</th></tr></thead><tbody>${issueRows}</tbody></table>` : `<p>No active operational issues in this scope.</p>`}
    <h2>Activity by domain</h2><table class="category"><thead><tr><th>Domain</th><th>Records</th></tr></thead><tbody>${categorySummary}</tbody></table>
    <h2>Chronological event ledger</h2><table><thead><tr><th>Timestamp</th><th>Domain</th><th>Event</th><th>Actor</th><th>Severity</th><th>Status</th><th>Correlation ID</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 250);
}

export default function AuditView() {
  const storeFilter = useAppStore((state) => state.auditFilter);
  const setStoreFilter = useAppStore((state) => state.setAuditFilter);
  const auditFocusRequest = useAppStore((state) => state.auditFocusRequest);
  const clearAuditFocusRequest = useAppStore((state) => state.clearAuditFocusRequest);
  const snapshot = useAppStore((state) => state.snapshot)!;
  const setView = useAppStore((state) => state.setView);
  const setSelectedZone = useAppStore((state) => state.setSelectedZone);
  const setWarehouseWorkspace = useAppStore((state) => state.setWarehouseWorkspace);
  const setInventoryWorkspace = useAppStore((state) => state.setInventoryWorkspace);
  const focusPhysicalDockInWarehouse = useAppStore((state) => state.focusPhysicalDockInWarehouse);
  const openDockScheduleInWarehouse = useAppStore((state) => state.openDockScheduleInWarehouse);
  const openTransportLegInLogistics = useAppStore((state) => state.openTransportLegInLogistics);
  const openRouteInLogistics = useAppStore((state) => state.openRouteInLogistics);
  const openInboundInLogistics = useAppStore((state) => state.openInboundInLogistics);
  const openOutboundInLogistics = useAppStore((state) => state.openOutboundInLogistics);
  const openStockBalanceInInventory = useAppStore((state) => state.openStockBalanceInInventory);
  const setInventoryQuickFilter = useAppStore((state) => state.setInventoryQuickFilter);

  const [workspace, setWorkspace] = useState<AuditWorkspace>(storeFilter === "action_required" || storeFilter === "issue_lifecycle" ? "cases" : storeFilter === "ai_decisions" || storeFilter === "pending" ? "decisions" : "ledger");
  const [query, setQuery] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [domain, setDomain] = useState<"all" | AuditEventCategory>(storeFilter === "inventory" ? "Inventory" : storeFilter === "cold_chain" ? "Cold Chain" : storeFilter === "logistics" ? "Logistics" : storeFilter === "warehouse" ? "Warehouse" : "all");
  const [outcome, setOutcome] = useState<OutcomeFilter>(storeFilter === "pending" ? "pending" : storeFilter === "action_required" ? "action" : "all");
  const [eventType, setEventType] = useState("all");
  const [actor, setActor] = useState("all");
  const [includeRoutine, setIncludeRoutine] = useState(storeFilter === "all");
  const [includeCaseTransitions, setIncludeCaseTransitions] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selection, setSelection] = useState<AuditSelection | null>(null);
  const [highlightedCaseId, setHighlightedCaseId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);

  const localEvents = useMemo(() => buildAuditEvents(snapshot), [snapshot]);
  const [remoteEvents, setRemoteEvents] = useState<AuditEvent[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const caseRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const consumedAuditFocusRequestIdRef = useRef<number | null>(null);

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setRefreshing(true);
    try {
      const next = await fetchJson<AuditEvent[]>("/api/audit");
      setRemoteEvents(next);
      setLastRefreshAt(new Date().toISOString());
      setRefreshError(null);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Unable to refresh audit records.");
    } finally {
      if (showLoading) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const poll = () => {
      fetchJson<AuditEvent[]>("/api/audit").then((next) => {
        if (!active) return;
        setRemoteEvents(next);
        setLastRefreshAt(new Date().toISOString());
        setRefreshError(null);
      }).catch((error: unknown) => {
        if (active) setRefreshError(error instanceof Error ? error.message : "Unable to refresh audit records.");
      });
    };
    poll();
    const timer = window.setInterval(poll, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (storeFilter === "action_required") { setWorkspace("cases"); setDomain("all"); setOutcome("action"); }
    else if (storeFilter === "issue_lifecycle") setWorkspace("cases");
    else if (storeFilter === "ai_decisions") { setWorkspace("decisions"); setDomain("all"); }
    else if (storeFilter === "pending") { setWorkspace("decisions"); setDomain("all"); setOutcome("pending"); }
    else {
      setWorkspace("ledger");
      if (storeFilter === "all") setIncludeRoutine(true);
      if (storeFilter === "significant") setIncludeRoutine(false);
      if (storeFilter === "inventory") setDomain("Inventory");
      if (storeFilter === "cold_chain") setDomain("Cold Chain");
      if (storeFilter === "logistics") setDomain("Logistics");
      if (storeFilter === "warehouse") setDomain("Warehouse");
    }
  }, [storeFilter]);

  const events = useMemo(() => [...(remoteEvents ?? localEvents)].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [localEvents, remoteEvents]);
  const issues = useMemo(() => snapshot.operationalIssues ?? buildOperationalIssues(snapshot), [snapshot]);
  const cases = useMemo(() => buildCases(events, issues), [events, issues]);
  const cutoff = useMemo(() => timeRange === "24h" ? Date.now() - 24 * 60 * 60_000 : timeRange === "7d" ? Date.now() - 7 * 24 * 60 * 60_000 : 0, [timeRange]);
  const normalizedQuery = query.trim().toLowerCase();

  const eventTypes = useMemo(() => [...new Set(events.map((event) => event.eventType))].sort((a, b) => a.localeCompare(b)), [events]);
  const actors = useMemo(() => [...new Set(events.map((event) => event.actor).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [events]);

  const eventMatchesScope = useCallback((event: AuditEvent, forceDecisionDomain = false) => {
    if (cutoff && new Date(event.timestamp).getTime() < cutoff) return false;
    if (!includeRoutine && event.category === "Warehouse" && event.eventType === "RFID scan") return false;
    if (!forceDecisionDomain && !includeCaseTransitions && event.eventType.startsWith("Issue ")) return false;
    if (forceDecisionDomain && event.category !== "AI Decision") return false;
    if (domain !== "all" && event.category !== domain) return false;
    if (!matchesOutcome(event, outcome)) return false;
    if (eventType !== "all" && event.eventType !== eventType) return false;
    if (actor !== "all" && event.actor !== actor) return false;
    if (!normalizedQuery) return true;
    return [event.title, event.detail, event.actor, event.category, event.eventType, event.status, event.correlationId, ...event.affectedIds].some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
  }, [actor, cutoff, domain, eventType, includeCaseTransitions, includeRoutine, normalizedQuery, outcome]);

  const ledgerEvents = useMemo(() => events.filter((event) => eventMatchesScope(event)), [eventMatchesScope, events]);
  const decisionEvents = useMemo(() => events.filter((event) => eventMatchesScope(event, true)), [eventMatchesScope, events]);
  const filteredCases = useMemo(() => cases.filter((auditCase) => {
    if (cutoff && new Date(auditCase.updatedAt).getTime() < cutoff) return false;
    if (domain !== "all" && auditCase.category !== domain) return false;
    if (outcome === "action" && !auditCase.currentIssue) return false;
    if (outcome === "pending" && auditCase.status !== "pending") return false;
    if (outcome === "resolved" && (auditCase.currentIssue || !RESOLVED_STATUSES.has(auditCase.status))) return false;
    if (outcome === "recorded" && !RECORDED_STATUSES.has(auditCase.status)) return false;
    if (eventType !== "all" && !auditCase.events.some((event) => event.eventType === eventType)) return false;
    if (actor !== "all" && !auditCase.events.some((event) => event.actor === actor)) return false;
    if (!normalizedQuery) return true;
    return [auditCase.title, auditCase.detail, auditCase.category, auditCase.status, auditCase.id, ...auditCase.affectedIds, ...auditCase.events.flatMap((event) => [event.title, event.detail])].some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
  }), [actor, cases, cutoff, domain, eventType, normalizedQuery, outcome]);

  const workspaceEvents = useMemo(() => {
    if (workspace === "ledger") return ledgerEvents;
    if (workspace === "decisions") return decisionEvents;
    const unique = new Map<string, AuditEvent>();
    filteredCases.forEach((auditCase) => auditCase.events.forEach((event) => unique.set(event.id, event)));
    return [...unique.values()].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [decisionEvents, filteredCases, ledgerEvents, workspace]);

  useEffect(() => setPage(0), [actor, domain, eventType, includeCaseTransitions, includeRoutine, normalizedQuery, outcome, timeRange, workspace]);

  const workspaceRowCount = workspace === "ledger" ? ledgerEvents.length : workspace === "cases" ? filteredCases.length : decisionEvents.length;
  const pageCount = Math.max(1, Math.ceil(workspaceRowCount / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const visibleLedgerEvents = ledgerEvents.slice(pageStart, pageStart + PAGE_SIZE);
  const visibleCases = filteredCases.slice(pageStart, pageStart + PAGE_SIZE);
  const visibleDecisionEvents = decisionEvents.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => setPage((value) => Math.min(value, pageCount - 1)), [pageCount]);

  useEffect(() => {
    if (
      !auditFocusRequest ||
      consumedAuditFocusRequestIdRef.current === auditFocusRequest.id
    ) return;
    consumedAuditFocusRequestIdRef.current = auditFocusRequest.id;
    setWorkspace("cases");
    setQuery("");
    setTimeRange("all");
    setDomain("all");
    setOutcome("action");
    setEventType("all");
    setActor("all");
    setSelection(null);
    setHighlightedCaseId(auditFocusRequest.issueId);
    clearAuditFocusRequest(auditFocusRequest.id);
  }, [auditFocusRequest, clearAuditFocusRequest]);

  useEffect(() => {
    if (!highlightedCaseId) return;
    const targetIndex = filteredCases.findIndex((auditCase) => auditCase.id === highlightedCaseId);
    if (targetIndex >= 0) setPage(Math.floor(targetIndex / PAGE_SIZE));
  }, [filteredCases, highlightedCaseId]);

  useEffect(() => {
    if (!highlightedCaseId || !visibleCases.some((auditCase) => auditCase.id === highlightedCaseId)) return;
    const frame = window.requestAnimationFrame(() => {
      caseRowRefs.current[highlightedCaseId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setHighlightedCaseId(null), 5000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [highlightedCaseId, visibleCases]);

  const scopedOpenCases = filteredCases.filter((auditCase) => auditCase.currentIssue).length;
  const scopedCriticalOpen = filteredCases.filter((auditCase) => auditCase.currentIssue && auditCase.severity === "critical").length;
  const resolvedInPeriod = filteredCases.filter((auditCase) => !auditCase.currentIssue && RESOLVED_STATUSES.has(auditCase.status)).length;
  const stale = Boolean(lastRefreshAt && Date.now() - new Date(lastRefreshAt).getTime() > 45_000);
  const ledgerVisibilityFiltersActive = workspace === "ledger" && (includeRoutine || includeCaseTransitions);
  const activeFilters = Boolean(query || timeRange !== "7d" || domain !== "all" || outcome !== "all" || eventType !== "all" || actor !== "all" || ledgerVisibilityFiltersActive);

  function workspaceActionForReference(reference: OperationalReference | null, coldChain = false): (() => void) | undefined {
    if (!reference) return undefined;
    if (reference.kind === "dock_appointment") return () => openDockScheduleInWarehouse({
      dockId: reference.dockId,
      appointmentId: reference.id,
      transportLegId: reference.transportLegId,
      asnId: reference.asnId,
      shipmentId: reference.shipmentId
    });
    if (reference.kind === "dock") return () => focusPhysicalDockInWarehouse({ dockId: reference.id });
    if (reference.kind === "asn") return () => openInboundInLogistics(reference.id);
    if (reference.kind === "shipment") return () => openOutboundInLogistics(reference.id);
    if (reference.kind === "route") return () => openRouteInLogistics(reference.id, "network");
    if (reference.kind === "transport_leg") return () => openTransportLegInLogistics(reference.id, "transport");
    if (reference.kind === "stock_balance") return () => openStockBalanceInInventory(reference.id);
    if (reference.kind === "zone") return () => {
      setSelectedZone(reference.id);
      if (!coldChain) setWarehouseWorkspace("facility");
      setView(coldChain ? "Monitoring" : "Warehouse");
    };
    return undefined;
  }

  function workspaceActionFor(event: AuditEvent): (() => void) | undefined {
    const operationalEvent = (event.metadata as { operationalEvent?: { process?: string; asnId?: string | null; shipmentId?: string | null; transportLegId?: string | null; dockAppointmentId?: string | null } }).operationalEvent;
    if (operationalEvent) {
      if (operationalEvent.dockAppointmentId) {
        return workspaceActionForReference(resolveOperationalReference(snapshot, [operationalEvent.dockAppointmentId]));
      }
      if ((operationalEvent.process === "transport" || operationalEvent.process === "yard") && operationalEvent.transportLegId) {
        return () => openTransportLegInLogistics(operationalEvent.transportLegId!, "transport");
      }
      if (operationalEvent.asnId) return () => openInboundInLogistics(operationalEvent.asnId!);
      if (operationalEvent.shipmentId) return () => openOutboundInLogistics(operationalEvent.shipmentId!);
    }
    const issue = issues.find((item) => `current-issue-${item.id}` === event.id || item.id === event.correlationId);
    if (issue?.target === "monitoring") return workspaceActionForReference(resolveOperationalReference(snapshot, [issue.targetId, ...issue.affectedIds]), true);
    if (issue?.target === "logistics") return workspaceActionForReference(resolveOperationalReference(snapshot, [issue.targetId, ...issue.affectedIds]));
    if (issue?.target === "inventory") {
      const sku = snapshot.inventoryPlacements.find((item) => item.stockBalanceId === issue.targetId || issue.affectedIds.includes(item.stockBalanceId) || issue.affectedIds.includes(item.batchNo));
      return sku ? () => openStockBalanceInInventory(sku.stockBalanceId) : () => { setInventoryQuickFilter(issue.id.startsWith("replenishment:") ? "Reorder Required" : "Attention Required"); setInventoryWorkspace("stock"); setView("Inventory"); };
    }
    if (issue?.target === "warehouse") return workspaceActionForReference(resolveOperationalReference(snapshot, [issue.targetId, ...issue.affectedIds])) ?? (() => setView("Warehouse"));
    if (event.category === "Cold Chain") return workspaceActionForReference(resolveOperationalReference(snapshot, event.affectedIds), true) ?? (() => setView("Monitoring"));
    if (event.category === "Logistics") return workspaceActionForReference(resolveOperationalReference(snapshot, event.affectedIds)) ?? (() => setView("Logistics"));
    if (event.category === "Inventory") return workspaceActionForReference(resolveOperationalReference(snapshot, event.affectedIds)) ?? (() => setView("Inventory"));
    if (event.category === "Warehouse") return workspaceActionForReference(resolveOperationalReference(snapshot, event.affectedIds)) ?? (() => setView("Warehouse"));
    return undefined;
  }

  function changeWorkspace(next: AuditWorkspace) {
    setWorkspace(next);
    setSelection(null);
    if (next === "ledger") setStoreFilter(includeRoutine ? "all" : "significant");
    if (next === "cases") setStoreFilter("issue_lifecycle");
    if (next === "decisions") setStoreFilter("ai_decisions");
  }

  function clearFilters() {
    setQuery("");
    setTimeRange("7d");
    setDomain("all");
    setOutcome("all");
    setEventType("all");
    setActor("all");
    setIncludeRoutine(false);
    setIncludeCaseTransitions(false);
    setStoreFilter(workspace === "cases" ? "issue_lifecycle" : workspace === "decisions" ? "ai_decisions" : "significant");
  }

  async function exportJson() {
    try {
      setExportError(null);
      const statuses = outcome === "pending" ? ["pending"] : outcome === "resolved" ? [...RESOLVED_STATUSES] : outcome === "recorded" ? [...RECORDED_STATUSES] : outcome === "action" ? ["open", "under_review", "escalated", "pending"] : undefined;
      const report = await fetchJson<Record<string, unknown>>("/api/audit/export", {
        method: "POST",
        body: JSON.stringify({
          view: workspace === "ledger" ? includeRoutine ? "all" : "significant" : workspace === "cases" ? "issue_lifecycle" : "ai_decisions",
          query: query || undefined,
          from: cutoff ? new Date(cutoff).toISOString() : undefined,
          categories: domain === "all" ? undefined : [domain],
          statuses,
          eventTypes: eventType === "all" ? undefined : [eventType],
          actors: actor === "all" ? undefined : [actor],
          includeRoutine
        })
      });
      const exportScope = report.exportScope && typeof report.exportScope === "object" ? report.exportScope as Record<string, unknown> : {};
      const scopedReport = {
        ...report,
        exportScope: { ...exportScope, matchedEventCount: workspaceEvents.length, renderedWorkspace: workspace },
        auditEvents: workspaceEvents,
        ...(workspace === "ledger" && !includeCaseTransitions ? { operationalIssueLifecycle: [] } : {})
      };
      const blob = new Blob([JSON.stringify(scopedReport, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `twinops-audit-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Unable to export audit records.");
    }
  }

  const rangeLabel = timeRange === "24h" ? "Last 24 hours" : timeRange === "7d" ? "Last 7 days" : "Loaded history";

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <section className="panel rounded-2xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-twin-blue" /><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-twin-muted">Governance workspace</span></div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Audit &amp; Compliance</h2>
            <p className="mt-1 text-sm text-twin-muted">Trace warehouse evidence, investigate exception lifecycles, and review recorded assistant enquiries.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2 text-[10px] text-twin-muted">
              <span className={clsx("h-2 w-2 rounded-full", refreshError ? "bg-twin-critical" : stale ? "bg-twin-warning" : remoteEvents ? "bg-twin-green" : "bg-twin-muted")} />
              <span>{refreshError ? "Audit service unavailable · showing retained records" : stale ? "Data may be stale" : remoteEvents ? "Connected" : "Loading audit service"}</span>
              <span>·</span>
              <span>{lastRefreshAt ? `Updated ${formatLocalDateTime(lastRefreshAt)} (${elapsedPresentation(lastRefreshAt)})` : "Not refreshed yet"}</span>
              <span>· Auto-refresh 15s</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="flex items-center gap-2 rounded-xl border border-twin-border/70 bg-white/70 px-3 py-2 text-xs font-semibold text-twin-text hover:bg-white disabled:opacity-60" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh audit records"><RefreshCw size={15} className={clsx(refreshing && "animate-spin")} />Refresh</button>
              <button className="flex items-center gap-2 rounded-xl border border-twin-border/70 bg-white/70 px-3 py-2 text-xs font-semibold text-twin-text hover:bg-white" onClick={() => void exportJson()}><Download size={15} />JSON</button>
              <button className="flex items-center gap-2 rounded-xl bg-twin-orange px-3 py-2 text-xs font-semibold text-white" onClick={() => {
                try {
                  setExportError(null);
                  const issueIds = new Set(filteredCases.filter((auditCase) => auditCase.currentIssue).map((auditCase) => auditCase.id));
                  const scopedIssues = issues.filter((issue) => issueIds.has(issue.id));
                  printAuditReport(workspaceEvents, scopedIssues, workspaceEvents.filter((event) => event.id.startsWith("movement-")).length, `${workspace === "ledger" ? "Event Ledger" : workspace === "cases" ? "Exception Cases" : "Assistant Chat Log"} · ${rangeLabel}${domain !== "all" ? ` · ${domain}` : ""}${query ? ` · Search: ${query}` : ""}`);
                } catch (error) { setExportError(error instanceof Error ? error.message : "Unable to create PDF report."); }
              }}><Printer size={15} />PDF</button>
            </div>
          </div>
        </div>
        {(exportError || refreshError) && <div className={clsx("mt-3 rounded-xl border px-3 py-2 text-xs", exportError ? "border-red-300 bg-red-50 text-red-700" : "border-amber-300 bg-amber-50 text-amber-800")}><AlertTriangle className="mr-2 inline" size={14} />{exportError ?? refreshError}</div>}

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <AuditStat label="Open cases" value={scopedOpenCases} tone={scopedOpenCases ? "warning" : "healthy"} detail="Active exceptions in scope" />
          <AuditStat label="Critical open" value={scopedCriticalOpen} tone={scopedCriticalOpen ? "critical" : "healthy"} detail="Open cases requiring priority review" />
          <AuditStat label="Resolved in period" value={resolvedInPeriod} tone="healthy" detail={rangeLabel} />
          <AuditStat label="Assistant enquiries" value={decisionEvents.length} tone="focus" detail="Read-only questions recorded" />
        </div>

        <div className="mt-4 grid gap-2 rounded-2xl border border-twin-border/70 bg-white/80 p-1.5 md:grid-cols-3">
          <WorkspaceTab active={workspace === "ledger"} icon={History} label="Event Ledger" count={ledgerEvents.length} onClick={() => changeWorkspace("ledger")} />
          <WorkspaceTab active={workspace === "cases"} icon={CircleAlert} label="Exception Cases" count={filteredCases.length} onClick={() => changeWorkspace("cases")} />
          <WorkspaceTab active={workspace === "decisions"} icon={Bot} label="Assistant Chat Log" count={decisionEvents.length} onClick={() => changeWorkspace("decisions")} />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <label className="flex min-w-[240px] flex-[2] items-center gap-2 rounded-xl border border-twin-border/70 bg-white/70 px-3 py-2 text-sm focus-within:border-twin-blue/50">
            <Search size={15} className="shrink-0 text-twin-muted" />
            <input className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-twin-muted" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search event, reference, product, batch or actor" />
          </label>
          <select aria-label="Audit date range" className="min-w-[140px] rounded-xl border border-twin-border/70 bg-white/70 px-3 py-2 text-xs font-semibold text-twin-text" value={timeRange} onChange={(event) => setTimeRange(event.target.value as TimeRange)}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="all">Loaded history</option></select>
          <select aria-label="Audit domain" className="min-w-[140px] rounded-xl border border-twin-border/70 bg-white/70 px-3 py-2 text-xs font-semibold text-twin-text" value={domain} onChange={(event) => setDomain(event.target.value as "all" | AuditEventCategory)}>{categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <select aria-label="Audit outcome" className="min-w-[150px] rounded-xl border border-twin-border/70 bg-white/70 px-3 py-2 text-xs font-semibold text-twin-text" value={outcome} onChange={(event) => setOutcome(event.target.value as OutcomeFilter)}>{outcomeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <button className={clsx("flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold", advancedOpen || eventType !== "all" || actor !== "all" || ledgerVisibilityFiltersActive ? "border-twin-cyan/40 bg-twin-cyan/10 text-twin-blue" : "border-twin-border/70 bg-white/70 text-twin-text")} onClick={() => setAdvancedOpen((value) => !value)}><SlidersHorizontal size={15} />Advanced</button>
        </div>

        {advancedOpen && (
          <div className={clsx("mt-2 grid gap-2 rounded-xl border border-twin-border/70 bg-white/80 p-3 sm:grid-cols-2", workspace === "ledger" && "lg:grid-cols-[1fr_1fr_auto_auto]")}>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Event type<select className="mt-1 block w-full rounded-lg border border-twin-border bg-white px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-twin-text" value={eventType} onChange={(event) => { setEventType(event.target.value); if (event.target.value.startsWith("Issue ")) setIncludeCaseTransitions(true); }}><option value="all">All event types</option>{eventTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Actor / source<select className="mt-1 block w-full rounded-lg border border-twin-border bg-white px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-twin-text" value={actor} onChange={(event) => setActor(event.target.value)}><option value="all">All actors and sources</option>{actors.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            {workspace === "ledger" && <label className="flex items-center gap-2 self-end rounded-lg border border-twin-border bg-white px-3 py-2 text-xs text-twin-text"><input type="checkbox" checked={includeRoutine} onChange={(event) => { setIncludeRoutine(event.target.checked); setStoreFilter(event.target.checked ? "all" : "significant"); }} />Include routine RFID records</label>}
            {workspace === "ledger" && <label className="flex items-center gap-2 self-end rounded-lg border border-twin-border bg-white px-3 py-2 text-xs text-twin-text"><input type="checkbox" checked={includeCaseTransitions} onChange={(event) => setIncludeCaseTransitions(event.target.checked)} />Include case lifecycle transitions</label>}
          </div>
        )}

        {activeFilters && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="font-semibold uppercase tracking-wide text-twin-muted">Active filters</span>
            {timeRange !== "7d" && <button className="rounded-full border border-twin-border bg-white px-2 py-1" onClick={() => setTimeRange("7d")}>{rangeLabel} ×</button>}
            {domain !== "all" && <button className="rounded-full border border-twin-border bg-white px-2 py-1" onClick={() => setDomain("all")}>{domain} ×</button>}
            {outcome !== "all" && <button className="rounded-full border border-twin-border bg-white px-2 py-1" onClick={() => setOutcome("all")}>{outcomeOptions.find((item) => item.value === outcome)?.label} ×</button>}
            {eventType !== "all" && <button className="rounded-full border border-twin-border bg-white px-2 py-1" onClick={() => setEventType("all")}>{eventType} ×</button>}
            {actor !== "all" && <button className="rounded-full border border-twin-border bg-white px-2 py-1" onClick={() => setActor("all")}>{actor} ×</button>}
            {workspace === "ledger" && includeRoutine && <button className="rounded-full border border-twin-border bg-white px-2 py-1" onClick={() => setIncludeRoutine(false)}>Routine RFID included ×</button>}
            {workspace === "ledger" && includeCaseTransitions && <button className="rounded-full border border-twin-border bg-white px-2 py-1" onClick={() => setIncludeCaseTransitions(false)}>Case transitions included ×</button>}
            {query && <button className="rounded-full border border-twin-border bg-white px-2 py-1" onClick={() => setQuery("")}>Search: {query} ×</button>}
            <button className="ml-1 font-semibold text-twin-blue hover:underline" onClick={clearFilters}>Clear all</button>
          </div>
        )}
      </section>

      <section className="panel flex min-h-0 flex-col overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-twin-border/70 bg-white/80 px-4 py-3">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-twin-text">{workspace === "ledger" ? "Event Ledger" : workspace === "cases" ? "Exception Cases" : "Assistant Chat Log"}</h3><p className="mt-0.5 truncate text-[10px] text-twin-muted">{workspace === "ledger" ? "Immutable chronological evidence; routine RFID and case lifecycle transitions are hidden by default." : workspace === "cases" ? "Issue lifecycle transitions grouped into one traceable exception case." : "Read-only assistant questions, verified evidence, referenced records, and recorded answers."}</p></div>
          <span className="shrink-0 text-[10px] tabular-nums text-twin-muted">{workspace === "cases" ? filteredCases.length : workspaceEvents.length} loaded</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {workspace === "ledger" && (ledgerEvents.length ? (
            <table className="w-full min-w-[860px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-twin-bg/95 text-[10px] uppercase tracking-wide text-twin-muted backdrop-blur"><tr>{["Timestamp", "Domain / source", "Event & reference", "Actor", "Outcome", ""].map((header) => <th key={header} className="border-b border-twin-border px-3 py-2.5 font-semibold">{header}</th>)}</tr></thead>
              <tbody>{visibleLedgerEvents.map((event) => <tr key={event.id} tabIndex={0} aria-label={`Open audit event ${event.title}`} className="cursor-pointer border-b border-twin-border/60 hover:bg-twin-blue/5 focus:bg-twin-blue/5 focus:outline-none" onClick={() => setSelection({ kind: "event", event })} onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") setSelection({ kind: "event", event }); }}><td className="w-[180px] whitespace-nowrap px-3 py-3 tabular-nums">{formatLocalDateTime(event.timestamp)}</td><td className="w-[150px] px-3 py-3"><StatusChip tone="focus" className="normal-case tracking-normal">{event.category}</StatusChip><div className="mt-1 truncate text-[10px] text-twin-muted" title={event.eventType}>{event.eventType}</div></td><td className="px-3 py-3"><div className="max-w-[520px] truncate font-semibold text-twin-text" title={event.title}>{event.title}</div><div className="mt-1 flex items-center gap-2"><span className="max-w-[460px] truncate text-[10px] text-twin-muted" title={event.detail}>{event.detail}</span>{event.correlationId && <span className="shrink-0 font-mono text-[9px] text-twin-muted">{event.correlationId}</span>}</div></td><td className="w-[150px] px-3 py-3"><span className="block max-w-[140px] truncate" title={event.actor}>{event.actor}</span></td><td className="w-[130px] px-3 py-3"><StatusChip tone={statusTone(event)}>{displayStatus(event.status)}</StatusChip><div className="mt-1"><StatusChip tone={toneForSeverity(event.severity)}>{event.severity}</StatusChip></div></td><td className="w-10 px-3 py-3 text-twin-muted"><ChevronRight size={15} /></td></tr>)}</tbody>
            </table>
          ) : <EmptyWorkspace workspace="ledger" />)}

          {workspace === "cases" && (filteredCases.length ? (
            <table className="w-full min-w-[780px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-twin-bg/95 text-[10px] uppercase tracking-wide text-twin-muted backdrop-blur"><tr>{["Last transition", "Domain", "Exception case", "Lifecycle", "State", ""].map((header) => <th key={header} className="border-b border-twin-border px-3 py-2.5 font-semibold">{header}</th>)}</tr></thead>
              <tbody>{visibleCases.map((auditCase) => <tr ref={(row) => { caseRowRefs.current[auditCase.id] = row; }} data-audit-case-id={auditCase.id} key={auditCase.id} tabIndex={0} aria-label={`Open exception case ${auditCase.title}`} className={clsx("cursor-pointer border-b border-twin-border/60 transition-colors duration-700 hover:bg-twin-blue/5 focus:bg-twin-blue/5 focus:outline-none", highlightedCaseId === auditCase.id && "bg-twin-cyan/20 ring-2 ring-inset ring-twin-cyan/60")} onClick={() => setSelection({ kind: "case", auditCase })} onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") setSelection({ kind: "case", auditCase }); }}><td className="w-[180px] whitespace-nowrap px-3 py-3 tabular-nums">{formatLocalDateTime(auditCase.updatedAt)}<div className="mt-1 text-[10px] text-twin-muted">Opened {formatLocalDateTime(auditCase.openedAt)}</div></td><td className="w-[130px] px-3 py-3"><StatusChip tone="focus" className="normal-case tracking-normal">{auditCase.category}</StatusChip></td><td className="px-3 py-3"><div className="max-w-[520px] truncate font-semibold text-twin-text" title={auditCase.title}>{auditCase.title}</div><div className="mt-1 max-w-[520px] truncate text-[10px] text-twin-muted" title={auditCase.detail}>{auditCase.detail}</div><div className="mt-1 font-mono text-[9px] text-twin-muted">{auditCase.id}</div></td><td className="w-[130px] px-3 py-3"><strong className="tabular-nums text-twin-text">{auditCase.events.length}</strong><span className="ml-1 text-twin-muted">transition{auditCase.events.length === 1 ? "" : "s"}</span></td><td className="w-[130px] px-3 py-3"><StatusChip tone={auditCase.currentIssue ? toneForSeverity(auditCase.severity) : "healthy"}>{auditCase.currentIssue ? displayStatus(auditCase.status) : "resolved"}</StatusChip></td><td className="w-10 px-3 py-3 text-twin-muted"><ChevronRight size={15} /></td></tr>)}</tbody>
            </table>
          ) : <EmptyWorkspace workspace="cases" />)}

          {workspace === "decisions" && (decisionEvents.length ? (
            <table className="w-full min-w-[700px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-twin-bg/95 text-[10px] uppercase tracking-wide text-twin-muted backdrop-blur"><tr>{["Asked", "Assistant response", "Risk / confidence", "Referenced records", ""].map((header) => <th key={header} className="border-b border-twin-border px-3 py-2.5 font-semibold">{header}</th>)}</tr></thead>
              <tbody>{visibleDecisionEvents.map((event) => { const decision = decisionFromEvent(event, snapshot.decisions); const decisionId = decision?.id ?? event.id; const confidence = decision ? Math.round(decision.confidence * (decision.confidence <= 1 ? 100 : 1)) : null; return <tr key={event.id} tabIndex={0} aria-label={`Open assistant enquiry ${decisionId}`} className="cursor-pointer border-b border-twin-border/60 hover:bg-twin-blue/5 focus:bg-twin-blue/5 focus:outline-none" onClick={() => setSelection({ kind: "decision", event, decision })} onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") setSelection({ kind: "decision", event, decision }); }}><td className="w-[180px] whitespace-nowrap px-3 py-3 tabular-nums">{formatLocalDateTime(event.timestamp)}<div className="mt-1 font-mono text-[9px] text-twin-muted">{decisionId}</div></td><td className="px-3 py-3"><div className="max-w-[520px] truncate font-semibold text-twin-text" title={event.title}>{event.title}</div><div className="mt-1 max-w-[520px] truncate text-[10px] text-twin-muted" title={event.detail}>{event.detail}</div></td><td className="w-[140px] px-3 py-3"><StatusChip tone={toneForRisk(decision?.riskLevel)}>{decision?.riskLevel ?? event.severity}</StatusChip><div className="mt-1 text-[10px] text-twin-muted">{confidence === null ? "Confidence not recorded" : `${confidence}% confidence`}</div></td><td className="w-[150px] px-3 py-3"><span className="block max-w-[140px] truncate" title={event.affectedIds.join(", ")}>{event.affectedIds.length ? event.affectedIds.join(", ") : "None recorded"}</span></td><td className="w-10 px-3 py-3 text-twin-muted"><ChevronRight size={15} /></td></tr>; })}</tbody>
            </table>
          ) : <EmptyWorkspace workspace="decisions" />)}
        </div>
        {workspaceRowCount > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-twin-border/70 bg-white/90 px-4 py-2 text-[10px] text-twin-muted">
            <span>Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, workspaceRowCount)} of {workspaceRowCount} loaded records</span>
            <div className="flex items-center gap-2"><button className="rounded-lg border border-twin-border bg-white px-2.5 py-1.5 font-semibold text-twin-text disabled:opacity-40" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>Previous</button><span className="tabular-nums">Page {page + 1} of {pageCount}</span><button className="rounded-lg border border-twin-border bg-white px-2.5 py-1.5 font-semibold text-twin-text disabled:opacity-40" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1}>Next</button></div>
          </div>
        )}
      </section>

      {selection && <DetailDrawer selection={selection} onClose={() => setSelection(null)} workspaceActionFor={workspaceActionFor} />}
    </div>
  );
}
