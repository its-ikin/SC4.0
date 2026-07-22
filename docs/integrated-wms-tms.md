# Integrated WMS/TMS operating model

TwinOps uses one operational model across Inventory, Logistics, Warehouse, Monitoring, and Audit. The UI views are different projections of the same warehouse and transport records; they are not separate programs or independent copies of shipment state.

## Simulation boundary

All orders, commercial relationships, quantities, vehicles, carriers, appointments, and operating events are simulated for academic demonstration. Public Singapore facility names or locations are used only to create geographically plausible lanes. They do not imply that any named organisation supplies, purchases, transports, or stores products for another named organisation.

## Sources of truth

- `partner_sites` identifies the warehouse, supplier, gateway, return, and customer receiving sites.
- `transport_legs` connects an ASN or outbound shipment to its origin, destination, vehicle, carrier, route, temperature requirement, and transport status.
- `dock_appointments` connects a transport leg to its warehouse door and planned/actual service window.
- `inbound_shipments` and `inbound_lines` are the WMS source for expected and received stock.
- `outbound_shipments` and `outbound_lines` are the WMS source for allocation and fulfilment.
- `inventory_movements` records quantity-changing warehouse execution.
- `operational_events` records non-quantity milestones across the WMS and TMS.
- Compatibility objects used by older Warehouse components are derived from these records and must not become a second mutable source.

Every cross-domain object uses stable IDs. A screen should navigate by ID and resolve the current record from the warehouse snapshot rather than copying a label, status, coordinate, or quantity into local state.

## Inbound process

1. Purchase order and ASN are created externally.
2. ASN is linked to the supplier site and an inbound transport leg.
3. A receiving appointment reserves an appropriate dock and temperature staging capability.
4. Transport progresses through planned, assigned, in transit, arrived, and at-dock milestones.
5. Receiving verifies vehicle, seal, temperature logger, handling units, batch, expiry, and expected quantity.
6. Goods receipt posts received quantity, but stock remains unavailable while quality review is required.
7. Quality disposition releases, holds, or quarantines the batch.
8. A putaway task moves released stock to a compatible location.
9. Putaway confirmation makes eligible quantity available for allocation.

## Outbound process

1. Customer order creates an outbound delivery and required delivery window.
2. Wave release applies FEFO and quality eligibility rules.
3. Allocation reserves released stock; shortfalls or held lots block the delivery.
4. Replenishment moves stock to the pick face when needed.
5. Pick, pack, and staging confirmations update line quantities and operational events.
6. A linked outbound transport leg and dock appointment control vehicle arrival and loading.
7. Load verification confirms handling units, seal, route, and temperature capability.
8. Goods issue posts dispatched quantity and inventory movements.
9. The TMS records delivery and proof of delivery. A failed delivery creates an exception or return leg rather than reversing history.

## Cross-view behaviour

- Inventory Inbound selects an ASN and opens its linked inbound transport leg in Logistics.
- Inventory Outbound selects a shipment and opens its outbound leg and customer in Logistics.
- Logistics route, marker, and vehicle details open the linked ASN or shipment in Inventory.
- Warehouse dock details resolve the active appointment and linked transport leg.
- Monitoring exceptions reference the same batch, shipment, route, appointment, and site IDs.
- Audit combines inventory movements, operational events, cold-chain events, alerts, and decisions into one chronological ledger.

## Data integrity rules

- Every inbound shipment has a valid supplier site, transport leg, route, and receiving appointment.
- Every outbound shipment has a valid customer site, transport leg, route, and dispatch appointment.
- A transport leg's origin and destination sites must match its direction.
- QA Hold, Quarantine, Pending QA, and expired stock cannot be allocated or dispatched.
- Cold-chain loads require a compatible dock/staging flow and a vehicle with the required temperature capability.
- Planned timestamps are never overwritten by actual timestamps.
- Status is derived from recorded milestones wherever possible; labels alone must not mutate inventory.
- Every state-changing action is append-only in Audit even when the current-state record is updated.

## Routing

Routes should be calculated server-side from stored site coordinates. Provider results may update geometry, distance, and duration, while the site, reference, direction, and audit history remain stable. Provider failures fall back to cached geometry and are shown explicitly in the UI.

