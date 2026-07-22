import { BellRing, Bot, Boxes, ClipboardList, LayoutDashboard, MessageSquare, Radar, Route, Warehouse } from "lucide-react";
import clsx from "clsx";
import { buildOperationalIssues } from "@twinops/shared";
import { useAppStore, type ViewKey } from "../store";

const nav: Array<{ key: ViewKey; label: string; icon: typeof Warehouse }> = [
  { key: "Dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "Warehouse", label: "Warehouse", icon: Warehouse },
  { key: "Inventory", label: "Inventory", icon: Boxes },
  { key: "Logistics", label: "Logistics", icon: Route },
  { key: "Monitoring", label: "Monitoring", icon: Radar },
  { key: "Audit", label: "Audit", icon: ClipboardList }
];

export default function Sidebar() {
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const setChatOpen = useAppStore((state) => state.setChatOpen);
  const openAlertsPage = useAppStore((state) => state.openAlertsPage);
  const snapshot = useAppStore((state) => state.snapshot);
  const openAlertCount = snapshot ? (snapshot.operationalIssues ?? buildOperationalIssues(snapshot)).length : 0;

  return (
    <aside className="panel flex max-h-[230px] w-full shrink-0 flex-col overflow-auto border-b border-twin-border/80 px-4 py-5 lg:max-h-none lg:w-[220px] lg:border-b-0 lg:border-r">
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-twin-cyan/25 bg-twin-cyan/10 text-twin-blue">
            <Bot size={19} />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight tracking-tight">TwinOps Control</h1>
            <p className="mt-0.5 text-[11px] leading-snug text-twin-muted">Pharma operations</p>
          </div>
        </div>
      </div>

      <nav className="mt-5 grid grid-cols-2 gap-1.5 lg:mt-9 lg:block lg:space-y-2">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={clsx(
                "relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition",
                view === item.key ? "border border-twin-cyan/20 bg-twin-cyan/10 text-twin-blue shadow-sm" : "text-twin-muted hover:bg-white/70 hover:text-twin-text"
              )}
              onClick={() => setView(item.key)}
            >
              <span className={clsx("absolute left-0 h-6 w-1 rounded-r-full bg-twin-cyan transition", view === item.key ? "opacity-100" : "opacity-0")} />
              <Icon size={17} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-4 space-y-2 lg:mt-auto">
        <button
          className={clsx("flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition", view === "Alerts" ? "border-twin-cyan/30 bg-twin-cyan/10 text-twin-blue shadow-sm" : "border-twin-border/70 bg-white/80 text-twin-muted hover:border-twin-blue/40 hover:bg-twin-blue/5 hover:text-twin-text")}
          onClick={() => openAlertsPage()}
        >
          <BellRing size={15} />
          <span>Alerts</span>
          {openAlertCount > 0 && <span className="ml-auto min-w-6 rounded-full bg-red-50 px-1.5 py-0.5 text-center text-[10px] font-bold tabular-nums text-red-600">{openAlertCount}</span>}
        </button>
        <button
          className="flex w-full items-center gap-2 rounded-xl border border-twin-border/70 bg-white/80 px-3 py-2.5 text-left text-sm text-twin-muted transition hover:bg-white/80 hover:text-twin-text"
          onClick={() => setChatOpen(true)}
        >
          <MessageSquare size={15} />
          Assistant
        </button>
      </div>
    </aside>
  );
}
