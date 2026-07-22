import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Boxes, Database, FlaskConical, Pause, Play, RotateCcw, ShieldCheck, StepForward, Truck, Warehouse, X } from "lucide-react";
import type { WarehouseSnapshot } from "@twinops/shared";
import { formatLocalDateTime } from "../lib/dateTime";
import {
  advanceOperationsSimulation,
  createOperationsSimulation,
  projectedInboundLineReceipts,
  projectedOutboundLineAllocations,
  type OperationsSimulation,
  type SimulationDirection,
  type SimulationImpact
} from "../lib/operationsSimulation";

type Props = {
  snapshot: WarehouseSnapshot;
  direction: SimulationDirection;
  referenceId: string;
  onClose: () => void;
};

function cloneSnapshot(snapshot: WarehouseSnapshot): WarehouseSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as WarehouseSnapshot;
}

function impactText(value: number) {
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
}

function Metric({ label, baseline, projected }: { label: string; baseline: number; projected: number }) {
  return <div className="rounded-xl border border-twin-border/70 bg-white/75 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">{label}</div><div className="mt-1 flex items-baseline gap-2"><span className="text-sm tabular-nums text-twin-muted">{baseline.toLocaleString()}</span><span className="text-xs text-twin-subtle">→</span><strong className={clsx("text-lg tabular-nums", baseline !== projected ? "text-twin-blue" : "text-twin-text")}>{projected.toLocaleString()}</strong></div></div>;
}

function ImpactCard({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-twin-border/70 bg-white/75 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">{label}</div><div className={clsx("mt-1 text-lg font-semibold tabular-nums", value < 0 ? "text-twin-critical" : value > 0 ? "text-twin-green" : "text-twin-muted")}>{impactText(value)}</div></div>;
}

function Pipeline({ simulation }: { simulation: OperationsSimulation }) {
  const progress = Math.round(simulation.stageIndex / Math.max(1, simulation.stages.length - 1) * 100);
  return <section className="rounded-2xl border border-twin-border/70 bg-white/90 p-4"><div className="flex items-end justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Projected workflow</div><h3 className="mt-1 text-lg font-semibold">{simulation.stages[simulation.stageIndex]}</h3></div><div className="text-right"><strong className="text-xl text-twin-blue">{progress}%</strong><div className="text-[10px] text-twin-muted">scenario progress</div></div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-twin-border/60"><div className="h-full rounded-full bg-gradient-to-r from-twin-blue via-twin-cyan to-twin-green transition-[width] duration-500" style={{ width: `${progress}%` }} /></div><div className="mt-4 overflow-x-auto"><div className="flex min-w-[720px]">{simulation.stages.map((stage, index) => <div key={stage} className="relative flex min-w-0 flex-1 flex-col items-center text-center after:absolute after:left-1/2 after:top-3 after:h-px after:w-full after:bg-twin-border last:after:hidden"><span className={clsx("relative z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[9px] font-semibold", index < simulation.stageIndex ? "border-twin-green bg-twin-green text-white" : index === simulation.stageIndex ? "border-twin-blue bg-twin-blue text-white" : "border-twin-border bg-white text-twin-muted")}>{index + 1}</span><span className={clsx("mt-2 max-w-[88px] text-[9px] font-semibold", index === simulation.stageIndex ? "text-twin-blue" : "text-twin-muted")}>{stage}</span></div>)}</div></div></section>;
}

function QuantityProjection({ simulation }: { simulation: OperationsSimulation }) {
  const { baseline, projected } = simulation;
  if (simulation.direction === "inbound") return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Ordered / expected" baseline={baseline.expected} projected={projected.expected} /><Metric label="Received so far" baseline={baseline.received} projected={projected.received} /><Metric label="Remaining to receive" baseline={Math.max(0, baseline.expected - baseline.received)} projected={Math.max(0, projected.expected - projected.received)} /><Metric label="On hand" baseline={baseline.onHand} projected={projected.onHand} /><Metric label="Available" baseline={baseline.available} projected={projected.available} /></div>;
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Required" baseline={baseline.required} projected={projected.required} /><Metric label="Allocated" baseline={baseline.allocated} projected={projected.allocated} /><Metric label="Picked" baseline={baseline.picked} projected={projected.picked} /><Metric label="Packed" baseline={baseline.packed} projected={projected.packed} /><Metric label="Dispatched" baseline={baseline.dispatched} projected={projected.dispatched} /></div>;
}

function InventoryImpact({ impact }: { impact: SimulationImpact }) {
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"><ImpactCard label="On-hand impact" value={impact.onHandDelta} /><ImpactCard label="Available impact" value={impact.availableDelta} /><ImpactCard label="Reserved bucket" value={impact.reservedDelta} /><ImpactCard label="Picked bucket" value={impact.pickedDelta} /><ImpactCard label="Packed bucket" value={impact.packedDelta} /><ImpactCard label="Staged bucket" value={impact.stagedDelta} /></div>;
}

export default function LogisticsSimulationDrawer({ snapshot, direction, referenceId, onClose }: Props) {
  const [baseline] = useState(() => cloneSnapshot(snapshot));
  const [simulation, setSimulation] = useState(() => createOperationsSimulation(baseline, direction, referenceId));
  const [playing, setPlaying] = useState(false);
  const products = new Map(baseline.inventory.products.map((product) => [product.productId, product]));
  const balancesByBatch = useMemo(() => new Map(baseline.inventory.stockBalances.map((balance) => [balance.batchId, balance])), [baseline.inventory.stockBalances]);
  const inboundLines = baseline.inventory.inboundLines.filter((line) => line.asnId === referenceId);
  const outboundLines = baseline.inventory.outboundLines.filter((line) => line.shipmentId === referenceId);
  const inboundProjection = new Map(projectedInboundLineReceipts(simulation, inboundLines).map((line) => [line.inboundLineId, line]));
  const outboundProjection = new Map(projectedOutboundLineAllocations(simulation, outboundLines).map((line) => [line.outboundLineId, line]));
  const relatedRows = direction === "inbound"
    ? inboundLines.map((line) => ({
        id: line.inboundLineId,
        productId: line.productId,
        batchId: line.batchId,
        lineStatus: line.qaStatus,
        expectedOrRequired: line.qtyExpected,
        receivedOrAllocated: inboundProjection.get(line.inboundLineId)?.received ?? line.qtyReceived
      }))
    : outboundLines.map((line) => ({
        id: line.outboundLineId,
        productId: line.productId,
        batchId: line.batchId,
        lineStatus: line.allocationStatus,
        expectedOrRequired: line.qtyRequired,
        receivedOrAllocated: outboundProjection.get(line.outboundLineId)?.allocated ?? line.qtyAllocated
      }));
  const lineExpectedOrRequired = relatedRows.reduce((total, line) => total + line.expectedOrRequired, 0);
  const lineReceivedOrAllocated = relatedRows.reduce((total, line) => total + line.receivedOrAllocated, 0);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const terminal = simulation.completed || Boolean(simulation.blocker);

  useEffect(() => {
    if (!playing || terminal) {
      if (terminal) setPlaying(false);
      return;
    }
    const timer = window.setInterval(() => setSimulation((current) => advanceOperationsSimulation(current)), 1_500);
    return () => window.clearInterval(timer);
  }, [playing, terminal]);

  const reset = () => {
    setPlaying(false);
    setSimulation(createOperationsSimulation(baseline, direction, referenceId));
  };
  const domains = [
    { icon: Boxes, label: "Inventory", value: impactText(simulation.impact.onHandDelta), detail: "Projected on-hand change" },
    { icon: Warehouse, label: "Dock", value: simulation.dockStatus, detail: `Dock ${simulation.dockId}` },
    { icon: Truck, label: "Transport", value: simulation.transportStatus, detail: "Projected transport state" },
    { icon: Database, label: "Database", value: "Unchanged", detail: "Frozen read-only baseline" }
  ];

  return <><button className="fixed inset-0 z-[60] cursor-default bg-twin-text/40" onClick={onClose} aria-label="Close inventory simulation" /><aside className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[860px] flex-col border-l border-twin-border bg-twin-bg shadow-2xl" role="dialog" aria-modal="true" aria-label={`${referenceId} inventory simulation`}>
    <header className="border-b border-twin-border bg-white/90 px-5 py-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><FlaskConical size={18} className="text-twin-blue" /><h2 className="text-lg font-semibold">{direction === "inbound" ? "Inbound" : "Outbound"} inventory simulation</h2></div><p className="mt-1 text-xs text-twin-muted"><strong className="text-twin-text">{referenceId}</strong> · baseline {simulation.initialStatus} · captured {formatLocalDateTime(simulation.capturedAt)}</p></div><button autoFocus className="rounded-lg border border-twin-border bg-white p-2 text-twin-muted hover:text-twin-text" onClick={onClose} aria-label="Close simulation"><X size={16} /></button></div><div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-twin-warning/30 bg-twin-warning/10 px-3 py-2"><div className="flex items-center gap-2 text-xs font-semibold text-twin-warning"><ShieldCheck size={14} />Projection only · no warehouse writes</div><div className="flex gap-2"><button className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-twin-border bg-white px-2.5 text-xs font-semibold" onClick={reset}><RotateCcw size={12} />Reset</button><button className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-twin-border bg-white px-2.5 text-xs font-semibold text-twin-blue disabled:opacity-40" disabled={terminal} onClick={() => setSimulation((current) => advanceOperationsSimulation(current))}><StepForward size={12} />Next event</button><button className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-twin-blue px-2.5 text-xs font-semibold text-white disabled:opacity-40" disabled={terminal} onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={12} /> : <Play size={12} />}{playing ? "Pause" : "Play"}</button></div></div></header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
      {simulation.warnings.map((warning) => <div key={warning} className="rounded-xl border border-twin-warning/30 bg-twin-warning/10 px-3 py-2 text-xs text-twin-warning">{warning}</div>)}
      {simulation.blocker && <div className="rounded-xl border border-twin-critical/30 bg-twin-critical/10 px-3 py-2" role="status"><div className="text-xs font-semibold text-twin-critical">{simulation.blocker.title}</div><p className="mt-0.5 text-[11px] text-twin-critical">{simulation.blocker.detail}</p></div>}
      <Pipeline simulation={simulation} />
      <section><h3 className="text-sm font-semibold">Inventory change</h3><p className="mb-2 mt-0.5 text-[10px] text-twin-muted">Current baseline on the left; projected scenario value on the right. {direction === "inbound" && `${simulation.baseline.received.toLocaleString()} of ${simulation.baseline.expected.toLocaleString()} ordered units are currently received, leaving ${Math.max(0, simulation.baseline.expected - simulation.baseline.received).toLocaleString()} in progress.`}</p><QuantityProjection simulation={simulation} /></section>
      <section className="grid gap-3 xl:grid-cols-[1.1fr_.9fr]"><div className="rounded-2xl border border-twin-border/70 bg-white/60 p-4"><h3 className="text-sm font-semibold">Inventory bucket impact</h3><p className="mb-3 mt-0.5 text-[10px] text-twin-muted">Cumulative difference from the captured baseline.</p><InventoryImpact impact={simulation.impact} /></div><div className="rounded-2xl border border-twin-border/70 bg-white/60 p-4"><h3 className="text-sm font-semibold">Connected projection</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{domains.map(({ icon: Icon, label, value, detail }) => <div key={label} className="rounded-xl border border-twin-border/70 bg-white/75 p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-twin-muted"><Icon size={13} />{label}</div><div className="mt-1 text-sm font-semibold">{value}</div><div className="text-[10px] text-twin-muted">{detail}</div></div>)}</div></div></section>
      <section className="overflow-hidden rounded-2xl border border-twin-border/70 bg-white/60"><div className="border-b border-twin-border px-4 py-3"><h3 className="text-sm font-semibold">Affected products and lots</h3><p className="text-[10px] text-twin-muted">Identifiers and line dispositions come from the frozen warehouse baseline.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[11px]"><thead className="bg-twin-bg text-[10px] uppercase text-twin-muted"><tr>{["Product", "Batch / lot", "Stock balance", "Location", "Line status", direction === "inbound" ? "Expected / received" : "Required / allocated"].map((header) => <th key={header} className="px-3 py-2">{header}</th>)}</tr></thead><tbody>{relatedRows.map((line) => { const balance = balancesByBatch.get(line.batchId); return <tr key={line.id} className="border-t border-twin-border/60"><td className="px-3 py-2 font-semibold">{products.get(line.productId)?.productCode ?? line.productId}</td><td className="px-3 py-2 font-mono">{line.batchId}</td><td className="px-3 py-2 font-mono">{balance?.stockBalanceId ?? "Projected on receipt"}</td><td className="px-3 py-2 font-mono">{balance?.locationId ?? (direction === "inbound" ? "Receiving" : "Not located")}</td><td className="px-3 py-2">{line.lineStatus}</td><td className="px-3 py-2 tabular-nums">{line.expectedOrRequired.toLocaleString()} / {line.receivedOrAllocated.toLocaleString()}</td></tr>; })}</tbody><tfoot><tr className="border-t-2 border-twin-border bg-twin-bg/70 font-semibold"><td className="px-3 py-2" colSpan={5}>Total {referenceId}</td><td className="px-3 py-2 tabular-nums">{lineExpectedOrRequired.toLocaleString()} / {lineReceivedOrAllocated.toLocaleString()}</td></tr></tfoot></table></div></section>
      <section className="overflow-hidden rounded-2xl border border-twin-border/70 bg-white/60"><div className="border-b border-twin-border px-4 py-3"><h3 className="text-sm font-semibold">Temporary simulation ledger</h3><p className="text-[10px] text-twin-muted">Discarded on close; never copied into Movements or Audit.</p></div><div className="max-h-64 overflow-auto">{[...simulation.ledger].reverse().map((event) => <div key={event.eventId} className="border-b border-twin-border/60 px-4 py-3 last:border-0"><div className="flex justify-between gap-3"><strong className="text-xs">{event.title}</strong><span className="whitespace-nowrap text-[10px] text-twin-muted">{formatLocalDateTime(event.timestamp)}</span></div><p className="mt-1 text-[11px] text-twin-muted">{event.detail}</p></div>)}</div></section>
    </div>
  </aside></>;
}
