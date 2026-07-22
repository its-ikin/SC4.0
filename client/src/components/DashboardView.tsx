import { useEffect, useState } from "react";
import {
  CloudDrizzle,
  CloudLightning,
  CloudRain,
  Cloudy,
  ClipboardList,
  ArrowUpRight,
  CalendarClock,
  CircleDot,
  Eye,
  ExternalLink,
  PackageSearch,
  Radar,
  Route,
  ShieldAlert,
  Siren,
  Snowflake,
  Sun,
  Truck,
  Warehouse
} from "lucide-react";
import { motion } from "framer-motion";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import clsx from "clsx";
import { buildOperationalIssues, type AlertPriority, type OperationalIssue, type WarehouseSnapshot, type Zone } from "@twinops/shared";
import { getWeather, type LiveWeather } from "../api";
import { useAppStore } from "../store";
import { formatLocalDateTime } from "../lib/dateTime";
import { CountUp, StatusChip, type Tone } from "./ui";

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: index * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }
  })
};

function latestReadingTime(snapshot: WarehouseSnapshot) {
  const latest = [...snapshot.temperatureReadings]
    .filter((reading) => Number.isFinite(new Date(reading.timestamp).getTime()))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
  return latest ? formatLocalDateTime(latest.timestamp) : "Not recorded";
}

function SummaryCard({
  index,
  label,
  value,
  suffix = "",
  secondary,
  icon: Icon,
  tone,
  onOpen
}: {
  index: number;
  label: string;
  value: number;
  suffix?: string;
  secondary: string;
  icon: typeof Warehouse;
  tone?: Tone;
  onOpen: () => void;
}) {
  return (
    <motion.button
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      className="panel-card group flex min-h-[132px] flex-col justify-between p-4 text-left hover:border-twin-blue/50 hover:bg-twin-blue/5 hover:shadow-card"
      onClick={onOpen}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-twin-muted">{label}</span>
        <Icon size={17} className={clsx(tone === "critical" ? "text-twin-critical" : tone === "warning" ? "text-twin-warning" : "text-twin-blue")} />
      </div>
      <div>
        <div className="text-3xl font-semibold tracking-tight text-twin-text">
          <CountUp value={value} suffix={suffix} />
        </div>
        <div className="mt-1 text-sm text-twin-muted">{secondary}</div>
      </div>
    </motion.button>
  );
}

function weatherIcon(weatherCode: number) {
  if (weatherCode >= 95) return CloudLightning;
  if (weatherCode >= 61) return CloudRain;
  if (weatherCode >= 51) return CloudDrizzle;
  if (weatherCode >= 2) return Cloudy;
  return Sun;
}

export function LiveWeatherWidget({ location }: { location: string }) {
  const [state, setState] = useState<{ loading: boolean; weather: LiveWeather; error: boolean }>({
    loading: true,
    weather: null,
    error: false
  });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getWeather()
        .then((result) => {
          if (!cancelled) setState({ loading: false, weather: result.weather, error: false });
        })
        .catch(() => {
          if (!cancelled) setState({ loading: false, weather: null, error: true });
        });
    };
    load();
    const interval = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (state.loading) {
    return (
      <div className="panel-card flex items-center gap-3 px-4 py-3 text-sm text-twin-muted">
        <Cloudy size={18} className="animate-pulse text-twin-muted" />
        Loading live weather...
      </div>
    );
  }

  if (state.error || !state.weather) {
    return (
      <div className="panel-card flex items-center gap-3 px-4 py-3 text-sm text-twin-muted">
        <Cloudy size={18} />
        Live weather unavailable; route disruptions use simulated conditions only.
      </div>
    );
  }

  const weather = state.weather;
  const Icon = weatherIcon(weather.weatherCode);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="panel-card flex flex-wrap items-center gap-4 px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <Icon size={22} className={clsx(weather.isActiveDisruption ? "text-twin-warning" : "text-twin-cyan")} />
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-twin-muted">Live Weather · {location}</div>
          <div className="text-sm font-semibold text-twin-text">{weather.condition}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm text-twin-muted">
        <span className="tabular-nums">{weather.temperatureC.toFixed(1)}°C</span>
        <span className="tabular-nums">{weather.precipitationMm.toFixed(1)} mm rain</span>
        <span className="tabular-nums">{weather.windSpeedKph.toFixed(0)} km/h wind</span>
        {weather.isActiveDisruption && <StatusChip tone="warning">Active disruption risk</StatusChip>}
      </div>
    </motion.div>
  );
}

function zoneIcon(zone: Zone) {
  const name = zone.name.toLowerCase();
  if (name.includes("cold")) return Snowflake;
  if (name.includes("qa") || name.includes("quarantine")) return ShieldAlert;
  if (name.includes("dispatch")) return Truck;
  if (name.includes("receiv")) return PackageSearch;
  return Warehouse;
}

function zoneHealthDotClass(zone: Zone) {
  if (zone.status === "critical") return "bg-twin-critical";
  if (zone.status === "warn") return "bg-twin-warning";
  return "bg-twin-green";
}

function ZoneStatusCard({ zone, active, onClick }: { zone: Zone; active: boolean; onClick: () => void }) {
  const Icon = zoneIcon(zone);
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex w-[200px] shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition",
        active
          ? "border-twin-cyan/50 bg-twin-cyan/10 shadow-sm"
          : "border-twin-border/70 bg-white/90 hover:border-twin-blue/50 hover:bg-twin-blue/5"
      )}
    >
      <Icon size={16} className={active ? "text-twin-blue" : "text-twin-muted"} />
      <div className="min-w-0 flex-1">
        <div className="whitespace-nowrap text-[11px] font-semibold text-twin-text">{zone.name}</div>
        <div className="text-[10px] text-twin-muted tabular-nums">{zone.currentTemperature.toFixed(1)}°C</div>
      </div>
      <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", zoneHealthDotClass(zone))} />
    </button>
  );
}

function ColdChainTrend({ snapshot }: { snapshot: WarehouseSnapshot }) {
  const defaultZoneId = (snapshot.zones.find((zone) => zone.name.toLowerCase().includes("cold")) ?? snapshot.zones[0])?.id;
  const [selectedZoneId, setSelectedZoneId] = useState(defaultZoneId);
  const zone = snapshot.zones.find((candidate) => candidate.id === selectedZoneId) ?? snapshot.zones[0];
  const readings = snapshot.temperatureReadings
    .filter((reading) => !zone || reading.zoneId === zone.id)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-24)
    .map((reading) => ({
      time: new Date(reading.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      temperature: reading.temperature
    }));

  if (!zone) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="panel shrink-0 rounded-2xl p-4"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-twin-text">{zone.name} Temperature Trend</h2>
        <StatusChip tone={zone.status === "critical" ? "critical" : zone.status === "warn" ? "warning" : "healthy"}>
          {zone.currentTemperature.toFixed(1)}°C now
        </StatusChip>
      </div>
      <div className="scroll-optimized mb-3 overflow-x-auto pb-1">
        <div className="flex min-w-max gap-2">
          {snapshot.zones.map((candidate) => (
            <ZoneStatusCard
              key={candidate.id}
              zone={candidate}
              active={candidate.id === zone.id}
              onClick={() => setSelectedZoneId(candidate.id)}
            />
          ))}
        </div>
      </div>
      {readings.length < 2 ? (
        <div className="flex h-32 items-center justify-center text-sm text-twin-muted">Not enough readings yet for {zone.name}.</div>
      ) : (
      <div className="h-32 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={readings} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="coldChainGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
              domain={["dataMin - 0.2", "dataMax + 0.2"]}
              tickFormatter={(value: number) => value.toFixed(1)}
              tickCount={4}
              width={40}
            />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: "1px solid var(--border-soft)", fontSize: 12 }}
              formatter={(value: number) => [`${value.toFixed(1)} C`, "Temperature"]}
            />
            <Area type="monotone" dataKey="temperature" stroke="var(--accent-cyan)" strokeWidth={2} fill="url(#coldChainGradient)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      )}
    </motion.section>
  );
}

const alertQuadrants: Array<{
  key: AlertPriority;
  label: string;
  context: string;
  action: string;
  description: string;
  icon: typeof Siren;
  className: string;
  iconClassName: string;
}> = [
  { key: "act_now", label: "Act Now", context: "Important + urgent", action: "Do first", description: "Immediate intervention", icon: Siren, className: "border-red-200 bg-gradient-to-br from-red-50 to-white hover:border-red-300", iconClassName: "bg-red-100 text-red-600" },
  { key: "plan", label: "Plan", context: "Important + not urgent", action: "Schedule", description: "Protect time to resolve", icon: CalendarClock, className: "border-amber-200 bg-gradient-to-br from-amber-50 to-white hover:border-amber-300", iconClassName: "bg-amber-100 text-amber-700" },
  { key: "review", label: "Review", context: "Urgent + lower impact", action: "Assess", description: "Triage and delegate", icon: Eye, className: "border-blue-200 bg-gradient-to-br from-blue-50 to-white hover:border-blue-300", iconClassName: "bg-blue-100 text-blue-700" },
  { key: "monitor", label: "Monitor", context: "Lower impact + not urgent", action: "Watch", description: "Track for material change", icon: CircleDot, className: "border-cyan-200 bg-gradient-to-br from-cyan-50 to-white hover:border-cyan-300", iconClassName: "bg-cyan-100 text-cyan-700" }
];

function AlertPriorityMatrix({ items, onSelect }: { items: OperationalIssue[]; onSelect: (priority: AlertPriority) => void }) {
  return (
    <div className="rounded-2xl border border-twin-border/70 bg-white/80 p-2.5 shadow-inner">
      <div className="mb-2 grid grid-cols-[auto_1fr_1fr] items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-twin-muted">
        <span className="flex items-center gap-1 text-twin-text"><ArrowUpRight size={12} />Urgency</span>
        <span className="text-center">Urgent</span>
        <span className="text-center">Not urgent</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5" aria-label="Open alerts urgency and importance matrix">
        {alertQuadrants.map((quadrant) => {
          const count = items.filter((item) => item.priority === quadrant.key).length;
          const Icon = quadrant.icon;
          return (
            <button
              key={quadrant.key}
              className={clsx("group min-h-[124px] rounded-xl border p-3.5 text-left text-twin-text shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-twin-blue/50", quadrant.className)}
              onClick={() => onSelect(quadrant.key)}
            >
              <span className="flex items-start justify-between gap-3">
                <span className={clsx("flex h-9 w-9 items-center justify-center rounded-xl", quadrant.iconClassName)}><Icon size={17} /></span>
                <span className="flex min-w-8 items-center justify-center rounded-full border border-white bg-white/90 px-2 py-1 text-sm font-bold tabular-nums shadow-sm">{count}</span>
              </span>
              <span className="mt-3 block text-sm font-semibold">{quadrant.label} <span className="font-normal text-twin-muted">· {quadrant.action}</span></span>
              <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-twin-muted">{quadrant.context}</span>
              <span className="mt-2 flex items-center justify-between text-[11px] text-twin-muted">
                <span>{quadrant.description}</span>
                <ArrowUpRight size={14} className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardView() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const setView = useAppStore((state) => state.setView);
  const setChatOpen = useAppStore((state) => state.setChatOpen);
  const openInboundInLogistics = useAppStore((state) => state.openInboundInLogistics);
  const openOutboundInLogistics = useAppStore((state) => state.openOutboundInLogistics);
  const setInventoryWorkspace = useAppStore((state) => state.setInventoryWorkspace);
  const setLogisticsWorkspace = useAppStore((state) => state.setLogisticsWorkspace);
  const setInventoryQuickFilter = useAppStore((state) => state.setInventoryQuickFilter);
  const setLogisticsRouteFilter = useAppStore((state) => state.setLogisticsRouteFilter);
  const setAuditFilter = useAppStore((state) => state.setAuditFilter);
  const openAlertsPage = useAppStore((state) => state.openAlertsPage);
  const operationalIssues = snapshot.operationalIssues ?? buildOperationalIssues(snapshot);
  const criticalOperationalIssues = operationalIssues.filter((issue) => issue.severity === "critical").length;
  const totalLocationCapacity = snapshot.inventory.locations.reduce((sum, location) => sum + location.capacity, 0);
  const warehouseFill = totalLocationCapacity
    ? Math.round(snapshot.inventory.stockBalances.reduce((sum, balance) => sum + balance.qtyOnHand, 0) / totalLocationCapacity * 100)
    : 0;
  const coldZones = snapshot.zones.filter((zone) => zone.temperatureMax <= 8 || zone.name.toLowerCase().includes("cold")).length;
  const qaHoldCount = snapshot.inventoryPlacements.filter((sku) => sku.qualityStatus === "QA Hold").length;
  const quarantineCount = snapshot.inventoryPlacements.filter((sku) => sku.qualityStatus === "Quarantine").length;
  const pendingQaCount = snapshot.inventoryPlacements.filter((sku) => sku.qualityStatus === "Pending QA").length;
  const inventoryAttentionBatchIds = new Set<string>();
  const attentionCutoff = Date.now() + 7 * 24 * 60 * 60_000;
  const activeInboundAsnIds = new Set(snapshot.inventory.inboundShipments
    .filter((shipment) => !["Putaway Complete", "Closed"].includes(shipment.inboundStatus))
    .map((shipment) => shipment.asnId));
  snapshot.inventory.stockPositions.forEach((position) => {
    const inbound = snapshot.inventory.inboundLines
      .filter((line) => line.productId === position.product.productId && activeInboundAsnIds.has(line.asnId))
      .reduce((sum, line) => sum + Math.max(0, line.qtyExpected - line.qtyReceived), 0);
    const inventoryPosition = position.totalAvailable + inbound;
    const projectedAtLeadTime = inventoryPosition - position.product.averageDailyDemand * position.product.leadTimeDays;
    const replenishmentRequired = position.totalAvailable <= 0 || projectedAtLeadTime <= position.product.safetyStock || inventoryPosition <= position.product.reorderPoint;
    position.batches.forEach((batch) => {
      if (batch.qualityStatus !== "Released" || new Date(batch.expiryDate).getTime() <= attentionCutoff || replenishmentRequired) {
        inventoryAttentionBatchIds.add(batch.batchId);
      }
    });
  });
  const activeOutbound = snapshot.inventory.outboundShipments.filter((shipment) => !["Dispatched", "Delivered"].includes(shipment.outboundStatus));
  const stagedOutbound = activeOutbound.filter((shipment) => shipment.outboundStatus === "Staged").length;
  const pickingOutbound = activeOutbound.filter((shipment) => shipment.outboundStatus === "Picking").length;
  const blockedOutbound = activeOutbound.filter((shipment) => shipment.outboundStatus === "Blocked").length;
  const activeTemperatureEvents = snapshot.temperatureEvents.filter((event) => event.status === "Open");
  const activeNonConformances = activeTemperatureEvents.filter((event) => event.eventType === "Non-Conformance").length;
  const expiryIssues = operationalIssues.filter((issue) => issue.id.startsWith("expiry:"));
  const expiredIssues = expiryIssues.filter((issue) => issue.detail.startsWith("Expired "));
  const expiringIssues = expiryIssues.filter((issue) => !issue.detail.startsWith("Expired "));
  const qualityIssues = operationalIssues.filter((issue) => issue.id.startsWith("quality:"));
  const disruptedRoutes = snapshot.routes.filter((route) => route.status === "disrupted").length;
  const delayedRoutes = snapshot.routes.filter((route) => route.status === "delayed").length;
  const blockedShipments = activeOutbound.filter((shipment) => shipment.outboundStatus === "Blocked");
  const nextActions: Array<[string, () => void]> = [];

  if (blockedShipments.length) nextActions.push([
    `Resolve ${blockedShipments.length} Blocked Shipment${blockedShipments.length === 1 ? "" : "s"}`,
    () => openOutboundInLogistics(blockedShipments[0].shipmentId)
  ]);
  if (expiredIssues.length) nextActions.push([
    `Review ${expiredIssues.length} Expired Lot${expiredIssues.length === 1 ? "" : "s"}`,
    () => { setInventoryQuickFilter("Expired"); setInventoryWorkspace("stock"); setView("Inventory"); }
  ]);
  if (expiringIssues.length) nextActions.push([
    `Review ${expiringIssues.length} Expiring Lot${expiringIssues.length === 1 ? "" : "s"}`,
    () => { setInventoryQuickFilter("Expiring Soon"); setInventoryWorkspace("stock"); setView("Inventory"); }
  ]);
  if (disruptedRoutes || delayedRoutes) {
    const routeFilter = disruptedRoutes ? "disrupted" : "delayed";
    const routeCount = disruptedRoutes || delayedRoutes;
    nextActions.push([
      `Review ${routeCount} ${routeFilter === "disrupted" ? "Disrupted" : "Delayed"} Route${routeCount === 1 ? "" : "s"}`,
      () => { setLogisticsRouteFilter(routeFilter); setLogisticsWorkspace("network"); setView("Logistics"); }
    ]);
  }
  if (qualityIssues.length) nextActions.push([
    `Review ${qualityIssues.length} Quality Exception${qualityIssues.length === 1 ? "" : "s"}`,
    () => { setInventoryQuickFilter("Attention Required"); setInventoryWorkspace("stock"); setView("Inventory"); }
  ]);
  if (!nextActions.length && activeInboundAsnIds.size) nextActions.push([
    "Review Active Inbound Queue",
    () => openInboundInLogistics(snapshot.inventory.inboundShipments.find((shipment) => activeInboundAsnIds.has(shipment.asnId))!.asnId)
  ]);
  if (!nextActions.length && activeOutbound.length) nextActions.push([
    "Review Active Outbound Queue",
    () => openOutboundInLogistics(activeOutbound[0].shipmentId)
  ]);
  if (!nextActions.length && snapshot.inventory.stockPositions.length) nextActions.push(["Review Inventory", () => setView("Inventory")]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto pr-1">
      <section className="shrink-0 px-1 pt-3">
        <h1 className="text-3xl font-semibold tracking-tight text-twin-text">Dashboard</h1>
      </section>

      <section className="shrink-0">
        <LiveWeatherWidget location="Singapore" />
      </section>

      <section className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard index={0} label="Inventory" value={snapshot.inventory.products.length} secondary={`${snapshot.inventory.batches.length} lots / ${inventoryAttentionBatchIds.size} attention`} icon={PackageSearch} tone={inventoryAttentionBatchIds.size ? "warning" : "neutral"} onOpen={() => setView("Inventory")} />
        <SummaryCard index={1} label="Warehouse" value={warehouseFill} suffix="%" secondary={`${qaHoldCount} hold / ${quarantineCount} quarantine / ${pendingQaCount} pending`} icon={Warehouse} tone={qaHoldCount || quarantineCount ? "critical" : pendingQaCount ? "warning" : "neutral"} onOpen={() => setView("Warehouse")} />
        <SummaryCard index={2} label="Logistics" value={activeOutbound.length} secondary={`${stagedOutbound} staged / ${pickingOutbound} picking / ${blockedOutbound} blocked`} icon={Route} tone={blockedOutbound ? "critical" : stagedOutbound || pickingOutbound ? "warning" : "neutral"} onOpen={() => setView("Logistics")} />
        <SummaryCard index={3} label="Monitoring" value={activeTemperatureEvents.length} secondary={`${coldZones} cold zone${coldZones === 1 ? "" : "s"} / ${activeNonConformances} non-conformance`} icon={Radar} tone={activeNonConformances ? "critical" : activeTemperatureEvents.length ? "warning" : "neutral"} onOpen={() => setView("Monitoring")} />
        <SummaryCard index={4} label="Audit" value={operationalIssues.length} secondary={`${criticalOperationalIssues} critical / ${snapshot.decisions.length} enquiries`} icon={ClipboardList} tone={criticalOperationalIssues ? "critical" : operationalIssues.length ? "warning" : "neutral"} onOpen={() => { setAuditFilter(operationalIssues.length ? "action_required" : "significant"); setView("Audit"); }} />
      </section>

      <ColdChainTrend snapshot={snapshot} />

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="panel rounded-2xl p-4"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-twin-text">Open Alerts</h2>
            <StatusChip tone={operationalIssues.some((issue) => issue.severity === "critical") ? "critical" : operationalIssues.length ? "warning" : "healthy"}>{operationalIssues.length}</StatusChip>
          </div>
          {operationalIssues.length
            ? <AlertPriorityMatrix items={operationalIssues} onSelect={(priority) => openAlertsPage(priority)} />
            : <div className="rounded-xl border border-twin-border/70 bg-white/90 p-5 text-sm text-twin-muted">No open exceptions.</div>}
        </motion.section>

        <motion.aside
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="panel h-fit rounded-2xl p-4"
        >
          <h2 className="text-lg font-semibold text-twin-text">Next Actions</h2>
          <div className="mt-3 grid gap-2">
            {nextActions.slice(0, 4).map(([label, onOpen]) => (
              <button key={label} className="flex items-center justify-between rounded-xl border border-twin-border/70 bg-white/90 px-3 py-2.5 text-left text-sm font-semibold text-twin-text transition hover:border-twin-blue/50 hover:bg-twin-blue/5" onClick={onOpen}>
                {label}
                <ExternalLink size={14} className="text-twin-muted" />
              </button>
            ))}
            <button className="flex items-center justify-between rounded-xl border border-twin-border/70 bg-white/90 px-3 py-2.5 text-left text-sm font-semibold text-twin-text transition hover:border-twin-blue/50 hover:bg-twin-blue/5" onClick={() => setChatOpen(true)}>
              Open Assistant
              <ExternalLink size={14} />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl border border-twin-border/70 bg-white/90 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Sensors Online</div>
              <div className="mt-1 text-xl font-semibold">{new Set(snapshot.temperatureReadings.map((reading) => reading.zoneId)).size}</div>
            </div>
            <div className="rounded-xl border border-twin-border/70 bg-white/90 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Last Reading</div>
              <div className="mt-1 text-xs font-semibold leading-snug tabular-nums">{latestReadingTime(snapshot)}</div>
            </div>
          </div>
        </motion.aside>
      </div>
    </div>
  );
}
