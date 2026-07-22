import type { WarehouseSnapshot } from "@twinops/shared";

export type OperationalReference =
  | { kind: "dock_appointment"; id: string; dockId: string; transportLegId: string; asnId: string | null; shipmentId: string | null }
  | { kind: "dock"; id: string }
  | { kind: "asn"; id: string }
  | { kind: "shipment"; id: string }
  | { kind: "route"; id: string }
  | { kind: "transport_leg"; id: string; routeId: string | null }
  | { kind: "zone"; id: string }
  | { kind: "stock_balance"; id: string };

/**
 * Resolves traceability identifiers against the live snapshot. Keeping this lookup in one place
 * prevents Dashboard and Audit from sending the same dock, ASN, shipment, or route to different
 * workspaces.
 */
export function resolveOperationalReference(
  snapshot: WarehouseSnapshot,
  candidates: Array<string | null | undefined>
): OperationalReference | null {
  for (const candidate of [...new Set(candidates.filter((value): value is string => Boolean(value)))]) {
    const appointment = snapshot.dockAppointments.find((item) => item.dockAppointmentId === candidate);
    if (appointment) {
      const leg = snapshot.transportLegs.find((item) => item.transportLegId === appointment.transportLegId);
      return {
        kind: "dock_appointment",
        id: appointment.dockAppointmentId,
        dockId: appointment.dockId,
        transportLegId: appointment.transportLegId,
        asnId: appointment.referenceType === "ASN" ? appointment.referenceId : leg?.asnId ?? null,
        shipmentId: appointment.referenceType === "Outbound Shipment" ? appointment.referenceId : leg?.shipmentId ?? null
      };
    }

    const dock = snapshot.docks.find((item) => item.id === candidate);
    if (dock) return { kind: "dock", id: dock.id };

    const inbound = snapshot.inventory.inboundShipments.find((item) => item.asnId === candidate);
    if (inbound) return { kind: "asn", id: inbound.asnId };

    const outbound = snapshot.inventory.outboundShipments.find((item) => item.shipmentId === candidate);
    if (outbound) return { kind: "shipment", id: outbound.shipmentId };

    const route = snapshot.routes.find((item) => item.id === candidate || item.routeId === candidate);
    if (route) return { kind: "route", id: route.routeId };

    const leg = snapshot.transportLegs.find((item) => item.transportLegId === candidate);
    if (leg) return { kind: "transport_leg", id: leg.transportLegId, routeId: leg.routeId ?? null };

    const zone = snapshot.zones.find((item) => item.id === candidate);
    if (zone) return { kind: "zone", id: zone.id };

    const placement = snapshot.inventoryPlacements.find((item) =>
      item.stockBalanceId === candidate || item.batchId === candidate || item.batchNo === candidate
    );
    if (placement) return { kind: "stock_balance", id: placement.stockBalanceId };
  }

  return null;
}
