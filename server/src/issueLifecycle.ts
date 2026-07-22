import { buildOperationalIssues } from "@twinops/shared";
import type {
  IssueLifecycleEventType,
  OperationalIssue,
  OperationalIssueLifecycleEvent,
  WarehouseSnapshot
} from "@twinops/shared";
import { db, getWarehouseSnapshot, nowIso } from "./db/database";

type IssueRow = {
  issue_id: string;
  lifecycle_status: "active" | "resolved";
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  revision: number;
  current_issue_json: string;
};

function parseIssue(value: string | null): OperationalIssue | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as OperationalIssue;
  } catch {
    return null;
  }
}

function materialIssue(issue: OperationalIssue) {
  const { openedAt: _openedAt, ...material } = issue;
  return material;
}

function issueChanged(previous: OperationalIssue, current: OperationalIssue) {
  return JSON.stringify(materialIssue(previous)) !== JSON.stringify(materialIssue(current));
}

function transitionType(previous: OperationalIssue, current: OperationalIssue): IssueLifecycleEventType {
  if (previous.priority !== current.priority || previous.importance !== current.importance || previous.urgency !== current.urgency) return "reclassified";
  if (previous.status !== current.status) return "status_changed";
  return "updated";
}

function transitionReason(eventType: IssueLifecycleEventType, previous: OperationalIssue | null, current: OperationalIssue | null) {
  if (eventType === "opened") return `Issue detected. ${current?.classificationReason ?? ""}`.trim();
  if (eventType === "reopened") return `Previously resolved issue became active again. ${current?.classificationReason ?? ""}`.trim();
  if (eventType === "resolved") return "The triggering condition is no longer present in the current warehouse state.";
  if (eventType === "reclassified") return `Priority changed from ${previous?.priority.replaceAll("_", " ")} to ${current?.priority.replaceAll("_", " ")}. ${current?.classificationReason ?? ""}`.trim();
  if (eventType === "status_changed") return `Issue status changed from ${previous?.status.replaceAll("_", " ")} to ${current?.status.replaceAll("_", " ")}.`;
  return `Issue details changed while remaining ${current?.priority.replaceAll("_", " ")}.`;
}

function eventId(issueId: string, revision: number, eventType: IssueLifecycleEventType) {
  return `ISSUE-EVENT:${issueId}:${revision}:${eventType}`;
}

function insertLifecycleEvent(
  issueId: string,
  revision: number,
  eventType: IssueLifecycleEventType,
  timestamp: string,
  previous: OperationalIssue | null,
  current: OperationalIssue | null
) {
  db.prepare(
    `INSERT INTO operational_issue_events
     (event_id, issue_id, event_type, timestamp, revision, previous_issue_json, current_issue_json, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId(issueId, revision, eventType),
    issueId,
    eventType,
    timestamp,
    revision,
    previous ? JSON.stringify(previous) : null,
    current ? JSON.stringify(current) : null,
    transitionReason(eventType, previous, current)
  );
}

/** Reconciles calculated current issues into durable state plus append-only transition events. */
export function reconcileOperationalIssues(snapshot: WarehouseSnapshot = getWarehouseSnapshot()) {
  const calculated = buildOperationalIssues(snapshot);
  const timestamp = nowIso();
  let began = false;
  let eventsWritten = 0;

  try {
    db.exec("BEGIN IMMEDIATE");
    began = true;
    const rows = db.prepare("SELECT * FROM operational_issues").all() as unknown as IssueRow[];
    const existing = new Map(rows.map((row) => [row.issue_id, row]));
    const activeIds = new Set(calculated.map((issue) => issue.id));

    calculated.forEach((calculatedIssue) => {
      const row = existing.get(calculatedIssue.id);
      if (!row) {
        const issue = { ...calculatedIssue, openedAt: calculatedIssue.openedAt || timestamp };
        db.prepare(
          `INSERT INTO operational_issues
           (issue_id, lifecycle_status, first_seen_at, last_seen_at, resolved_at, revision, current_issue_json)
           VALUES (?, 'active', ?, ?, NULL, 1, ?)`
        ).run(issue.id, timestamp, timestamp, JSON.stringify(issue));
        insertLifecycleEvent(issue.id, 1, "opened", timestamp, null, issue);
        eventsWritten += 1;
        return;
      }

      const previous = parseIssue(row.current_issue_json);
      const revision = row.revision + 1;
      const current = {
        ...calculatedIssue,
        openedAt: row.lifecycle_status === "active" && previous ? previous.openedAt : calculatedIssue.openedAt || timestamp
      };

      if (row.lifecycle_status === "resolved") {
        db.prepare(
          `UPDATE operational_issues
           SET lifecycle_status = 'active', last_seen_at = ?, resolved_at = NULL, revision = ?, current_issue_json = ?
           WHERE issue_id = ?`
        ).run(timestamp, revision, JSON.stringify(current), current.id);
        insertLifecycleEvent(current.id, revision, "reopened", timestamp, previous, current);
        eventsWritten += 1;
        return;
      }

      if (previous && issueChanged(previous, current)) {
        const eventType = transitionType(previous, current);
        db.prepare(
          `UPDATE operational_issues SET last_seen_at = ?, revision = ?, current_issue_json = ? WHERE issue_id = ?`
        ).run(timestamp, revision, JSON.stringify(current), current.id);
        insertLifecycleEvent(current.id, revision, eventType, timestamp, previous, current);
        eventsWritten += 1;
        return;
      }

      db.prepare("UPDATE operational_issues SET last_seen_at = ? WHERE issue_id = ?").run(timestamp, current.id);
    });

    rows
      .filter((row) => row.lifecycle_status === "active" && !activeIds.has(row.issue_id))
      .forEach((row) => {
        const previous = parseIssue(row.current_issue_json);
        const revision = row.revision + 1;
        db.prepare(
          `UPDATE operational_issues
           SET lifecycle_status = 'resolved', last_seen_at = ?, resolved_at = ?, revision = ?
           WHERE issue_id = ?`
        ).run(timestamp, timestamp, revision, row.issue_id);
        insertLifecycleEvent(row.issue_id, revision, "resolved", timestamp, previous, null);
        eventsWritten += 1;
      });

    db.exec("COMMIT");
    began = false;
    return { eventsWritten, activeIssues: getActiveOperationalIssues() };
  } catch (error) {
    if (began) db.exec("ROLLBACK");
    throw error;
  }
}

export function getActiveOperationalIssues(): OperationalIssue[] {
  const priorityRank = { act_now: 0, plan: 1, review: 2, monitor: 3 } as const;
  return (db.prepare("SELECT current_issue_json FROM operational_issues WHERE lifecycle_status = 'active'").all() as unknown as Array<{ current_issue_json: string }>)
    .map((row) => parseIssue(row.current_issue_json))
    .filter((issue): issue is OperationalIssue => Boolean(issue))
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
}

export function getOperationalIssueLifecycleEvents(limit = 2000): OperationalIssueLifecycleEvent[] {
  return (db.prepare("SELECT * FROM operational_issue_events ORDER BY datetime(timestamp) DESC, revision DESC LIMIT ?").all(limit) as unknown as any[])
    .map((row) => ({
      eventId: row.event_id,
      issueId: row.issue_id,
      eventType: row.event_type,
      timestamp: row.timestamp,
      revision: row.revision,
      previousIssue: parseIssue(row.previous_issue_json),
      currentIssue: parseIssue(row.current_issue_json),
      reason: row.reason
    }));
}
