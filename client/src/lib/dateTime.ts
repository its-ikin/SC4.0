import { INVENTORY_POLICY } from "./inventoryPolicy";

export type ExpiryState = "normal" | "expiring" | "critical" | "expired" | "missing";

function parsed(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDayNumber(date: Date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

export function formatLocalDate(value: string | null | undefined) {
  const date = parsed(value);
  return date ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "No date";
}

export function formatLocalDateTime(value: string | null | undefined) {
  const date = parsed(value);
  return date
    ? date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })
    : "Not recorded";
}

export function calendarDaysBetween(value: string | null | undefined, now = new Date()) {
  const date = parsed(value);
  return date ? localDayNumber(date) - localDayNumber(now) : null;
}

export function expiryPresentation(value: string | null | undefined, now = new Date()) {
  const days = calendarDaysBetween(value, now);
  if (days === null) return { days: null, label: "No expiry date", state: "missing" as ExpiryState };
  if (days < 0) return { days, label: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`, state: "expired" as ExpiryState };
  if (days === 0) return { days, label: "Expires today", state: "critical" as ExpiryState };
  return {
    days,
    label: `${days} day${days === 1 ? "" : "s"} remaining`,
    state: days <= INVENTORY_POLICY.expiryCriticalDays ? "critical" as ExpiryState : days <= INVENTORY_POLICY.expiryWarningDays ? "expiring" as ExpiryState : "normal" as ExpiryState
  };
}

export function elapsedPresentation(value: string | null | undefined, now = new Date()) {
  const date = parsed(value);
  if (!date) return "Not recorded";
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function liveElapsedPresentation(value: string | null | undefined, now = new Date()) {
  const date = parsed(value);
  if (!date) return "Not recorded";
  const totalSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor(totalSeconds % 86_400 / 3_600);
  const minutes = Math.floor(totalSeconds % 3_600 / 60);
  const seconds = totalSeconds % 60;
  if (days) return `${days}d ${hours}h ${minutes}m ${seconds}s ago`;
  if (hours) return `${hours}h ${minutes}m ${seconds}s ago`;
  if (minutes) return `${minutes}m ${seconds}s ago`;
  return `${seconds}s ago`;
}

export function dwellDays(value: string | null | undefined, now = new Date()) {
  const date = parsed(value);
  return date ? Math.max(0, localDayNumber(now) - localDayNumber(date)) : null;
}

export function rawTime(value: string | null | undefined) {
  return parsed(value)?.getTime() ?? Number.POSITIVE_INFINITY;
}
