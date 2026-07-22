import { AlertTriangle, Boxes, LocateFixed, PackageSearch, Snowflake, Thermometer } from "lucide-react";
import clsx from "clsx";
import type { WarehouseSnapshot } from "@twinops/shared";
import { useAppStore } from "../store";
import {
  buildWarehouseBins,
  getRack,
  getRackMetrics,
  getSector,
  getSectorMetrics,
  isExpiryRisk,
  rackDisplayLabel,
  stockDisplayCode,
  warehouseRacks
} from "../warehouseLayout";
import { StatusChip } from "./ui";

const storageSectorIds = ["CS", "AM", "PH", "QA", "QT"] as const;

function locationSectorId(zone: string) {
  const value = zone.toLowerCase();
  if (value.includes("cold")) return "CS";
  if (value.includes("ambient")) return "AM";
  if (value.includes("pharmaceutical")) return "PH";
  if (value.includes("qa")) return "QA";
  if (value.includes("quarantine")) return "QT";
  return zone;
}

export default function WarehouseLocationsView({ snapshot }: { snapshot: WarehouseSnapshot }) {
  const setWarehouseWorkspace = useAppStore((state) => state.setWarehouseWorkspace);
  const setSelectedZone = useAppStore((state) => state.setSelectedZone);
  const setSelectedRack = useAppStore((state) => state.setSelectedRack);
  const openStockBalanceInInventory = useAppStore((state) => state.openStockBalanceInInventory);
  const bins = buildWarehouseBins(snapshot.inventoryPlacements);

  const openZoneOnFloor = (zoneId: string) => {
    setSelectedZone(zoneId);
    setWarehouseWorkspace("facility");
  };
  const openRackOnFloor = (rackId: string) => {
    setSelectedRack(rackId);
    setWarehouseWorkspace("facility");
  };

  return (
    <div className="space-y-3">
      <section className="panel rounded-2xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-twin-text">Storage location control</h2>
            <p className="mt-1 text-xs text-twin-muted">Capacity, condition and stock risk by controlled area and rack row.</p>
          </div>
          <StatusChip tone="neutral">{snapshot.inventory.locations.length} WMS locations</StatusChip>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-5">
          {storageSectorIds.map((sectorId) => {
            const sector = getSector(sectorId)!;
            const metrics = getSectorMetrics(sector, snapshot.zones, snapshot.inventoryPlacements);
            const zone = metrics.dataZone;
            const qualityHolds = metrics.sectorPlacements.filter((item) => item.qualityStatus !== "Released").length;
            const expiryRisk = metrics.sectorPlacements.filter(isExpiryRisk).length;
            const conditionTone = zone?.status === "critical" ? "critical" : zone?.status === "warn" ? "warning" : "healthy";
            const locations = snapshot.inventory.locations.filter((location) => locationSectorId(location.zone) === sectorId);
            const capacity = locations.reduce((sum, location) => sum + location.capacity, 0);
            const currentFill = locations.reduce((sum, location) => sum + location.currentFill, 0);
            const fillPercent = capacity ? Math.round(currentFill / capacity * 100) : zone?.fillPercent ?? 0;
            return (
              <article key={sectorId} className="rounded-xl border border-twin-blue/20 bg-gradient-to-br from-white to-sky-50/70 p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div><span className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">{sector.id}</span><h3 className="mt-0.5 text-sm font-semibold text-twin-text">{sector.name}</h3></div>
                  <StatusChip tone={conditionTone}>{zone?.status ?? "controlled"}</StatusChip>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg border border-twin-blue/10 bg-white p-2"><span className="text-twin-muted">Capacity / fill</span><strong className="mt-1 block text-sm">{fillPercent}%</strong><span className="mt-0.5 block text-[9px] text-twin-muted">{currentFill.toLocaleString()} / {capacity.toLocaleString()} units</span></div>
                  <div className="rounded-lg border border-twin-blue/10 bg-white p-2"><span className="text-twin-muted">Positions</span><strong className="mt-1 block text-sm">{metrics.sectorPlacements.length}</strong></div>
                  <div className="rounded-lg border border-twin-blue/10 bg-white p-2"><span className="text-twin-muted">Quality holds</span><strong className={clsx("mt-1 block text-sm", qualityHolds && "text-twin-critical")}>{qualityHolds}</strong></div>
                  <div className="rounded-lg border border-twin-blue/10 bg-white p-2"><span className="text-twin-muted">Near expiry</span><strong className={clsx("mt-1 block text-sm", expiryRisk && "text-twin-warning")}>{expiryRisk}</strong></div>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-twin-muted">
                  <span className="inline-flex items-center gap-1"><Thermometer size={12} />{zone ? `${zone.currentTemperature.toFixed(1)}°C` : sector.temperatureRange ?? "Controlled"}</span>
                  <span>{sector.racks.length ? `${sector.racks.length} racks` : "Controlled area"}</span>
                </div>
                <button className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-twin-border bg-white px-2 py-2 text-xs font-semibold text-twin-blue hover:border-twin-blue/50" onClick={() => openZoneOnFloor(sector.id)}><LocateFixed size={13} />View on facility</button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-twin-border/70 px-4 py-3">
          <div><h2 className="text-sm font-semibold text-twin-text">Rack and controlled-location ledger</h2><p className="mt-0.5 text-[11px] text-twin-muted">Select a rack to locate it physically or open a leading stock position in Inventory.</p></div>
          <div className="flex items-center gap-2 text-xs text-twin-muted"><Boxes size={15} />{warehouseRacks.length} rack rows</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-[11px]">
            <thead className="bg-twin-bg text-[10px] uppercase tracking-wide text-twin-muted"><tr>{["Location", "Storage area", "Occupancy", "Stock positions", "Condition", "Quality / expiry", "Actions"].map((item) => <th key={item} className="border-b border-twin-border px-3 py-2">{item}</th>)}</tr></thead>
            <tbody>
              {warehouseRacks.map((rack) => {
                const metrics = getRackMetrics(getRack(rack.id), bins);
                const topStock = metrics.bins[0]?.placement ?? null;
                return (
                  <tr key={rack.id} className="border-b border-twin-border/60 bg-white hover:bg-twin-blue/5">
                    <td className="px-3 py-2 font-semibold text-twin-text">{rackDisplayLabel(rack.id)}</td>
                    <td className="px-3 py-2 text-twin-muted">{getSector(rack.zoneId)?.name ?? rack.zoneId}</td>
                    <td className="px-3 py-2"><strong>{metrics.occupancy}%</strong><div className="mt-1 h-1.5 w-24 overflow-hidden rounded bg-twin-border"><span className="block h-full rounded bg-twin-blue" style={{ width: `${metrics.occupancy}%` }} /></div></td>
                    <td className="px-3 py-2">{metrics.bins.length}</td>
                    <td className="px-3 py-2"><span className="inline-flex items-center gap-1 text-twin-muted"><Snowflake size={12} />{getSector(rack.zoneId)?.temperatureRange ?? "Controlled"}</span></td>
                    <td className="px-3 py-2"><div className="flex gap-1.5"><StatusChip tone={metrics.qualityHoldCount ? "critical" : "healthy"}>{metrics.qualityHoldCount} quality</StatusChip><StatusChip tone={metrics.expiryRiskCount ? "warning" : "healthy"}>{metrics.expiryRiskCount} expiry</StatusChip></div></td>
                    <td className="px-3 py-2"><div className="flex gap-1.5"><button className="inline-flex items-center gap-1 rounded-lg border border-twin-border bg-white px-2 py-1.5 font-semibold text-twin-blue" onClick={() => openRackOnFloor(rack.id)}><LocateFixed size={11} />Facility</button><button className="inline-flex items-center gap-1 rounded-lg border border-twin-border bg-white px-2 py-1.5 font-semibold text-twin-blue disabled:opacity-40" disabled={!topStock} onClick={() => topStock && openStockBalanceInInventory(topStock.stockBalanceId)}><PackageSearch size={11} />{topStock ? stockDisplayCode(topStock) : "Empty"}</button></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!warehouseRacks.length && <div className="flex items-center gap-2 px-4 py-8 text-sm text-twin-muted"><AlertTriangle size={16} />No rack locations are configured.</div>}
      </section>
    </div>
  );
}
