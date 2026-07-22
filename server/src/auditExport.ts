import type { AuditEvent, OperationalIssue } from "@twinops/shared";

const AUDIT_EXPORT_VIEWS = [
  "significant",
  "action_required",
  "issue_lifecycle",
  "inventory",
  "cold_chain",
  "logistics",
  "warehouse",
  "ai_decisions",
  "pending",
  "all"
] as const;

export type AuditExportView = typeof AUDIT_EXPORT_VIEWS[number];

export interface AuditExportScope {
  view: AuditExportView;
  query: string;
  from: string | null;
  to: string | null;
  categories: string[];
  severities: string[];
  statuses: string[];
  eventTypes: string[];
  actors: string[];
  sourceSystems: string[];
  correlationIds: string[];
  eventIds: string[];
  includeRoutine: boolean;
}

export class AuditExportScopeError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringsFrom(...values: unknown[]): string[] {
  return [...new Set(values
    .flatMap((value) => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.toLowerCase() !== "all"))];
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function parseBoundary(value: unknown, field: "from" | "to"): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new AuditExportScopeError(`${field} must be a valid ISO date-time`);
  }
  return new Date(value).toISOString();
}

/**
 * Normalises the JSON export request. Flat fields are the public contract; a nested `filters`
 * object and a few singular aliases are accepted to keep the endpoint tolerant of older clients.
 */
export function parseAuditExportScope(input: unknown, now = new Date()): AuditExportScope {
  if (input !== undefined && input !== null && !isRecord(input)) {
    throw new AuditExportScopeError("Audit export body must be a JSON object");
  }

  const body = isRecord(input) ? input : {};
  const nested = isRecord(body.filters) ? body.filters : {};
  const raw = { ...body, ...nested };
  const requestedView = firstString(raw.view, raw.filter) ?? "all";
  if (!AUDIT_EXPORT_VIEWS.includes(requestedView as AuditExportView)) {
    throw new AuditExportScopeError(`Unsupported audit export view: ${requestedView}`);
  }

  let from = parseBoundary(raw.from ?? raw.dateFrom, "from");
  const to = parseBoundary(raw.to ?? raw.dateTo, "to");
  const timeRange = firstString(raw.timeRange);
  if (!from && timeRange && timeRange !== "all") {
    const duration = timeRange === "24h" ? 24 * 60 * 60_000 : timeRange === "7d" ? 7 * 24 * 60 * 60_000 : null;
    if (duration === null) throw new AuditExportScopeError(`Unsupported audit export time range: ${timeRange}`);
    from = new Date(now.getTime() - duration).toISOString();
  }
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new AuditExportScopeError("from must be earlier than or equal to to");
  }
  if (raw.includeRoutine !== undefined && typeof raw.includeRoutine !== "boolean") {
    throw new AuditExportScopeError("includeRoutine must be a boolean");
  }

  return {
    view: requestedView as AuditExportView,
    query: firstString(raw.query, raw.search) ?? "",
    from,
    to,
    categories: stringsFrom(raw.categories, raw.category, raw.domains, raw.domain),
    severities: stringsFrom(raw.severities, raw.severity),
    statuses: stringsFrom(raw.statuses, raw.status, raw.outcomes, raw.outcome),
    eventTypes: stringsFrom(raw.eventTypes, raw.eventType),
    actors: stringsFrom(raw.actors, raw.actor),
    sourceSystems: stringsFrom(raw.sourceSystems, raw.sourceSystem),
    correlationIds: stringsFrom(raw.correlationIds, raw.correlationId),
    eventIds: stringsFrom(raw.eventIds, raw.eventId),
    includeRoutine: typeof raw.includeRoutine === "boolean" ? raw.includeRoutine : requestedView !== "significant"
  };
}

function normalised(values: string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

function isRoutineEvent(event: AuditEvent): boolean {
  return event.category === "Warehouse" && event.eventType === "RFID scan";
}

function sourceSystemFor(event: AuditEvent): string {
  const metadata = event.metadata as {
    sourceSystem?: unknown;
    operationalEvent?: { sourceSystem?: unknown };
    operationalIssue?: { sourceType?: unknown };
  };
  const source = metadata.sourceSystem ?? metadata.operationalEvent?.sourceSystem ?? metadata.operationalIssue?.sourceType;
  return typeof source === "string" ? source : event.actor;
}

function matchesView(event: AuditEvent, view: AuditExportView, includeRoutine: boolean): boolean {
  if (!includeRoutine && isRoutineEvent(event)) return false;
  if (view === "significant") return includeRoutine || !isRoutineEvent(event);
  if (view === "issue_lifecycle") return event.eventType.startsWith("Issue ");
  if (view === "inventory") return event.category === "Inventory";
  if (view === "cold_chain") return event.category === "Cold Chain";
  if (view === "logistics") return event.category === "Logistics";
  if (view === "warehouse") return event.category === "Warehouse";
  if (view === "ai_decisions") return event.category === "AI Decision";
  if (view === "pending") return event.status.toLowerCase() === "pending";
  return true;
}

export function operationalIssueAsAuditEvent(issue: OperationalIssue): AuditEvent {
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

/** Returns the exact ledger rows represented by an Audit export scope. */
export function filterAuditEventsForExport(
  events: AuditEvent[],
  issues: OperationalIssue[],
  scope: AuditExportScope
): AuditEvent[] {
  const base = scope.view === "action_required" ? issues.map(operationalIssueAsAuditEvent) : events;
  const categories = normalised(scope.categories);
  const severities = normalised(scope.severities);
  const statuses = normalised(scope.statuses);
  const eventTypes = normalised(scope.eventTypes);
  const actors = normalised(scope.actors);
  const sourceSystems = normalised(scope.sourceSystems);
  const correlationIds = normalised(scope.correlationIds);
  const eventIds = normalised(scope.eventIds);
  const query = scope.query.toLowerCase();
  const fromMs = scope.from ? Date.parse(scope.from) : null;
  const toMs = scope.to ? Date.parse(scope.to) : null;

  return base.filter((event) => {
    if (!matchesView(event, scope.view, scope.includeRoutine)) return false;
    const timestamp = Date.parse(event.timestamp);
    if (fromMs !== null && timestamp < fromMs) return false;
    if (toMs !== null && timestamp > toMs) return false;
    if (categories.size && !categories.has(event.category.toLowerCase())) return false;
    if (severities.size && !severities.has(event.severity.toLowerCase())) return false;
    if (statuses.size && !statuses.has(event.status.toLowerCase())) return false;
    if (eventTypes.size && !eventTypes.has(event.eventType.toLowerCase())) return false;
    if (actors.size && !actors.has(event.actor.toLowerCase())) return false;
    if (sourceSystems.size && !sourceSystems.has(sourceSystemFor(event).toLowerCase())) return false;
    if (correlationIds.size && !correlationIds.has(String(event.correlationId ?? "").toLowerCase())) return false;
    if (eventIds.size && !eventIds.has(event.id.toLowerCase())) return false;
    if (!query) return true;
    return [
      event.id,
      event.title,
      event.detail,
      event.actor,
      event.category,
      event.eventType,
      event.status,
      event.severity,
      event.correlationId,
      sourceSystemFor(event),
      ...event.affectedIds
    ].some((value) => String(value ?? "").toLowerCase().includes(query));
  }).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
