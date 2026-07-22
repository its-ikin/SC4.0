import { useEffect, useState } from "react";
import { AlertTriangle, Info, X, XCircle } from "lucide-react";
import clsx from "clsx";
import type { Alert } from "@twinops/shared";
import { useAppStore } from "../store";
import { StatusChip, toneForSeverity, toneTextClass } from "./ui";

const AUTO_DISMISS_MS = 8000;
const EXIT_DURATION_MS = 200;

function severityIcon(severity: Alert["severity"]) {
  if (severity === "critical") return XCircle;
  if (severity === "warn") return AlertTriangle;
  return Info;
}

/** Plain CSS transitions instead of framer-motion's AnimatePresence: when a single alert-check
 * tick creates several alerts at once (common — one 30s tick can fire up to 5-6), all their
 * toasts mount in the same React commit. AnimatePresence only reliably plays the entrance
 * transition for the first child in a batched multi-mount; the rest get stuck at their `initial`
 * state (opacity 0, never animated in) instead of a merely-late animation. Each toast driving its
 * own `visible` flag via `requestAnimationFrame` has no such shared-orchestration failure mode. */
function ToastCard({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    const dismissTimer = setTimeout(() => setClosing(true), AUTO_DISMISS_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(dismissTimer);
    };
  }, []);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(onDismiss, EXIT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [closing, onDismiss]);

  const tone = toneForSeverity(alert.severity);
  const Icon = severityIcon(alert.severity);

  return (
    <div
      className={clsx(
        "pointer-events-auto w-full max-w-sm rounded-2xl border border-twin-border/80 bg-white/95 p-3 shadow-lg backdrop-blur-sm transition-all ease-out",
        visible && !closing ? "translate-x-0 scale-100 opacity-100 duration-300" : "translate-x-10 scale-95 opacity-0 duration-200"
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon size={17} className={clsx("mt-0.5 shrink-0", toneTextClass[tone])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">{alert.sourceAgent}</span>
              <StatusChip tone={tone}>{alert.severity}</StatusChip>
            </div>
            <button className="shrink-0 rounded-lg p-1 text-twin-muted transition hover:text-twin-text" onClick={() => setClosing(true)} aria-label="Dismiss notification">
              <X size={13} />
            </button>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-twin-text">{alert.message}</p>
        </div>
      </div>
    </div>
  );
}

export default function ToastStack() {
  const toasts = useAppStore((state) => state.toasts);
  const dismissToast = useAppStore((state) => state.dismissToast);

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((alert) => (
        <ToastCard key={alert.id} alert={alert} onDismiss={() => dismissToast(alert.id)} />
      ))}
    </div>
  );
}
