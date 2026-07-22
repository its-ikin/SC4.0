import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Pause, Play, RadioTower, ThermometerSun } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import clsx from "clsx";
import { calculateVariance, getTemperatureEvents, type RfidEvent, type TemperatureEvent, type TemperatureReading, type WarehouseSnapshot, type Zone } from "@twinops/shared";
import { useAppStore } from "../store";
import { formatLocalDateTime } from "../lib/dateTime";
import { LiveBadge, StatusChip, useFlashHighlight } from "./ui";

function formatTemp(value: number) {
  return `${value.toFixed(1)} C`;
}

function formatBand(min: number, max: number) {
  return `${min}-${max} C`;
}

function formatEventTime(timestamp: string) {
  return formatLocalDateTime(timestamp);
}

function formatEventDateTime(timestamp: string) {
  return formatLocalDateTime(timestamp);
}

function FeedStateBadge({ paused }: { paused: boolean }) {
  return paused ? <StatusChip tone="warning">Paused</StatusChip> : <LiveBadge />;
}

function normalizeReading(reading: TemperatureReading, zone: Zone): TemperatureReading {
  return {
    ...reading,
    allowedMin: reading.allowedMin ?? zone.temperatureMin,
    allowedMax: reading.allowedMax ?? zone.temperatureMax,
    sensorId: reading.sensorId ?? `${zone.id}-TEMP-01`,
    relatedSkuIds: reading.relatedSkuIds ?? [],
    relatedBatchIds: reading.relatedBatchIds ?? []
  };
}

function latestReadingFor(zone: Zone, readings: TemperatureReading[]) {
  const latest = readings[readings.length - 1];
  return latest ? normalizeReading(latest, zone) : {
    id: 0,
    zoneId: zone.id,
    temperature: zone.currentTemperature,
    timestamp: new Date().toISOString(),
    withinBand: zone.currentTemperature >= zone.temperatureMin && zone.currentTemperature <= zone.temperatureMax,
    allowedMin: zone.temperatureMin,
    allowedMax: zone.temperatureMax,
    sensorId: `${zone.id}-TEMP-01`,
    relatedSkuIds: [],
    relatedBatchIds: []
  };
}

function eventForReading(reading: TemperatureReading, events: TemperatureEvent[]) {
  const timestamp = new Date(reading.timestamp).getTime();
  return events.find((event) => {
    if (event.zoneId !== reading.zoneId) return false;
    return timestamp >= new Date(event.timestampStart).getTime() && timestamp <= new Date(event.timestampEnd).getTime();
  });
}

function TemperaturePanel({
  snapshot,
  events,
  selectedZoneId,
  paused
}: {
  snapshot: WarehouseSnapshot;
  events: TemperatureEvent[];
  selectedZoneId: string | null;
  paused: boolean;
}) {
  const isFlashing = useFlashHighlight(selectedZoneId);

  useEffect(() => {
    if (!selectedZoneId) return;
    document.getElementById(`zone-temperature-card-${selectedZoneId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedZoneId]);

  return (
    <section className="panel rounded-2xl p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-twin-text">Temperature Monitoring</h2>
          <FeedStateBadge paused={paused} />
        </div>
        <ThermometerSun size={18} className="text-twin-blue" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {snapshot.zones.map((zone) => {
          const zoneReadings = snapshot.temperatureReadings
            .filter((reading) => reading.zoneId === zone.id)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .slice(-24)
            .map((reading) => normalizeReading(reading, zone));
          const zoneEvents = events.filter((event) => event.zoneId === zone.id);
          const data = zoneReadings.map((reading) => {
            const variance = calculateVariance(reading);
            const matchingEvent = eventForReading(reading, zoneEvents);
            const nonConformance = matchingEvent?.eventType === "Non-Conformance";
            return {
              time: new Date(reading.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              temp: reading.temperature,
              excursionVariance: variance > 0 && !nonConformance ? variance : 0,
              nonConformanceVariance: variance > 0 && nonConformance ? variance : 0
            };
          });
          const latest = latestReadingFor(zone, zoneReadings);
          const values = data.map((item) => item.temp);
          const min = values.length ? Math.min(...values) : zone.currentTemperature;
          const max = values.length ? Math.max(...values) : zone.currentTemperature;
          const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : zone.currentTemperature;
          const maxVariance = Math.max(0.5, ...data.map((item) => Math.max(item.excursionVariance, item.nonConformanceVariance)));
          // Zoomed to the actual reading range (not the full allowed band) so small real temperature
          // changes are visible; the green ReferenceArea below still shows the safe-band boundary
          // whenever it falls within this tighter view.
          const domainMin = min - 0.3;
          const domainMax = max + 0.3;
          const lastEvent = [...zoneEvents].sort((a, b) => new Date(b.timestampStart).getTime() - new Date(a.timestampStart).getTime())[0];
          const nonConformanceCount = zoneEvents.filter((event) => event.eventType === "Non-Conformance").length;
          const showFlash = zone.id === selectedZoneId && isFlashing;
          return (
            <div
              key={zone.id}
              id={`zone-temperature-card-${zone.id}`}
              className={clsx(
                "rounded-xl border p-3 transition-all duration-700",
                showFlash ? "border-twin-blue/60 bg-twin-blue/5 shadow-glow ring-2 ring-twin-blue/40" : "border-twin-border/70 bg-white/90"
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-twin-text">{zone.name}</h3>
                  <p className="mt-1 text-xs text-twin-muted">Allowed Band {formatBand(latest.allowedMin, latest.allowedMax)}</p>
                </div>
                <div className="rounded-xl border border-twin-cyan/25 bg-twin-cyan/10 px-3 py-1.5 text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-blue">Current</div>
                  <div className="text-lg font-bold leading-tight text-twin-blue tabular-nums">{formatTemp(latest.temperature)}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><span className="block text-twin-muted">Min</span><strong>{formatTemp(min)}</strong></div>
                <div><span className="block text-twin-muted">Max</span><strong>{formatTemp(max)}</strong></div>
                <div><span className="block text-twin-muted">Avg</span><strong>{formatTemp(avg)}</strong></div>
              </div>
              <div className="mt-3 h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#d6e0ea" vertical={false} opacity={0.72} />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10, fill: "#7b8797" }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={28}
                    />
                    <YAxis
                      yAxisId="temp"
                      domain={[domainMin, domainMax]}
                      tick={{ fontSize: 10, fill: "#7b8797" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value: number) => value.toFixed(1)}
                      tickCount={4}
                      width={34}
                    />
                    <YAxis yAxisId="variance" orientation="right" domain={[0, maxVariance + 0.4]} hide />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        `${Number(value).toFixed(1)} C`,
                        name === "temp" ? "Temperature" : name === "excursionVariance" ? "Excursion Variance" : "Non-Conformance Variance"
                      ]}
                      contentStyle={{ background: "rgba(255,255,255,0.94)", border: "1px solid #d6e0ea", color: "#142033", borderRadius: 12 }}
                    />
                    <ReferenceArea yAxisId="temp" y1={zone.temperatureMin} y2={zone.temperatureMax} fill="#5bcf82" fillOpacity={0.08} />
                    <Bar yAxisId="variance" dataKey="excursionVariance" fill="#f4b83f" radius={[3, 3, 0, 0]} barSize={5} />
                    <Bar yAxisId="variance" dataKey="nonConformanceVariance" fill="#ff706c" radius={[3, 3, 0, 0]} barSize={5} />
                    <Line yAxisId="temp" type="monotone" dataKey="temp" dot={false} stroke="#42bdd0" strokeWidth={2} isAnimationActive />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {(lastEvent || nonConformanceCount > 0) && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-twin-muted">
                  {lastEvent && <span>Last excursion {formatEventTime(lastEvent.timestampStart)}</span>}
                  {nonConformanceCount > 0 && <span>{nonConformanceCount} Non-Conformance</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TemperatureEventsLog({
  events,
  selectedEvent,
  onSelect,
  paused
}: {
  events: TemperatureEvent[];
  selectedEvent: TemperatureEvent | null;
  onSelect: (event: TemperatureEvent) => void;
  paused: boolean;
}) {
  const orderedEvents = [...events].sort((a, b) => new Date(b.timestampStart).getTime() - new Date(a.timestampStart).getTime());
  const selectedNonConformance = selectedEvent?.eventType === "Non-Conformance" ? selectedEvent : null;

  return (
    <section className="panel rounded-2xl p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-twin-text">Temperature Events</h2>
          <FeedStateBadge paused={paused} />
        </div>
        <ClipboardList size={18} className="text-twin-blue" />
      </div>
      <div className="overflow-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-twin-muted">
            <tr>
              <th className="pb-2 pr-3 font-semibold">Time</th>
              <th className="pb-2 pr-3 font-semibold">Zone</th>
              <th className="pb-2 pr-3 font-semibold">Event</th>
              <th className="pb-2 pr-3 font-semibold">Peak</th>
              <th className="pb-2 pr-3 font-semibold">Variance</th>
              <th className="pb-2 pr-3 font-semibold">Duration</th>
              <th className="pb-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-twin-border/70">
            {orderedEvents.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-5 text-center text-twin-muted">No temperature events.</td>
              </tr>
            ) : (
              orderedEvents.map((event) => (
                <tr
                  key={event.eventId}
                  className={clsx(
                    "transition",
                    event.eventType === "Non-Conformance" && "cursor-pointer hover:bg-twin-critical/5",
                    selectedEvent?.eventId === event.eventId && "bg-twin-blue/5"
                  )}
                  onClick={() => event.eventType === "Non-Conformance" && onSelect(event)}
                >
                  <td className="py-2.5 pr-3 text-twin-muted">{formatEventTime(event.timestampStart)}</td>
                  <td className="py-2.5 pr-3 font-semibold text-twin-text">{event.zoneName}</td>
                  <td className={clsx("py-2.5 pr-3 font-semibold", event.eventType === "Non-Conformance" ? "text-twin-critical" : "text-twin-warning")}>{event.eventType}</td>
                  <td className="py-2.5 pr-3">{formatTemp(event.peakTemp)}</td>
                  <td className="py-2.5 pr-3">+{formatTemp(event.peakVariance)}</td>
                  <td className="py-2.5 pr-3">{event.durationMinutes} min</td>
                  <td className="py-2.5">{event.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {selectedNonConformance && (
        <div className="mt-4 rounded-xl border border-twin-critical/25 bg-twin-critical/5 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-twin-text">{selectedNonConformance.zoneName}</div>
              <div className="mt-1 text-xs text-twin-muted">{selectedNonConformance.ncId} | {formatEventDateTime(selectedNonConformance.timestampStart)}</div>
            </div>
            <span className="rounded-full border border-twin-critical/25 bg-white/70 px-2.5 py-1 text-xs font-semibold text-twin-critical">{selectedNonConformance.status}</span>
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="block text-twin-muted">Affected Band</span><strong>{formatBand(selectedNonConformance.allowedBand.min, selectedNonConformance.allowedBand.max)}</strong></div>
            <div><span className="block text-twin-muted">Observed Range</span><strong>{selectedNonConformance.observedRange}</strong></div>
            <div><span className="block text-twin-muted">Duration</span><strong>{selectedNonConformance.durationMinutes} min</strong></div>
            <div><span className="block text-twin-muted">Action</span><strong>{selectedNonConformance.recommendedAction}</strong></div>
          </div>
          <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
            <div><span className="block text-twin-muted">Affected SKUs</span><strong>{[...new Set(selectedNonConformance.affectedSkuIds)].join(", ") || "-"}</strong></div>
            <div><span className="block text-twin-muted">Affected Batches</span><strong>{[...new Set(selectedNonConformance.affectedBatchIds)].join(", ") || "-"}</strong></div>
            <div><span className="block text-twin-muted">Audit Reference</span><strong>{selectedNonConformance.auditReference ?? "-"}</strong></div>
          </div>
        </div>
      )}
    </section>
  );
}

function LiveFeeds({ snapshot, rfidFeed, paused }: { snapshot: WarehouseSnapshot; rfidFeed: RfidEvent[]; paused: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const feedEvents = [...(rfidFeed.length ? rfidFeed : snapshot.rfidEvents)]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const visibleEvents = showAll ? feedEvents : feedEvents.slice(0, 4);

  return (
    <section className="panel rounded-2xl p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-twin-text">RFID Events</h2>
          <FeedStateBadge paused={paused} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-twin-muted">{visibleEvents.length} / {feedEvents.length}</span>
          {feedEvents.length > 4 && (
            <button
              className="rounded-lg border border-twin-border bg-white px-2.5 py-1.5 text-xs font-semibold text-twin-blue hover:border-twin-blue/40"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? "Latest 4" : "Show all"}
            </button>
          )}
          <RadioTower size={18} className="text-twin-blue" />
        </div>
      </div>
      <div
        className="space-y-2"
        role="list"
        aria-label="RFID event feed"
        data-testid="rfid-event-feed"
      >
        {visibleEvents.map((event) => (
          <div
            key={`${event.id}-${event.timestamp}`}
            className={clsx("min-h-[66px] rounded-2xl border p-3 text-sm", event.severity === "warn" ? "border-twin-warning/30 bg-twin-warning/10" : "border-twin-border/70 bg-white/80")}
            role="listitem"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{event.skuId}</span>
              <span className="text-xs text-twin-muted tabular-nums">{formatLocalDateTime(event.timestamp)}</span>
            </div>
            <div className="mt-1 text-xs text-twin-muted">{event.action} in {event.zoneId}</div>
          </div>
        ))}
        {feedEvents.length === 0 && <div className="rounded-xl border border-dashed border-twin-border p-5 text-center text-sm text-twin-muted">No RFID events recorded.</div>}
      </div>
    </section>
  );
}

function MonitoringStat({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "warning" | "critical" }) {
  return (
    <div className="rounded-xl border border-twin-border/70 bg-white/90 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">{label}</div>
      <div className={clsx("mt-1 text-2xl font-semibold text-twin-text", tone === "critical" && "text-twin-critical", tone === "warning" && "text-twin-warning")}>{value}</div>
    </div>
  );
}

export default function MonitoringView() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const rfidFeed = useAppStore((state) => state.rfidFeed);
  const selectedZoneId = useAppStore((state) => state.selectedZoneId);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<{ snapshot: WarehouseSnapshot; rfidFeed: RfidEvent[] } | null>(null);
  const [selectedTemperatureEvent, setSelectedTemperatureEvent] = useState<TemperatureEvent | null>(null);
  const displaySnapshot = paused && frozen ? frozen.snapshot : snapshot;
  const displayRfidFeed = paused && frozen ? frozen.rfidFeed : rfidFeed;
  const temperatureEvents = useMemo(() => {
    const eventMap = new Map<string, TemperatureEvent>();
    (displaySnapshot.temperatureEvents ?? []).forEach((event) => eventMap.set(event.eventId, event));
    getTemperatureEvents(displaySnapshot.temperatureReadings, displaySnapshot.zones).forEach((event) => eventMap.set(event.eventId, event));
    return [...eventMap.values()].sort((a, b) => new Date(a.timestampStart).getTime() - new Date(b.timestampStart).getTime());
  }, [displaySnapshot.temperatureEvents, displaySnapshot.temperatureReadings, displaySnapshot.zones]);
  const togglePause = () => {
    if (paused) {
      setPaused(false);
      setFrozen(null);
      return;
    }
    setFrozen({ snapshot, rfidFeed });
    setPaused(true);
  };
  const activeNonConformances = temperatureEvents.filter((event) => event.eventType === "Non-Conformance" && event.status === "Open").length;
  const lastReading = [...displaySnapshot.temperatureReadings]
    .filter((reading) => Number.isFinite(new Date(reading.timestamp).getTime()))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
  const lastReadingTime = lastReading ? formatLocalDateTime(lastReading.timestamp) : "Not recorded";
  const sensorsOnline = new Set(displaySnapshot.temperatureReadings.map((reading) => reading.zoneId)).size;

  return (
    <div className="grid h-full gap-4 overflow-auto">
      <section className="panel shrink-0 rounded-2xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-twin-text">Monitoring</h1>
          <button
            className={clsx(
              "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition",
              paused ? "border-twin-warning/40 bg-twin-warning/10 text-twin-warning" : "border-twin-border/70 bg-white/90 text-twin-muted hover:text-twin-text"
            )}
            onClick={togglePause}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
            {paused ? "Resume Feed" : "Pause Feed"}
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <MonitoringStat label="Sensors Online" value={sensorsOnline} />
          <MonitoringStat label="Active Non-Conformance" value={activeNonConformances} tone={activeNonConformances ? "critical" : "neutral"} />
          <MonitoringStat label="Last Reading" value={lastReadingTime} />
        </div>
      </section>
      <div className="hidden justify-end">
        <button
          className={clsx(
            "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition",
            paused ? "border-twin-warning/40 bg-twin-warning/10 text-twin-warning" : "border-white/10 bg-white/[0.025] text-twin-muted hover:text-twin-text"
          )}
          onClick={togglePause}
        >
          {paused ? <Play size={16} /> : <Pause size={16} />}
          {paused ? "Resume Feed" : "Pause Feed"}
        </button>
      </div>
      <TemperaturePanel snapshot={displaySnapshot} events={temperatureEvents} selectedZoneId={selectedZoneId} paused={paused} />
      <TemperatureEventsLog events={temperatureEvents} selectedEvent={selectedTemperatureEvent} onSelect={setSelectedTemperatureEvent} paused={paused} />
      <LiveFeeds snapshot={displaySnapshot} rfidFeed={displayRfidFeed} paused={paused} />
    </div>
  );
}
