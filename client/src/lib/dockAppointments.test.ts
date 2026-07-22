import { describe, expect, it } from "vitest";
import { effectiveDockAppointments } from "./dockAppointments";
import { makeNavigationSnapshot } from "../test/navigationFixture";

describe("effectiveDockAppointments", () => {
  it("uses canonical appointments without merging or overriding them with the legacy schedule", () => {
    const snapshot = makeNavigationSnapshot();
    snapshot.dockSchedule = [{
      id: "LEGACY-APPT",
      dockId: "D-02",
      shipmentId: "SHIP-OUT",
      startTime: "2026-07-18T09:00:00.000Z",
      endTime: "2026-07-18T10:00:00.000Z",
      status: "cancelled",
      conflictFlag: true
    }];

    const appointments = effectiveDockAppointments(snapshot);

    expect(appointments).toBe(snapshot.dockAppointments);
    expect(appointments.map((item) => item.dockAppointmentId)).toEqual(["APPT-IN", "APPT-OUT"]);
    expect(appointments).not.toContainEqual(expect.objectContaining({ dockAppointmentId: "LEGACY-APPT" }));
  });

  it("projects legacy schedule rows only when canonical appointments are empty", () => {
    const snapshot = makeNavigationSnapshot();
    snapshot.dockAppointments = [];
    snapshot.dockSchedule = [
      {
        id: "LEGACY-IN",
        dockId: "D-01",
        shipmentId: "ASN-IN",
        startTime: "2026-07-18T09:00:00.000Z",
        endTime: "2026-07-18T10:00:00.000Z",
        status: "checked in",
        conflictFlag: false,
        direction: "inbound",
        transportLegId: "LEG-IN",
        referenceType: "ASN"
      },
      {
        id: "LEGACY-OUT",
        dockId: "D-02",
        shipmentId: "SHIP-OUT",
        startTime: "2026-07-18T10:00:00.000Z",
        endTime: "2026-07-18T11:00:00.000Z",
        status: "cancelled",
        conflictFlag: true,
        direction: "outbound",
        transportLegId: "LEG-OUT",
        referenceType: "Outbound Shipment"
      }
    ];

    expect(effectiveDockAppointments(snapshot)).toEqual([
      expect.objectContaining({
        dockAppointmentId: "LEGACY-IN",
        dockId: "D-01",
        direction: "inbound",
        transportLegId: "LEG-IN",
        referenceId: "ASN-IN",
        status: "checked_in",
        conflictFlag: false
      }),
      expect.objectContaining({
        dockAppointmentId: "LEGACY-OUT",
        dockId: "D-02",
        direction: "outbound",
        transportLegId: "LEG-OUT",
        referenceId: "SHIP-OUT",
        status: "cancelled",
        conflictFlag: true
      })
    ]);
  });
});
