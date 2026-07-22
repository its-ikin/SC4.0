import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  getDockAppointments,
  getInboundShipments,
  getInboundLines,
  getInventoryPlacements,
  getLogisticsData,
  getOperationalEvents,
  getOutboundShipments,
  getOutboundLines,
  getPartnerSites,
  getRoutes,
  getShipments,
  getTransportLegs,
  getProducts,
  getBatches,
  getStockBalances,
  getDocks,
  getInventoryMovements,
  getTemperatureReadings,
  getWarehouseLocations
} from "./db/database";

before(async () => {
  const { seedIfEmpty } = await import("./db/seed");
  seedIfEmpty();
});

describe("integrated WMS/TMS model", () => {
  it("uses one connected site, leg, route, and appointment graph", () => {
    const sites = getPartnerSites();
    const legs = getTransportLegs();
    const routes = getRoutes();
    const appointments = getDockAppointments();
    const siteIds = new Set(sites.map((site) => site.siteId));
    const routeIds = new Set(routes.map((route) => route.routeId));
    const appointmentIds = new Set(appointments.map((appointment) => appointment.dockAppointmentId));

    assert.ok(sites.length > 2);
    assert.ok(legs.some((leg) => leg.direction === "inbound"));
    assert.ok(legs.some((leg) => leg.direction === "outbound"));
    assert.equal(routes.length, legs.length);
    assert.equal(appointments.length, legs.length);

    for (const leg of legs) {
      assert.ok(siteIds.has(leg.originSiteId), `${leg.transportLegId} has an unknown origin site`);
      assert.ok(siteIds.has(leg.destinationSiteId), `${leg.transportLegId} has an unknown destination site`);
      assert.ok(routeIds.has(leg.routeId), `${leg.transportLegId} has no route projection`);
      assert.ok(appointmentIds.has(leg.dockAppointmentId), `${leg.transportLegId} has no dock appointment`);
    }
  });

  it("links every ASN and outbound shipment to the correct transport direction", () => {
    const legs = getTransportLegs();
    const appointments = getDockAppointments();
    const sites = getPartnerSites();
    const legById = new Map(legs.map((leg) => [leg.transportLegId, leg]));
    const appointmentById = new Map(appointments.map((appointment) => [appointment.dockAppointmentId, appointment]));
    const siteById = new Map(sites.map((site) => [site.siteId, site]));

    for (const inbound of getInboundShipments()) {
      assert.ok(inbound.transportLegId, `${inbound.asnId} has no transport leg`);
      assert.ok(inbound.dockAppointmentId, `${inbound.asnId} has no appointment`);
      assert.ok(inbound.supplierSiteId, `${inbound.asnId} has no supplier site`);
      const leg = legById.get(inbound.transportLegId!);
      const appointment = appointmentById.get(inbound.dockAppointmentId!);
      assert.equal(leg?.direction, "inbound");
      assert.equal(leg?.asnId, inbound.asnId);
      assert.equal(appointment?.referenceId, inbound.asnId);
      assert.equal(siteById.get(inbound.supplierSiteId!)?.role === "customer", false);
    }

    for (const outbound of getOutboundShipments()) {
      assert.ok(outbound.transportLegId, `${outbound.shipmentId} has no transport leg`);
      assert.ok(outbound.dockAppointmentId, `${outbound.shipmentId} has no appointment`);
      assert.ok(outbound.customerSiteId, `${outbound.shipmentId} has no customer site`);
      const leg = legById.get(outbound.transportLegId!);
      const appointment = appointmentById.get(outbound.dockAppointmentId!);
      assert.equal(leg?.direction, "outbound");
      assert.equal(leg?.shipmentId, outbound.shipmentId);
      assert.equal(appointment?.referenceId, outbound.shipmentId);
      assert.equal(siteById.get(outbound.customerSiteId!)?.role, "customer");
    }
  });

  it("keeps ASN and shipment schedule timestamps aligned with their transport legs", () => {
    const legById = new Map(getTransportLegs().map((leg) => [leg.transportLegId, leg]));
    const arrivedInboundStatuses = new Set([
      "Gate In",
      "At Receiving",
      "Unloading",
      "Received",
      "QA Pending",
      "QA Hold",
      "Released",
      "Putaway",
      "Putaway Complete",
      "Closed"
    ]);
    const preArrivalInboundStatuses = new Set([
      "ASN Received",
      "Appointment Booked",
      "Vehicle Assigned",
      "Scheduled",
      "In Transit"
    ]);
    const departedOutboundStatuses = new Set(["Goods Issued", "Dispatched", "Delivered"]);

    for (const inbound of getInboundShipments()) {
      const leg = legById.get(inbound.transportLegId!);
      assert.ok(leg, `${inbound.asnId} has no transport leg for schedule validation`);
      assert.equal(inbound.plannedArrival, leg.plannedArrival, `${inbound.asnId} planned arrival differs from transport`);
      assert.equal(inbound.actualArrival, leg.actualArrival, `${inbound.asnId} actual arrival differs from transport`);
      if (arrivedInboundStatuses.has(inbound.inboundStatus)) {
        assert.ok(inbound.actualArrival, `${inbound.asnId} is ${inbound.inboundStatus} but has no actual arrival`);
      }
      if (preArrivalInboundStatuses.has(inbound.inboundStatus)) {
        assert.equal(inbound.actualArrival, null, `${inbound.asnId} is ${inbound.inboundStatus} but already has an actual arrival`);
      }
    }

    for (const outbound of getOutboundShipments()) {
      const leg = legById.get(outbound.transportLegId!);
      assert.ok(leg, `${outbound.shipmentId} has no transport leg for schedule validation`);
      assert.equal(outbound.plannedDeparture, leg.plannedDeparture, `${outbound.shipmentId} planned departure differs from transport`);
      assert.equal(outbound.actualDeparture, leg.actualDeparture, `${outbound.shipmentId} actual departure differs from transport`);
      assert.equal(
        outbound.requiredBy,
        leg.deliveryWindowEnd ?? leg.plannedArrival,
        `${outbound.shipmentId} required-by time differs from the transport delivery target`
      );
      if (departedOutboundStatuses.has(outbound.outboundStatus)) {
        assert.ok(outbound.actualDeparture, `${outbound.shipmentId} is ${outbound.outboundStatus} but has no actual departure`);
      }
    }
  });

  it("keeps transport expected-SKU metadata aligned with WMS document lines", () => {
    const productCodeById = new Map(getProducts().map((product) => [product.productId, product.productCode]));
    const inboundLines = getInboundLines();
    const outboundLines = getOutboundLines();

    for (const route of getRoutes()) {
      const lines = route.direction === "inbound"
        ? inboundLines.filter((line) => line.asnId === route.asnId)
        : outboundLines.filter((line) => line.shipmentId === route.shipmentId);
      const expected = [...new Set(lines.map((line) => productCodeById.get(line.productId)).filter((code): code is string => Boolean(code)))].sort();
      assert.deepEqual([...route.expectedSkus].sort(), expected, `${route.transportLegId} expected SKUs differ from its WMS lines`);
    }
  });

  it("keeps received ASN headers consistent with their receipt lines", () => {
    const lines = getInboundLines();
    const receivedShipments = getInboundShipments().filter((shipment) => shipment.inboundStatus === "Received");
    assert.ok(receivedShipments.length > 0);
    for (const shipment of receivedShipments) {
      const shipmentLines = lines.filter((line) => line.asnId === shipment.asnId);
      const expected = shipmentLines.reduce((sum, line) => sum + line.qtyExpected, 0);
      const received = shipmentLines.reduce((sum, line) => sum + line.qtyReceived, 0);
      assert.ok(shipmentLines.length > 0, `${shipment.asnId} is Received but has no receipt lines`);
      assert.ok(expected > 0, `${shipment.asnId} is Received but has no expected quantity`);
      assert.equal(received, expected, `${shipment.asnId} is Received but its receipt is incomplete`);
    }
  });

  it("derives the Warehouse shipment compatibility view from outbound WMS records", () => {
    const outbound = getOutboundShipments();
    const projected = getShipments();
    assert.deepEqual(
      projected.map((shipment) => shipment.id).sort(),
      outbound.map((shipment) => shipment.shipmentId).sort()
    );
    for (const shipment of projected) {
      const source = outbound.find((item) => item.shipmentId === shipment.id)!;
      assert.equal(shipment.status, source.outboundStatus);
      assert.equal(shipment.dockId, source.dock);
      assert.equal(shipment.transportLegId, source.transportLegId);
      const lines = getOutboundLines().filter((line) => line.shipmentId === shipment.id);
      assert.deepEqual(shipment.productIds.slice().sort(), [...new Set(lines.map((line) => line.productId))].sort());
      assert.deepEqual(shipment.batchIds.slice().sort(), [...new Set(lines.map((line) => line.batchId))].sort());
    }
  });

  it("preserves product, batch, balance, warehouse, inbound, outbound, and transport identity", () => {
    const productIds = new Set(getProducts().map((product) => product.productId));
    const batchById = new Map(getBatches().map((batch) => [batch.batchId, batch]));
    const balances = getStockBalances();
    const balanceById = new Map(balances.map((balance) => [balance.stockBalanceId, balance]));
    const placements = getInventoryPlacements();
    const inboundById = new Map(getInboundShipments().map((shipment) => [shipment.asnId, shipment]));
    const outboundById = new Map(getOutboundShipments().map((shipment) => [shipment.shipmentId, shipment]));
    const projectedById = new Map(getShipments().map((shipment) => [shipment.id, shipment]));
    const transportLegIds = new Set(getTransportLegs().map((leg) => leg.transportLegId));

    for (const placement of placements) {
      const balance = balanceById.get(placement.stockBalanceId);
      assert.ok(balance, `${placement.stockBalanceId} has no canonical stock balance`);
      assert.equal(balance.batchId, placement.batchId);
      assert.equal(balance.locationId, placement.locationId);
      assert.equal(batchById.get(placement.batchId!)?.productId, placement.productId);
      assert.ok(productIds.has(placement.productId!), `${placement.stockBalanceId} has no product master`);
      if (placement.linkedShipmentId) {
        const shipment = projectedById.get(placement.linkedShipmentId);
        assert.ok(shipment, `${placement.stockBalanceId} links to an unknown outbound shipment`);
        assert.ok(shipment.stockBalanceIds.includes(placement.stockBalanceId));
        assert.ok(shipment.batchIds.includes(placement.batchId!));
        assert.ok(shipment.productIds.includes(placement.productId!));
      }
    }

    for (const line of getInboundLines()) {
      const shipment = inboundById.get(line.asnId);
      assert.ok(shipment, `${line.inboundLineId} has no inbound shipment`);
      assert.ok(productIds.has(line.productId));
      assert.equal(batchById.get(line.batchId)?.productId, line.productId);
      assert.ok(shipment.transportLegId && transportLegIds.has(shipment.transportLegId));
    }

    for (const line of getOutboundLines()) {
      const shipment = outboundById.get(line.shipmentId);
      const projected = projectedById.get(line.shipmentId);
      assert.ok(shipment, `${line.outboundLineId} has no outbound shipment`);
      assert.ok(projected, `${line.outboundLineId} has no Warehouse shipment projection`);
      assert.ok(projected.productIds.includes(line.productId));
      assert.ok(projected.batchIds.includes(line.batchId));
      assert.equal(batchById.get(line.batchId)?.productId, line.productId);
      assert.ok(shipment.transportLegId && transportLegIds.has(shipment.transportLegId));
      for (const stockBalanceId of projected.stockBalanceIds) {
        assert.ok(balanceById.has(stockBalanceId), `${line.shipmentId} contains unknown balance ${stockBalanceId}`);
      }
    }
  });

  it("publishes auditable milestones and an explicit simulation disclosure", () => {
    const logistics = getLogisticsData();
    const events = getOperationalEvents();
    const referencedLegs = new Set(events.map((event) => event.transportLegId).filter(Boolean));

    assert.match(logistics.simulationDisclosure, /simulated/i);
    assert.match(logistics.simulationDisclosure, /does not represent actual/i);
    assert.ok(events.length > 0);
    for (const leg of logistics.transportLegs) {
      assert.ok(referencedLegs.has(leg.transportLegId), `${leg.transportLegId} has no audit milestone`);
    }
    for (const site of logistics.partnerSites) {
      assert.equal(site.simulated, true);
      assert.ok(site.dataNotice.length > 20);
    }
  });

  it("keeps road status, schedule adherence, ETA, appointments, and dock occupancy distinct", () => {
    const logistics = getLogisticsData();
    const routeByLeg = new Map(getRoutes().map((route) => [route.transportLegId, route]));
    const occupiedStatuses = new Set(["checked_in", "at_dock", "loading", "unloading"]);

    for (const leg of logistics.transportLegs) {
      assert.equal(leg.routeStatus, routeByLeg.get(leg.transportLegId)?.status, `${leg.transportLegId} road status drifted in Logistics`);
      assert.match(leg.estimatedArrival, /Z$/, `${leg.transportLegId} ETA has no timezone`);
      assert.ok(Number.isFinite(Date.parse(leg.estimatedArrival)), `${leg.transportLegId} ETA is invalid`);
      assert.ok(
        Date.parse(leg.estimatedArrival) >= Date.parse(leg.actualDeparture ?? leg.plannedDeparture),
        `${leg.transportLegId} ETA precedes its departure`
      );
      assert.ok(["on-time", "delayed", "unknown"].includes(leg.scheduleAdherence ?? "unknown"));
    }

    for (const dock of getDocks()) {
      const active = logistics.dockAppointments
        .filter((appointment) => appointment.dockId === dock.id && occupiedStatuses.has(appointment.status))
        .sort((a, b) => Date.parse(b.actualDockIn ?? b.actualGateIn ?? b.scheduledStart) - Date.parse(a.actualDockIn ?? a.actualGateIn ?? a.scheduledStart))[0];
      assert.equal(dock.status, active ? "occupied" : "available", `${dock.id} occupancy disagrees with its appointment`);
      assert.equal(dock.currentShipmentId, active?.referenceId ?? null, `${dock.id} current reference is stale`);
    }

    const byDock = new Map<string, typeof logistics.dockAppointments>();
    logistics.dockAppointments.forEach((appointment) => byDock.set(appointment.dockId, [...(byDock.get(appointment.dockId) ?? []), appointment]));
    byDock.forEach((appointments) => {
      const ordered = [...appointments].sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart));
      ordered.forEach((appointment, index) => {
        const overlapsEarlier = ordered.slice(0, index).some((earlier) => Date.parse(appointment.scheduledStart) < Date.parse(earlier.scheduledEnd));
        assert.equal(appointment.conflictFlag, overlapsEarlier, `${appointment.dockAppointmentId} conflict flag is inaccurate`);
      });
    });
  });

  it("aligns transport handling and telemetry references with the products actually carried", () => {
    const products = new Map(getProducts().map((product) => [product.productId, product]));
    const batches = new Set(getBatches().map((batch) => batch.batchId));
    const balances = new Set(getStockBalances().map((balance) => balance.stockBalanceId));
    const inboundLines = getInboundLines();
    const outboundLines = getOutboundLines();

    for (const leg of getTransportLegs()) {
      const lines = leg.direction === "inbound"
        ? inboundLines.filter((line) => line.asnId === leg.asnId)
        : outboundLines.filter((line) => line.shipmentId === leg.shipmentId);
      const bands = lines.map((line) => products.get(line.productId)?.defaultTempBand);
      const expectedRequirement = bands.some((band) => band === "2-8 C")
        ? "2-8C"
        : bands.some((band) => band === "15-25 C") ? "15-25C" : "ambient";
      assert.equal(leg.temperatureRequirement, expectedRequirement, `${leg.transportLegId} temperature handling differs from its WMS lines`);
    }

    for (const reading of getTemperatureReadings()) {
      reading.relatedSkuIds.forEach((id) => assert.ok(balances.has(id), `${reading.zoneId} reading references unknown balance ${id}`));
      reading.relatedBatchIds.forEach((id) => assert.ok(batches.has(id), `${reading.zoneId} reading references unknown batch ${id}`));
    }
  });

  it("keeps execution movements and audit milestones consistent with current WMS buckets", () => {
    const movements = getInventoryMovements();
    const locations = new Set(getWarehouseLocations().map((location) => location.locationId));
    const movementKey = new Set(movements.map((movement) => `${movement.referenceId}:${movement.movementType}`));

    for (const line of getOutboundLines()) {
      if (line.qtyAllocated > 0) assert.ok(movementKey.has(`${line.shipmentId}:Reserve`), `${line.shipmentId} has allocated stock without a reserve movement`);
      if (line.qtyPicked > 0) assert.ok(movementKey.has(`${line.shipmentId}:Pick`), `${line.shipmentId} has picked stock without a pick movement`);
      if (line.qtyPacked > 0) assert.ok(movementKey.has(`${line.shipmentId}:Pack`), `${line.shipmentId} has packed stock without a pack movement`);
    }
    movements.forEach((movement) => {
      if (movement.fromLocationId) assert.ok(locations.has(movement.fromLocationId), `${movement.movementId} has unknown source ${movement.fromLocationId}`);
      if (movement.toLocationId) assert.ok(locations.has(movement.toLocationId), `${movement.movementId} has unknown destination ${movement.toLocationId}`);
    });
    const future = getOperationalEvents().filter((event) => Date.parse(event.timestamp) > Date.now() + 1_000);
    assert.deepEqual(future, [], `Operational history contains future events: ${future.map((event) => event.eventId).join(", ")}`);
  });
});
