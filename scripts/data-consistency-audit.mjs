const baseUrl = process.argv[2] ?? "http://localhost:3002";

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

const [warehouse, inventory, logistics, issues] = await Promise.all([
  get("/api/warehouse"),
  get("/api/inventory"),
  get("/api/logistics"),
  get("/api/issues")
]);

const failures = [];
const checks = [];
const check = (condition, message, detail = "") => {
  if (condition) checks.push(message);
  else failures.push(detail ? `${message}: ${detail}` : message);
};
const sum = (rows, value) => rows.reduce((total, row) => total + Number(value(row) ?? 0), 0);

const productById = new Map(inventory.products.map((row) => [row.productId, row]));
const batchById = new Map(inventory.batches.map((row) => [row.batchId, row]));
const balanceById = new Map(inventory.stockBalances.map((row) => [row.stockBalanceId, row]));
const locationById = new Map(inventory.locations.map((row) => [row.locationId, row]));
const placementByBalance = new Map(warehouse.inventoryPlacements.map((row) => [row.stockBalanceId, row]));
const inboundById = new Map(inventory.inboundShipments.map((row) => [row.asnId, row]));
const outboundById = new Map(inventory.outboundShipments.map((row) => [row.shipmentId, row]));
const legById = new Map(logistics.transportLegs.map((row) => [row.transportLegId, row]));
const appointmentById = new Map(logistics.dockAppointments.map((row) => [row.dockAppointmentId, row]));

check(inventory.stockBalances.length === warehouse.inventoryPlacements.length,
  "Every stock balance has one warehouse placement",
  `${inventory.stockBalances.length} balances vs ${warehouse.inventoryPlacements.length} placements`);

for (const balance of inventory.stockBalances) {
  const placement = placementByBalance.get(balance.stockBalanceId);
  const batch = batchById.get(balance.batchId);
  check(Boolean(placement), `Placement exists for ${balance.stockBalanceId}`);
  check(Boolean(batch), `Batch exists for ${balance.stockBalanceId}`, balance.batchId);
  check(Boolean(locationById.get(balance.locationId)), `Location exists for ${balance.stockBalanceId}`, balance.locationId);
  if (placement) {
    check(placement.batchId === balance.batchId && placement.locationId === balance.locationId,
      `Warehouse placement matches WMS balance ${balance.stockBalanceId}`,
      `${placement.batchId}/${placement.locationId} vs ${balance.batchId}/${balance.locationId}`);
  }
  if (batch) check(Boolean(productById.get(batch.productId)), `Product exists for batch ${batch.batchId}`, batch.productId);
}

for (const location of inventory.locations) {
  const liveFill = sum(inventory.stockBalances.filter((row) => row.locationId === location.locationId), (row) => row.qtyOnHand);
  check(Number(location.currentFill) === liveFill, `Location fill matches balances at ${location.locationId}`,
    `${location.currentFill} vs ${liveFill}`);
}

for (const zone of warehouse.zones) {
  const zoneLocations = inventory.locations.filter((location) => location.zone === zone.name);
  const physicalCapacity = sum(zoneLocations, (location) => location.capacity);
  if (physicalCapacity > 0) {
    check(Number(zone.capacityUnits) === physicalCapacity, `Zone capacity matches location master for ${zone.id}`,
      `${zone.capacityUnits} vs ${physicalCapacity}`);
  }
}

for (const placement of warehouse.inventoryPlacements) {
  if (["QA Hold", "Pending QA"].includes(placement.qualityStatus)) {
    const cold = placement.temperatureMin === 2 && placement.temperatureMax === 8;
    check(cold ? placement.zoneId === "QAC" : placement.zoneId === "QA",
      `Held stock is in a temperature-compatible QA area: ${placement.stockBalanceId}`,
      `${placement.qualityStatus}/${placement.zoneId}/${placement.temperatureMin}-${placement.temperatureMax} C`);
  }
  if (placement.qualityStatus === "Quarantine") {
    check(placement.zoneId === "QT", `Quarantined stock is segregated: ${placement.stockBalanceId}`, placement.zoneId);
  }
}

for (const shipment of inventory.inboundShipments) {
  const lines = inventory.inboundLines.filter((line) => line.asnId === shipment.asnId);
  const expected = sum(lines, (line) => line.qtyExpected);
  const received = sum(lines, (line) => line.qtyReceived);
  check(lines.length > 0, `Inbound ${shipment.asnId} has product lines`);
  check(received <= expected, `Inbound receipt does not exceed expected for ${shipment.asnId}`, `${received}/${expected}`);
  if (shipment.inboundStatus === "Received") {
    check(received === expected, `Received ASN is fully received: ${shipment.asnId}`, `${received}/${expected}`);
  }
  if (["Received", "QA Pending", "QA Hold", "Released", "Putaway", "Putaway Complete", "Closed"].includes(shipment.inboundStatus)) {
    check(Boolean(shipment.goodsReceiptNumber), `Posted inbound stage has a goods-receipt reference: ${shipment.asnId}`);
  }
  const leg = legById.get(shipment.transportLegId);
  const appointment = appointmentById.get(shipment.dockAppointmentId);
  check(Boolean(leg) && leg.asnId === shipment.asnId, `Inbound ${shipment.asnId} links to its transport leg`);
  check(Boolean(appointment) && appointment.referenceId === shipment.asnId && appointment.dockId === shipment.receivingDock,
    `Inbound ${shipment.asnId} links to its dock appointment`);
}

for (const shipment of inventory.outboundShipments) {
  const lines = inventory.outboundLines.filter((line) => line.shipmentId === shipment.shipmentId);
  check(lines.length > 0, `Outbound ${shipment.shipmentId} has product lines`);
  for (const line of lines) {
    check(line.qtyRequired >= line.qtyAllocated
      && line.qtyAllocated >= line.qtyPicked
      && line.qtyPicked >= line.qtyPacked
      && line.qtyPacked >= line.qtyDispatched,
    `Outbound quantity chain is monotonic for ${line.outboundLineId}`,
    `${line.qtyRequired}/${line.qtyAllocated}/${line.qtyPicked}/${line.qtyPacked}/${line.qtyDispatched}`);
    check(Boolean(batchById.get(line.batchId)) && Boolean(productById.get(line.productId)),
      `Outbound line references canonical product and batch: ${line.outboundLineId}`);
  }
  if (shipment.outboundStatus === "Blocked") {
    check(sum(lines, (line) => line.qtyDispatched) === 0,
      `Blocked outbound has not dispatched: ${shipment.shipmentId}`);
  }
  const leg = legById.get(shipment.transportLegId);
  const appointment = appointmentById.get(shipment.dockAppointmentId);
  check(Boolean(leg) && leg.shipmentId === shipment.shipmentId, `Outbound ${shipment.shipmentId} links to its transport leg`);
  check(Boolean(appointment) && appointment.referenceId === shipment.shipmentId && appointment.dockId === shipment.dock,
    `Outbound ${shipment.shipmentId} links to its dock appointment`);
}

for (const leg of logistics.transportLegs) {
  for (const field of ["plannedDeparture", "plannedArrival", "estimatedArrival", "lastUpdatedAt"]) {
    const value = leg[field];
    check(typeof value === "string" && /Z$/.test(value) && Number.isFinite(Date.parse(value)),
      `Transport ${leg.transportLegId} has an unambiguous ${field}`, String(value));
  }
  const departure = Date.parse(leg.actualDeparture ?? leg.plannedDeparture);
  check(Date.parse(leg.estimatedArrival) >= departure,
    `Transport ETA follows departure for ${leg.transportLegId}`,
    `${leg.estimatedArrival} before ${leg.actualDeparture ?? leg.plannedDeparture}`);
  check(["on-time", "delayed", "unknown"].includes(leg.scheduleAdherence),
    `Transport ${leg.transportLegId} exposes schedule adherence separately`, String(leg.scheduleAdherence));
}

const activeAppointmentStatuses = new Set(["checked_in", "at_dock", "loading", "unloading"]);
for (const dock of warehouse.docks) {
  const active = warehouse.dockAppointments
    .filter((appointment) => appointment.dockId === dock.id && activeAppointmentStatuses.has(appointment.status))
    .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt))[0];
  check(dock.status === (active ? "occupied" : "available"), `Dock occupancy matches appointments for ${dock.id}`,
    `${dock.status} vs ${active?.status ?? "none"}`);
  check((dock.currentShipmentId ?? null) === (active?.referenceId ?? null), `Dock reference matches active appointment for ${dock.id}`,
    `${dock.currentShipmentId ?? "none"} vs ${active?.referenceId ?? "none"}`);
}

for (const movement of inventory.movements) {
  check(Boolean(productById.get(movement.productId)) && Boolean(batchById.get(movement.batchId)),
    `Movement ${movement.movementId} references canonical stock`);
  for (const locationId of [movement.fromLocationId, movement.toLocationId].filter(Boolean)) {
    check(Boolean(locationById.get(locationId)), `Movement ${movement.movementId} references known location ${locationId}`);
  }
}

for (const reading of warehouse.temperatureReadings) {
  for (const stockBalanceId of reading.relatedSkuIds ?? []) {
    check(Boolean(balanceById.get(stockBalanceId)), `Temperature reading references stock balance ${stockBalanceId}`);
  }
  for (const batchId of reading.relatedBatchIds ?? []) {
    check(Boolean(batchById.get(batchId)), `Temperature reading references batch ${batchId}`);
  }
}

const issueIds = [...issues].map((issue) => issue.id).sort();
const warehouseIssueIds = warehouse.operationalIssues.map((issue) => issue.id).sort();
check(JSON.stringify(issueIds) === JSON.stringify(warehouseIssueIds),
  "Warehouse, Dashboard and Audit use the same active issue set");

const futureOperationalEvents = warehouse.operationalEvents.filter((event) => Date.parse(event.timestamp) > Date.now() + 1_000);
check(futureOperationalEvents.length === 0, "Operational history contains no future events",
  futureOperationalEvents.map((event) => `${event.referenceId}:${event.step}:${event.timestamp}`).join(", "));

console.log(`Consistency audit: ${checks.length} checks passed, ${failures.length} failed.`);
if (failures.length) {
  failures.forEach((failure) => console.error(`FAIL ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Validated ${inventory.products.length} products, ${inventory.batches.length} lots, ${inventory.stockBalances.length} stock positions, ${inventory.inboundShipments.length} ASNs, ${inventory.outboundShipments.length} outbound shipments and ${logistics.transportLegs.length} transport legs.`);
}
