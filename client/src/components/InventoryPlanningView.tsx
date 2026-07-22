import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  CalendarClock,
  PackagePlus,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingDown
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  buildInventoryPlanning,
  type InventoryPlanningRow,
  type InventoryPlanningRisk,
  type WarehouseSnapshot
} from "@twinops/shared";
import { useAppStore } from "../store";
import { formatLocalDate } from "../lib/dateTime";
import { StatusChip, type Tone } from "./ui";

type Props = {
  snapshot: WarehouseSnapshot;
};

type RiskFilter = "all" | InventoryPlanningRisk;

const riskLabels: Record<InventoryPlanningRisk, string> = {
  critical: "Critical",
  warning: "Replenishment",
  expiry: "Expiry risk",
  healthy: "Healthy"
};

function riskTone(risk: InventoryPlanningRisk): Tone {
  if (risk === "critical") return "critical";
  if (risk === "warning" || risk === "expiry") return "warning";
  return "healthy";
}

function displayQuantity(value: number) {
  return Math.round(value).toLocaleString();
}

function planningAsOf(snapshot: WarehouseSnapshot) {
  const latest = snapshot.inventory.stockBalances.reduce((current, balance) => {
    const timestamp = new Date(balance.lastUpdated).getTime();
    return Number.isFinite(timestamp) ? Math.max(current, timestamp) : current;
  }, 0);
  return latest ? new Date(latest) : new Date();
}

export default function InventoryPlanningView({ snapshot }: Props) {
  const requestAssistantQuery = useAppStore((state) => state.requestAssistantQuery);
  const setSelectedStockBalance = useAppStore((state) => state.setSelectedStockBalance);
  const [horizonDays, setHorizonDays] = useState(14);
  const [demandMultiplier, setDemandMultiplier] = useState(1);
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState("All");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const asOf = useMemo(() => planningAsOf(snapshot), [snapshot]);
  const plan = useMemo(
    () => buildInventoryPlanning(snapshot.inventory, { horizonDays, demandMultiplier, asOf }),
    [asOf, demandMultiplier, horizonDays, snapshot.inventory]
  );
  const families = useMemo(
    () => [...new Set(plan.rows.map((row) => row.product.productFamily))].sort(),
    [plan.rows]
  );
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return plan.rows.filter((row) => {
      const matchesSearch = !query || [row.product.productCode, row.product.productName, row.product.productId]
        .some((value) => value.toLowerCase().includes(query));
      const matchesFamily = family === "All" || row.product.productFamily === family;
      const matchesRisk = riskFilter === "all" || row.risk === riskFilter;
      return matchesSearch && matchesFamily && matchesRisk;
    });
  }, [family, plan.rows, riskFilter, search]);
  const selected = visibleRows.find((row) => row.product.productId === selectedProductId) ?? visibleRows[0] ?? null;
  const chartData = selected?.curve.map((point) => ({
    day: `Day ${point.day}`,
    available: point.projectedAvailable,
    safety: point.safetyStock,
    reorder: point.reorderPoint,
    inbound: point.plannedInbound
  })) ?? [];

  const selectPlanningProduct = (row: InventoryPlanningRow) => {
    setSelectedProductId(row.product.productId);
    const position = snapshot.inventory.stockPositions.find((item) => item.product.productId === row.product.productId);
    const fefoBatches = [...(position?.batches ?? [])].sort(
      (a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
    );
    const stockBalanceId = row.expiryRiskLots[0]?.stockBalanceId
      ?? fefoBatches.find((batch) => batch.qtyReserved + batch.qtyPicked + batch.qtyPacked + batch.qtyStaged > 0)?.stockBalanceId
      ?? fefoBatches.find((batch) => batch.qualityStatus === "Released" && batch.qtyAvailable > 0)?.stockBalanceId
      ?? fefoBatches[0]?.stockBalanceId
      ?? null;
    setSelectedStockBalance(stockBalanceId);
  };

  const askAssistant = () => {
    if (!selected) return;
    const stockout = selected.stockoutDay === null ? "not projected" : `day ${selected.stockoutDay}`;
    requestAssistantQuery(
      `Review replenishment and expiry risk for ${selected.product.productCode} (${selected.product.productId}). `
      + `The Inventory Planning screen is testing a ${horizonDays}-day horizon at ${demandMultiplier.toFixed(2)}x average demand. `
      + `The displayed deterministic snapshot shows risk ${selected.risk}, ${selected.availableNow} available now, ${selected.plannedInbound} eligible inbound units within the horizon, ${selected.projectedAtLeadTime} projected at lead time, ${selected.projectedAtHorizon} projected at the horizon, stock-out ${stockout}, ${selected.expiryRiskUnits} expiry-risk units, and ${selected.recommendedOrderQty} suggested replenishment units. `
      + `Use the authoritative inventory-planning calculation to verify this displayed snapshot, explain the risk, and suggest a safe read-only action. `
      + `Treat the horizon and demand multiplier as scenario assumptions, not operational facts.`
    );
  };

  const summaryCards = [
    { label: "Products at risk", value: plan.summary.productsAtRisk, detail: `of ${plan.rows.length} products`, icon: AlertTriangle, tone: plan.summary.productsAtRisk ? "text-twin-critical" : "text-twin-green" },
    { label: "Lead-time stock-outs", value: plan.summary.stockoutsBeforeReplenishment, detail: "before supply can arrive", icon: TrendingDown, tone: plan.summary.stockoutsBeforeReplenishment ? "text-twin-critical" : "text-twin-green" },
    { label: "Expiry-risk units", value: plan.summary.expiryRiskUnits, detail: `within ${horizonDays} days`, icon: CalendarClock, tone: plan.summary.expiryRiskUnits ? "text-twin-warning" : "text-twin-green" },
    { label: "Suggested replenishment", value: plan.summary.recommendedOrderQty, detail: "units to target stock", icon: PackagePlus, tone: "text-twin-blue" }
  ];

  return (
    <div className="space-y-4" data-testid="inventory-planning-workspace">
      <section className="panel rounded-2xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <ShieldCheck size={17} className="text-twin-blue" />
              <h3 className="text-sm font-semibold">Inventory risk and replenishment planning</h3>
              <StatusChip tone="healthy">Read-only</StatusChip>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-twin-muted">
              Deterministic projection using configured average demand, safety stock, lead time, eligible inbound, and FEFO expiry dates. It is not a learned demand forecast.
            </p>
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto xl:grid-cols-[150px_230px]">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">
              Forecast horizon
              <select
                aria-label="Forecast horizon"
                className="mt-1 h-10 w-full rounded-xl border border-twin-border bg-white px-3 text-xs font-normal normal-case text-twin-text"
                value={horizonDays}
                onChange={(event) => setHorizonDays(Number(event.target.value))}
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">
              Demand scenario <strong className="ml-1 text-twin-blue">{demandMultiplier.toFixed(2)}x</strong>
              <input
                aria-label="Demand scenario multiplier"
                className="mt-3 block w-full accent-twin-blue"
                type="range"
                min="0.5"
                max="2"
                step="0.25"
                value={demandMultiplier}
                onChange={(event) => setDemandMultiplier(Number(event.target.value))}
              />
            </label>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Planning summary">
        {summaryCards.map(({ label, value, detail, icon: Icon, tone }) => (
          <article key={label} className="panel rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">{label}</span>
              <Icon size={16} className={tone} />
            </div>
            <strong className={clsx("mt-2 block text-2xl tabular-nums", tone)}>{value.toLocaleString()}</strong>
            <span className="mt-0.5 block text-[10px] text-twin-muted">{detail}</span>
          </article>
        ))}
      </section>

      <section className="panel rounded-2xl p-4">
        <div className="grid gap-2 md:grid-cols-[minmax(240px,1fr)_190px_180px]">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-twin-muted" size={15} />
            <input
              aria-label="Search planning products"
              className="h-10 w-full rounded-xl border border-twin-border bg-white/80 pl-9 pr-3 text-xs"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search product or material"
            />
          </label>
          <select aria-label="Product family filter" className="h-10 rounded-xl border border-twin-border bg-white/80 px-3 text-xs" value={family} onChange={(event) => setFamily(event.target.value)}>
            <option>All</option>
            {families.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select aria-label="Planning risk filter" className="h-10 rounded-xl border border-twin-border bg-white/80 px-3 text-xs" value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as RiskFilter)}>
            <option value="all">All risk levels</option>
            <option value="critical">Critical</option>
            <option value="warning">Replenishment</option>
            <option value="expiry">Expiry risk</option>
            <option value="healthy">Healthy</option>
          </select>
        </div>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.55fr)]">
        <section className="panel min-w-0 overflow-hidden rounded-2xl">
          <div className="border-b border-twin-border px-4 py-3">
            <h3 className="text-sm font-semibold">Product risk ranking</h3>
            <p className="mt-0.5 text-[10px] text-twin-muted">Select a product to inspect its projected balance and batch-level expiry exposure.</p>
          </div>
          <div className="max-h-[620px] overflow-auto">
            <table className="w-full min-w-[940px] text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-twin-bg text-[10px] uppercase tracking-wide text-twin-muted">
                <tr>{["Product", "Risk", "Available", "Daily demand", "Days cover", "Lead time", "Lead-time balance", "Planned inbound", "Expiry risk", "Suggested order"].map((heading) => <th key={heading} className={clsx("border-b border-twin-border px-3 py-2", !["Product", "Risk"].includes(heading) && "text-right")}>{heading}</th>)}</tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.product.productId}
                    tabIndex={0}
                    className={clsx("cursor-pointer border-b border-twin-border/60 hover:bg-twin-blue/5 focus:outline-none", selected?.product.productId === row.product.productId && "bg-twin-blue/5")}
                    onClick={() => selectPlanningProduct(row)}
                    onKeyDown={(event) => { if (event.key === "Enter") selectPlanningProduct(row); }}
                  >
                    <td className="px-3 py-2"><strong className="block">{row.product.productCode}</strong><span className="block max-w-[220px] truncate text-[10px] text-twin-muted">{row.product.productName}</span></td>
                    <td className="px-3 py-2"><StatusChip tone={riskTone(row.risk)}>{riskLabels[row.risk]}</StatusChip></td>
                    <td className="px-3 py-2 text-right tabular-nums">{displayQuantity(row.availableNow)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.scaledDailyDemand.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.daysOfCover === null ? "No demand" : `${row.daysOfCover} d`}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.product.leadTimeDays} d</td>
                    <td className={clsx("px-3 py-2 text-right font-semibold tabular-nums", row.projectedAtLeadTime <= row.product.safetyStock && "text-twin-critical")}>{displayQuantity(row.projectedAtLeadTime)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{displayQuantity(row.plannedInbound)}</td>
                    <td className={clsx("px-3 py-2 text-right tabular-nums", row.expiryRiskUnits > 0 && "font-semibold text-twin-warning")}>{row.expiryRiskUnits.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-twin-blue">{row.recommendedOrderQty.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleRows.length && <div className="px-4 py-12 text-center text-xs text-twin-muted">No products match the planning filters.</div>}
          </div>
        </section>

        <aside className="min-w-0 space-y-4">
          {selected ? (
            <>
              <section className="panel rounded-2xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{selected.product.productCode}</h3><p className="mt-0.5 truncate text-[10px] text-twin-muted">{selected.product.productName}</p></div>
                  <StatusChip tone={riskTone(selected.risk)}>{riskLabels[selected.risk]}</StatusChip>
                </div>
                <p className="mt-3 rounded-xl border border-twin-border/70 bg-white/70 p-3 text-[11px] leading-relaxed text-twin-muted">{selected.riskReason}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                  {[
                    ["Safety stock", selected.product.safetyStock.toLocaleString()],
                    ["Reorder point", selected.product.reorderPoint.toLocaleString()],
                    ["Target stock", selected.product.targetStock.toLocaleString()],
                    ["Stock-out", selected.stockoutDay === null ? "Not projected" : `Day ${selected.stockoutDay}`]
                  ].map(([label, value]) => <div key={label} className="rounded-xl border border-twin-border/70 bg-white/70 p-3"><dt className="uppercase tracking-wide text-twin-muted">{label}</dt><dd className="mt-1 text-xs font-semibold text-twin-text">{value}</dd></div>)}
                </dl>
                <button
                  className="mt-3 flex w-full items-center gap-2 rounded-xl bg-twin-orange px-3 py-2.5 text-left text-sm font-semibold text-white"
                  onClick={askAssistant}
                >
                  <Sparkles size={16} />
                  Ask Assistant
                </button>
              </section>

              <section className="panel rounded-2xl p-4">
                <div><h3 className="text-sm font-semibold">Projected available stock</h3><p className="mt-0.5 text-[10px] text-twin-muted">Conditional released inbound is added on its planned arrival day.</p></div>
                <div className="mt-3 h-[260px] min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#dfe7ef" />
                      <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#6f8193" }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9, fill: "#6f8193" }} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #d8e2ec", fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="inbound" name="Planned inbound" fill="#30a98b" opacity={0.55} radius={[3, 3, 0, 0]} />
                      <Line type="monotone" dataKey="available" name="Projected" stroke="#2a63a8" strokeWidth={2.5} dot={false} />
                      <Line type="stepAfter" dataKey="safety" name="Safety stock" stroke="#cc3f3f" strokeDasharray="5 4" dot={false} />
                      <Line type="stepAfter" dataKey="reorder" name="Reorder point" stroke="#d47b22" strokeDasharray="3 4" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="panel overflow-hidden rounded-2xl">
                <div className="border-b border-twin-border px-4 py-3"><h3 className="text-sm font-semibold">FEFO expiry exposure</h3><p className="mt-0.5 text-[10px] text-twin-muted">Released lots projected to retain stock at expiry.</p></div>
                <div className="max-h-56 overflow-auto">
                  {selected.expiryRiskLots.map((lot) => <div key={lot.stockBalanceId} className="border-b border-twin-border/60 px-4 py-3 last:border-0"><div className="flex items-center justify-between gap-3"><strong className="text-[11px]">{lot.lotCode}</strong><span className="text-[11px] font-semibold text-twin-warning">{lot.projectedRemainingAtExpiry.toLocaleString()} at risk</span></div><div className="mt-1 flex justify-between gap-3 text-[10px] text-twin-muted"><span>{lot.stockBalanceId}</span><span>{formatLocalDate(lot.expiryDate)}</span></div></div>)}
                  {!selected.expiryRiskLots.length && <div className="px-4 py-8 text-center text-xs text-twin-muted">No eligible FEFO lot is projected to retain stock at expiry within this horizon.</div>}
                </div>
              </section>
            </>
          ) : <section className="panel rounded-2xl p-8 text-center text-xs text-twin-muted">Select a product to inspect its planning projection.</section>}
        </aside>
      </div>

      <p className="px-1 text-[10px] leading-relaxed text-twin-muted">
        Planning basis captured {new Date(plan.asOf).toLocaleString()}. Incoming quantities are projections only and remain unavailable until receipt, quality release, and put-away. Suggested quantities do not create purchase orders or modify WMS records.
      </p>
    </div>
  );
}
