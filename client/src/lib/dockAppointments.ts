import type { DockAppointment, DockAppointmentStatus, WarehouseSnapshot } from "@twinops/shared";

const appointmentStatuses: DockAppointmentStatus[] = [
  "booked",
  "checked_in",
  "at_dock",
  "loading",
  "unloading",
  "completed",
  "missed",
  "cancelled",
  "exception"
];

function legacyStatus(value: string): DockAppointmentStatus {
  const normalised = value.toLowerCase().replaceAll(" ", "_");
  return appointmentStatuses.includes(normalised as DockAppointmentStatus)
    ? normalised as DockAppointmentStatus
    : "booked";
}

/** Canonical appointments take precedence; the legacy schedule is only a compatibility fallback. */
export function effectiveDockAppointments(snapshot: WarehouseSnapshot): DockAppointment[] {
  if (snapshot.dockAppointments.length) return snapshot.dockAppointments;

  return snapshot.dockSchedule.map((entry) => {
    const leg = snapshot.transportLegs.find((item) =>
      item.transportLegId === entry.transportLegId || item.shipmentId === entry.shipmentId || item.asnId === entry.shipmentId
    );
    const direction = entry.direction ?? leg?.direction ?? "outbound";
    return {
      dockAppointmentId: entry.id,
      dockId: entry.dockId,
      direction,
      transportLegId: entry.transportLegId ?? leg?.transportLegId ?? "",
      referenceType: entry.referenceType ?? (direction === "inbound" ? "ASN" : "Outbound Shipment"),
      referenceId: entry.shipmentId,
      scheduledStart: entry.startTime,
      scheduledEnd: entry.endTime,
      actualGateIn: null,
      actualDockIn: null,
      actualDockOut: null,
      actualGateOut: null,
      status: legacyStatus(entry.status),
      carrierId: leg?.carrierId ?? "unassigned",
      carrierName: leg?.carrierName ?? "Carrier not assigned",
      vehicleId: leg?.vehicleId ?? "unassigned",
      licensePlate: leg?.licensePlate ?? "Plate not recorded",
      temperatureRequirement: leg?.temperatureRequirement ?? "ambient",
      conflictFlag: entry.conflictFlag,
      notes: "Compatibility schedule record",
      lastUpdatedAt: leg?.lastUpdatedAt ?? entry.startTime
    };
  });
}
