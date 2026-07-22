import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { animate } from "framer-motion";
import clsx from "clsx";
import type { Alert, RiskLevel, Severity } from "@twinops/shared";

const GLOSSARY: Record<string, string> = {
  fefo: "First-Expired-First-Out: dispatch the soonest-to-expire stock first.",
  "qa hold": "Quality Assurance Hold: stock paused pending a quality check, not available to ship.",
  sku: "Stock Keeping Unit: the product-level code used across all batches and warehouse locations.",
  quarantine: "Isolated stock under investigation, not available for use.",
  "cold chain": "Temperature-controlled handling required to keep sensitive products safe.",
  "cold-chain": "Temperature-controlled handling required to keep sensitive products safe.",
  asn: "Advance Shipment Notice: a heads-up that a shipment is on its way before it arrives.",
  eta: "Estimated Time of Arrival.",
  excursion: "A temporary temperature reading outside the allowed safe range.",
  "non-conformance": "A recorded quality or compliance issue that breaks a defined rule.",
  dispatch: "The stage where an order physically leaves the warehouse.",
  dock: "A physical bay where trucks load or unload shipments.",
  batch: "A specific manufactured group of product sharing the same expiry and quality status.",
  lot: "A specific manufactured group of product sharing the same expiry and quality status."
};

const GLOSSARY_PATTERN = new RegExp(`\\b(${Object.keys(GLOSSARY).sort((a, b) => b.length - a.length).join("|")})\\b`, "gi");

/** Renders text with recognized supply-chain jargon underlined and given a native tooltip definition. */
export function GlossaryText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(GLOSSARY_PATTERN);
  return (
    <span className={className}>
      {parts.map((part, index) => {
        const definition = GLOSSARY[part.toLowerCase()];
        if (!definition) return <span key={index}>{part}</span>;
        return (
          <abbr key={index} title={definition} className="cursor-help decoration-dotted underline decoration-twin-cyan/60 underline-offset-2">
            {part}
          </abbr>
        );
      })}
    </span>
  );
}

/** Returns true for a brief window after targetId first becomes set (or changes), then auto-clears.
 * Used for "jump here and briefly highlight it" navigation, decoupled from any persistent selection
 * state so the visual glow fades even though the underlying selection stays active. */
export function useFlashHighlight(targetId: string | null, durationMs = 2200) {
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!targetId) return;
    setFlashing(true);
    const timeout = setTimeout(() => setFlashing(false), durationMs);
    return () => clearTimeout(timeout);
  }, [targetId, durationMs]);
  return flashing;
}

export function CountUp({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const previousValue = useRef(0);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const controls = animate(previousValue.current, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate(latest) {
        node.textContent = `${Math.round(latest).toLocaleString()}${suffix}`;
      }
    });
    previousValue.current = value;
    return () => controls.stop();
  }, [value, suffix]);

  return (
    <span ref={nodeRef} className={clsx("tabular-nums", className)}>
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}

export type Tone = "neutral" | "brand" | "focus" | "healthy" | "warning" | "critical";

const chipTone: Record<Tone, string> = {
  neutral: "border-twin-border/80 bg-white/70 text-twin-muted",
  brand: "border-twin-orange/25 bg-twin-orange/10 text-twin-orange",
  focus: "border-twin-cyan/25 bg-twin-cyan/10 text-twin-blue",
  healthy: "border-twin-green/25 bg-twin-green/10 text-twin-green",
  warning: "border-twin-warning/30 bg-twin-warning/10 text-twin-warning",
  critical: "border-twin-critical/30 bg-twin-critical/10 text-twin-critical"
};

const textTone: Record<Tone, string> = {
  neutral: "text-slate-300",
  brand: "text-twin-orange",
  focus: "text-twin-cyan",
  healthy: "text-twin-green",
  warning: "text-twin-warning",
  critical: "text-twin-critical"
};

export function LiveBadge({ label = "LIVE" }: { label?: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-twin-green/30 bg-twin-green/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-twin-green">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-twin-green opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-twin-green" />
      </span>
      {label}
    </span>
  );
}

export function toneForSeverity(severity?: Severity): Tone {
  if (severity === "critical") return "critical";
  if (severity === "warn") return "warning";
  return "focus";
}

export function toneForRisk(risk?: RiskLevel | string | null): Tone {
  if (risk === "critical" || risk === "high") return "critical";
  if (risk === "medium") return "warning";
  if (risk === "low") return "healthy";
  return "neutral";
}

export function confidenceTone(score: number): Tone {
  if (score >= 80) return "healthy";
  if (score >= 60) return "warning";
  return "critical";
}

export function StatusChip({
  children,
  tone = "neutral",
  className
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span className={clsx("inline-flex items-center rounded-xl border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide", chipTone[tone], className)}>
      {children}
    </span>
  );
}

export function FilterChip({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={clsx(
        "rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
        active ? "border-twin-cyan/40 bg-twin-cyan/10 text-twin-blue shadow-sm" : "border-twin-border/80 bg-white/60 text-twin-muted hover:border-twin-blue/50 hover:bg-twin-blue/5 hover:text-twin-text"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  actions,
  className
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-wrap items-start justify-between gap-3", className)}>
      <div>
        <div className="section-label">{eyebrow}</div>
        <h2 className="mt-1 text-xl font-semibold leading-tight tracking-tight text-twin-text">{title}</h2>
        {subtitle && <p className="mt-1 text-sm leading-relaxed text-twin-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {Icon && (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-twin-border/80 bg-white/70 text-twin-blue">
            <Icon size={18} />
          </span>
        )}
      </div>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  subtitle,
  icon: Icon,
  tone = "neutral",
  trend
}: {
  label: string;
  value: ReactNode;
  subtitle?: string;
  icon: LucideIcon;
  tone?: Tone;
  trend?: string;
}) {
  return (
    <div className="panel-card group p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase leading-tight tracking-wide text-twin-muted">{label}</div>
          <div className="mt-2 text-3xl font-semibold leading-none tracking-tight text-twin-text">{value}</div>
        </div>
        <span className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border bg-white/70", chipTone[tone], textTone[tone])}>
          <Icon size={17} />
        </span>
      </div>
      {(subtitle || trend) && <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        {subtitle && <span className="leading-tight text-twin-muted">{subtitle}</span>}
        {trend && <span className="rounded-xl border border-twin-border/70 bg-white/70 px-2 py-0.5 text-[10px] text-twin-muted">{trend}</span>}
      </div>}
    </div>
  );
}

export function PanelCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("panel-card", className)}>{children}</div>;
}

export type WorkspaceNavItem<T extends string> = {
  id: T;
  label: string;
  detail: ReactNode;
  icon: LucideIcon;
};

export function WorkspaceNav<T extends string>({
  label,
  items,
  value,
  onChange
}: {
  label: string;
  items: Array<WorkspaceNavItem<T>>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <nav className="workspace-nav" aria-label={label}>
      {items.map(({ id, label: itemLabel, detail, icon: Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            className={clsx("workspace-nav-item", active && "workspace-nav-item--active")}
            onClick={() => onChange(id)}
            aria-label={itemLabel}
            aria-pressed={active}
          >
            <span className="workspace-nav-icon" aria-hidden="true"><Icon size={16} /></span>
            <span className="min-w-0">
              <span className="workspace-nav-label">{itemLabel}</span>
              <span className="workspace-nav-detail">{detail}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function CompactMetricCard({
  label,
  value,
  detail,
  tone = "neutral",
  onClick
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="compact-metric-heading">
        <span>{label}</span>
        <span className="compact-metric-dot" aria-hidden="true" />
      </div>
      <div className="compact-metric-value">{value}</div>
      {detail && <div className="compact-metric-detail">{detail}</div>}
    </>
  );

  const className = clsx(
    "compact-metric-card",
    `compact-metric-card--${tone}`,
    onClick && "compact-metric-card--interactive"
  );

  if (onClick) {
    return <button className={className} onClick={onClick}>{content}</button>;
  }
  return <div className={className}>{content}</div>;
}

export type GroupedAlert = {
  alert: Alert;
  count: number;
  latestAt: number;
};

export function groupAlerts(alerts: Alert[]): GroupedAlert[] {
  const map = new Map<string, GroupedAlert>();
  alerts.forEach((alert) => {
    const key = `${alert.severity}|${alert.sourceAgent}|${alert.message}`;
    const latestAt = new Date(alert.timestamp).getTime();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { alert, count: 1, latestAt });
      return;
    }
    existing.count += 1;
    if (latestAt > existing.latestAt) {
      existing.alert = alert;
      existing.latestAt = latestAt;
    }
  });
  return [...map.values()].sort((a, b) => b.latestAt - a.latestAt);
}

export function AlertCard({
  alert,
  count = 1,
  compact = false,
  actions
}: {
  alert: Alert;
  count?: number;
  compact?: boolean;
  actions?: ReactNode;
}) {
  const tone = toneForSeverity(alert.severity);
  const Icon = alert.severity === "critical" ? XCircle : alert.severity === "warn" ? AlertTriangle : Info;
  return (
    <div className={clsx("rounded-2xl border bg-white/75 shadow-sm", compact ? "p-3" : "p-4", chipTone[tone])}>
      <div className="flex items-start gap-3">
        <Icon size={17} className={clsx("mt-0.5 shrink-0", textTone[tone])} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-twin-muted">{alert.sourceAgent}</span>
            <StatusChip tone={tone}>{alert.severity}</StatusChip>
            {count > 1 && <StatusChip tone="neutral">Repeated {count}x</StatusChip>}
          </div>
          <p className={clsx("mt-2 leading-relaxed text-twin-text", compact ? "text-xs" : "text-sm")}>{alert.message}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-twin-muted">
            <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}

export const toneTextClass = textTone;
