import type {
  Alert,
  DockSchedule,
  InboundRoute,
  RiskLevel,
  Shipment,
  InventoryPlacement,
  ToolCallSummary,
  WarehouseSnapshot,
  Zone
} from "@twinops/shared";
import { buildInventoryPlanning } from "@twinops/shared";
import {
  addHours,
  addMinutes,
  alertFromRow,
  db,
  getBatchDetail,
  getBatches,
  getDockSchedule,
  getDockAppointments,
  getDocks,
  getInboundLines,
  getInboundShipments,
  getInventoryMovements,
  getInventoryData,
  getInventorySummary,
  getLogisticsData,
  getOutboundLines,
  getOutboundShipments,
  getProductStock,
  getProductStockPositions,
  getProducts,
  getPartnerSites,
  getRoutes,
  getShipments,
  getInventoryPlacements,
  getStockBalances,
  getTemperatureEvents,
  getWarehouseSnapshot,
  getWarehouseLocations,
  getZones,
  nowIso,
  routeFromRow,
  zoneFromRow
} from "./db/database";
import { fetchLiveWeather, type LiveWeatherReading } from "./weatherService";

const stringify = (value: unknown) => JSON.stringify(value);
const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const actionId = (prefix = "ACT") => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

const stageChain = ["Inbound", "Receiving", "Storage", "Picking", "Packing", "Dock Staging", "Dispatch"];

function findInventoryPlacement(identifier: string): InventoryPlacement {
  const needle = identifier.trim().toLowerCase();
  const placement = getInventoryPlacements().find(
    (candidate) =>
      candidate.stockBalanceId.toLowerCase() === needle ||
      candidate.batchId?.toLowerCase() === needle ||
      candidate.batchNo.toLowerCase() === needle ||
      candidate.productCode?.toLowerCase() === needle
  );
  if (!placement) throw new Error(`Inventory placement ${identifier} was not found in the simulated warehouse database.`);
  return placement;
}

function findShipment(shipmentId: string): Shipment {
  const shipment = getShipments().find((item) => item.id === shipmentId);
  if (!shipment) throw new Error(`Shipment ${shipmentId} was not found in the simulated warehouse database.`);
  return shipment;
}

function findZone(zoneIdOrName: string): Zone {
  const needle = zoneIdOrName.trim().toLowerCase();
  const row = db
    .prepare("SELECT * FROM zones WHERE lower(id) = ? OR lower(code) = ? OR lower(name) = ?")
    .get(needle, needle, needle);
  if (!row) throw new Error(`Zone ${zoneIdOrName} was not found in the simulated warehouse database.`);
  return zoneFromRow(row);
}

function findRoute(routeName: string): InboundRoute {
  const needle = routeName.trim().toLowerCase();
  const row = db
    .prepare("SELECT * FROM inbound_routes WHERE lower(name) = ? OR lower(id) = ? OR lower(name) LIKE ?")
    .get(needle, needle, `%${needle}%`);
  if (!row) throw new Error(`Inbound route ${routeName} was not found in the simulated warehouse database.`);
  return routeFromRow(row);
}

function normaliseFilters(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String);
  return String(input)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isHoldStatus(status: string) {
  return status === "QA Hold" || status === "Pending QA" || status === "Quarantine" || status === "Expired";
}

function excludedReasons(batch: {
  qualityStatus: string;
  expiryDate: string;
  qtyAvailable: number;
  location?: { tempBand?: string; zone?: string };
}, requiredTempBand?: string) {
  const reasons: string[] = [];
  if (batch.qualityStatus !== "Released") reasons.push(batch.qualityStatus);
  if (new Date(batch.expiryDate).getTime() <= Date.now()) reasons.push("Expired");
  if (batch.qtyAvailable <= 0) reasons.push("No available quantity");
  if (requiredTempBand && batch.location?.tempBand && batch.location.tempBand !== requiredTempBand) reasons.push("Temperature band mismatch");
  if (batch.location?.zone === "Quarantine") reasons.push("Quarantine");
  if (batch.location?.zone === "QA Hold") reasons.push("QA Hold");
  return [...new Set(reasons)];
}

function productIdFromInput(productIdOrCode: string) {
  const needle = productIdOrCode.trim().toLowerCase();
  const product = getProducts().find(
    (item) => item.productId.toLowerCase() === needle || item.productCode.toLowerCase() === needle || item.productName.toLowerCase().includes(needle)
  );
  if (product) return product.productId;

  const placement = getInventoryPlacements().find(
    (item) =>
      item.stockBalanceId.toLowerCase() === needle ||
      item.batchId?.toLowerCase() === needle ||
      item.batchNo.toLowerCase() === needle ||
      item.productCode?.toLowerCase() === needle
  );
  return placement?.productId ?? productIdOrCode;
}

function movementLabel(value: string | null | undefined) {
  return value ?? "-";
}

/** Compatibility tool name retained for agent clients; the identifier is a stock balance. */
export function locate_sku(stockBalanceId: string) {
  const sku = findInventoryPlacement(stockBalanceId);
  const zone = findZone(sku.zoneId);
  const sameZone = getInventoryPlacements()
    .filter((candidate) => candidate.zoneId === sku.zoneId && candidate.qualityStatus !== "Quarantine")
    .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  const fefoPosition = sameZone.findIndex((candidate) => candidate.stockBalanceId === sku.stockBalanceId) + 1;
  const stageImpacts = sku.linkedShipmentId
    ? ["Storage", "Picking", "Packing", "Dock Staging", "Dispatch"]
    : [sku.currentStage];

  return {
    stockBalanceId: sku.stockBalanceId,
    productCode: sku.productCode,
    productName: sku.productName,
    category: sku.category,
    zone: {
      id: zone.id,
      name: zone.name,
      status: zone.status,
      currentTemperature: zone.currentTemperature
    },
    rack: sku.rack,
    bin: sku.bin,
    batchNo: sku.batchNo,
    expiryDate: sku.expiryDate,
    quantity: sku.quantity,
    priority: sku.priority,
    temperatureBand: `${sku.temperatureMin}-${sku.temperatureMax} C`,
    qualityReleaseStatus: sku.qualityStatus,
    linkedShipmentId: sku.linkedShipmentId,
    currentStage: sku.currentStage,
    fefoPosition,
    stageImpacts
  };
}

export function get_inventory_summary() {
  return getInventorySummary();
}

export function search_inventory(query = "", filtersInput: unknown = [], sort = "Earliest expiry") {
  const filters = normaliseFilters(filtersInput).map((filter) => filter.toLowerCase());
  const needle = query.trim().toLowerCase();
  const positions = getProductStockPositions();
  const inboundShipments = getInboundShipments();
  const inboundLines = getInboundLines();
  const outboundShipments = getOutboundShipments();
  const outboundLines = getOutboundLines();
  const movements = getInventoryMovements(240);
  const products = getProducts();
  const productById = new Map(products.map((product) => [product.productId, product]));

  const matchesText = (values: Array<unknown>) => !needle || values.filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));
  const batchMatchesFilter = (batch: any, product: any) => {
    if (!filters.length || filters.includes("all")) return true;
    return filters.every((filter) => {
      if (filter === "released") return batch.qualityStatus === "Released";
      if (filter === "qa hold") return batch.qualityStatus === "QA Hold" || batch.location.zone === "QA Hold";
      if (filter === "quarantine") return batch.qualityStatus === "Quarantine" || batch.location.zone === "Quarantine";
      if (filter === "cold chain") return product.defaultTempBand === "2-8 C" || batch.tempBand === "2-8 C";
      if (filter === "available") return batch.qtyAvailable > 0;
      if (filter === "reserved") return batch.qtyReserved + batch.qtyPicked + batch.qtyPacked + batch.qtyStaged > 0;
      if (filter === "expiring soon") return new Date(batch.expiryDate).getTime() <= Date.now() + 7 * 24 * 60 * 60_000;
      if (filter === "incoming") return batch.linkedInboundIds.length > 0;
      if (filter === "outbound") return batch.linkedShipmentIds.length > 0;
      return true;
    });
  };

  const productMatches = positions
    .map((position) => ({
      ...position,
      batches: position.batches.filter(
        (batch) =>
          batchMatchesFilter(batch, position.product) &&
          matchesText([
            position.product.productCode,
            position.product.productName,
            position.product.productFamily,
            batch.lotCode,
            batch.batchId,
            batch.location.zone,
            batch.location.rack,
            batch.location.bin,
            batch.stoNumber,
            batch.goodsReceiptNumber,
            batch.handlingUnit,
            batch.inspectionLot,
            batch.countryOfOrigin,
            position.product.gtin,
            position.product.manufacturer,
            ...batch.linkedInboundIds,
            ...batch.linkedShipmentIds
          ])
      )
    }))
    .filter((position) => position.batches.length > 0 || matchesText([position.product.productCode, position.product.productName]));

  const sortKey = String(sort).toLowerCase();
  productMatches.forEach((position) => {
    position.batches.sort((a, b) => {
      if (sortKey.includes("available")) return b.qtyAvailable - a.qtyAvailable;
      if (sortKey.includes("on-hand") || sortKey.includes("on hand")) return b.qtyOnHand - a.qtyOnHand;
      if (sortKey.includes("location")) return `${a.location.zone}${a.location.rack}${a.location.bin}`.localeCompare(`${b.location.zone}${b.location.rack}${b.location.bin}`);
      if (sortKey.includes("status")) return a.qualityStatus.localeCompare(b.qualityStatus);
      return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
    });
  });
  if (sortKey.includes("product")) {
    productMatches.sort((a, b) => a.product.productCode.localeCompare(b.product.productCode));
  }

  return {
    query,
    filters,
    sort,
    products: productMatches,
    inbound: inboundShipments
      .map((shipment) => ({ ...shipment, lines: inboundLines.filter((line) => line.asnId === shipment.asnId) }))
      .filter((shipment) => matchesText([shipment.asnId, shipment.source, shipment.routeName, shipment.receivingDock, shipment.inboundStatus])),
    outbound: outboundShipments
      .map((shipment) => ({ ...shipment, lines: outboundLines.filter((line) => line.shipmentId === shipment.shipmentId) }))
      .filter((shipment) => matchesText([shipment.shipmentId, shipment.destination, shipment.dock, shipment.outboundStatus])),
    movements: movements.filter((movement) => {
      const product = productById.get(movement.productId);
      return matchesText([
        movement.movementId,
        movement.movementType,
        movement.batchId,
        movement.referenceId,
        movement.referenceType,
        product?.productCode,
        product?.productName,
        movement.fromLocationId,
        movement.toLocationId
      ]);
    })
  };
}

export function get_product_stock(productId: string) {
  const stock = getProductStock(productId);
  if (!stock) throw new Error(`Product ${productId} was not found.`);
  return stock;
}

export function get_inventory_planning(productId: string, horizonDays = 14, demandMultiplier = 1) {
  const inventory = getInventoryData();
  const latestStockUpdate = inventory.stockBalances.reduce((latest, balance) => {
    const timestamp = new Date(balance.lastUpdated).getTime();
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
  const plan = buildInventoryPlanning(inventory, {
    horizonDays,
    demandMultiplier,
    asOf: latestStockUpdate ? new Date(latestStockUpdate) : new Date()
  });
  const needle = productId.trim().toLowerCase();
  const row = plan.rows.find(({ product }) =>
    product.productId.toLowerCase() === needle || product.productCode.toLowerCase() === needle
  );
  if (!row) throw new Error(`Product ${productId} was not found.`);
  return {
    asOf: plan.asOf,
    horizonDays: plan.horizonDays,
    demandMultiplier: plan.demandMultiplier,
    ...row
  };
}

export function get_batch_detail(batchId: string) {
  const detail = getBatchDetail(batchId);
  if (!detail) throw new Error(`Batch ${batchId} was not found.`);
  return detail;
}

export function get_incoming_stock(filtersInput: unknown = []) {
  const filters = normaliseFilters(filtersInput).map((filter) => filter.toLowerCase());
  const lines = getInboundLines();
  const products = new Map(getProducts().map((product) => [product.productId, product]));
  return getInboundShipments()
    .filter((shipment) => {
      if (!filters.length) return true;
      return filters.some(
        (filter) =>
          shipment.inboundStatus.toLowerCase() === filter ||
          shipment.routeName.toLowerCase().includes(filter) ||
          shipment.receivingDock.toLowerCase() === filter
      );
    })
    .map((shipment) => {
      const shipmentLines = lines.filter((line) => line.asnId === shipment.asnId);
      return {
        ...shipment,
        lineCount: shipmentLines.length,
        expectedQuantity: shipmentLines.reduce((sum, line) => sum + line.qtyExpected, 0),
        receivedQuantity: shipmentLines.reduce((sum, line) => sum + line.qtyReceived, 0),
        lines: shipmentLines.map((line) => ({ ...line, product: products.get(line.productId) ?? null }))
      };
    });
}

export function get_outbound_stock(filtersInput: unknown = []) {
  const filters = normaliseFilters(filtersInput).map((filter) => filter.toLowerCase());
  const lines = getOutboundLines();
  const products = new Map(getProducts().map((product) => [product.productId, product]));
  return getOutboundShipments()
    .filter((shipment) => {
      if (!filters.length) return true;
      return filters.some(
        (filter) =>
          shipment.outboundStatus.toLowerCase() === filter ||
          shipment.destination.toLowerCase().includes(filter) ||
          shipment.dock.toLowerCase() === filter
      );
    })
    .map((shipment) => {
      const shipmentLines = lines.filter((line) => line.shipmentId === shipment.shipmentId);
      return {
        ...shipment,
        lineCount: shipmentLines.length,
        allocatedQuantity: shipmentLines.reduce((sum, line) => sum + line.qtyAllocated, 0),
        requiredQuantity: shipmentLines.reduce((sum, line) => sum + line.qtyRequired, 0),
        lines: shipmentLines.map((line) => ({ ...line, product: products.get(line.productId) ?? null }))
      };
    });
}

export function get_inventory_movements(filtersInput: Record<string, unknown> = {}) {
  const filters = filtersInput ?? {};
  const products = new Map(getProducts().map((product) => [product.productId, product]));
  const query = String(filters.query ?? filters.referenceId ?? "").trim().toLowerCase();
  const movementType = String(filters.movementType ?? "").trim().toLowerCase();
  const productNeedle = String(filters.product ?? filters.productId ?? "").trim().toLowerCase();
  const batchNeedle = String(filters.batch ?? filters.batchId ?? "").trim().toLowerCase();
  return getInventoryMovements(240)
    .filter((movement) => !movementType || movement.movementType.toLowerCase() === movementType)
    .filter((movement) => {
      const product = products.get(movement.productId);
      return (
        !productNeedle ||
        movement.productId.toLowerCase() === productNeedle ||
        product?.productCode.toLowerCase() === productNeedle ||
        product?.productName.toLowerCase().includes(productNeedle)
      );
    })
    .filter((movement) => !batchNeedle || movement.batchId.toLowerCase().includes(batchNeedle))
    .filter((movement) => {
      if (!query) return true;
      const product = products.get(movement.productId);
      return [
        movement.movementId,
        movement.movementType,
        movement.batchId,
        movement.referenceId,
        movement.referenceType,
        movement.userOrSystem,
        movement.note,
        product?.productCode,
        product?.productName,
        movement.fromLocationId,
        movement.toLocationId
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    })
    .map((movement) => ({
      ...movement,
      product: products.get(movement.productId) ?? null,
      from: movementLabel(movement.fromLocationId),
      to: movementLabel(movement.toLocationId)
    }));
}

export function check_fefo_allocation(productId: string, requestedQtyInput: number | string = 0) {
  const requestedPlacement = productId.toUpperCase().startsWith("STK-")
    ? getInventoryPlacements().find((item) => item.stockBalanceId.toLowerCase() === productId.trim().toLowerCase())
    : undefined;
  const resolvedProductId = productIdFromInput(productId);
  const position = getProductStock(resolvedProductId);
  if (!position) throw new Error(`Product ${productId} was not found for FEFO allocation.`);
  const requestedQty = Math.max(0, Number(requestedQtyInput) || requestedPlacement?.quantity || 0);
  const eligible = position.batches
    .filter((batch) => excludedReasons(batch, position.product.defaultTempBand).length === 0)
    .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  let remaining = requestedQty;
  const allocations = eligible.map((batch) => {
    const allocatedQty = Math.min(batch.qtyAvailable, remaining);
    remaining -= allocatedQty;
    return {
      batchId: batch.batchId,
      stockBalanceId: batch.stockBalanceId,
      lotCode: batch.lotCode,
      expiryDate: batch.expiryDate,
      locationId: batch.location.locationId,
      qtyAvailable: batch.qtyAvailable,
      qtyAllocated: allocatedQty,
      remainingAvailable: batch.qtyAvailable - allocatedQty
    };
  }).filter((batch) => requestedQty === 0 || batch.qtyAllocated > 0);
  const excludedBatches = position.batches
    .filter((batch) => !eligible.some((eligibleBatch) => eligibleBatch.batchId === batch.batchId))
    .map((batch) => ({
      batchId: batch.batchId,
      lotCode: batch.lotCode,
      expiryDate: batch.expiryDate,
      qualityStatus: batch.qualityStatus,
      qtyOnHand: batch.qtyOnHand,
      qtyAvailable: batch.qtyAvailable,
      locationId: batch.location.locationId,
      reasons: excludedReasons(batch, position.product.defaultTempBand)
    }));
  const outboundLines = getOutboundLines().filter((line) => line.productId === position.product.productId);
  const outboundShipments = new Map(getOutboundShipments().map((shipment) => [shipment.shipmentId, shipment]));
  const availableAfterRequest = Math.max(0, eligible.reduce((sum, batch) => sum + batch.qtyAvailable, 0) - requestedQty);
  const laterDemand = outboundLines
    .filter((line) => {
      const shipment = outboundShipments.get(line.shipmentId);
      return shipment && shipment.outboundStatus !== "Dispatched";
    })
    .map((line) => ({
      shipmentId: line.shipmentId,
      destination: outboundShipments.get(line.shipmentId)?.destination ?? "",
      requiredBy: outboundShipments.get(line.shipmentId)?.requiredBy ?? "",
      qtyRequired: line.qtyRequired,
      qtyAllocated: line.qtyAllocated,
      allocationStatus: line.allocationStatus
    }));

  return {
    productId: position.product.productId,
    productCode: position.product.productCode,
    productName: position.product.productName,
    requestedQty,
    totalEligibleAvailable: eligible.reduce((sum, batch) => sum + batch.qtyAvailable, 0),
    availableAfterRequest,
    shortfallQty: Math.max(0, remaining),
    eligibleBatches: allocations,
    excludedBatches,
    affectedLaterShipments: laterDemand,
    rule: "Released, not expired, not QA Hold, not Quarantine, not Pending QA, available quantity only, matching temperature band"
  };
}

export function check_fefo_impact(stockBalanceId: string, shipmentId: string) {
  const sku = findInventoryPlacement(stockBalanceId);
  const shipment = findShipment(shipmentId);
  const productId = sku.productId ?? productIdFromInput(sku.productCode ?? sku.stockBalanceId);
  const line = getOutboundLines().find((candidate) => candidate.shipmentId === shipmentId && candidate.productId === productId);
  const requestedQty = line?.qtyRequired ?? sku.quantity;
  const fefo = check_fefo_allocation(productId, requestedQty);
  const targetExpiry = new Date(sku.expiryDate).getTime();
  const earlierEligible = getInventoryPlacements()
    .filter((candidate) => candidate.productId === productId && candidate.qualityStatus === "Released" && (candidate.qtyAvailable ?? 0) > 0)
    .filter((candidate) => new Date(candidate.expiryDate).getTime() < targetExpiry && candidate.stockBalanceId !== sku.stockBalanceId)
    .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  const violationCount = earlierEligible.filter((candidate) => !shipment.stockBalanceIds.includes(candidate.stockBalanceId)).length;
  const affectedSkus = [
    ...fefo.eligibleBatches.map((batch, index) => ({
      skuId: batch.stockBalanceId,
      expiryDate: batch.expiryDate,
      qualityStatus: "Released",
      fefoRank: index + 1,
      linkedShipmentId: shipmentId
    })),
    ...fefo.excludedBatches.slice(0, 6).map((batch, index) => ({
      skuId: batch.batchId,
      expiryDate: batch.expiryDate,
      qualityStatus: batch.qualityStatus,
      fefoRank: fefo.eligibleBatches.length + index + 1,
      linkedShipmentId: null
    }))
  ].slice(0, 10);
  const cascadeRiskScore = Math.min(100, Math.round(violationCount * 18 + fefo.shortfallQty * 0.2 + (isHoldStatus(sku.qualityStatus) ? 30 : 10)));
  const recommendedDispatchOrder = fefo.eligibleBatches.slice(0, 6).map((batch) => batch.stockBalanceId);

  return {
    stockBalanceId,
    shipmentId,
    fefoViolationCount: violationCount,
    cascadeRiskScore,
    affectedSkus,
    recommendedDispatchOrder,
    eligibleBatches: fefo.eligibleBatches,
    excludedBatches: fefo.excludedBatches,
    remainingAvailable: fefo.availableAfterRequest,
    affectedLaterShipments: fefo.affectedLaterShipments,
    affectedStages: ["Storage", "Picking", "Packing", "Dock Staging", "Dispatch"],
    reason:
      fefo.shortfallQty > 0
        ? `${fefo.productCode} has ${fefo.shortfallQty} unit(s) short against the requested quantity after excluding unavailable batches.`
        : violationCount === 0
          ? `${stockBalanceId} is aligned with FEFO for ${fefo.productCode}; excluded batches are held, quarantined, expired, pending QA, or unavailable.`
          : `${violationCount} eligible earlier-expiry batch(es) exist for ${fefo.productCode} and should be consumed first.`
  };
}

export function check_cold_chain_status(zoneId: string, skuId?: string) {
  const zone = findZone(zoneId);
  const sku = skuId ? findInventoryPlacement(skuId) : null;
  const min = sku?.temperatureMin ?? zone.temperatureMin;
  const max = sku?.temperatureMax ?? zone.temperatureMax;
  const current = zone.currentTemperature;
  const breachSeverity = current < min - 1 || current > max + 1 ? "critical" : current < min || current > max ? "warn" : "none";
  const readings = db
    .prepare("SELECT * FROM temperature_readings WHERE zone_id = ? ORDER BY datetime(timestamp) DESC LIMIT 36")
    .all(zone.id) as { temperature: number; within_band: number; timestamp: string }[];
  const consecutiveBreachCount = readings.findIndex((reading) => Boolean(reading.within_band));
  const timeInBreachMinutes =
    breachSeverity === "none" ? 0 : consecutiveBreachCount === -1 ? readings.length * 5 : Math.max(1, consecutiveBreachCount) * 5;
  const affectedSkus = getInventoryPlacements()
    .filter((candidate) => candidate.zoneId === zone.id)
    .map((candidate) => candidate.stockBalanceId);

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    stockBalanceId: sku?.stockBalanceId ?? null,
    currentTemperature: current,
    requiredMin: min,
    requiredMax: max,
    breachSeverity,
    timeInBreachMinutes,
    affectedSkus,
    academicComplianceNote:
      "HSA-style regulatory fields for academic simulation are present; this prototype does not claim real HSA compliance.",
    recommendedMitigation:
      breachSeverity === "none"
        ? "Maintain live monitoring and keep cold-chain dispatches on planned FEFO sequence."
        : "Escalate to Compliance Agent, isolate affected SKUs, and verify calibrated sensor readings before dispatch."
  };
}

export function get_temperature_events(zoneId?: string, eventType?: string) {
  const resolvedZone = zoneId ? findZone(zoneId) : null;
  const normalizedType = eventType?.trim().toLowerCase();
  const events = getTemperatureEvents(resolvedZone?.id).filter((event) => {
    if (!normalizedType) return true;
    return event.eventType.toLowerCase() === normalizedType || event.eventType.toLowerCase().replace("-", " ") === normalizedType;
  });
  return {
    zoneId: resolvedZone?.id ?? null,
    zoneName: resolvedZone?.name ?? null,
    eventType: eventType ?? null,
    eventCount: events.length,
    events: events.map((event) => ({
      eventId: event.eventId,
      ncId: event.ncId,
      zoneId: event.zoneId,
      zoneName: event.zoneName,
      eventType: event.eventType,
      status: event.status,
      timestampStart: event.timestampStart,
      timestampEnd: event.timestampEnd,
      durationMinutes: event.durationMinutes,
      allowedBand: `${event.allowedBand.min}-${event.allowedBand.max} C`,
      observedRange: event.observedRange,
      peakTemp: event.peakTemp,
      peakVariance: event.peakVariance,
      affectedSkuIds: event.affectedSkuIds,
      affectedBatchIds: event.affectedBatchIds,
      recommendedAction: event.recommendedAction,
      auditReference: event.auditReference
    }))
  };
}

export function get_route_status(routeName?: string) {
  const needle = String(routeName ?? "").trim().toLowerCase();
  const routes = getRoutes().filter((route) => {
    if (!needle) return true;
    return (
      route.id.toLowerCase() === needle ||
      route.routeId.toLowerCase() === needle ||
      route.transportLegId.toLowerCase() === needle ||
      route.asnId?.toLowerCase() === needle ||
      route.shipmentId?.toLowerCase() === needle ||
      route.dockAppointmentId.toLowerCase() === needle ||
      route.name.toLowerCase().includes(needle) ||
      route.origin.toLowerCase().includes(needle) ||
      route.destination.toLowerCase().includes(needle) ||
      route.carrierName.toLowerCase().includes(needle) ||
      route.licensePlate.toLowerCase() === needle
    );
  });
  return {
    query: routeName ?? null,
    routeCount: routes.length,
    routes: routes.map((route) => ({
      id: route.id,
      routeId: route.routeId,
      transportLegId: route.transportLegId,
      direction: route.direction,
      asnId: route.asnId,
      shipmentId: route.shipmentId,
      dockAppointmentId: route.dockAppointmentId,
      name: route.name,
      origin: route.origin,
      destination: route.destination,
      etaMinutes: route.etaMinutes,
      baseEtaMinutes: route.baseEtaMinutes,
      delayDeltaMinutes: route.delayDeltaMinutes,
      status: route.status,
      expectedSkus: route.expectedSkus,
      coldChainRequired: route.coldChainRequired,
      disruptionType: route.disruptionType,
      riskLevel: route.riskLevel,
      riskNote: route.riskNote,
      receivingImpact: route.receivingImpact,
      mitigationSuggestion: route.mitigationSuggestion,
      carrierName: route.carrierName,
      vehicleId: route.vehicleId,
      licensePlate: route.licensePlate,
      transportStatus: route.transportStatus,
      temperatureStatus: route.temperatureStatus,
      plannedArrival: route.plannedArrival,
      estimatedArrival: route.estimatedArrival,
      providerUsed: route.providerUsed,
      isRealRoadRoute: route.isRealRoadRoute
    }))
  };
}

function normaliseTransportDirection(value?: string) {
  const direction = value?.trim().toLowerCase();
  if (!direction || direction === "all") return null;
  if (direction !== "inbound" && direction !== "outbound") {
    throw new Error(`Unsupported transport direction ${value}.`);
  }
  return direction;
}

function transportReferenceMatches(reference: string, values: Array<string | null | undefined>) {
  const needle = reference.trim().toLowerCase();
  return values.some((value) => {
    const candidate = value?.trim().toLowerCase();
    return Boolean(candidate && (candidate === needle || candidate.includes(needle)));
  });
}

/**
 * Resolve the canonical TMS record and its connected WMS/YMS/site records.  This is the
 * transport equivalent of a stock-position lookup: one tool output contains the joined
 * operational context, so the assistant never has to infer links from labels.
 */
export function get_transport_context(referenceId?: string, directionInput?: string, statusInput?: string) {
  const direction = normaliseTransportDirection(directionInput);
  const status = statusInput?.trim().toLowerCase() || null;
  const logistics = getLogisticsData();
  const inbound = new Map(getInboundShipments().map((shipment) => [shipment.asnId, shipment]));
  const outbound = new Map(getOutboundShipments().map((shipment) => [shipment.shipmentId, shipment]));
  const inboundLines = getInboundLines();
  const outboundLines = getOutboundLines();
  const products = new Map(getProducts().map((product) => [product.productId, product]));
  const sites = new Map(getPartnerSites().map((site) => [site.siteId, site]));
  const appointments = logistics.dockAppointments;
  const routes = getRoutes();
  const stockBalances = getStockBalances();
  const docks = getDocks();
  const reference = referenceId?.trim() || null;

  let legs = logistics.transportLegs.filter((leg) => {
    if (direction && leg.direction !== direction) return false;
    if (status && ![leg.transportStatus, leg.routeStatus, leg.scheduleAdherence].filter(Boolean).some((value) => String(value).toLowerCase() === status)) {
      return false;
    }
    if (!reference) return true;
    const appointment = appointments.find((item) => item.transportLegId === leg.transportLegId);
    const origin = sites.get(leg.originSiteId);
    const destination = sites.get(leg.destinationSiteId);
    return transportReferenceMatches(reference, [
      leg.transportLegId,
      leg.routeId,
      leg.asnId,
      leg.shipmentId,
      leg.dockAppointmentId,
      appointment?.dockId,
      leg.originSiteId,
      leg.destinationSiteId,
      origin?.displayName,
      destination?.displayName,
      leg.carrierId,
      leg.carrierName,
      leg.vehicleId,
      leg.licensePlate
    ]);
  });

  if (reference && legs.length === 0) {
    throw new Error(`Transport reference ${reference} was not found in the canonical TMS, WMS, or yard records.`);
  }

  const records = legs.map((leg) => {
    const appointment = appointments.find((item) => item.transportLegId === leg.transportLegId) ?? null;
    const route = routes.find((item) => item.transportLegId === leg.transportLegId || item.id === leg.routeId) ?? null;
    const origin = sites.get(leg.originSiteId) ?? null;
    const destination = sites.get(leg.destinationSiteId) ?? null;
    const inboundDocument = leg.asnId ? inbound.get(leg.asnId) ?? null : null;
    const outboundDocument = leg.shipmentId ? outbound.get(leg.shipmentId) ?? null : null;
    const lines = inboundDocument
      ? inboundLines.filter((line) => line.asnId === inboundDocument.asnId)
      : outboundDocument
        ? outboundLines.filter((line) => line.shipmentId === outboundDocument.shipmentId)
        : [];
    const wmsLines = lines.map((line) => {
      const balances = stockBalances.filter((balance) => balance.batchId === line.batchId);
      return {
        ...line,
        product: products.get(line.productId) ?? null,
        stockBalances: balances
      };
    });
    const events = logistics.operationalEvents
      .filter((event) =>
        event.transportLegId === leg.transportLegId ||
        event.asnId === leg.asnId ||
        event.shipmentId === leg.shipmentId ||
        event.dockAppointmentId === leg.dockAppointmentId
      )
      .slice(0, 24);
    return {
      referenceId: leg.asnId ?? leg.shipmentId ?? leg.transportLegId,
      transportLeg: leg,
      route,
      originSite: origin,
      destinationSite: destination,
      dockAppointment: appointment,
      physicalDock: appointment ? docks.find((dock) => dock.id === appointment.dockId) ?? null : null,
      wmsDocument: inboundDocument ?? outboundDocument,
      wmsLines,
      operationalEvents: events
    };
  });

  return {
    query: reference,
    direction,
    status,
    recordCount: records.length,
    summary: {
      inbound: records.filter((record) => record.transportLeg.direction === "inbound").length,
      outbound: records.filter((record) => record.transportLeg.direction === "outbound").length,
      delayed: records.filter((record) => record.transportLeg.scheduleAdherence === "delayed" || record.transportLeg.routeStatus === "delayed").length,
      exceptions: records.filter((record) => record.transportLeg.transportStatus === "exception" || record.transportLeg.routeStatus === "disrupted").length,
      coldChain: records.filter((record) => record.transportLeg.temperatureRequirement === "2-8C").length,
      dockConflicts: records.filter((record) => record.dockAppointment?.conflictFlag).length
    },
    records
  };
}

function shiftedIso(value: string | null | undefined, minutes: number) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp + minutes * 60_000).toISOString() : null;
}

function intervalOverlap(startA: string | null, endA: string | null, startB: string, endB: string) {
  if (!startA || !endA) return false;
  return new Date(startA).getTime() < new Date(endB).getTime() && new Date(startB).getTime() < new Date(endA).getTime();
}

/**
 * A cross-domain, read-only transport what-if. It projects the linked TMS leg, yard slot,
 * WMS document/lines and inventory exposure together, and stores only a scenario snapshot.
 */
export function simulate_transport_impact(referenceId: string, eventTypeInput: string, delayMinutesInput?: number | string) {
  const eventType = eventTypeInput.trim().toLowerCase().replace(/[ -]+/g, "_");
  const baselineDelay: Record<string, number> = {
    traffic_delay: 30,
    weather: 40,
    supplier_delay: 65,
    vehicle_breakdown: 55,
    customs_hold: 75,
    temperature_excursion: 35,
    manufacturing_delay: 90,
    quality_hold: 45,
    dock_closure: 60,
    capacity_constraint: 45
  };
  if (!(eventType in baselineDelay)) throw new Error(`Unsupported transport scenario ${eventTypeInput}.`);
  const requestedDelay = Number(delayMinutesInput);
  const delayMinutes = Number.isFinite(requestedDelay) && requestedDelay > 0
    ? Math.min(1_440, Math.round(requestedDelay))
    : baselineDelay[eventType];
  const context = get_transport_context(referenceId);
  if (context.recordCount !== 1) {
    throw new Error(`Transport reference ${referenceId} matched ${context.recordCount} records; use an exact leg, ASN, shipment, route, or appointment ID.`);
  }
  const record = context.records[0];
  const leg = record.transportLeg;
  const appointment = record.dockAppointment;
  const shiftedAppointment = appointment
    ? {
        scheduledStart: shiftedIso(appointment.scheduledStart, delayMinutes),
        scheduledEnd: shiftedIso(appointment.scheduledEnd, delayMinutes)
      }
    : null;
  const conflicts = appointment
    ? getDockAppointments()
        .filter((candidate) =>
          candidate.dockAppointmentId !== appointment.dockAppointmentId &&
          candidate.dockId === appointment.dockId &&
          candidate.status !== "cancelled" &&
          intervalOverlap(shiftedAppointment?.scheduledStart ?? null, shiftedAppointment?.scheduledEnd ?? null, candidate.scheduledStart, candidate.scheduledEnd)
        )
        .map((candidate) => ({
          dockAppointmentId: candidate.dockAppointmentId,
          dockId: candidate.dockId,
          referenceId: candidate.referenceId,
          scheduledStart: candidate.scheduledStart,
          scheduledEnd: candidate.scheduledEnd
        }))
    : [];
  const projectedArrival = shiftedIso(leg.estimatedArrival, delayMinutes);
  const serviceTarget = leg.direction === "outbound"
    ? leg.deliveryWindowEnd ?? leg.plannedArrival
    : appointment?.scheduledEnd ?? leg.plannedArrival;
  const serviceVarianceMinutes = projectedArrival && serviceTarget
    ? Math.max(0, Math.ceil((new Date(projectedArrival).getTime() - new Date(serviceTarget).getTime()) / 60_000))
    : null;
  const coldChain = leg.temperatureRequirement === "2-8C";
  const coldChainRisk = eventType === "temperature_excursion"
    ? "critical"
    : coldChain && delayMinutes >= 60
      ? "high"
      : coldChain
        ? "medium"
        : "low";
  const restrictedLines = record.wmsLines.filter((line: any) => {
    const quantityUnavailable = line.stockBalances?.some((balance: any) => balance.qtyOnHold > 0 || balance.qtyAvailable <= 0);
    return quantityUnavailable || line.qaStatus && line.qaStatus !== "Released";
  });
  const affectedSkus = [...new Set(record.wmsLines.map((line: any) => line.product?.productCode ?? line.productId))];
  const affectedBatches = [...new Set(record.wmsLines.map((line: any) => line.batchId))];
  const affectedStockBalances = [...new Set(record.wmsLines.flatMap((line: any) => line.stockBalances?.map((balance: any) => balance.stockBalanceId) ?? []))];
  const alternativeDocks = getDocks()
    .filter((dock) => dock.id !== appointment?.dockId && dock.status !== "maintenance")
    .slice(0, 3)
    .map((dock) => ({ dockId: dock.id, status: dock.status, nextAvailableAt: dock.nextAvailableAt }));
  const projectedTransportLeg = {
    ...leg,
    estimatedArrival: projectedArrival ?? leg.estimatedArrival,
    durationMinutes: leg.durationMinutes + delayMinutes,
    delayMinutes: leg.delayMinutes + delayMinutes,
    disruptionType: eventType,
    routeStatus: "disrupted" as const,
    riskLevel: coldChainRisk === "critical" || serviceVarianceMinutes && serviceVarianceMinutes > 60 ? "high" as const : "medium" as const
  };
  const projectedRoute = {
    ...(record.route ?? {}),
    id: leg.routeId,
    routeId: leg.routeId,
    transportLegId: leg.transportLegId,
    etaMinutes: projectedTransportLeg.durationMinutes,
    currentDurationMinutes: projectedTransportLeg.durationMinutes,
    delayDeltaMinutes: projectedTransportLeg.delayMinutes,
    estimatedArrival: projectedTransportLeg.estimatedArrival,
    status: "disrupted" as const,
    disruptionType: eventType,
    riskLevel: projectedTransportLeg.riskLevel
  };
  const options = [
    {
      id: "retain_slot",
      label: "Retain current handoff",
      effect: `${delayMinutes} minute delay remains on ${appointment?.dockId ?? "the current transport plan"}.`,
      tradeoff: conflicts.length ? `${conflicts.length} dock overlap(s) require yard review.` : "No additional dock overlap is projected."
    },
    {
      id: "alternate_dock",
      label: "Use another dock",
      effect: alternativeDocks.length ? `Candidate docks: ${alternativeDocks.map((dock) => dock.dockId).join(", ")}.` : "No alternative dock is currently available.",
      tradeoff: coldChain ? "Temperature-capable staging and logger continuity must be verified." : "Yard and labour availability must be verified."
    },
    {
      id: "resequence_handoff",
      label: "Resequence the handoff",
      effect: `Protect ${leg.direction === "inbound" ? "receiving" : "dispatch"} flow around ${record.referenceId}.`,
      tradeoff: `${restrictedLines.length} line(s) already have quality or availability constraints; those controls remain unchanged.`
    }
  ];
  const stages = leg.direction === "inbound"
    ? ["Transport", "Gate", "Receiving", "Quality", "Putaway"]
    : ["Allocation", "Picking", "Packing", "Dock Staging", "Dispatch", "Delivery"];
  const riskDelta = {
    delayMinutes,
    serviceVarianceMinutes,
    dockConflictsCreated: conflicts.length,
    coldChainRisk,
    restrictedLineCount: restrictedLines.length
  };
  const scenarioId = actionId("SCN");
  db.prepare(
    `INSERT INTO scenario_snapshots
     (id, decision_id, scenario_type, before_state_json, after_state_json, risk_delta_json, created_at)
     VALUES (?, NULL, 'transport_impact', ?, ?, ?, ?)`
  ).run(
    scenarioId,
    stringify({ context: record }),
    stringify({ projectedTransportLeg, shiftedAppointment, conflicts, options }),
    stringify(riskDelta),
    nowIso()
  );

  return {
    scenarioId,
    eventType,
    referenceId: record.referenceId,
    transportLegId: leg.transportLegId,
    routeId: leg.routeId,
    direction: leg.direction,
    asnId: leg.asnId,
    shipmentId: leg.shipmentId,
    dockAppointmentId: appointment?.dockAppointmentId ?? null,
    dockId: appointment?.dockId ?? null,
    delayMinutes,
    serviceVarianceMinutes,
    projectedArrival,
    projectedTransportLeg,
    projectedRoute,
    shiftedAppointment,
    dockConflictsCreated: conflicts,
    affectedSkus,
    affectedBatches,
    affectedStockBalances,
    affectedStages: stages,
    coldChainRisk,
    restrictedLineCount: restrictedLines.length,
    alternativeDocks,
    options,
    riskDelta,
    recommendedActionId: null,
    mutationApplied: false
  };
}

export function get_audit_lookup(query = "") {
  const needle = query.trim().toLowerCase();
  const decisions = getWarehouseSnapshot().decisions
    .filter((decision) => {
      if (!needle) return true;
      return (
        decision.id.toLowerCase().includes(needle) ||
        decision.query.toLowerCase().includes(needle) ||
        decision.narrative.toLowerCase().includes(needle)
      );
    })
    .slice(0, 12);
  return {
    query,
    enquiryCount: decisions.length,
    enquiries: decisions.map((decision) => ({
      id: decision.id,
      timestamp: decision.timestamp,
      query: decision.query,
      intent: decision.agentResponse?.intent ?? "unavailable",
      title: decision.agentResponse?.title ?? "Assistant enquiry",
      recordStatus: "recorded",
      operatingMode: "read_only",
      fallbackUsed: decision.fallbackUsed,
      toolsCalled: decision.toolsCalled.map((tool) => tool.toolName)
    }))
  };
}

function parseHours(timeWindow: string) {
  const match = timeWindow.match(/(\d+(?:\.\d+)?)/);
  return match ? Math.max(1, Number(match[1])) : 4;
}

function overlaps(a: DockSchedule, b: DockSchedule) {
  return new Date(a.startTime).getTime() < new Date(b.endTime).getTime() && new Date(b.startTime).getTime() < new Date(a.endTime).getTime();
}

export function check_dock_schedule(timeWindow: string, shipmentId?: string) {
  const hours = parseHours(timeWindow);
  const cutoff = Date.now() + hours * 60 * 60_000;
  const schedules = getDockSchedule().filter((slot) => new Date(slot.startTime).getTime() <= cutoff);
  const conflicts: Array<{ dockId: string; shipmentIds: string[]; startTime: string; endTime: string }> = [];
  for (const slot of schedules) {
    for (const other of schedules) {
      if (slot.id >= other.id || slot.dockId !== other.dockId) continue;
      if (overlaps(slot, other) || slot.conflictFlag || other.conflictFlag) {
        conflicts.push({
          dockId: slot.dockId,
          shipmentIds: [slot.shipmentId, other.shipmentId],
          startTime: slot.startTime,
          endTime: other.endTime
        });
      }
    }
  }
  const bookedDocks = new Set(schedules.map((slot) => slot.dockId));
  const availableSlots = getDocks()
    .filter((dock) => !bookedDocks.has(dock.id) || dock.status === "available")
    .map((dock) => ({
      dockId: dock.id,
      dockName: dock.name,
      earliestStart: dock.nextAvailableAt
    }));
  const affectedShipments = shipmentId ? [shipmentId] : [...new Set(conflicts.flatMap((conflict) => conflict.shipmentIds))];
  const dockUtilisationImpact = Math.round((schedules.length / (getDocks().length * Math.max(hours, 1))) * 100);

  return {
    timeWindow,
    shipmentId: shipmentId ?? null,
    dockSlotConflicts: conflicts,
    availableSlots,
    affectedShipments,
    recommendedResequencingOptions: [
      "Move urgent cold-chain dispatches to the earliest available dock with validated temperature staging.",
      "Hold QA Hold shipments until release status changes.",
      "Keep non-cold-chain shipments behind FEFO-sensitive vaccine batches."
    ],
    dockUtilisationImpact
  };
}

function warehouseSummary() {
  const snapshot = getWarehouseSnapshot();
  return {
    inventorySummary: snapshot.inventory.summary,
    fefoOrder: snapshot.inventoryPlacements.slice(0, 12).map((placement) => placement.stockBalanceId),
    dockSlots: snapshot.dockSchedule,
    shipmentQueue: snapshot.shipments.map((shipment) => ({
      id: shipment.id,
      priority: shipment.priority,
      dockId: shipment.dockId,
      dispatchTime: shipment.dispatchTime,
      status: shipment.status
    })),
    coldChainStatus: snapshot.zones.map((zone) => ({
      zoneId: zone.id,
      temp: zone.currentTemperature,
      inBand: zone.currentTemperature >= zone.temperatureMin && zone.currentTemperature <= zone.temperatureMax
    }))
  };
}

/**
 * Read-only facility outage scenario. Unlike route disruption tools, this evaluates the
 * complete warehouse inventory and work queue and never assumes a particular transport route.
 */
export function simulate_facility_disruption(eventTypeInput: string, durationMinutesInput?: number | string) {
  const eventType = eventTypeInput.trim().toLowerCase().replace(/[ -]+/g, "_");
  const validEvents = new Set(["severe_weather", "facility_shutdown", "tornado", "flood", "earthquake", "power_outage"]);
  if (!validEvents.has(eventType)) throw new Error(`Unsupported facility scenario ${eventTypeInput}.`);

  const requestedDuration = Number(durationMinutesInput);
  const durationMinutes = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? Math.min(5 * 365 * 24 * 60, Math.round(requestedDuration))
    : 7 * 24 * 60;
  const scenarioStart = new Date();
  const scenarioEnd = new Date(scenarioStart.getTime() + durationMinutes * 60_000);
  const restartReviewEnd = new Date(scenarioEnd.getTime() + 7 * 24 * 60 * 60_000);

  const products = new Map(getProducts().map((product) => [product.productId, product]));
  const batches = new Map(getBatches().map((batch) => [batch.batchId, batch]));
  const balances = getStockBalances();
  const releasedBalances = balances.filter((balance) => {
    const batch = batches.get(balance.batchId);
    return Boolean(batch && batch.qualityStatus === "Released" && balance.qtyAvailable > 0);
  });
  const toRiskLot = (balance: (typeof balances)[number]) => {
    const batch = batches.get(balance.batchId)!;
    return {
      stockBalanceId: balance.stockBalanceId,
      batchId: balance.batchId,
      lotCode: batch.lotCode,
      productId: batch.productId,
      productCode: products.get(batch.productId)?.productCode ?? batch.productId,
      expiryDate: batch.expiryDate,
      qtyAvailable: balance.qtyAvailable
    };
  };
  const expiresDuringOutage = releasedBalances
    .filter((balance) => new Date(batches.get(balance.batchId)!.expiryDate).getTime() <= scenarioEnd.getTime())
    .map(toRiskLot);
  const expiresWithin7DaysAfterRecovery = releasedBalances
    .filter((balance) => {
      const expiry = new Date(batches.get(balance.batchId)!.expiryDate).getTime();
      return expiry > scenarioEnd.getTime() && expiry <= restartReviewEnd.getTime();
    })
    .map(toRiskLot);
  const restrictedLots = balances
    .filter((balance) => {
      const batch = batches.get(balance.batchId);
      return Boolean(batch && batch.qualityStatus !== "Released" && balance.qtyOnHand > 0);
    })
    .map((balance) => {
      const batch = batches.get(balance.batchId)!;
      return {
        stockBalanceId: balance.stockBalanceId,
        lotCode: batch.lotCode,
        qualityStatus: batch.qualityStatus,
        qtyOnHand: balance.qtyOnHand
      };
    });

  const inWindow = (value: string | null | undefined) => {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp >= scenarioStart.getTime() && timestamp <= scenarioEnd.getTime();
  };
  const inboundAffected = getInboundShipments()
    .filter((shipment) => !["Received", "Released", "Putaway", "Putaway Complete", "Closed"].includes(shipment.inboundStatus))
    .filter((shipment) => inWindow(shipment.plannedArrival || shipment.eta))
    .map((shipment) => ({
      asnId: shipment.asnId,
      plannedArrival: shipment.plannedArrival || shipment.eta,
      status: shipment.inboundStatus,
      receivingDock: shipment.receivingDock
    }));
  const outboundAffected = getOutboundShipments()
    .filter((shipment) => !["Dispatched", "Delivered"].includes(shipment.outboundStatus))
    .filter((shipment) => inWindow(shipment.plannedDeparture || shipment.requiredBy))
    .map((shipment) => ({
      shipmentId: shipment.shipmentId,
      plannedDeparture: shipment.plannedDeparture || shipment.requiredBy,
      status: shipment.outboundStatus,
      dock: shipment.dock
    }));

  const duringOutageUnits = expiresDuringOutage.reduce((sum, lot) => sum + lot.qtyAvailable, 0);
  const restartCriticalUnits = expiresWithin7DaysAfterRecovery.reduce((sum, lot) => sum + lot.qtyAvailable, 0);
  const affectedStockBalances = [...new Set([
    ...expiresDuringOutage.map((lot) => lot.stockBalanceId),
    ...expiresWithin7DaysAfterRecovery.map((lot) => lot.stockBalanceId)
  ])];

  return {
    scope: "Singapore Western DC",
    eventType: eventType === "tornado" ? "severe_weather" : eventType,
    durationMinutes,
    scenarioStart: scenarioStart.toISOString(),
    scenarioEnd: scenarioEnd.toISOString(),
    expiresDuringOutage,
    expiresDuringOutageUnits: duringOutageUnits,
    expiresWithin7DaysAfterRecovery,
    restartCriticalUnits,
    restrictedLots,
    inboundAffected,
    outboundAffected,
    affectedSkus: [...new Set([...expiresDuringOutage, ...expiresWithin7DaysAfterRecovery].map((lot) => lot.productCode))],
    affectedStockBalances,
    affectedStages: ["Receiving", "Quality disposition", "Putaway", "Storage", "Picking", "Packing", "Dock Staging", "Dispatch"],
    operationalImpact: [
      "FEFO allocation execution pauses while the facility is inaccessible; the system's expiry order is not permission to allocate during the outage.",
      `${expiresDuringOutage.length} released lot(s) / ${duringOutageUnits} available unit(s) expire during the outage; ${expiresWithin7DaysAfterRecovery.length} released lot(s) / ${restartCriticalUnits} unit(s) expire within seven days after recovery.`,
      `${inboundAffected.length} inbound movement(s) cannot be received or put away and ${outboundAffected.length} outbound movement(s) cannot be picked, staged, or dispatched as scheduled.`,
      "Recalculate FEFO eligibility and remove expired or newly restricted lots before allocation resumes."
    ],
    mitigationOptions: [
      { label: "Pre-outage FEFO review", tradeoff: "Protects the shortest-dated released stock but is limited by the time and safe access available before closure." },
      { label: "Divert inbound receipts", tradeoff: "Avoids arrivals at a closed facility but requires an approved alternate receiving and cold-chain site." },
      { label: "Controlled restart", tradeoff: "Revalidates expiry, quality status, and stock condition before allocation, at the cost of a slower recovery." }
    ],
    assumptions: [
      "The facility is inaccessible for the full stated duration.",
      "No inventory movement is assumed during the outage.",
      "Temperature-control continuity is unknown and is not inferred from the weather event."
    ],
    recommendedActionId: null,
    mutationApplied: false
  };
}

export function simulate_shipment_allocation(shipmentId: string) {
  const shipment = getOutboundShipments().find((item) => item.shipmentId === shipmentId);
  if (!shipment) throw new Error(`Outbound shipment ${shipmentId} was not found.`);
  const lines = getOutboundLines().filter((line) => line.shipmentId === shipmentId);
  const products = new Map(getProducts().map((product) => [product.productId, product]));
  const beforeSummary = getInventorySummary();
  const beforeLines = lines.map((line) => ({
    ...line,
    product: products.get(line.productId) ?? null,
    currentFefo: check_fefo_allocation(line.productId, line.qtyRequired)
  }));

  if (shipment.outboundStatus === "Blocked") {
    return {
      shipmentId,
      status: shipment.outboundStatus,
      destination: shipment.destination,
      beforeSummary,
      afterSummary: beforeSummary,
      allocations: beforeLines,
      excludedBatches: beforeLines.flatMap((line) => line.currentFefo.excludedBatches),
      stockImpact: [],
      recommendedActionId: null,
      reason: "Blocked outbound shipment cannot allocate or dispatch until QA Hold or quarantine restrictions are resolved."
    };
  }

  const shouldDispatch = ["Picking", "Packed", "Staged"].includes(shipment.outboundStatus);
  const stockBalances = new Map(getStockBalances().map((balance) => [balance.batchId, balance]));
  const locations = new Map(getWarehouseLocations().map((location) => [location.locationId, location]));
  const actionAllocations = lines.flatMap((line) => {
    if (shouldDispatch) {
      const qty = line.qtyDispatched || line.qtyPacked || line.qtyPicked || line.qtyAllocated;
      return qty > 0 ? [{ productId: line.productId, batchId: line.batchId, qty, mode: "dispatch" }] : [];
    }
    const fefo = check_fefo_allocation(line.productId, line.qtyRequired);
    return fefo.eligibleBatches.map((batch) => ({
      productId: line.productId,
      batchId: batch.batchId,
      stockBalanceId: batch.stockBalanceId,
      qty: batch.qtyAllocated,
      mode: "allocate"
    })).filter((allocation) => allocation.qty > 0);
  });
  const outboundQty = actionAllocations.reduce((sum, item) => sum + item.qty, 0);
  const afterSummary = shouldDispatch
    ? {
        ...beforeSummary,
        onHand: Math.max(0, beforeSummary.onHand - outboundQty),
        reserved: Math.max(0, beforeSummary.reserved - outboundQty),
        outboundToday: Math.max(0, beforeSummary.outboundToday - outboundQty)
      }
    : {
        ...beforeSummary,
        available: Math.max(0, beforeSummary.available - outboundQty),
        reserved: beforeSummary.reserved + outboundQty
      };

  const stockImpact = actionAllocations.map((allocation) => {
    const balance = stockBalances.get(allocation.batchId);
    return {
      productCode: products.get(allocation.productId)?.productCode,
      batchId: allocation.batchId,
      locationId: balance?.locationId ?? null,
      location: balance ? locations.get(balance.locationId) ?? null : null,
      qty: allocation.qty,
      beforeOnHand: balance?.qtyOnHand ?? 0,
      beforeAvailable: balance?.qtyAvailable ?? 0,
      afterOnHand: shouldDispatch ? Math.max(0, (balance?.qtyOnHand ?? 0) - allocation.qty) : balance?.qtyOnHand ?? 0,
      afterAvailable: shouldDispatch ? balance?.qtyAvailable ?? 0 : Math.max(0, (balance?.qtyAvailable ?? 0) - allocation.qty)
    };
  });

  const beforeState = { shipment, lines, beforeSummary };
  const afterState = {
    shipment,
    afterSummary,
    allocations: actionAllocations
  };
  const scenarioId = actionId("SCN");
  db.prepare(
    `INSERT INTO scenario_snapshots
     (id, decision_id, scenario_type, before_state_json, after_state_json, risk_delta_json, created_at)
     VALUES (?, NULL, 'shipment_allocation', ?, ?, ?, ?)`
  ).run(
    scenarioId,
    stringify(beforeState),
    stringify(afterState),
    stringify({ onHandDelta: afterSummary.onHand - beforeSummary.onHand, availableDelta: afterSummary.available - beforeSummary.available }),
    nowIso()
  );

  return {
    shipmentId,
    status: shipment.outboundStatus,
    destination: shipment.destination,
    beforeSummary,
    afterSummary,
    allocations: beforeLines,
    stockImpact,
    excludedBatches: beforeLines.flatMap((line) => line.currentFefo.excludedBatches),
    affectedLaterShipments: beforeLines.flatMap((line) => line.currentFefo.affectedLaterShipments),
    affectedStages: shouldDispatch ? ["Packing", "Dock Staging", "Dispatch"] : ["Storage", "Reservation"],
    scenarioId,
    recommendedActionId: null,
    mutationApplied: false
  };
}

export function simulate_reprioritisation(shipmentId: string) {
  const shipment = findShipment(shipmentId);
  const allocationSimulation = simulate_shipment_allocation(shipmentId);
  const impactedStockBalances = shipment.stockBalanceIds;
  const beforeState = warehouseSummary();
  const targetDock = shipment.coldChainRequired ? "D2" : shipment.dockId;
  const newDispatchTime = addMinutes(80);
  const afterState = {
    ...beforeState,
    shipmentQueue: [
      {
        id: shipment.id,
        priority: "URGENT",
        dockId: targetDock,
        dispatchTime: newDispatchTime,
        status: "Expedited"
      },
      ...beforeState.shipmentQueue.filter((entry) => entry.id !== shipment.id)
    ],
    dockSlots: beforeState.dockSlots.map((slot) =>
      slot.shipmentId === shipment.id
        ? { ...slot, dockId: targetDock, startTime: newDispatchTime, endTime: addMinutes(140), conflictFlag: false }
        : slot
    )
  };
  const riskDelta = {
    fefoRisk: -12,
    dockConflictRisk: targetDock === shipment.dockId ? -4 : 8,
    coldChainRisk: shipment.coldChainRequired ? -10 : 0,
    qualityReleaseRisk: shipment.qualityFlags.length ? 15 : 0
  };
  const scenarioId = actionId("SCN");
  db.prepare(
    `INSERT INTO scenario_snapshots
     (id, decision_id, scenario_type, before_state_json, after_state_json, risk_delta_json, created_at)
     VALUES (?, NULL, 'reprioritisation', ?, ?, ?, ?)`
  ).run(scenarioId, stringify(beforeState), stringify(afterState), stringify(riskDelta), nowIso());

  return {
    shipmentId,
    beforeState,
    afterState,
    impactedStockBalances,
    inventoryImpact: allocationSimulation,
    affectedStages: ["Storage", "Picking", "Packing", "Dock Staging", "Dispatch"],
    affectedDocks: [targetDock],
    riskDelta,
    scenarioId,
    recommendedActionId: null,
    mutationApplied: false
  };
}

export async function simulate_event_impact(eventType: string, affectedRoute: string) {
  const validEvents = new Set([
    "weather",
    "supplier_delay",
    "vehicle_breakdown",
    "customs_hold",
    "temperature_excursion",
    "manufacturing_delay",
    "quality_hold"
  ]);
  if (!validEvents.has(eventType)) throw new Error(`Unsupported event type ${eventType}.`);
  const route = findRoute(affectedRoute);
  const impactMinutesByType: Record<string, number> = {
    weather: 40,
    supplier_delay: 65,
    vehicle_breakdown: 55,
    customs_hold: 75,
    temperature_excursion: 35,
    manufacturing_delay: 90,
    quality_hold: 45
  };

  // For weather events, blend in a real current-conditions reading at the route origin
  // (free, no-key Open-Meteo lookup) instead of relying purely on a hardcoded delay.
  // Falls back to the simulated baseline if the live lookup fails or times out, so the
  // demo never breaks on network issues or when Singapore genuinely has clear skies.
  let liveWeather: LiveWeatherReading | null = null;
  let inboundEtaImpactMinutes = impactMinutesByType[eventType];
  if (eventType === "weather") {
    liveWeather = await fetchLiveWeather(route.originLocation.lat, route.originLocation.lng);
    if (liveWeather?.isActiveDisruption) {
      const precipitationBonus = Math.round(Math.min(30, liveWeather.precipitationMm * 4));
      const windBonus = liveWeather.windSpeedKph >= 35 ? 10 : 0;
      inboundEtaImpactMinutes += precipitationBonus + windBonus;
    }
  }
  const projectedEta = route.baseEtaMinutes + inboundEtaImpactMinutes;
  const affectedProductCodes = route.expectedSkus;
  const affectedProductIds = affectedProductCodes.map(productIdFromInput);
  const fefoRiskSkus = affectedProductCodes.filter((productCode) => {
    const sku = findInventoryPlacement(productCode);
    return new Date(sku.expiryDate).getTime() <= Date.now() + 7 * 24 * 60 * 60_000;
  });
  const beforeState = {
    route,
    dockSchedule: getDockSchedule(),
    shipments: getShipments().filter((shipment) => shipment.productIds.some((productId) => affectedProductIds.includes(productId)))
  };
  const dockConflict = {
    dockId: "D2",
    shipmentIds: ["SHIP-001", "INBOUND-CHANGI-COLD"],
    startTime: addMinutes(projectedEta - 20),
    endTime: addMinutes(projectedEta + 40)
  };
  const mitigationOptions = [
    {
      label: "Option A Conservative",
      riskScore: 28,
      fefoImpact: "Protect FEFO by holding non-urgent dispatches and manually verifying cold-chain handoff.",
      dockImpact: "Reserve D6 as buffer dock; lowest dock conflict risk.",
      etaImpact: `Accepts ${projectedEta} minute ETA with no forced resequence.`,
      coldChainImpact: "Lowest excursion risk; highest operational delay.",
      qualityReleaseImpact: "No QA Hold stock is advanced."
    },
    {
      label: "Option B Balanced",
      riskScore: 42,
      fefoImpact: "Prioritises GSK-VAX-RSV and GSK-VAX-FLU while preserving released batch order.",
      dockImpact: "Moves cold-chain receiving to D2, shifts SHIP-003 behind urgent vaccines.",
      etaImpact: "Absorbs 40 minute weather delay with a controlled dock swap.",
      coldChainImpact: "Uses cold staging first; moderate resource pressure.",
      qualityReleaseImpact: "Blocks SHIP-005 until QA Hold is resolved."
    },
    {
      label: "Option C Aggressive",
      riskScore: 68,
      fefoImpact: "Fastest urgent vaccine dispatch, but creates more downstream FEFO pressure.",
      dockImpact: "Forces D2 and D4 resequence within the next 4 hours.",
      etaImpact: "Attempts to recover 20 minutes through immediate unloading.",
      coldChainImpact: "Higher excursion risk due to compressed staging.",
      qualityReleaseImpact: "Requires Compliance Agent release confirmation before movement."
    }
  ];
  const afterState = {
    route: {
      ...route,
      etaMinutes: projectedEta,
      currentDurationMinutes: projectedEta,
      delayDeltaMinutes: inboundEtaImpactMinutes,
      status: "disrupted",
      disruptionType: eventType,
      riskLevel: "high" as RiskLevel
    },
    dockConflictsCreated: [dockConflict],
    selectedMitigation: mitigationOptions[1]
  };
  const riskDelta = {
    inboundDelayMinutes: inboundEtaImpactMinutes,
    fefoRisk: fefoRiskSkus.length * 18,
    dockConflictRisk: 22,
    coldChainRisk: eventType === "temperature_excursion" ? 55 : 34,
    qualityReleaseRisk: eventType === "quality_hold" ? 60 : 15
  };
  const scenarioId = actionId("SCN");
  db.prepare(
    `INSERT INTO scenario_snapshots
     (id, decision_id, scenario_type, before_state_json, after_state_json, risk_delta_json, created_at)
     VALUES (?, NULL, 'event_impact', ?, ?, ?, ?)`
  ).run(scenarioId, stringify(beforeState), stringify(afterState), stringify(riskDelta), nowIso());

  return {
    eventType,
    inboundEtaImpactMinutes,
    dockConflictsCreated: [dockConflict],
    skusAtFefoRisk: fefoRiskSkus,
    coldChainRisk: riskDelta.coldChainRisk,
    qualityReleaseRisk: riskDelta.qualityReleaseRisk,
    affectedRoute: route.name,
    affectedSkus: affectedProductCodes,
    projectedRoute: afterState.route,
    mitigationOptions,
    riskDelta,
    scenarioId,
    recommendedActionId: null,
    mutationApplied: false,
    alert: null,
    alertIsNew: false,
    liveWeather,
    etaImpactSource: liveWeather?.isActiveDisruption ? "live_weather_plus_simulation" : "simulation_only"
  };
}

export function createAlert(alert: Omit<Alert, "id" | "timestamp" | "status">): { alert: Alert; isNew: boolean } {
  const existing = db
    .prepare("SELECT * FROM alerts WHERE message = ? AND status = 'open' ORDER BY datetime(timestamp) DESC LIMIT 1")
    .get(alert.message);
  if (existing) return { alert: alertFromRow(existing), isNew: false };
  const record = {
    id: `ALERT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    severity: alert.severity,
    message: alert.message,
    sourceAgent: alert.sourceAgent,
    affectedIdsJson: stringify(alert.affectedIds),
    timestamp: nowIso(),
    status: "open"
  };
  db.prepare(
    `INSERT INTO alerts (id, severity, message, source_agent, affected_ids_json, timestamp, status)
     VALUES (@id, @severity, @message, @sourceAgent, @affectedIdsJson, @timestamp, @status)`
  ).run(record);
  return {
    alert: alertFromRow({
      ...record,
      source_agent: record.sourceAgent,
      affected_ids_json: record.affectedIdsJson
    }),
    isNew: true
  };
}

export async function runTool(toolName: string, input: Record<string, unknown>) {
  switch (toolName) {
    case "get_inventory_summary":
      return get_inventory_summary();
    case "search_inventory":
      return search_inventory(String(input.query ?? ""), input.filters, String(input.sort ?? "Earliest expiry"));
    case "get_product_stock":
      return get_product_stock(String(input.productId ?? input.productCode ?? ""));
    case "get_inventory_planning":
      return get_inventory_planning(
        String(input.productId ?? input.productCode ?? ""),
        Number(input.horizonDays ?? 14),
        Number(input.demandMultiplier ?? 1)
      );
    case "get_batch_detail":
      return get_batch_detail(String(input.batchId ?? input.lotCode ?? ""));
    case "get_incoming_stock":
      return get_incoming_stock(input.filters);
    case "get_outbound_stock":
      return get_outbound_stock(input.filters);
    case "get_inventory_movements":
      return get_inventory_movements(input);
    case "check_fefo_allocation":
      return check_fefo_allocation(String(input.productId ?? input.productCode ?? ""), Number(input.requestedQty ?? 0));
    case "simulate_shipment_allocation":
      return simulate_shipment_allocation(String(input.shipmentId));
    case "apply_approved_inventory_action":
      throw new Error("Approval actions are disabled; assistant tools are read-only.");
    case "locate_sku":
      return locate_sku(String(input.stockBalanceId ?? input.skuId));
    case "check_fefo_impact":
      return check_fefo_impact(String(input.stockBalanceId ?? input.skuId), String(input.shipmentId));
    case "check_cold_chain_status":
      return check_cold_chain_status(String(input.zoneId), input.skuId ? String(input.skuId) : undefined);
    case "get_temperature_events":
      return get_temperature_events(input.zoneId ? String(input.zoneId) : undefined, input.eventType ? String(input.eventType) : undefined);
    case "get_route_status":
      return get_route_status(input.routeName ? String(input.routeName) : input.query ? String(input.query) : undefined);
    case "get_transport_context":
      return get_transport_context(
        input.referenceId ? String(input.referenceId) : undefined,
        input.direction ? String(input.direction) : undefined,
        input.status ? String(input.status) : undefined
      );
    case "get_audit_lookup":
      return get_audit_lookup(String(input.query ?? ""));
    case "check_dock_schedule":
      return check_dock_schedule(String(input.timeWindow ?? "next 4 hours"), input.shipmentId ? String(input.shipmentId) : undefined);
    case "simulate_reprioritisation":
      return simulate_reprioritisation(String(input.shipmentId));
    case "simulate_facility_disruption":
      return simulate_facility_disruption(
        String(input.eventType ?? "facility_shutdown"),
        input.durationMinutes === undefined ? undefined : Number(input.durationMinutes)
      );
    case "simulate_event_impact":
      return simulate_event_impact(String(input.eventType), String(input.affectedRoute));
    case "simulate_transport_impact":
      return simulate_transport_impact(
        String(input.referenceId),
        String(input.eventType),
        input.delayMinutes === undefined ? undefined : Number(input.delayMinutes)
      );
    case "apply_approved_action":
      throw new Error("Approval actions are disabled; assistant tools are read-only.");
    default:
      throw new Error(`Unknown deterministic tool ${toolName}.`);
  }
}

export function summariseToolCall(toolName: string, input: Record<string, unknown>, output: any): ToolCallSummary {
  let conciseOutput = "Tool completed.";
  switch (toolName) {
    case "get_inventory_summary":
      conciseOutput = `On Hand ${output.onHand}, Available ${output.available}, Reserved ${output.reserved}, QA Hold ${output.qaHold}`;
      break;
    case "search_inventory":
      conciseOutput = `${output.products?.length ?? 0} product match(es), ${output.inbound?.length ?? 0} inbound, ${output.outbound?.length ?? 0} outbound`;
      break;
    case "get_product_stock":
      conciseOutput = `${output.product?.productCode}: ${output.totalOnHand} on hand, ${output.totalAvailable} available`;
      break;
    case "get_inventory_planning":
      conciseOutput = `${output.product?.productCode}: ${output.risk} risk, ${output.projectedAtHorizon} projected at day ${output.horizonDays}, suggested replenishment ${output.recommendedOrderQty}`;
      break;
    case "get_batch_detail":
      conciseOutput = `${output.lotCode}: ${output.qtyOnHand} on hand, ${output.qualityStatus}`;
      break;
    case "get_incoming_stock":
      conciseOutput = `${output.length} inbound ASN(s)`;
      break;
    case "get_outbound_stock":
      conciseOutput = `${output.length} outbound shipment(s)`;
      break;
    case "get_inventory_movements":
      conciseOutput = `${output.length} movement record(s)`;
      break;
    case "check_fefo_allocation":
      conciseOutput = `${output.productCode}: ${output.totalEligibleAvailable} eligible, shortfall ${output.shortfallQty}`;
      break;
    case "simulate_shipment_allocation":
      conciseOutput = `${output.shipmentId}: ${output.stockImpact?.length ?? 0} stock impact row(s), advisory simulation only`;
      break;
    case "locate_sku":
      conciseOutput = `${output.stockBalanceId} -> ${output.zone?.name}, Rack ${output.rack}, Bin ${output.bin}`;
      break;
    case "check_fefo_impact":
      conciseOutput = `${output.fefoViolationCount} FEFO violation(s), cascade risk ${output.cascadeRiskScore}`;
      break;
    case "check_cold_chain_status":
      conciseOutput = `${output.zoneName}: ${output.currentTemperature} C, breach ${output.breachSeverity}`;
      break;
    case "get_temperature_events":
      conciseOutput = `${output.eventCount} temperature event(s)${output.zoneName ? ` for ${output.zoneName}` : ""}`;
      break;
    case "get_route_status":
      conciseOutput = `${output.routeCount} route status record(s)`;
      break;
    case "get_transport_context":
      conciseOutput = `${output.recordCount} canonical transport record(s): ${output.summary.inbound} inbound, ${output.summary.outbound} outbound, ${output.summary.exceptions} exception(s)`;
      break;
    case "get_audit_lookup":
      conciseOutput = `${output.enquiryCount} assistant enquiry record(s)`;
      break;
    case "check_dock_schedule":
      conciseOutput = `${output.dockSlotConflicts.length} conflict(s), utilisation impact ${output.dockUtilisationImpact}%`;
      break;
    case "simulate_reprioritisation":
      conciseOutput = `${output.shipmentId} advisory simulation only`;
      break;
    case "simulate_facility_disruption":
      conciseOutput = `${output.scope}: ${output.durationMinutes} min outage, ${output.expiresDuringOutage.length} lot(s) expiring during outage, ${output.expiresWithin7DaysAfterRecovery.length} restart-critical lot(s)`;
      break;
    case "simulate_event_impact":
      conciseOutput = `${output.affectedRoute} +${output.inboundEtaImpactMinutes} min, advisory simulation only`;
      break;
    case "simulate_transport_impact":
      conciseOutput = `${output.referenceId}: +${output.delayMinutes} min, ${output.dockConflictsCreated.length} dock conflict(s), advisory simulation only`;
      break;
  }
  return {
    toolName,
    input,
    conciseOutput,
    output
  };
}

export type ToolExecution = {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  summary: ToolCallSummary;
};

export type ToolResultSnapshot = WarehouseSnapshot;
