export type AgentName = "Orchestrator" | "Inventory" | "Logistics" | "Compliance";
export type AppViewKey = "Dashboard" | "Warehouse" | "Inventory" | "Logistics" | "Monitoring" | "Audit" | "Alerts";
export type WarehouseWorkspace = "facility" | "locations" | "docks";
export type InventoryWorkspace = "overview" | "stock" | "planning" | "movements";
export type LogisticsWorkspace = "network" | "inbound" | "outbound" | "transport";
export type OperationalWorkspace = WarehouseWorkspace | InventoryWorkspace | LogisticsWorkspace;
export type OperationalFocusType =
  | "overview"
  | "zone"
  | "rack"
  | "bin"
  | "stock_balance"
  | "asn"
  | "shipment"
  | "transport_leg"
  | "route"
  | "dock"
  | "dock_appointment"
  | "rfid"
  | "partner_site";

export interface AssistantUiContext {
  activeView: AppViewKey;
  activeWorkspace?: OperationalWorkspace | null;
  focusType?: OperationalFocusType | null;
  selected: {
    zoneId?: string | null;
    rackId?: string | null;
    binId?: string | null;
    stockBalanceId?: string | null;
    stage?: string | null;
    dockId?: string | null;
    dockAppointmentId?: string | null;
    shipmentId?: string | null;
    rfidGateId?: string | null;
    routeId?: string | null;
    transportLegId?: string | null;
    partnerSiteId?: string | null;
    inboundAsnId?: string | null;
  };
  filters?: {
    inventoryQuickFilter?: string;
    logisticsRouteFilter?: string;
    logisticsDirectionFilter?: string;
    auditFilter?: string;
  };
}
export type Severity = "critical" | "warn" | "info";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "not_required";
export type RouteStatus = "on-time" | "delayed" | "disrupted";
export type ScheduleAdherenceStatus = "on-time" | "delayed" | "unknown";
export type RouteProvider = "ors" | "osrm" | "fallback";
export type RouteCacheSource = RouteProvider;
export type QualityStatus = "Released" | "QA Hold" | "Quarantine" | "Pending QA" | "Expired";

export interface LatLng {
  lat: number;
  lng: number;
}

export type PartnerSiteRole = "supplier" | "customer" | "warehouse" | "airport" | "port" | "return_origin";
export type TemperatureCapability = "ambient" | "2-8C" | "15-25C";
export type TransportDirection = "inbound" | "outbound";
export type TemperatureComplianceStatus = "compliant" | "excursion" | "unknown" | "not_required";
export type TransportStatus =
  | "planned"
  | "vehicle_assigned"
  | "in_transit"
  | "arrived"
  | "at_dock"
  | "loading"
  | "unloading"
  | "departed"
  | "delivered"
  | "exception"
  | "cancelled";
export type DockAppointmentStatus =
  | "booked"
  | "checked_in"
  | "at_dock"
  | "loading"
  | "unloading"
  | "completed"
  | "missed"
  | "cancelled"
  | "exception";
export type WarehouseProcess = "inbound" | "outbound" | "transport" | "quality" | "inventory" | "yard";
export type WarehouseOperationalEventStatus = "planned" | "in_progress" | "completed" | "exception" | "cancelled";
export type WarehouseProcessStep =
  | "PURCHASE_ORDER_CREATED"
  | "ASN_RECEIVED"
  | "APPOINTMENT_BOOKED"
  | "VEHICLE_ASSIGNED"
  | "DEPARTED_ORIGIN"
  | "GATE_IN"
  | "DOCK_ASSIGNED"
  | "UNLOADING_STARTED"
  | "HANDLING_UNIT_SCANNED"
  | "GOODS_RECEIPT_POSTED"
  | "QA_INSPECTION_STARTED"
  | "QA_RELEASED"
  | "QA_HOLD_APPLIED"
  | "PUTAWAY_TASK_CREATED"
  | "PUTAWAY_CONFIRMED"
  | "CUSTOMER_ORDER_RECEIVED"
  | "DELIVERY_CREATED"
  | "WAVE_RELEASED"
  | "FEFO_ALLOCATED"
  | "REPLENISHMENT_TASK_CREATED"
  | "PICKING_STARTED"
  | "PICK_CONFIRMED"
  | "PACK_CONFIRMED"
  | "RELEASE_CHECK_PASSED"
  | "STAGED"
  | "LOADING_STARTED"
  | "SEAL_CONFIRMED"
  | "GOODS_ISSUE_POSTED"
  | "DEPARTED_WAREHOUSE"
  | "DELIVERED"
  | "POD_RECEIVED"
  | "EXCEPTION_RECORDED";

/**
 * A physical logistics location. Public Singapore locations are used only as geographic anchors;
 * `simulated` and `dataNotice` make it explicit that the commercial relationship is fictional.
 */
export interface PartnerSite {
  siteId: string;
  partnerId: string;
  partnerName: string;
  siteCode: string;
  role: PartnerSiteRole;
  displayName: string;
  address: string;
  postalCode: string;
  countryCode: string;
  timezone: string;
  location: LatLng;
  receivingWindow: string;
  temperatureCapabilities: TemperatureCapability[];
  vehicleRestrictions: string[];
  simulated: boolean;
  publicLocationReference: string | null;
  dataNotice: string;
}

/** The durable TMS record used for both supplier-to-warehouse and warehouse-to-customer movement. */
export interface TransportLeg {
  transportLegId: string;
  routeId: string;
  direction: TransportDirection;
  asnId: string | null;
  shipmentId: string | null;
  originSiteId: string;
  destinationSiteId: string;
  carrierId: string;
  carrierName: string;
  vehicleId: string;
  vehicleType: string;
  licensePlate: string;
  driverId: string | null;
  plannedDeparture: string;
  actualDeparture: string | null;
  plannedArrival: string;
  actualArrival: string | null;
  estimatedArrival: string;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  dockAppointmentId: string;
  temperatureRequirement: TemperatureCapability;
  temperatureMin: number | null;
  temperatureMax: number | null;
  temperatureStatus: TemperatureComplianceStatus;
  temperatureLoggerId: string | null;
  transportStatus: TransportStatus;
  routeStatus: RouteStatus;
  /** Derived from the linked WMS milestone and its planned/actual timestamp. */
  scheduleAdherence?: ScheduleAdherenceStatus;
  scheduleAdherenceLabel?: string;
  scheduleVarianceMinutes?: number | null;
  distanceKm: number;
  baseDurationMinutes: number;
  durationMinutes: number;
  delayMinutes: number;
  disruptionType: string | null;
  riskLevel: RiskLevel;
  riskNote: string;
  receivingImpact: string;
  mitigationSuggestion: string;
  encodedPolyline: string | null;
  polyline: LatLng[];
  lastKnownLocation: LatLng | null;
  lastComputedAt: string | null;
  cacheSource: RouteCacheSource;
  providerUsed: RouteProvider;
  isRealRoadRoute: boolean;
  sealNumber: string | null;
  proofOfDeliveryId: string | null;
  lastUpdatedAt: string;
}

export interface DockAppointment {
  dockAppointmentId: string;
  dockId: string;
  direction: TransportDirection;
  transportLegId: string;
  referenceType: "ASN" | "Outbound Shipment" | "Return";
  referenceId: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualGateIn: string | null;
  actualDockIn: string | null;
  actualDockOut: string | null;
  actualGateOut: string | null;
  status: DockAppointmentStatus;
  carrierId: string;
  carrierName: string;
  vehicleId: string;
  licensePlate: string;
  temperatureRequirement: TemperatureCapability;
  conflictFlag: boolean;
  notes: string;
  lastUpdatedAt: string;
}

export interface WarehouseOperationalEvent {
  eventId: string;
  timestamp: string;
  process: WarehouseProcess;
  direction: TransportDirection | null;
  step: WarehouseProcessStep;
  status: WarehouseOperationalEventStatus;
  sourceSystem: "ERP" | "WMS" | "TMS" | "QMS" | "YMS" | "IoT";
  actor: string;
  referenceType: string;
  referenceId: string;
  asnId: string | null;
  shipmentId: string | null;
  transportLegId: string | null;
  dockAppointmentId: string | null;
  siteId: string | null;
  dockId: string | null;
  locationId: string | null;
  description: string;
  exceptionCode: string | null;
  metadata: Record<string, unknown>;
}

export interface LogisticsData {
  warehouseSiteId: string;
  simulationDisclosure: string;
  partnerSites: PartnerSite[];
  transportLegs: TransportLeg[];
  dockAppointments: DockAppointment[];
  operationalEvents: WarehouseOperationalEvent[];
}

export interface Zone {
  id: string;
  name: string;
  code: string;
  temperatureMin: number;
  temperatureMax: number;
  capacityUnits: number;
  currentTemperature: number;
  fillPercent: number;
  status: "normal" | "warn" | "critical";
  productTypes: string[];
}

/** A product lot's quantity and operational state at one warehouse location. */
export interface InventoryPlacement {
  /** Canonical identity for this lot-location quantity record. */
  stockBalanceId: string;
  productId?: string;
  productCode?: string;
  batchId?: string;
  locationId?: string;
  productName: string;
  category: string;
  zoneId: string;
  zoneName?: string;
  rack: string;
  bin: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  priority: "URGENT" | "HIGH" | "NORMAL" | "LOW";
  temperatureMin: number;
  temperatureMax: number;
  regField: string;
  qualityStatus: QualityStatus;
  linkedShipmentId: string | null;
  currentStage: string;
  dispatchSequence: number;
  qtyAvailable?: number;
  qtyReserved?: number;
  qtyPicked?: number;
  qtyPacked?: number;
  qtyStaged?: number;
  qtyOnHold?: number;
}

export interface Shipment {
  id: string;
  destination: string;
  priority: "URGENT" | "HIGH" | "NORMAL" | "LOW";
  dockId: string;
  dispatchTime: string;
  status: string;
  productIds: string[];
  batchIds: string[];
  stockBalanceIds: string[];
  coldChainRequired: boolean;
  slaDeadline: string;
  qualityFlags: string[];
  /** Compatibility projection from the canonical outbound shipment and transport leg. */
  routeId?: string | null;
  transportLegId?: string | null;
  customerSiteId?: string | null;
  dockAppointmentId?: string | null;
}

export interface Dock {
  id: string;
  name: string;
  status: "available" | "occupied" | "maintenance";
  currentShipmentId: string | null;
  nextAvailableAt: string;
}

export interface DockSchedule {
  id: string;
  dockId: string;
  shipmentId: string;
  startTime: string;
  endTime: string;
  status: string;
  conflictFlag: boolean;
  direction?: TransportDirection;
  transportLegId?: string;
  referenceType?: "ASN" | "Outbound Shipment" | "Return";
}

export interface InboundRoute {
  routeId: string;
  id: string;
  name: string;
  origin: string;
  originType: string;
  originLocation: LatLng;
  destination: string;
  destinationLocation: LatLng;
  etaMinutes: number;
  baseEtaMinutes: number;
  currentDurationMinutes: number;
  durationMinutes: number;
  delayDeltaMinutes: number;
  distanceKm: number;
  status: RouteStatus;
  expectedSkus: string[];
  coldChainRequired: boolean;
  disruptionType: string | null;
  riskLevel: RiskLevel;
  riskNote: string;
  receivingImpact: string;
  mitigationSuggestion: string;
  encodedPolyline: string | null;
  polyline: LatLng[];
  geometry: LatLng[];
  lastComputedAt: string | null;
  cacheSource: RouteCacheSource;
  providerUsed: RouteProvider;
  isRealRoadRoute: boolean;
  /** Despite the legacy name, this compatibility view now contains inbound and outbound routes. */
  direction: TransportDirection;
  transportLegId: string;
  asnId: string | null;
  shipmentId: string | null;
  originSiteId: string;
  destinationSiteId: string;
  transportStatus: TransportStatus;
  plannedArrival: string;
  estimatedArrival: string;
  dockAppointmentId: string;
  temperatureStatus: TemperatureComplianceStatus;
  carrierName: string;
  vehicleId: string;
  licensePlate: string;
}

export interface TemperatureReading {
  id: number;
  zoneId: string;
  temperature: number;
  timestamp: string;
  withinBand: boolean;
  allowedMin: number;
  allowedMax: number;
  sensorId: string;
  relatedSkuIds: string[];
  relatedBatchIds: string[];
}

export type TemperatureReadingClassification = "In Range" | "Excursion" | "Non-Conformance";
export type TemperatureEventType = "Excursion" | "Non-Conformance";
export type TemperatureEventStatus = "Open" | "Under Review" | "Closed" | "Resolved";

export interface TemperatureDurationContext {
  durationMinutes?: number;
  repeatedExcursions?: number;
  zoneName?: string;
}

export interface TemperatureEvent {
  eventId: string;
  ncId: string | null;
  zoneId: string;
  zoneName: string;
  timestampStart: string;
  timestampEnd: string;
  durationMinutes: number;
  allowedBand: {
    min: number;
    max: number;
  };
  minTemp: number;
  maxTemp: number;
  observedRange: string;
  peakTemp: number;
  peakVariance: number;
  eventType: TemperatureEventType;
  status: TemperatureEventStatus;
  relatedSkuIds: string[];
  relatedBatchIds: string[];
  affectedSkuIds: string[];
  affectedBatchIds: string[];
  recommendedAction: string;
  auditReference: string | null;
  resolved: boolean;
}

type TemperatureBandReading = Pick<TemperatureReading, "temperature"> &
  Partial<Pick<TemperatureReading, "allowedMin" | "allowedMax" | "timestamp" | "zoneId" | "relatedSkuIds" | "relatedBatchIds">>;

const MAX_EXCURSION_SAMPLE_GAP_MINUTES = 10;
const REPEATED_EXCURSION_WINDOW_MS = 4 * 60 * 60_000;

function roundTemperature(value: number) {
  return Number(value.toFixed(1));
}

function roundVariance(value: number) {
  return Number(value.toFixed(2));
}

function isColdChainBand(reading: TemperatureBandReading) {
  return reading.allowedMin === 2 && reading.allowedMax === 8;
}

export function calculateVariance(reading: TemperatureBandReading): number {
  if (typeof reading.allowedMin !== "number" || typeof reading.allowedMax !== "number") return 0;
  if (reading.temperature > reading.allowedMax) return roundVariance(reading.temperature - reading.allowedMax);
  if (reading.temperature < reading.allowedMin) return roundVariance(reading.allowedMin - reading.temperature);
  return 0;
}

export function classifyReading(
  reading: TemperatureBandReading,
  durationContext: TemperatureDurationContext = {}
): TemperatureReadingClassification {
  const variance = calculateVariance(reading);
  if (variance === 0) return "In Range";

  const durationMinutes = durationContext.durationMinutes ?? 0;
  const repeatedExcursions = durationContext.repeatedExcursions ?? 0;
  const severeVariance = variance > 2;
  const durationExceeded = durationMinutes > 15;
  const repeatedBreach = repeatedExcursions >= 3;
  const coldChainHighBreach = isColdChainBand(reading) && typeof reading.allowedMax === "number" && reading.temperature > reading.allowedMax && durationMinutes > 15;
  const coldChainLowBreach = isColdChainBand(reading) && typeof reading.allowedMin === "number" && reading.temperature < reading.allowedMin && durationMinutes > 10;

  if (severeVariance || durationExceeded || repeatedBreach || coldChainHighBreach || coldChainLowBreach) {
    return "Non-Conformance";
  }
  return "Excursion";
}

function eventIdFor(zoneId: string, timestamp: string) {
  const compactTime = timestamp.replace(/[-:.TZ]/g, "").slice(0, 14);
  return `TE-${zoneId}-${compactTime}`;
}

function recommendedActionFor(zoneName: string, reading: TemperatureBandReading) {
  const label = zoneName.toLowerCase();
  if (label.includes("receiving") || label.includes("dispatch")) return "Review dock opening period";
  if (isColdChainBand(reading)) return "Hold affected batch";
  if (label.includes("qa") || label.includes("quarantine")) return "Inspect affected stock";
  return "Check sensor calibration";
}

function uniqueStrings(values: string[][]) {
  return [...new Set(values.flat().filter(Boolean))];
}

export function groupExcursions(readings: TemperatureReading[], zones: Zone[] = []): TemperatureEvent[] {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const byZone = new Map<string, TemperatureReading[]>();
  readings.forEach((reading) => {
    const zone = zoneById.get(reading.zoneId);
    const normalized: TemperatureReading = {
      ...reading,
      allowedMin: reading.allowedMin ?? zone?.temperatureMin ?? 0,
      allowedMax: reading.allowedMax ?? zone?.temperatureMax ?? 0,
      sensorId: reading.sensorId ?? `${reading.zoneId}-TEMP-01`,
      relatedSkuIds: reading.relatedSkuIds ?? [],
      relatedBatchIds: reading.relatedBatchIds ?? []
    };
    const current = byZone.get(normalized.zoneId) ?? [];
    current.push(normalized);
    byZone.set(normalized.zoneId, current);
  });

  const events: TemperatureEvent[] = [];

  byZone.forEach((zoneReadings, zoneId) => {
    const zone = zoneById.get(zoneId);
    const ordered = [...zoneReadings].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let current: TemperatureReading[] = [];

    const finalize = (active: boolean, recoveredAt?: string) => {
      if (!current.length) return;
      const start = current[0];
      const end = current[current.length - 1];
      // Historical seed readings arrive every five minutes while live telemetry arrives every
      // five seconds. Duration therefore has to come from the timestamps themselves; treating
      // every sample as a five-minute block inflated a one-minute live spike into several
      // minutes. A recovered event runs until the first in-range sample. For an event that is
      // still open, extend through one observed inter-sample interval and round up to a whole
      // display minute.
      const startMs = new Date(start.timestamp).getTime();
      const endMs = new Date(end.timestamp).getTime();
      const previous = current.length > 1 ? current[current.length - 2] : null;
      const observedIntervalMs = previous
        ? Math.max(0, endMs - new Date(previous.timestamp).getTime())
        : 0;
      const effectiveEndMs = recoveredAt
        ? new Date(recoveredAt).getTime()
        : endMs + observedIntervalMs;
      const durationMinutes = Math.max(1, Math.ceil(Math.max(0, effectiveEndMs - startMs) / 60_000));
      const minTemp = roundTemperature(Math.min(...current.map((reading) => reading.temperature)));
      const maxTemp = roundTemperature(Math.max(...current.map((reading) => reading.temperature)));
      const peakReading = current.reduce((highest, reading) => (calculateVariance(reading) > calculateVariance(highest) ? reading : highest), current[0]);
      const peakVariance = calculateVariance(peakReading);
      const classification = classifyReading(peakReading, {
        durationMinutes,
        zoneName: zone?.name
      });
      // Open Alerts represents the live physical condition. Once an in-range reading closes the
      // event, even a Non-Conformance becomes resolved here; its classification and audit/QMS
      // references remain durable for investigation in Audit.
      const status: TemperatureEventStatus = active ? "Open" : "Resolved";
      const relatedSkuIds = uniqueStrings(current.map((reading) => reading.relatedSkuIds));
      const relatedBatchIds = uniqueStrings(current.map((reading) => reading.relatedBatchIds));
      const eventId = eventIdFor(zoneId, start.timestamp);
      const ncId = classification === "Non-Conformance" ? eventId.replace("TE-", "NC-") : null;

      events.push({
        eventId,
        ncId,
        zoneId,
        zoneName: zone?.name ?? zoneId,
        timestampStart: start.timestamp,
        timestampEnd: end.timestamp,
        durationMinutes,
        allowedBand: {
          min: start.allowedMin,
          max: start.allowedMax
        },
        minTemp,
        maxTemp,
        observedRange: `${minTemp.toFixed(1)}-${maxTemp.toFixed(1)} C`,
        peakTemp: roundTemperature(peakReading.temperature),
        peakVariance,
        eventType: classification === "Non-Conformance" ? "Non-Conformance" : "Excursion",
        status,
        relatedSkuIds,
        relatedBatchIds,
        affectedSkuIds: relatedSkuIds,
        affectedBatchIds: relatedBatchIds,
        recommendedAction: recommendedActionFor(zone?.name ?? zoneId, start),
        auditReference: ncId ? `AUD-${eventId.replace("TE-", "")}` : null,
        resolved: !active
      });
      current = [];
    };

    ordered.forEach((reading) => {
      const outOfBand = calculateVariance(reading) > 0;
      if (!outOfBand) {
        finalize(false, reading.timestamp);
        return;
      }

      const previous = current[current.length - 1];
      const gapMinutes = previous ? (new Date(reading.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 60_000 : 0;
      if (previous && gapMinutes > MAX_EXCURSION_SAMPLE_GAP_MINUTES) {
        finalize(false);
      }
      current.push(reading);
    });
    finalize(true);
  });

  const sortedEvents = events.sort((a, b) => new Date(a.timestampStart).getTime() - new Date(b.timestampStart).getTime());

  sortedEvents.forEach((event) => {
    if (event.eventType === "Non-Conformance") return;
    const eventTime = new Date(event.timestampStart).getTime();
    const recentExcursions = sortedEvents.filter(
      (candidate) =>
        candidate.zoneId === event.zoneId &&
        candidate.eventType === "Excursion" &&
        new Date(candidate.timestampStart).getTime() <= eventTime &&
        eventTime - new Date(candidate.timestampStart).getTime() <= REPEATED_EXCURSION_WINDOW_MS
    );
    if (recentExcursions.length >= 3) {
      event.eventType = "Non-Conformance";
      event.status = event.status === "Open" ? "Open" : "Resolved";
      event.ncId = event.eventId.replace("TE-", "NC-");
      event.auditReference = `AUD-${event.eventId.replace("TE-", "")}`;
      event.recommendedAction = "Escalate QA review";
      event.resolved = event.status === "Resolved";
    }
  });

  return sortedEvents;
}

export function getTemperatureEvents(readings: TemperatureReading[], zones: Zone[] = [], zoneId?: string): TemperatureEvent[] {
  const scopedReadings = zoneId ? readings.filter((reading) => reading.zoneId === zoneId) : readings;
  return groupExcursions(scopedReadings, zones).filter((event) => event.eventType === "Excursion" || event.eventType === "Non-Conformance");
}

export interface RfidEvent {
  id: number;
  skuId: string;
  zoneId: string;
  action: "IN" | "OUT" | "MOVE";
  timestamp: string;
  severity: Severity;
}

export interface Alert {
  id: string;
  severity: Severity;
  message: string;
  sourceAgent: AgentName;
  affectedIds: string[];
  timestamp: string;
  status: "open" | "dismissed" | "escalated";
}

export interface ToolCallSummary {
  toolName: string;
  input: Record<string, unknown>;
  conciseOutput: string;
  output?: unknown;
}

export const agentIntentValues = [
  "stock_position",
  "incoming_stock",
  "outbound_stock",
  "sku_location",
  "batch_detail",
  "fefo_check",
  "shipment_impact",
  "route_status",
  "transport_status",
  "temperature_event",
  "non_conformance",
  "audit_lookup",
  "scenario_simulation",
  "general_question",
  "unavailable"
] as const;

export type AgentIntent = (typeof agentIntentValues)[number];

export const agentStatusValues = ["ok", "attention", "blocked", "non_conformance", "unavailable"] as const;
export type AgentStatus = (typeof agentStatusValues)[number];

export const agentActionTypeValues = [
  "none",
  "open_inventory",
  "locate_warehouse",
  "open_logistics",
  "open_monitoring",
  "open_audit",
  "run_fefo_check",
  "run_simulation",
  "review_non_conformance"
] as const;

export type AgentActionType = (typeof agentActionTypeValues)[number];

export const agentConfidenceValues = ["high", "medium", "low"] as const;
export type AgentConfidence = (typeof agentConfidenceValues)[number];

export const analysisPriorityValues = ["balanced", "fefo", "cold_chain"] as const;
export type AnalysisPriority = (typeof analysisPriorityValues)[number];

export interface AgentResponse {
  intent: AgentIntent;
  status: AgentStatus;
  title: string;
  summary: string;
  facts: Array<{ label: string; value: string }>;
  impact: string[];
  nextAction: {
    label: string;
    type: AgentActionType;
    targetId: string | null;
  };
  requiresApproval: boolean;
  dataGaps: string[];
  confidence: AgentConfidence;
}

export interface ActionPayload {
  type: string;
  affectedSKUs: string[];
  affectedZones: string[];
  affectedStages: string[];
  affectedShipments: string[];
  affectedDocks: string[];
  recommendedActionId: string | null;
}

export interface DecisionEvidence {
  dataUsed: string[];
  constraintsApplied: string[];
  alternativesConsidered: string[];
  uncertainties: string[];
  whyRecommendationWasMade: string;
}

export interface OrchestratorResponse {
  decisionId: string;
  narrative: string;
  agentResponse: AgentResponse;
  agentsUsed: AgentName[];
  toolsCalled: ToolCallSummary[];
  confidence: number;
  riskLevel: RiskLevel;
  actionPayload: ActionPayload;
  decisionEvidence: DecisionEvidence;
  requiresApproval: boolean;
  approvalStatus: ApprovalStatus;
  toolResults?: Record<string, unknown>;
  fallbackUsed: boolean;
  analysisPriority?: AnalysisPriority;
}

export interface AiDecision {
  id: string;
  timestamp: string;
  query: string;
  narrative: string;
  agentResponse: AgentResponse;
  agentsUsed: AgentName[];
  toolsCalled: ToolCallSummary[];
  confidence: number;
  riskLevel: RiskLevel;
  actionPayload: ActionPayload;
  decisionEvidence: DecisionEvidence;
  requiresApproval: boolean;
  approvalStatus: ApprovalStatus;
  fallbackUsed: boolean;
}

export interface Product {
  productId: string;
  productCode: string;
  productName: string;
  productFamily: string;
  defaultTempBand: string;
  storageClass: string;
  unitType: string;
  safetyStock: number;
  reorderPoint: number;
  targetStock: number;
  leadTimeDays: number;
  averageDailyDemand: number;
  gtin: string;
  manufacturer: string;
  dosageForm: string;
  strength: string;
  packSize: string;
}

export interface Batch {
  batchId: string;
  productId: string;
  lotCode: string;
  expiryDate: string;
  manufactureDate: string | null;
  qualityStatus: QualityStatus;
  tempBand: string;
  serializationStatus: string | null;
  notes: string | null;
  stoNumber: string;
  goodsReceiptNumber: string;
  arrivalAt: string;
  putawayAt: string;
  handlingUnit: string;
  inspectionLot: string;
  countryOfOrigin: string;
  lastCycleCountAt: string;
}

export interface WarehouseLocation {
  locationId: string;
  zone: string;
  rack: string;
  bin: string;
  tempBand: string;
  capacity: number;
  currentFill: number;
}

export interface StockBalance {
  stockBalanceId: string;
  batchId: string;
  locationId: string;
  qtyOnHand: number;
  qtyAvailable: number;
  qtyReserved: number;
  qtyPicked: number;
  qtyPacked: number;
  qtyStaged: number;
  qtyDispatched: number;
  qtyOnHold: number;
  lastUpdated: string;
}

export interface InboundShipment {
  asnId: string;
  source: string;
  routeName: string;
  eta: string;
  receivingDock: string;
  inboundStatus:
    | "ASN Received"
    | "Appointment Booked"
    | "Vehicle Assigned"
    | "Scheduled"
    | "In Transit"
    | "Gate In"
    | "At Receiving"
    | "Unloading"
    | "Received"
    | "QA Pending"
    | "QA Hold"
    | "Released"
    | "Putaway"
    | "Putaway Complete"
    | "Closed"
    | "Exception";
  coldChainStatus: string;
  linkedRouteId: string | null;
  purchaseOrderId: string | null;
  supplierSiteId: string | null;
  transportLegId: string | null;
  dockAppointmentId: string | null;
  plannedArrival: string;
  actualArrival: string | null;
  goodsReceiptNumber: string | null;
  vehicleId: string | null;
  sealNumber: string | null;
}

export interface InboundLine {
  inboundLineId: string;
  asnId: string;
  productId: string;
  batchId: string;
  qtyExpected: number;
  qtyReceived: number;
  tempBand: string;
  receivingStatus: string;
  qaStatus: QualityStatus;
}

export interface OutboundShipment {
  shipmentId: string;
  destination: string;
  requiredBy: string;
  dock: string;
  outboundStatus:
    | "Order Received"
    | "Delivery Created"
    | "Scheduled"
    | "Wave Released"
    | "Allocated"
    | "Replenishment"
    | "Picking"
    | "Picked"
    | "Packed"
    | "QA Release"
    | "Staged"
    | "Loading"
    | "Goods Issued"
    | "Dispatched"
    | "Delivered"
    | "Blocked"
    | "Exception";
  priorityLevel: "Medical Priority" | "Normal" | "Low" | null;
  routeId: string | null;
  customerOrderId: string | null;
  deliveryId: string | null;
  customerSiteId: string | null;
  transportLegId: string | null;
  dockAppointmentId: string | null;
  plannedDeparture: string;
  actualDeparture: string | null;
  deliveryWindowStart: string | null;
  deliveryWindowEnd: string | null;
  goodsIssueNumber: string | null;
  proofOfDeliveryId: string | null;
  vehicleId: string | null;
  sealNumber: string | null;
}

export interface OutboundLine {
  outboundLineId: string;
  shipmentId: string;
  productId: string;
  batchId: string;
  qtyRequired: number;
  qtyAllocated: number;
  qtyPicked: number;
  qtyPacked: number;
  qtyDispatched: number;
  allocationStatus: string;
}

export interface ScheduleAdherence {
  status: ScheduleAdherenceStatus;
  label: string;
  varianceMinutes: number | null;
  targetTime: string | null;
  actualTime: string | null;
  completed: boolean;
}

function scheduleTime(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function scheduleDuration(minutes: number) {
  const absolute = Math.max(1, Math.round(Math.abs(minutes)));
  if (absolute < 60) return `${absolute} min`;
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function calculateScheduleAdherence(input: {
  targetTime: string | null | undefined;
  actualTime?: string | null;
  completed?: boolean;
  pendingMilestone: string;
  completedMilestone: string;
}, now = new Date()): ScheduleAdherence {
  const target = scheduleTime(input.targetTime);
  const actual = scheduleTime(input.actualTime);
  const completed = Boolean(input.completed || actual !== null);
  if (target === null) {
    return { status: "unknown", label: "Schedule unknown", varianceMinutes: null, targetTime: input.targetTime ?? null, actualTime: input.actualTime ?? null, completed };
  }
  if (completed && actual === null) {
    return { status: "unknown", label: `${input.completedMilestone} time not recorded`, varianceMinutes: null, targetTime: input.targetTime ?? null, actualTime: null, completed };
  }

  const comparison = actual ?? now.getTime();
  const varianceMilliseconds = comparison - target;
  const varianceMinutes = varianceMilliseconds > 0
    ? Math.ceil(varianceMilliseconds / 60_000)
    : varianceMilliseconds < 0
      ? Math.floor(varianceMilliseconds / 60_000)
      : 0;
  if (varianceMilliseconds > 0) {
    return {
      status: "delayed",
      label: completed
        ? `${input.completedMilestone} ${scheduleDuration(varianceMinutes)} late`
        : `${input.pendingMilestone} overdue by ${scheduleDuration(varianceMinutes)}`,
      varianceMinutes,
      targetTime: input.targetTime ?? null,
      actualTime: input.actualTime ?? null,
      completed
    };
  }
  return {
    status: "on-time",
    label: completed ? `${input.completedMilestone} on time` : "On schedule",
    varianceMinutes,
    targetTime: input.targetTime ?? null,
    actualTime: input.actualTime ?? null,
    completed
  };
}

export function inboundScheduleAdherence(shipment: InboundShipment, now = new Date()) {
  const arrivalRecordedByStatus = ["Gate In", "At Receiving", "Unloading", "Received", "QA Pending", "QA Hold", "Released", "Putaway", "Putaway Complete", "Closed"].includes(shipment.inboundStatus);
  return calculateScheduleAdherence({
    targetTime: shipment.plannedArrival || shipment.eta,
    actualTime: shipment.actualArrival,
    completed: arrivalRecordedByStatus,
    pendingMilestone: "Arrival",
    completedMilestone: "Arrived"
  }, now);
}

export function outboundScheduleAdherence(shipment: OutboundShipment, now = new Date()) {
  const departureRecordedByStatus = ["Goods Issued", "Dispatched", "Delivered"].includes(shipment.outboundStatus);
  return calculateScheduleAdherence({
    // `requiredBy` is the customer delivery-window target. Dispatch adherence must use the
    // planned warehouse departure or a late vehicle could be shown as on time merely because
    // the customer delivery deadline has not passed yet.
    targetTime: shipment.plannedDeparture,
    actualTime: shipment.actualDeparture,
    completed: departureRecordedByStatus,
    pendingMilestone: "Dispatch",
    completedMilestone: "Dispatched"
  }, now);
}

export interface InventoryMovement {
  movementId: string;
  timestamp: string;
  movementType:
    | "Receive"
    | "Putaway"
    | "Reserve"
    | "Release Reservation"
    | "Pick"
    | "Pack"
    | "Stage"
    | "Dispatch"
    | "QA Hold"
    | "QA Release"
    | "Quarantine"
    | "Adjustment";
  productId: string;
  batchId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  qty: number;
  referenceType: string;
  referenceId: string;
  userOrSystem: string;
  note: string;
}

export interface InventorySummary {
  onHand: number;
  available: number;
  reserved: number;
  incomingToday: number;
  outboundToday: number;
  qaHold: number;
  productCount: number;
  batchCount: number;
}

export interface BatchStockPosition {
  batchId: string;
  lotCode: string;
  productId: string;
  expiryDate: string;
  manufactureDate: string | null;
  qualityStatus: QualityStatus;
  tempBand: string;
  serializationStatus: string | null;
  notes: string | null;
  stoNumber: string;
  goodsReceiptNumber: string;
  arrivalAt: string;
  putawayAt: string;
  handlingUnit: string;
  inspectionLot: string;
  countryOfOrigin: string;
  lastCycleCountAt: string;
  location: WarehouseLocation;
  stockBalanceId: string;
  qtyOnHand: number;
  qtyAvailable: number;
  qtyReserved: number;
  qtyPicked: number;
  qtyPacked: number;
  qtyStaged: number;
  qtyDispatched: number;
  qtyOnHold: number;
  linkedInboundIds: string[];
  linkedShipmentIds: string[];
}

export interface ProductStockPosition {
  product: Product;
  totalOnHand: number;
  totalAvailable: number;
  totalReserved: number;
  totalPicked: number;
  totalPacked: number;
  totalStaged: number;
  totalQaHold: number;
  earliestExpiry: string | null;
  batches: BatchStockPosition[];
}

export interface BatchDetail extends BatchStockPosition {
  product: Product;
  movements: InventoryMovement[];
  inboundLines: InboundLine[];
  outboundLines: OutboundLine[];
}

export interface InventoryData {
  products: Product[];
  batches: Batch[];
  locations: WarehouseLocation[];
  stockBalances: StockBalance[];
  inboundShipments: InboundShipment[];
  inboundLines: InboundLine[];
  outboundShipments: OutboundShipment[];
  outboundLines: OutboundLine[];
  movements: InventoryMovement[];
  stockPositions: ProductStockPosition[];
  summary: InventorySummary;
}

export type InventoryPlanningRisk = "critical" | "warning" | "expiry" | "healthy";

export interface InventoryPlanningPoint {
  day: number;
  projectedAvailable: number;
  plannedInbound: number;
  safetyStock: number;
  reorderPoint: number;
}

export interface InventoryExpiryRiskLot {
  stockBalanceId: string;
  batchId: string;
  lotCode: string;
  expiryDate: string;
  available: number;
  projectedRemainingAtExpiry: number;
}

export interface InventoryPlanningRow {
  product: Product;
  risk: InventoryPlanningRisk;
  riskReason: string;
  availableNow: number;
  scaledDailyDemand: number;
  daysOfCover: number | null;
  plannedInbound: number;
  projectedAtLeadTime: number;
  projectedAtHorizon: number;
  stockoutDay: number | null;
  recommendedOrderQty: number;
  expiryRiskUnits: number;
  expiryRiskLots: InventoryExpiryRiskLot[];
  curve: InventoryPlanningPoint[];
}

export interface InventoryPlanningResult {
  asOf: string;
  horizonDays: number;
  demandMultiplier: number;
  rows: InventoryPlanningRow[];
  summary: {
    productsAtRisk: number;
    stockoutsBeforeReplenishment: number;
    expiryRiskUnits: number;
    recommendedOrderQty: number;
  };
}

export interface InventoryPlanningOptions {
  horizonDays: number;
  demandMultiplier: number;
  asOf?: Date | string;
}

const INVENTORY_PLANNING_DAY_MS = 24 * 60 * 60_000;

function planningTimestamp(value: string | Date) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function roundedPlanningQuantity(value: number) {
  return Math.round(value * 10) / 10;
}

/**
 * Builds a read-only inventory projection from the canonical WMS snapshot. It is a
 * deterministic planning calculation, not a learned demand forecast. Outstanding
 * inbound is conditional and is counted only when its line is already quality-released.
 */
export function buildInventoryPlanning(
  inventory: InventoryData,
  options: InventoryPlanningOptions
): InventoryPlanningResult {
  const horizonDays = Math.max(1, Math.min(90, Math.round(options.horizonDays)));
  const demandMultiplier = Math.max(0, Math.min(10, options.demandMultiplier));
  const requestedAsOf = options.asOf ?? new Date();
  const asOfTimestamp = planningTimestamp(requestedAsOf) ?? Date.now();
  const asOf = new Date(asOfTimestamp).toISOString();
  const inboundShipmentById = new Map(inventory.inboundShipments.map((shipment) => [shipment.asnId, shipment]));

  const rows = inventory.stockPositions.map<InventoryPlanningRow>((position) => {
    const { product } = position;
    const scaledDailyDemand = roundedPlanningQuantity(product.averageDailyDemand * demandMultiplier);
    const projectionDays = Math.max(horizonDays, Math.max(0, product.leadTimeDays));
    const inboundByDay = new Map<number, number>();

    inventory.inboundLines
      .filter((line) => line.productId === product.productId && line.qaStatus === "Released")
      .forEach((line) => {
        const shipment = inboundShipmentById.get(line.asnId);
        const etaTimestamp = shipment ? planningTimestamp(shipment.plannedArrival || shipment.eta) : null;
        const outstanding = Math.max(0, line.qtyExpected - line.qtyReceived);
        if (etaTimestamp === null || outstanding === 0) return;
        const day = Math.max(1, Math.ceil((etaTimestamp - asOfTimestamp) / INVENTORY_PLANNING_DAY_MS));
        if (day > projectionDays) return;
        inboundByDay.set(day, (inboundByDay.get(day) ?? 0) + outstanding);
      });

    const fullCurve: InventoryPlanningPoint[] = [{
      day: 0,
      projectedAvailable: roundedPlanningQuantity(position.totalAvailable),
      plannedInbound: 0,
      safetyStock: product.safetyStock,
      reorderPoint: product.reorderPoint
    }];
    let projectedAvailable = position.totalAvailable;
    let stockoutDay: number | null = projectedAvailable <= 0 ? 0 : null;
    for (let day = 1; day <= projectionDays; day += 1) {
      const plannedInbound = inboundByDay.get(day) ?? 0;
      projectedAvailable += plannedInbound - scaledDailyDemand;
      projectedAvailable = roundedPlanningQuantity(projectedAvailable);
      if (stockoutDay === null && projectedAvailable <= 0) stockoutDay = day;
      fullCurve.push({
        day,
        projectedAvailable,
        plannedInbound,
        safetyStock: product.safetyStock,
        reorderPoint: product.reorderPoint
      });
    }

    const releasedBatches = position.batches
      .filter((batch) => batch.qualityStatus === "Released" && batch.qtyAvailable > 0)
      .sort((a, b) => (planningTimestamp(a.expiryDate) ?? Number.MAX_SAFE_INTEGER) - (planningTimestamp(b.expiryDate) ?? Number.MAX_SAFE_INTEGER));
    let earlierFefoSupply = 0;
    const expiryRiskLots: InventoryExpiryRiskLot[] = [];
    releasedBatches.forEach((batch) => {
      const expiryTimestamp = planningTimestamp(batch.expiryDate);
      if (expiryTimestamp === null) {
        earlierFefoSupply += batch.qtyAvailable;
        return;
      }
      const daysUntilExpiry = Math.floor((expiryTimestamp - asOfTimestamp) / INVENTORY_PLANNING_DAY_MS);
      if (daysUntilExpiry > horizonDays) {
        earlierFefoSupply += batch.qtyAvailable;
        return;
      }
      const demandBeforeExpiry = Math.max(0, daysUntilExpiry) * scaledDailyDemand;
      const demandAvailableForBatch = Math.max(0, demandBeforeExpiry - earlierFefoSupply);
      const projectedRemainingAtExpiry = Math.max(0, batch.qtyAvailable - demandAvailableForBatch);
      if (projectedRemainingAtExpiry > 0) {
        expiryRiskLots.push({
          stockBalanceId: batch.stockBalanceId,
          batchId: batch.batchId,
          lotCode: batch.lotCode,
          expiryDate: batch.expiryDate,
          available: batch.qtyAvailable,
          projectedRemainingAtExpiry: Math.ceil(projectedRemainingAtExpiry)
        });
      }
      earlierFefoSupply += batch.qtyAvailable;
    });

    const curve = fullCurve.slice(0, horizonDays + 1);
    const projectedAtLeadTime = fullCurve[Math.min(product.leadTimeDays, fullCurve.length - 1)]?.projectedAvailable ?? position.totalAvailable;
    const projectedAtHorizon = curve[curve.length - 1]?.projectedAvailable ?? position.totalAvailable;
    const plannedInbound = curve.reduce((total, point) => total + point.plannedInbound, 0);
    const expiryRiskUnits = expiryRiskLots.reduce((total, lot) => total + lot.projectedRemainingAtExpiry, 0);
    const reorderTriggered = position.totalAvailable <= product.reorderPoint || projectedAtLeadTime <= product.safetyStock;
    const recommendedOrderQty = reorderTriggered ? Math.ceil(Math.max(0, product.targetStock - projectedAtLeadTime)) : 0;
    const stockoutBeforeReplenishment = stockoutDay !== null && stockoutDay <= product.leadTimeDays;
    const risk: InventoryPlanningRisk = stockoutBeforeReplenishment || projectedAtLeadTime <= 0
      ? "critical"
      : projectedAtLeadTime <= product.safetyStock || position.totalAvailable <= product.reorderPoint
        ? "warning"
        : expiryRiskUnits > 0
          ? "expiry"
          : "healthy";
    const riskReason = risk === "critical"
      ? `Projected stock-out occurs before the ${product.leadTimeDays}-day replenishment lead time.`
      : risk === "warning"
        ? `Projected lead-time stock is at or below the configured safety threshold.`
        : risk === "expiry"
          ? `${expiryRiskUnits.toLocaleString()} unit${expiryRiskUnits === 1 ? "" : "s"} may remain when eligible FEFO lots expire.`
          : "Projected stock remains above policy thresholds within this scenario.";

    return {
      product,
      risk,
      riskReason,
      availableNow: position.totalAvailable,
      scaledDailyDemand,
      daysOfCover: scaledDailyDemand > 0 ? roundedPlanningQuantity(position.totalAvailable / scaledDailyDemand) : null,
      plannedInbound,
      projectedAtLeadTime,
      projectedAtHorizon,
      stockoutDay,
      recommendedOrderQty,
      expiryRiskUnits,
      expiryRiskLots,
      curve
    };
  });

  const riskRank: Record<InventoryPlanningRisk, number> = { critical: 0, warning: 1, expiry: 2, healthy: 3 };
  rows.sort((a, b) => riskRank[a.risk] - riskRank[b.risk] || a.projectedAtLeadTime - b.projectedAtLeadTime || a.product.productCode.localeCompare(b.product.productCode));

  return {
    asOf,
    horizonDays,
    demandMultiplier,
    rows,
    summary: {
      productsAtRisk: rows.filter((row) => row.risk !== "healthy").length,
      stockoutsBeforeReplenishment: rows.filter((row) => row.stockoutDay !== null && row.stockoutDay <= row.product.leadTimeDays).length,
      expiryRiskUnits: rows.reduce((total, row) => total + row.expiryRiskUnits, 0),
      recommendedOrderQty: rows.reduce((total, row) => total + row.recommendedOrderQty, 0)
    }
  };
}

export interface WarehouseSnapshot {
  zones: Zone[];
  inventoryPlacements: InventoryPlacement[];
  shipments: Shipment[];
  docks: Dock[];
  dockSchedule: DockSchedule[];
  routes: InboundRoute[];
  temperatureReadings: TemperatureReading[];
  temperatureEvents: TemperatureEvent[];
  rfidEvents: RfidEvent[];
  alerts: Alert[];
  decisions: AiDecision[];
  operationalIssues?: OperationalIssue[];
  partnerSites: PartnerSite[];
  transportLegs: TransportLeg[];
  dockAppointments: DockAppointment[];
  operationalEvents: WarehouseOperationalEvent[];
  logistics: LogisticsData;
  inventory: InventoryData;
  kpis: {
    fefoCompliance: number;
    coldChainIntegrity: number;
    dockUtilisation: number;
    activeShipments: number;
    stockBalancesAtExpiryRisk: number;
    assistantEnquiries: number;
  };
}

export type AlertPriority = "act_now" | "plan" | "review" | "monitor";

export function classifyAlertPriority(alert: Pick<Alert, "severity" | "message">): AlertPriority {
  if (alert.severity === "critical") return "act_now";
  if (alert.severity === "info") return "monitor";

  const message = alert.message.toLowerCase();
  if (/delay|delayed|dock|route|scan|rfid|scheduled window/.test(message)) return "review";
  return "plan";
}

export type IssueImportance = "important" | "lower_impact";
export type IssueUrgency = "urgent" | "not_urgent";
export type OperationalIssueTarget = "inventory" | "warehouse" | "monitoring" | "logistics" | "audit";

export interface OperationalIssue {
  id: string;
  title: string;
  detail: string;
  category: AuditEventCategory;
  severity: Severity;
  status: "open" | "under_review" | "pending";
  importance: IssueImportance;
  urgency: IssueUrgency;
  priority: AlertPriority;
  classificationReason: string;
  openedAt: string;
  affectedIds: string[];
  sourceType: "alert" | "temperature" | "inventory" | "quality" | "logistics" | "decision";
  sourceId: string;
  target: OperationalIssueTarget;
  targetId: string | null;
}

export type IssueLifecycleEventType = "opened" | "reopened" | "reclassified" | "status_changed" | "updated" | "resolved";

export interface OperationalIssueLifecycleEvent {
  eventId: string;
  issueId: string;
  eventType: IssueLifecycleEventType;
  timestamp: string;
  revision: number;
  previousIssue: OperationalIssue | null;
  currentIssue: OperationalIssue | null;
  reason: string;
}

function issuePriority(importance: IssueImportance, urgency: IssueUrgency): AlertPriority {
  if (importance === "important" && urgency === "urgent") return "act_now";
  if (importance === "important") return "plan";
  if (urgency === "urgent") return "review";
  return "monitor";
}

function makeIssue(input: Omit<OperationalIssue, "priority">): OperationalIssue {
  return { ...input, priority: issuePriority(input.importance, input.urgency) };
}

/**
 * Produces the single active-exception set used by both Dashboard and Audit. It deliberately
 * evaluates current warehouse state rather than treating every historical audit record as open.
 */
export function buildOperationalIssues(snapshot: WarehouseSnapshot, now = new Date()): OperationalIssue[] {
  const issues = new Map<string, OperationalIssue>();
  const nowMs = now.getTime();

  snapshot.temperatureEvents
    .filter((event) => event.status === "Open")
    .forEach((event) => {
      const important = event.eventType === "Non-Conformance" || event.affectedBatchIds.length > 0;
      const urgent = event.status === "Open" || event.eventType === "Non-Conformance";
      const importance: IssueImportance = important ? "important" : "lower_impact";
      const urgency: IssueUrgency = urgent ? "urgent" : "not_urgent";
      issues.set(`temperature:${event.zoneId}`, makeIssue({
        id: `temperature:${event.zoneId}`,
        title: `${event.eventType}: ${event.zoneName}`,
        detail: `${event.observedRange} for ${event.durationMinutes} minutes; allowed ${event.allowedBand.min}-${event.allowedBand.max} C.`,
        category: "Cold Chain",
        severity: event.eventType === "Non-Conformance" ? "critical" : "warn",
        status: "open",
        importance,
        urgency,
        classificationReason: important
          ? `Product integrity may be affected${urgent ? " and the condition requires immediate review" : " and remains under review"}.`
          : "The excursion is contained but should remain visible until reviewed.",
        openedAt: event.timestampStart,
        affectedIds: [event.zoneId, ...event.affectedSkuIds, ...event.affectedBatchIds],
        sourceType: "temperature",
        sourceId: event.eventId,
        target: "monitoring",
        targetId: event.zoneId
      }));
    });

  snapshot.inventoryPlacements
    .filter((placement) => placement.qualityStatus !== "Released")
    .forEach((placement) => {
      const linkedShipmentIds = [...new Set([
        ...snapshot.inventory.outboundLines
          .filter((line) => line.batchId === placement.batchId)
          .map((line) => line.shipmentId),
        placement.linkedShipmentId
      ].filter((id): id is string => Boolean(id)))]
        .filter((shipmentId) => snapshot.inventory.outboundShipments.some(
          (shipment) => shipment.shipmentId === shipmentId && !["Dispatched", "Delivered"].includes(shipment.outboundStatus)
        ));
      const linkedToShipment = linkedShipmentIds.length > 0;
      const restricted = placement.qualityStatus === "QA Hold" || placement.qualityStatus === "Quarantine";
      const importance: IssueImportance = restricted ? "important" : "lower_impact";
      const urgency: IssueUrgency = linkedToShipment ? "urgent" : "not_urgent";
      issues.set(`quality:${placement.stockBalanceId}`, makeIssue({
        id: `quality:${placement.stockBalanceId}`,
        title: `${placement.qualityStatus}: ${placement.productCode ?? placement.productName}`,
        detail: linkedToShipment ? `Restricted stock is linked to ${linkedShipmentIds.join(", ")}.` : `${placement.locationId ?? `${placement.rack}-${placement.bin}`} requires quality workflow follow-up.`,
        category: "Inventory",
        severity: restricted ? "critical" : "warn",
        status: "open",
        importance,
        urgency,
        classificationReason: linkedToShipment
          ? "Restricted stock is linked to an active shipment, creating immediate product-release risk."
          : restricted
            ? "Product release is blocked, but no active shipment is currently affected."
            : "QA disposition is pending without an immediate shipment impact.",
        openedAt: now.toISOString(),
        affectedIds: [placement.stockBalanceId, placement.batchId, ...linkedShipmentIds].filter((id): id is string => Boolean(id)),
        sourceType: "quality",
        sourceId: placement.stockBalanceId,
        target: "inventory",
        targetId: placement.stockBalanceId
      }));
    });

  snapshot.inventoryPlacements
    .filter((placement) => placement.currentStage !== "Dispatch" && new Date(placement.expiryDate).getTime() <= nowMs + 7 * 24 * 60 * 60_000)
    .forEach((placement) => {
      const days = Math.ceil((new Date(placement.expiryDate).getTime() - nowMs) / (24 * 60 * 60_000));
      const urgent = days <= 2;
      issues.set(`expiry:${placement.stockBalanceId}`, makeIssue({
        id: `expiry:${placement.stockBalanceId}`,
        title: `Expiry risk: ${placement.productCode ?? placement.productName}`,
        detail: days < 0 ? `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago.` : `${days} day${days === 1 ? "" : "s"} remaining before expiry.`,
        category: "Inventory",
        severity: urgent ? "critical" : "warn",
        status: "open",
        importance: "important",
        urgency: urgent ? "urgent" : "not_urgent",
        classificationReason: urgent ? "Expiry is within 48 hours and usable stock may be lost." : "Expiry is approaching within the seven-day planning horizon.",
        openedAt: now.toISOString(),
        affectedIds: [placement.stockBalanceId, placement.batchId, placement.linkedShipmentId].filter((id): id is string => Boolean(id)),
        sourceType: "inventory",
        sourceId: placement.stockBalanceId,
        target: "inventory",
        targetId: placement.stockBalanceId
      }));
    });

  snapshot.inventory.stockPositions.forEach((position) => {
    const inbound = snapshot.inventory.inboundLines
      .filter((line) => line.productId === position.product.productId)
      .reduce((sum, line) => sum + Math.max(0, line.qtyExpected - line.qtyReceived), 0);
    const inventoryPosition = position.totalAvailable + inbound;
    const projectedAtLeadTime = inventoryPosition - position.product.averageDailyDemand * position.product.leadTimeDays;
    const requiresReorder = position.totalAvailable <= 0 || projectedAtLeadTime <= position.product.safetyStock || inventoryPosition <= position.product.reorderPoint;
    if (!requiresReorder) return;
    const urgent = position.totalAvailable <= 0 || projectedAtLeadTime <= 0;
    issues.set(`replenishment:${position.product.productId}`, makeIssue({
      id: `replenishment:${position.product.productId}`,
      title: `Reorder required: ${position.product.productName}`,
      detail: `${position.totalAvailable} available; projected lead-time stock ${Math.round(projectedAtLeadTime)}; safety stock ${position.product.safetyStock}.`,
      category: "Inventory",
      severity: urgent ? "critical" : "warn",
      status: "open",
      importance: "important",
      urgency: urgent ? "urgent" : "not_urgent",
      classificationReason: urgent ? "Projected stock reaches zero within supplier lead time." : "Projected stock falls below the configured safety threshold.",
      openedAt: now.toISOString(),
      affectedIds: [position.product.productId, ...position.batches.map((batch) => batch.batchId)],
      sourceType: "inventory",
      sourceId: position.product.productId,
      target: "inventory",
      targetId: position.product.productId
    }));
  });

  snapshot.inventory.outboundShipments
    .filter((shipment) => shipment.outboundStatus === "Blocked")
    .forEach((shipment) => {
      const urgent = shipment.priorityLevel === "Medical Priority" || new Date(shipment.requiredBy).getTime() <= nowMs + 4 * 60 * 60_000;
      issues.set(`shipment:${shipment.shipmentId}`, makeIssue({
        id: `shipment:${shipment.shipmentId}`,
        title: `Shipment blocked: ${shipment.shipmentId}`,
        detail: `${shipment.destination}; required ${new Date(shipment.requiredBy).toLocaleString()}.`,
        category: "Logistics",
        severity: "critical",
        status: "open",
        importance: "important",
        urgency: urgent ? "urgent" : "not_urgent",
        classificationReason: urgent ? "A blocked medical-priority or near-deadline shipment requires immediate intervention." : "Dispatch is blocked, but the delivery deadline is outside the immediate response window.",
        openedAt: now.toISOString(),
        affectedIds: [shipment.shipmentId, shipment.routeId].filter((id): id is string => Boolean(id)),
        sourceType: "logistics",
        sourceId: shipment.shipmentId,
        target: "logistics",
        targetId: shipment.shipmentId
      }));
    });

  snapshot.routes
    .filter((route) => route.status !== "on-time")
    .forEach((route) => {
      const disrupted = route.status === "disrupted";
      issues.set(`route:${route.id}`, makeIssue({
        id: `route:${route.id}`,
        title: `Route ${route.status}: ${route.name}`,
        detail: `${route.delayDeltaMinutes} minute delay; ${route.riskNote || "route requires review"}.`,
        category: "Logistics",
        severity: disrupted ? "critical" : "warn",
        status: "open",
        importance: disrupted ? "important" : "lower_impact",
        urgency: "urgent",
        classificationReason: disrupted ? "The active route disruption may prevent service and requires immediate mitigation." : "The delay is time-sensitive but currently has lower operational impact.",
        openedAt: route.lastComputedAt ?? now.toISOString(),
        affectedIds: [route.id, route.routeId],
        sourceType: "logistics",
        sourceId: route.id,
        target: "logistics",
        targetId: route.id
      }));
    });

  snapshot.alerts
    .filter((alert) => alert.status === "open" || alert.status === "escalated")
    .forEach((alert) => {
      const text = alert.message.toLowerCase();
      const represented =
        (/temperature|excursion|non-conformance/.test(text) && [...issues.keys()].some((key) => key.startsWith("temperature:"))) ||
        (/qa hold|quarantine/.test(text) && alert.affectedIds.some((id) => issues.has(`quality:${id}`))) ||
        (/expires|expiry/.test(text) && alert.affectedIds.some((id) => issues.has(`expiry:${id}`)));
      if (represented) return;
      const priority = classifyAlertPriority(alert);
      const importance: IssueImportance = priority === "act_now" || priority === "plan" ? "important" : "lower_impact";
      const urgency: IssueUrgency = priority === "act_now" || priority === "review" ? "urgent" : "not_urgent";
      issues.set(`alert:${alert.id}`, makeIssue({
        id: `alert:${alert.id}`,
        title: alert.message,
        detail: `${alert.sourceAgent} raised this warehouse alert.`,
        category: categoryForAlert(alert),
        severity: alert.severity,
        status: "open",
        importance,
        urgency,
        classificationReason: alert.severity === "critical" ? "The source system marked this alert critical." : "Priority is based on the alert severity and operational subject.",
        openedAt: alert.timestamp,
        affectedIds: alert.affectedIds,
        sourceType: "alert",
        sourceId: alert.id,
        target: categoryForAlert(alert) === "Cold Chain" ? "monitoring" : categoryForAlert(alert) === "Logistics" ? "logistics" : categoryForAlert(alert) === "Inventory" ? "inventory" : "warehouse",
        targetId: alert.affectedIds[0] ?? null
      }));
    });

  const priorityRank: Record<AlertPriority, number> = { act_now: 0, plan: 1, review: 2, monitor: 3 };
  return [...issues.values()].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
}

export type AuditEventCategory = "Inventory" | "Cold Chain" | "Logistics" | "AI Decision" | "Warehouse";

export interface AuditEvent {
  id: string;
  timestamp: string;
  category: AuditEventCategory;
  eventType: string;
  title: string;
  detail: string;
  severity: Severity;
  status: string;
  actor: string;
  affectedIds: string[];
  correlationId: string | null;
  metadata: Record<string, unknown>;
}

function categoryForAlert(alert: Alert): AuditEventCategory {
  const text = alert.message.toLowerCase();
  if (/temperature|cold|excursion|non-conformance/.test(text)) return "Cold Chain";
  if (/shipment|route|dock|delay|dispatch/.test(text)) return "Logistics";
  if (/stock|sku|batch|expiry|expires|qa hold|quarantine|reorder/.test(text)) return "Inventory";
  return "Warehouse";
}

/** Builds one cross-domain, chronological ledger from the application's durable source records. */
export function buildAuditEvents(snapshot: WarehouseSnapshot): AuditEvent[] {
  const products = new Map(snapshot.inventory.products.map((product) => [product.productId, product]));

  const movements: AuditEvent[] = snapshot.inventory.movements.map((movement) => {
    const product = products.get(movement.productId);
    const locations = [movement.fromLocationId, movement.toLocationId].filter(Boolean).join(" to ");
    return {
      id: `movement-${movement.movementId}`,
      timestamp: movement.timestamp,
      category: "Inventory",
      eventType: movement.movementType,
      title: `${movement.movementType}: ${product?.productName ?? movement.productId}`,
      detail: `${movement.qty} unit${movement.qty === 1 ? "" : "s"} for batch ${movement.batchId}${locations ? ` (${locations})` : ""}. ${movement.note}`.trim(),
      severity: ["QA Hold", "Quarantine", "Adjustment"].includes(movement.movementType) ? "warn" : "info",
      status: "recorded",
      actor: movement.userOrSystem,
      affectedIds: [movement.productId, movement.batchId, movement.fromLocationId, movement.toLocationId].filter((id): id is string => Boolean(id)),
      correlationId: movement.referenceId || movement.movementId,
      metadata: { ...movement }
    };
  });

  const temperatureEvents: AuditEvent[] = snapshot.temperatureEvents.map((event) => ({
    id: `temperature-${event.eventId}`,
    timestamp: event.timestampStart,
    category: "Cold Chain",
    eventType: event.eventType,
    title: `${event.eventType}: ${event.zoneName}`,
    detail: `${event.observedRange} for ${event.durationMinutes} minutes; allowed ${event.allowedBand.min}-${event.allowedBand.max} C. ${event.recommendedAction}`,
    severity: event.eventType === "Non-Conformance" ? "critical" : "warn",
    status: event.status.toLowerCase(),
    actor: "Temperature Monitoring",
    affectedIds: [event.zoneId, ...event.affectedSkuIds, ...event.affectedBatchIds],
    correlationId: event.auditReference ?? event.eventId,
    metadata: { ...event }
  }));

  const alerts: AuditEvent[] = snapshot.alerts.map((alert) => ({
    id: `alert-${alert.id}`,
    timestamp: alert.timestamp,
    category: categoryForAlert(alert),
    eventType: "Alert",
    title: alert.message,
    detail: `${alert.sourceAgent} raised a ${alert.severity} warehouse alert.`,
    severity: alert.severity,
    status: alert.status,
    actor: alert.sourceAgent,
    affectedIds: alert.affectedIds,
    correlationId: alert.id,
    metadata: { priority: classifyAlertPriority(alert), ...alert }
  }));

  const decisions: AuditEvent[] = snapshot.decisions.map((decision) => ({
    id: `decision-${decision.id}`,
    timestamp: decision.timestamp,
    category: "AI Decision",
    eventType: "AI enquiry",
    title: decision.query,
    detail: decision.narrative,
    severity: decision.riskLevel === "critical" || decision.riskLevel === "high" ? "critical" : decision.riskLevel === "medium" ? "warn" : "info",
    status: "recorded",
    actor: decision.agentsUsed.join(", ") || "Orchestrator",
    affectedIds: [
      ...decision.actionPayload.affectedSKUs,
      ...decision.actionPayload.affectedZones,
      ...decision.actionPayload.affectedShipments,
      ...decision.actionPayload.affectedDocks
    ],
    correlationId: decision.id,
    metadata: { decision }
  }));

  const rfidEvents: AuditEvent[] = snapshot.rfidEvents.map((event) => ({
    id: `rfid-${event.id}`,
    timestamp: event.timestamp,
    category: "Warehouse",
    eventType: "RFID scan",
    title: `${event.skuId} ${event.action} ${event.zoneId}`,
    detail: `RFID checkpoint recorded a ${event.action.toLowerCase()} event.`,
    severity: event.severity,
    status: "recorded",
    actor: "RFID System",
    affectedIds: [event.skuId, event.zoneId],
    correlationId: String(event.id),
    metadata: { ...event }
  }));

  // A planned future milestone is not an audit event yet. Some seeded operational timelines
  // include future appointments, so exclude those records until their timestamp is reached.
  const now = Date.now();
  const operationalEvents: AuditEvent[] = snapshot.operationalEvents
    .filter((event) => new Date(event.timestamp).getTime() <= now)
    .map((event) => ({
    id: `operation-${event.eventId}`,
    timestamp: event.timestamp,
    category:
      event.process === "transport" || event.process === "yard"
        ? "Logistics"
        : event.process === "quality" || event.process === "inventory"
          ? "Inventory"
          : "Warehouse",
    eventType: event.step.replaceAll("_", " "),
    title: event.description,
    detail: `${event.sourceSystem} recorded ${event.referenceType} ${event.referenceId}${event.exceptionCode ? ` (${event.exceptionCode})` : ""}.`,
    severity: event.status === "exception" ? "warn" : "info",
    status: event.status,
    actor: event.actor,
    affectedIds: [...new Set([
      event.referenceId,
      event.asnId,
      event.shipmentId,
      event.transportLegId,
      event.dockAppointmentId,
      event.siteId,
      event.dockId,
      event.locationId
    ].filter((id): id is string => Boolean(id)))],
    correlationId: event.transportLegId ?? event.dockAppointmentId ?? event.referenceId,
    metadata: { sourceSystem: event.sourceSystem, operationalEvent: event }
    }));

  return [...movements, ...temperatureEvents, ...alerts, ...decisions, ...rfidEvents, ...operationalEvents]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "autonomous";
  content: string;
  createdAt: string;
  response?: OrchestratorResponse;
  streaming?: boolean;
  activeAgents?: AgentName[];
  elapsedMs?: number;
}

export interface SimulateRequest {
  type: string;
  params: Record<string, unknown>;
}
