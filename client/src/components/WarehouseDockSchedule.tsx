import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowRight, ArrowUpFromLine, CalendarClock, LocateFixed, Truck } from "lucide-react";
import clsx from "clsx";
import type { DockAppointment, WarehouseSnapshot } from "@twinops/shared";
import { effectiveDockAppointments } from "../lib/dockAppointments";
import { formatLocalDateTime } from "../lib/dateTime";
import { useAppStore } from "../store";
import { StatusChip, type Tone } from "./ui";

function formatStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function appointmentTone(appointment: DockAppointment): Tone {
  if (appointment.conflictFlag || ["missed", "exception"].includes(appointment.status)) return "critical";
  if (["checked_in", "at_dock", "loading", "unloading"].includes(appointment.status)) return "warning";
  if (appointment.status === "completed") return "healthy";
  return "neutral";
}

export default function WarehouseDockSchedule({ snapshot }: { snapshot: WarehouseSnapshot }) {
  const selectedDockAppointmentId = useAppStore((state) => state.selectedDockAppointmentId);
  const openDockScheduleInWarehouse = useAppStore((state) => state.openDockScheduleInWarehouse);
  const focusPhysicalDockInWarehouse = useAppStore((state) => state.focusPhysicalDockInWarehouse);
  const openInboundInLogistics = useAppStore((state) => state.openInboundInLogistics);
  const openOutboundInLogistics = useAppStore((state) => state.openOutboundInLogistics);
  const openTransportLegInLogistics = useAppStore((state) => state.openTransportLegInLogistics);
  const [showAll, setShowAll] = useState(false);
  const appointments = useMemo(() => effectiveDockAppointments(snapshot), [snapshot]);
  const visibleAppointments = [...appointments]
    .filter((appointment) => showAll || !["completed", "cancelled"].includes(appointment.status))
    .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime());
  const dockColumns = snapshot.docks
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map((dock) => ({ dock, appointments: visibleAppointments.filter((appointment) => appointment.dockId === dock.id) }));
  const conflicts = visibleAppointments.filter((appointment) => appointment.conflictFlag).length;

  const selectAppointment = (appointment: DockAppointment) => {
    openDockScheduleInWarehouse({
      dockId: appointment.dockId,
      appointmentId: appointment.dockAppointmentId,
      transportLegId: appointment.transportLegId,
      asnId: appointment.direction === "inbound" ? appointment.referenceId : null,
      shipmentId: appointment.direction === "outbound" ? appointment.referenceId : null
    });
  };

  const openFlow = (appointment: DockAppointment) => {
    if (appointment.direction === "inbound") openInboundInLogistics(appointment.referenceId);
    else if (appointment.direction === "outbound") openOutboundInLogistics(appointment.referenceId);
    else if (appointment.transportLegId) openTransportLegInLogistics(appointment.transportLegId, "transport");
  };

  return (
    <section className="panel min-h-[500px] rounded-2xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-twin-cyan/20 bg-twin-cyan/10 text-twin-blue"><CalendarClock size={18} /></span>
          <div><h2 className="font-semibold text-twin-text">Dock schedule and physical readiness</h2><p className="mt-0.5 text-xs text-twin-muted">Canonical appointments grouped by warehouse door, with yard, vehicle and handoff context.</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="focus">{visibleAppointments.length} appointments</StatusChip>
          <StatusChip tone={conflicts ? "critical" : "healthy"}>{conflicts} conflicts</StatusChip>
          <button className="rounded-lg border border-twin-border bg-white px-3 py-1.5 text-[11px] font-semibold text-twin-blue" onClick={() => setShowAll((value) => !value)}>{showAll ? "Active only" : "Include history"}</button>
        </div>
      </div>

      <div className="scroll-optimized mt-4 overflow-x-auto pb-1">
        <div className="grid min-w-max grid-flow-col auto-cols-[270px] gap-3 xl:auto-cols-[minmax(250px,1fr)]">
          {dockColumns.map(({ dock, appointments: dockAppointments }) => (
            <section key={dock.id} className="flex min-h-[380px] flex-col overflow-hidden rounded-xl border border-twin-blue/20 bg-gradient-to-b from-white to-sky-50/60 shadow-sm">
              <button
                className="border-b border-twin-border/70 bg-white px-3 py-3 text-left transition hover:bg-twin-blue/5"
                onClick={() => focusPhysicalDockInWarehouse({ dockId: dock.id })}
                aria-label={`Open physical dock ${dock.id}`}
              >
                <div className="flex items-start justify-between gap-3"><span><span className="block text-sm font-semibold text-twin-text">Dock {dock.id}</span><span className="mt-0.5 block text-[10px] text-twin-muted">{dockAppointments.length} visible appointments</span></span><StatusChip tone={dock.status === "available" ? "healthy" : dock.status === "maintenance" ? "critical" : "warning"}>{dock.status}</StatusChip></div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-twin-muted"><span>{dock.currentShipmentId ? `Current ${dock.currentShipmentId}` : "No active shipment"}</span><span className="inline-flex items-center gap-1 font-semibold text-twin-blue">Facility <LocateFixed size={10} /></span></div>
                <div className="mt-1 text-[10px] text-twin-muted">Next available {formatLocalDateTime(dock.nextAvailableAt)}</div>
              </button>

              <div className="flex flex-1 flex-col gap-2 p-2">
                {dockAppointments.map((appointment) => {
                  const selected = selectedDockAppointmentId === appointment.dockAppointmentId;
                  return (
                    <article key={appointment.dockAppointmentId} className={clsx("rounded-lg border bg-white p-3 shadow-sm transition", selected ? "border-twin-blue ring-2 ring-twin-blue/20" : appointment.conflictFlag ? "border-twin-critical/50" : "border-twin-border/70")}>
                      <button className="w-full text-left" onClick={() => selectAppointment(appointment)} aria-pressed={selected}>
                        <div className="flex items-start justify-between gap-2">
                          <span><span className="block text-xs font-semibold text-twin-text">{appointment.referenceId}</span><span className="mt-0.5 block font-mono text-[9px] text-twin-muted">{appointment.dockAppointmentId}</span></span>
                          <span className={clsx("inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-semibold uppercase", appointment.direction === "inbound" ? "bg-cyan-50 text-cyan-700" : "bg-blue-50 text-blue-700")}>{appointment.direction === "inbound" ? <ArrowDownToLine size={10} /> : <ArrowUpFromLine size={10} />}{appointment.direction}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-twin-text"><CalendarClock size={12} className="text-twin-blue" />{formatLocalDateTime(appointment.scheduledStart)}</div>
                        <div className="mt-1 text-[10px] text-twin-muted">to {formatLocalDateTime(appointment.scheduledEnd)}</div>
                        <div className="mt-2 flex items-center justify-between gap-2"><span className="min-w-0 truncate text-[10px] text-twin-muted" title={`${appointment.carrierName} · ${appointment.licensePlate}`}>{appointment.carrierName} · {appointment.licensePlate}</span><StatusChip tone={appointmentTone(appointment)}>{formatStatus(appointment.status)}</StatusChip></div>
                        {appointment.actualGateIn && <div className="mt-2 text-[10px] text-twin-muted">Gate in {formatLocalDateTime(appointment.actualGateIn)}</div>}
                        {appointment.conflictFlag && <div className="mt-2 flex items-center gap-1 border-t border-twin-critical/20 pt-2 text-[10px] font-semibold text-twin-critical"><AlertTriangle size={11} />Appointment conflict</div>}
                      </button>
                      {selected && (
                        <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-twin-border/60 pt-2">
                          <button className="inline-flex items-center justify-center gap-1 rounded-lg bg-twin-blue px-2 py-1.5 text-[10px] font-semibold text-white" onClick={() => openFlow(appointment)}><ArrowRight size={11} />Open flow</button>
                          <button className="inline-flex items-center justify-center gap-1 rounded-lg border border-twin-border bg-white px-2 py-1.5 text-[10px] font-semibold text-twin-blue" onClick={() => openTransportLegInLogistics(appointment.transportLegId, "transport")} disabled={!appointment.transportLegId}><Truck size={11} />Transport</button>
                        </div>
                      )}
                    </article>
                  );
                })}
                {!dockAppointments.length && <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-twin-border/70 px-3 py-8 text-center text-[11px] text-twin-muted">No {showAll ? "recorded" : "active"} appointment for this dock.</div>}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
