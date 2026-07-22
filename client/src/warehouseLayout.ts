import type { Dock, InventoryPlacement, Zone } from "@twinops/shared";

export type Vec2 = { x: number; z: number };
export type Bounds = { x: number; z: number; width: number; depth: number };
export type LayoutZoneId = "RCV" | "CI" | "CS" | "AM" | "PH" | "QA" | "QT" | "PS" | "PK" | "DS";
export type RouteState = "normal" | "warning" | "blocked" | "selected";
export type RouteSegmentType = "inbound" | "inspection" | "storage-access" | "rack-access" | "picking" | "packing" | "dispatch" | "quality-control" | "static-lane";

export type WarehouseSector = {
  id: LayoutZoneId;
  name: string;
  type: "receiving" | "inspection" | "cold" | "ambient" | "pharma" | "qa" | "quarantine" | "staging" | "packing" | "dispatch";
  stage: string;
  bounds: Bounds;
  color: string;
  dataZoneId?: string;
  temperatureRange?: string;
  racks: string[];
  sensors: Vec2[];
  routeNodeId: string;
};

export type WarehouseRack = {
  id: string;
  zoneId: LayoutZoneId;
  label: string;
  center: Vec2;
  size: { width: number; depth: number };
  routeNodeId: string;
};

export type WarehouseBin = {
  id: string;
  rackId: string;
  storageKind: "rack" | "controlled-area";
  placement: InventoryPlacement;
  label: string;
  position: Vec2;
  aislePosition: Vec2;
  expiryRisk: "nominal" | "warning";
  coldChainRequired: boolean;
};

export type NavigationNode = {
  id: string;
  position: Vec2;
  type: "walkable" | "transition" | "dock" | "rack" | "restricted";
};

export type NavigationEdge = {
  from: string;
  to: string;
  allowed?: boolean;
};

export type RfidCheckpoint = {
  id: string;
  name: string;
  stage: string;
  purpose: string;
  position: Vec2;
  scanZoneIds: string[];
};

export type PresetRouteSegment = {
  id: string;
  from: string;
  to: string;
  routeType: RouteSegmentType;
  points: Vec2[];
  statusCapability: RouteState[];
};

export type InternalRoute = {
  points: Vec2[];
  state: RouteState;
  message: string;
  segments: PresetRouteSegment[];
  blockedPoint?: Vec2 | null;
  showArrows?: boolean;
};

export const warehouseSectors: WarehouseSector[] = [
  {
    id: "RCV",
    name: "Receiving",
    type: "receiving",
    stage: "Receiving",
    bounds: { x: -5.55, z: 0.72, width: 0.78, depth: 0.95 },
    color: "#bfdbfe",
    racks: [],
    sensors: [],
    routeNodeId: "receiving"
  },
  {
    id: "CI",
    name: "Cold Inspection",
    type: "inspection",
    stage: "Receiving",
    bounds: { x: -5.55, z: 1.75, width: 0.78, depth: 0.92 },
    color: "#bae6fd",
    racks: [],
    sensors: [],
    routeNodeId: "cold-inspection"
  },
  {
    id: "CS",
    name: "Cold Storage",
    type: "cold",
    stage: "Storage",
    bounds: { x: -4.65, z: -3.05, width: 3.55, depth: 2.48 },
    color: "#99f6e4",
    dataZoneId: "CS",
    temperatureRange: "2-8 C",
    racks: ["CS-R01", "CS-R02", "CS-R03", "CS-R04"],
    sensors: [
      { x: -4.2, z: -2.78 },
      { x: -1.45, z: -2.78 }
    ],
    routeNodeId: "cold-cross"
  },
  {
    id: "AM",
    name: "Ambient Storage",
    type: "ambient",
    stage: "Storage",
    bounds: { x: -4.65, z: 0.1, width: 3.28, depth: 2.42 },
    color: "#bbf7d0",
    dataZoneId: "AM",
    temperatureRange: "18-28 C",
    racks: ["AM-R01", "AM-R02", "AM-R03", "AM-R04", "AM-R05", "AM-R06"],
    sensors: [
      { x: -4.35, z: 0.32 },
      { x: -1.72, z: 0.32 }
    ],
    routeNodeId: "ambient-cross"
  },
  {
    id: "PH",
    name: "Pharmaceutical Storage",
    type: "pharma",
    stage: "Storage",
    bounds: { x: -0.92, z: -3.05, width: 4.84, depth: 2.48 },
    color: "#fed7aa",
    dataZoneId: "PH",
    temperatureRange: "15-25 C",
    racks: ["PH-R01", "PH-R02", "PH-R03", "PH-R04", "PH-R05", "PH-R06"],
    sensors: [
      { x: -0.56, z: -2.8 },
      { x: 3.55, z: -2.8 }
    ],
    routeNodeId: "pharma-cross"
  },
  {
    id: "QA",
    name: "QA Hold",
    type: "qa",
    stage: "Storage",
    bounds: { x: 3.98, z: -3.05, width: 0.96, depth: 1.08 },
    color: "#fef3c7",
    dataZoneId: "QA",
    racks: [],
    sensors: [],
    routeNodeId: "qa-hold-door"
  },
  {
    id: "QT",
    name: "Quarantine",
    type: "quarantine",
    stage: "Storage",
    bounds: { x: 3.98, z: -1.86, width: 0.96, depth: 1.1 },
    color: "#fecaca",
    dataZoneId: "QT",
    racks: [],
    sensors: [],
    routeNodeId: "quarantine-door"
  },
  {
    id: "PS",
    name: "Pallet Staging Positions",
    type: "staging",
    stage: "Packing",
    bounds: { x: -0.58, z: 0.18, width: 3.66, depth: 0.95 },
    color: "#fde68a",
    racks: [],
    sensors: [],
    routeNodeId: "pallet-staging"
  },
  {
    id: "PK",
    name: "Packing Bench",
    type: "packing",
    stage: "Packing",
    bounds: { x: 3.22, z: 0.24, width: 1.5, depth: 0.82 },
    color: "#ddd6fe",
    racks: [],
    sensors: [],
    routeNodeId: "packing-in"
  },
  {
    id: "DS",
    name: "Dispatch Staging",
    type: "dispatch",
    stage: "Dock Staging",
    bounds: { x: -0.82, z: 1.38, width: 5.42, depth: 0.74 },
    color: "#fde68a",
    dataZoneId: "DS",
    temperatureRange: "15-30 C",
    racks: [],
    sensors: [{ x: 0.15, z: 1.58 }],
    routeNodeId: "dispatch-staging"
  }
];

const rackRows = [
  { zoneId: "CS" as const, labels: ["CS-R01", "CS-R02", "CS-R03", "CS-R04"], x: [-3.92, -3.12, -2.32, -1.52], z: -1.82, width: 0.32, depth: 1.82 },
  { zoneId: "AM" as const, labels: ["AM-R01", "AM-R02", "AM-R03", "AM-R04", "AM-R05", "AM-R06"], x: [-4.22, -3.68, -3.14, -2.6, -2.06, -1.52], z: 1.3, width: 0.24, depth: 1.48 },
  { zoneId: "PH" as const, labels: ["PH-R01", "PH-R02", "PH-R03", "PH-R04", "PH-R05", "PH-R06"], x: [-0.45, 0.32, 1.09, 1.86, 2.63, 3.4], z: -1.82, width: 0.26, depth: 1.82 }
];

export const warehouseRacks: WarehouseRack[] = rackRows.flatMap((row) =>
  row.labels.map((label, index) => ({
    id: label,
    zoneId: row.zoneId,
    label,
    center: { x: row.x[index], z: row.z },
    size: { width: row.width, depth: row.depth },
    routeNodeId: `${label}-aisle`
  }))
);

export const dockLayout = ["D1", "D2", "D3", "D4", "D5", "D6"].map((id, index) => ({
  id,
  position: { x: -0.5 + index * 0.9, z: 3.12 },
  routeNodeId: `${id}-access`
}));

export const rfidCheckpoints: RfidCheckpoint[] = [
  {
    id: "rfid-gate-1",
    name: "RFID Gate 1",
    stage: "Receiving",
    purpose: "Confirms inbound pallet receipt and creates first warehouse scan event.",
    position: { x: -5.18, z: 0.28 },
    scanZoneIds: ["RCV", "CI"]
  },
  {
    id: "rfid-gate-2",
    name: "RFID Gate 2",
    stage: "Picking",
    purpose: "Confirms SKU has left storage and entered picking/packing workflow.",
    position: { x: -0.88, z: 1.14 },
    scanZoneIds: ["CS", "AM", "PH"]
  },
  {
    id: "rfid-gate-3",
    name: "RFID Gate 3",
    stage: "Dispatch",
    purpose: "Confirms shipment has passed final outbound scan before dock release.",
    position: { x: 1.55, z: 2.46 },
    scanZoneIds: ["DS"]
  }
];

export function getRfidCheckpoint(id?: string | null) {
  if (!id) return null;
  return rfidCheckpoints.find((checkpoint) => checkpoint.id === id) ?? null;
}

const baseNavigationNodes: NavigationNode[] = [
  { id: "receiving-entry", position: { x: -5.45, z: 0.2 }, type: "transition" },
  { id: "receiving", position: { x: -5.16, z: 1.18 }, type: "walkable" },
  { id: "cold-inspection", position: { x: -5.16, z: 2.18 }, type: "walkable" },
  { id: "ambient-entry", position: { x: -4.38, z: 2.18 }, type: "transition" },
  { id: "ambient-cross", position: { x: -4.22, z: 0.42 }, type: "walkable" },
  { id: "cold-cross", position: { x: -4.18, z: -0.43 }, type: "walkable" },
  { id: "central-rfid", position: { x: -0.88, z: -0.43 }, type: "transition" },
  { id: "pharma-cross", position: { x: -0.35, z: -0.43 }, type: "walkable" },
  { id: "qa-hold-door", position: { x: 3.78, z: -2.52 }, type: "restricted" },
  { id: "quarantine-door", position: { x: 3.78, z: -1.25 }, type: "restricted" },
  { id: "pallet-staging", position: { x: 0.6, z: 0.62 }, type: "walkable" },
  { id: "packing-in", position: { x: 3.04, z: 0.62 }, type: "walkable" },
  { id: "packing-out", position: { x: 3.04, z: 1.24 }, type: "walkable" },
  { id: "dispatch-staging", position: { x: 1.55, z: 1.72 }, type: "walkable" },
  { id: "dock-cross", position: { x: 1.55, z: 2.58 }, type: "walkable" }
];

const rackNavigationNodes: NavigationNode[] = warehouseRacks.map((rack) => ({
  id: rack.routeNodeId,
  position: getRackAislePosition(rack),
  type: "rack"
}));

const dockNavigationNodes: NavigationNode[] = dockLayout.map((dock) => ({
  id: dock.routeNodeId,
  position: { x: dock.position.x, z: 2.58 },
  type: "dock"
}));

export const navigationNodes: NavigationNode[] = [...baseNavigationNodes, ...rackNavigationNodes, ...dockNavigationNodes];

export const navigationEdges: NavigationEdge[] = [
  { from: "receiving-entry", to: "receiving" },
  { from: "receiving", to: "cold-inspection" },
  { from: "cold-inspection", to: "ambient-entry" },
  { from: "ambient-entry", to: "ambient-cross" },
  { from: "ambient-cross", to: "cold-cross" },
  { from: "cold-cross", to: "central-rfid" },
  { from: "central-rfid", to: "pharma-cross" },
  { from: "central-rfid", to: "pallet-staging" },
  { from: "pharma-cross", to: "pallet-staging" },
  { from: "pharma-cross", to: "qa-hold-door" },
  { from: "pharma-cross", to: "quarantine-door" },
  { from: "pallet-staging", to: "packing-in" },
  { from: "packing-in", to: "packing-out" },
  { from: "packing-out", to: "dispatch-staging" },
  { from: "dispatch-staging", to: "dock-cross" },
  ...warehouseRacks.map((rack) => ({
    from: rack.zoneId === "AM" ? "ambient-cross" : rack.zoneId === "CS" ? "cold-cross" : "pharma-cross",
    to: rack.routeNodeId
  })),
  ...dockLayout.map((dock) => ({ from: "dock-cross", to: dock.routeNodeId }))
];

const sectorAliases: Record<string, LayoutZoneId> = {
  receiving: "RCV",
  "inbound-receiving": "RCV",
  "cold-inspection": "CI",
  "cold-storage": "CS",
  "ambient-storage": "AM",
  "pharmaceutical-storage": "PH",
  "pharma-storage": "PH",
  "qa-hold": "QA",
  qac: "QA",
  quarantine: "QT",
  "pallet-staging": "PS",
  "packing-bench": "PK",
  packing: "PK",
  "dispatch-staging": "DS",
  dispatch: "DS"
};

export function getSector(id?: string | null) {
  if (!id) return null;
  const normalized = id ? sectorAliases[id.toLowerCase()] ?? id : id;
  return warehouseSectors.find((sector) => sector.id === normalized || sector.dataZoneId === normalized) ?? null;
}

export function getRack(id?: string | null) {
  return warehouseRacks.find((rack) => rack.id === id) ?? null;
}

export function getDockLayout(id?: string | null) {
  return dockLayout.find((dock) => dock.id === id) ?? null;
}

export function normalizeRackId(zoneId?: string | null, rackLabel?: string | null) {
  const sector = getSector(zoneId);
  if (!sector?.racks.length) return null;
  // WMS labels use PH-05 while the scene uses the internal object id PH-R05.
  // Only return the exact physical rack; never fold an unknown rack onto another row.
  const match = rackLabel?.match(/(?:R|-)(\d+)(?:\D|$)/i) ?? rackLabel?.match(/(\d+)/);
  if (!match) return null;
  const rackId = `${sector.id}-R${String(Number(match[1])).padStart(2, "0")}`;
  return sector.racks.includes(rackId) ? rackId : null;
}

export function rackDisplayLabel(rackId?: string | null) {
  return rackId?.replace(/^([A-Z]+)-R(\d+)$/i, "$1-$2") ?? "Unassigned rack";
}

export function stockDisplayCode(placement?: InventoryPlacement | null) {
  return placement?.productCode ?? placement?.productName ?? "Unknown product";
}

export function stockBalanceLabel(placement?: InventoryPlacement | null) {
  return placement?.stockBalanceId ?? "Unknown balance";
}

export function wmsLocationLabel(placement?: InventoryPlacement | null) {
  if (!placement) return "Unassigned location";
  return placement.locationId ?? `${placement.rack}-${placement.bin}`;
}

export function getRackForPlacement(placement?: InventoryPlacement | null) {
  if (!placement) return null;
  return getRack(normalizeRackId(placement.zoneId, placement.rack));
}

export function getRackAislePosition(rack: WarehouseRack): Vec2 {
  if (rack.zoneId === "AM") {
    return { x: rack.center.x, z: rack.center.z - rack.size.depth / 2 - 0.22 };
  }
  return { x: rack.center.x, z: rack.center.z + rack.size.depth / 2 + 0.2 };
}

export function getPlacementBinPosition(placement?: InventoryPlacement | null): Vec2 | null {
  const controlledZoneId = placement?.zoneId === "QAC" ? "QA" : placement?.zoneId;
  const controlledSector = controlledZoneId === "QA" || controlledZoneId === "QT" ? getSector(controlledZoneId) : null;
  if (placement && controlledSector) {
    const numericSeed = [...placement.stockBalanceId].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const column = numericSeed % 2;
    const row = Math.floor(numericSeed / 2) % 2;
    return {
      x: controlledSector.bounds.x + 0.3 + column * 0.34,
      z: controlledSector.bounds.z + 0.34 + row * 0.36
    };
  }
  const rack = getRackForPlacement(placement);
  if (!placement || !rack) return null;
  const parsed = Number(placement.bin.match(/\d+/)?.[0] ?? 1);
  const binIndex = Number.isFinite(parsed) ? (Math.max(1, parsed) - 1) % 6 : 0;
  const startZ = rack.center.z - rack.size.depth / 2 + 0.22;
  const z = startZ + binIndex * ((rack.size.depth - 0.44) / 5);
  return { x: rack.center.x, z };
}

export function getPlacementAislePosition(placement?: InventoryPlacement | null): Vec2 | null {
  const bin = getPlacementBinPosition(placement);
  if (placement?.zoneId === "QA" || placement?.zoneId === "QAC" || placement?.zoneId === "QT") return bin;
  const rack = getRackForPlacement(placement);
  if (!rack || !bin) return null;
  const aisleOffset = rack.zoneId === "AM" ? -0.34 : 0.34;
  return { x: rack.center.x, z: bin.z + aisleOffset };
}

export function buildWarehouseBins(placements: InventoryPlacement[]): WarehouseBin[] {
  return placements
    .map((placement) => {
      const rack = getRackForPlacement(placement);
      const controlledArea = placement.zoneId === "QA" || placement.zoneId === "QAC" || placement.zoneId === "QT";
      const controlledZoneId = placement.zoneId === "QAC" ? "QA" : placement.zoneId;
      const position = getPlacementBinPosition(placement);
      const aislePosition = getPlacementAislePosition(placement);
      if ((!rack && !controlledArea) || !position || !aislePosition) return null;
      const expiryRisk = isExpiryRisk(placement);
      return {
        id: `${rack?.id ?? `${controlledZoneId}-CONTROLLED`}-${placement.bin}-${placement.stockBalanceId}`,
        rackId: rack?.id ?? `${controlledZoneId}-CONTROLLED`,
        storageKind: controlledArea ? "controlled-area" as const : "rack" as const,
        placement: placement,
        label: placement.bin,
        position,
        aislePosition,
        expiryRisk: expiryRisk ? "warning" : "nominal",
        coldChainRequired: placement.temperatureMin <= 8
      };
    })
    .filter((bin): bin is WarehouseBin => Boolean(bin));
}

export function isExpiryRisk(placement: InventoryPlacement) {
  return new Date(placement.expiryDate).getTime() <= Date.now() + 7 * 24 * 60 * 60_000;
}

export function coldChainLabel(placement?: InventoryPlacement | null, sector?: WarehouseSector | null) {
  if (placement) return `${placement.temperatureMin}-${placement.temperatureMax} C required`;
  return sector?.temperatureRange ?? "ambient handling";
}

export function recommendedActionForPlacement(placement?: InventoryPlacement | null) {
  if (!placement) return "Select a sector, rack, or SKU to inspect the route.";
  if (placement.qualityStatus === "QA Hold") return "Resolve quality-release status before dispatch.";
  if (placement.qualityStatus === "Quarantine") return "Keep SKU isolated; do not release to picking.";
  if (isExpiryRisk(placement)) return "Near-term expiry: run the authoritative FEFO allocation check before reprioritisation.";
  if (placement.temperatureMin <= 8) return "Verify cold-chain handoff through receiving and dispatch.";
  return "Maintain pick sequence and monitor linked shipment.";
}

export function affectedStagesForPlacement(placement?: InventoryPlacement | null, sector?: WarehouseSector | null) {
  if (placement?.qualityStatus === "QA Hold") return ["Storage", "Picking", "Dock Staging"];
  if (placement?.linkedShipmentId) return ["Storage", "Picking", "Packing", "Dock Staging", "Dispatch"];
  if (sector?.stage === "Receiving") return ["Inbound", "Receiving"];
  if (sector?.stage === "Dock Staging") return ["Packing", "Dock Staging", "Dispatch"];
  if (sector?.stage) return [sector.stage];
  return ["Receiving", "Storage", "Picking", "Packing", "Dock Staging"];
}

export function getSectorMetrics(sector: WarehouseSector | null, zones: Zone[], placements: InventoryPlacement[]) {
  const zoneId = sector?.dataZoneId ?? sector?.id;
  const dataZone = zones.find((zone) => zone.id === zoneId);
  const sectorPlacements = zoneId ? placements.filter((placement) => placement.zoneId === zoneId || (zoneId === "QA" && placement.zoneId === "QAC")) : [];
  const qaCount = sectorPlacements.filter((placement) => placement.qualityStatus !== "Released").length;
  const expiryRiskCount = sectorPlacements.filter(isExpiryRisk).length;
  return {
    dataZone,
    sectorPlacements,
    qaCount,
    expiryRiskCount,
    riskCount: qaCount + expiryRiskCount + (dataZone?.status && dataZone.status !== "normal" ? 1 : 0)
  };
}

export function getRackMetrics(rack: WarehouseRack | null, bins: WarehouseBin[]) {
  const rackBins = rack ? bins.filter((bin) => bin.rackId === rack.id) : [];
  return {
    bins: rackBins,
    occupancy: Math.min(100, Math.round((rackBins.length / 6) * 100)),
    expiryRiskCount: rackBins.filter((bin) => bin.expiryRisk === "warning").length,
    qualityHoldCount: rackBins.filter((bin) => bin.placement.qualityStatus !== "Released").length
  };
}

export function resolveDockIdForPlacement(placement: InventoryPlacement | null | undefined, docks: Dock[]) {
  if (!placement?.linkedShipmentId) return "D2";
  return docks.find((dock) => dock.currentShipmentId === placement.linkedShipmentId)?.id ?? "D2";
}

type RouteSegmentRef = string | { id: string; reverse?: boolean };

const pt = (x: number, z: number): Vec2 => ({ x, z });
const storageAccessPoint: Record<"CS" | "AM" | "PH", Vec2> = {
  CS: pt(-4.22, -0.71),
  AM: pt(-4.22, 0.34),
  PH: pt(-0.35, -0.71)
};

function createSegment(
  id: string,
  from: string,
  to: string,
  routeType: RouteSegmentType,
  points: Vec2[],
  statusCapability: RouteState[] = ["normal", "warning", "selected"]
): PresetRouteSegment {
  return { id, from, to, routeType, points, statusCapability };
}

const basePresetRouteSegments: PresetRouteSegment[] = [
  createSegment("receiving-to-cold-inspection", "Receiving", "Cold Inspection", "inspection", [
    pt(-5.42, 0.2),
    pt(-5.18, 0.2),
    pt(-5.18, 2.14)
  ]),
  createSegment("receiving-to-ambient-storage", "Cold Inspection", "Ambient Storage access", "storage-access", [
    pt(-5.18, 2.14),
    pt(-4.22, 2.14),
    pt(-4.22, 0.34)
  ]),
  createSegment("cold-inspection-to-cold-storage-corridor", "Cold Inspection", "Cold Storage corridor", "storage-access", [
    pt(-5.18, 2.14),
    pt(-4.22, 2.14),
    storageAccessPoint.CS
  ]),
  createSegment("receiving-to-pharmaceutical-storage", "Cold Inspection", "Pharmaceutical Storage access", "storage-access", [
    pt(-5.18, 2.14),
    pt(-4.22, 2.14),
    pt(-4.22, -0.43),
    pt(-0.88, -0.43),
    pt(-0.35, -0.43),
    storageAccessPoint.PH
  ]),
  createSegment("cold-storage-to-pharmaceutical-control", "Cold Storage access", "Pharmaceutical access", "quality-control", [
    storageAccessPoint.CS,
    pt(-4.22, -0.43),
    pt(-0.88, -0.43),
    pt(-0.35, -0.43),
    storageAccessPoint.PH
  ]),
  createSegment("ambient-storage-to-pharmaceutical-control", "Ambient Storage access", "Pharmaceutical access", "quality-control", [
    storageAccessPoint.AM,
    pt(-4.22, -0.43),
    pt(-0.88, -0.43),
    pt(-0.35, -0.43),
    storageAccessPoint.PH
  ]),
  createSegment("cold-storage-to-storage-exit-rfid", "Cold Storage access", "RFID Gate 2", "picking", [
    storageAccessPoint.CS,
    pt(-4.22, -0.43),
    pt(-0.88, -0.43)
  ]),
  createSegment("ambient-storage-to-storage-exit-rfid", "Ambient Storage access", "RFID Gate 2", "picking", [
    storageAccessPoint.AM,
    pt(-4.22, -0.43),
    pt(-0.88, -0.43)
  ]),
  createSegment("pharmaceutical-storage-to-storage-exit-rfid", "Pharmaceutical Storage access", "RFID Gate 2", "picking", [
    storageAccessPoint.PH,
    pt(-0.35, -0.43),
    pt(-0.88, -0.43)
  ]),
  createSegment("storage-exit-rfid-to-pallet-staging", "RFID Gate 2", "Pallet staging", "picking", [
    pt(-0.88, -0.43),
    pt(-0.88, 0.62),
    pt(0.6, 0.62)
  ]),
  createSegment("pallet-staging-to-packing-bench", "Pallet staging", "Packing bench", "packing", [
    pt(0.6, 0.62),
    pt(3.04, 0.62)
  ]),
  createSegment("packing-bench-to-dispatch-staging", "Packing bench", "Dispatch staging", "packing", [
    pt(3.04, 0.62),
    pt(3.04, 1.22),
    pt(3.04, 1.72),
    pt(1.55, 1.72)
  ]),
  createSegment("dispatch-staging-to-rfid-gate-3", "Dispatch staging", "RFID Gate 3", "dispatch", [
    pt(1.55, 1.72),
    pt(1.55, 2.46)
  ]),
  ...dockLayout.map((dock) =>
    createSegment(`rfid-gate-3-to-${dock.id.toLowerCase()}`, "RFID Gate 3", dock.id, "dispatch", [
      pt(1.55, 2.46),
      pt(1.55, 2.58),
      pt(dock.position.x, 2.58)
    ])
  ),
  createSegment("pharmaceutical-storage-to-qa-hold", "Pharmaceutical Storage access", "QA Hold door", "quality-control", [
    storageAccessPoint.PH,
    pt(3.72, -0.71),
    pt(3.72, -2.52)
  ], ["blocked", "warning", "selected"]),
  createSegment("qa-hold-to-quarantine", "QA Hold door", "Quarantine door", "quality-control", [
    pt(3.72, -2.52),
    pt(3.72, -1.25)
  ], ["blocked", "warning", "selected"])
];

const rackPresetRouteSegments: PresetRouteSegment[] = warehouseRacks.map((rack) => {
  const access = storageAccessPoint[rack.zoneId as "CS" | "AM" | "PH"];
  const aisle = getRackAislePosition(rack);
  return createSegment(`rack-access-${rack.id.toLowerCase()}`, `${rack.zoneId} access`, rack.id, "rack-access", [
    access,
    pt(aisle.x, access.z),
    aisle
  ]);
});

export const presetRouteSegments: PresetRouteSegment[] = [...basePresetRouteSegments, ...rackPresetRouteSegments];

export const staticAisleRouteSegments: PresetRouteSegment[] = [
  createSegment("static-receiving-lane", "Receiving", "Cold Inspection", "static-lane", [pt(-5.18, 0.2), pt(-5.18, 2.14)], ["normal"]),
  createSegment("static-west-cross-aisle", "West cross aisle", "Central RFID", "static-lane", [pt(-4.22, 2.14), pt(-4.22, -0.43), pt(-0.88, -0.43)], ["normal"]),
  createSegment("static-storage-aisle-cold", "Cold rack aisle", "Cold rack aisle", "static-lane", [storageAccessPoint.CS, pt(-1.2, -0.71)], ["normal"]),
  createSegment("static-storage-aisle-ambient", "Ambient rack aisle", "Ambient rack aisle", "static-lane", [storageAccessPoint.AM, pt(-1.8, 0.34)], ["normal"]),
  createSegment("static-storage-aisle-pharma", "Pharma rack aisle", "Pharma rack aisle", "static-lane", [storageAccessPoint.PH, pt(3.72, -0.71)], ["normal"]),
  createSegment("static-packing-bypass", "Packing bypass", "Dispatch staging", "static-lane", [pt(-0.88, 1.22), pt(3.04, 1.22), pt(3.04, 1.72), pt(1.55, 1.72)], ["normal"]),
  createSegment("static-dock-cross", "Dispatch staging", "Dock cross aisle", "static-lane", [pt(1.55, 1.72), pt(1.55, 2.58), pt(-0.5, 2.58), pt(4.0, 2.58)], ["normal"])
];

const segmentById = new Map(presetRouteSegments.map((segment) => [segment.id, segment]));

function samePoint(a: Vec2, b: Vec2) {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.z - b.z) < 0.001;
}

function orientedSegment(ref: RouteSegmentRef): PresetRouteSegment | null {
  const id = typeof ref === "string" ? ref : ref.id;
  const segment = segmentById.get(id);
  if (!segment) return null;
  if (typeof ref === "string" || !ref.reverse) return segment;
  return {
    ...segment,
    id: `${segment.id}:reverse`,
    from: segment.to,
    to: segment.from,
    points: [...segment.points].reverse()
  };
}

function combineRoute(refs: RouteSegmentRef[]) {
  const segments = refs.map(orientedSegment).filter((segment): segment is PresetRouteSegment => Boolean(segment));
  const points: Vec2[] = [];
  segments.forEach((segment) => {
    segment.points.forEach((point) => {
      if (!points.length || !samePoint(points[points.length - 1], point)) points.push(point);
    });
  });
  return { segments, points };
}

function inboundSegmentIdsForSector(sector?: WarehouseSector | null): RouteSegmentRef[] {
  if (!sector) return [];
  if (sector.id === "CI" || sector.id === "RCV") return ["receiving-to-cold-inspection"];
  if (sector.id === "CS") return ["receiving-to-cold-inspection", "cold-inspection-to-cold-storage-corridor"];
  if (sector.id === "AM") return ["receiving-to-cold-inspection", "receiving-to-ambient-storage"];
  if (sector.id === "PH") return ["receiving-to-cold-inspection", "receiving-to-pharmaceutical-storage"];
  if (sector.id === "QA") return ["receiving-to-cold-inspection", "receiving-to-pharmaceutical-storage", "pharmaceutical-storage-to-qa-hold"];
  if (sector.id === "QT") return ["receiving-to-cold-inspection", "receiving-to-pharmaceutical-storage", "pharmaceutical-storage-to-qa-hold", "qa-hold-to-quarantine"];
  if (sector.id === "PK" || sector.id === "PS") return ["pharmaceutical-storage-to-storage-exit-rfid", "storage-exit-rfid-to-pallet-staging", "pallet-staging-to-packing-bench"];
  if (sector.id === "DS") return ["packing-bench-to-dispatch-staging"];
  return [];
}

function storageToExitSegmentId(zoneId?: string | null) {
  const sector = getSector(zoneId);
  if (sector?.id === "AM") return "ambient-storage-to-storage-exit-rfid";
  if (sector?.id === "PH") return "pharmaceutical-storage-to-storage-exit-rfid";
  return "cold-storage-to-storage-exit-rfid";
}

function storageToQualityControlRefs(zoneId?: string | null): RouteSegmentRef[] {
  const sector = getSector(zoneId);
  if (sector?.id === "AM") return ["ambient-storage-to-pharmaceutical-control", "pharmaceutical-storage-to-qa-hold"];
  if (sector?.id === "CS") return ["cold-storage-to-pharmaceutical-control", "pharmaceutical-storage-to-qa-hold"];
  return ["pharmaceutical-storage-to-qa-hold"];
}

function rackAccessRef(rack?: WarehouseRack | null, reverse = false): RouteSegmentRef[] {
  if (!rack) return [];
  return [{ id: `rack-access-${rack.id.toLowerCase()}`, reverse }];
}

function inboundRefsForRack(rack?: WarehouseRack | null): RouteSegmentRef[] {
  if (!rack) return [];
  return [...inboundSegmentIdsForSector(getSector(rack.zoneId)), ...rackAccessRef(rack)];
}

function dispatchSegmentId(dockId?: string | null) {
  return `rfid-gate-3-to-${(dockId ?? "D2").toLowerCase()}`;
}

function stageRefs(stage?: string | null, sector?: WarehouseSector | null, rack?: WarehouseRack | null, dockId?: string | null): RouteSegmentRef[] {
  if (!stage) return [];
  if (stage === "Inbound" || stage === "Receiving") return ["receiving-to-cold-inspection"];
  if (stage === "Storage") return rack ? inboundRefsForRack(rack) : inboundSegmentIdsForSector(sector ?? getSector("CS"));
  if (stage === "Picking") return [storageToExitSegmentId(rack?.zoneId ?? sector?.id ?? "CS"), "storage-exit-rfid-to-pallet-staging", "pallet-staging-to-packing-bench"];
  if (stage === "Packing") return ["pallet-staging-to-packing-bench", "packing-bench-to-dispatch-staging"];
  if (stage === "Dock Staging" || stage === "Dispatch") return ["packing-bench-to-dispatch-staging", "dispatch-staging-to-rfid-gate-3", dispatchSegmentId(dockId)];
  return [];
}

export function buildInternalRoute({
  placement,
  rackId,
  sectorId,
  dockId,
  stage
}: {
  placement?: InventoryPlacement | null;
  rackId?: string | null;
  sectorId?: string | null;
  dockId?: string | null;
  stage?: string | null;
}): InternalRoute {
  const sector = getSector(sectorId ?? placement?.zoneId ?? null);
  const rack = getRack(rackId) ?? getRackForPlacement(placement);
  const targetDock = getDockLayout(dockId) ?? getDockLayout("D2");
  const isBlocked = placement?.qualityStatus === "QA Hold" || placement?.qualityStatus === "Quarantine";
  const explicitStageOnly = Boolean(stage && !placement && !rackId && !sectorId);
  const stageOverrideForSelection = Boolean(
    stage &&
      ((placement && stage !== placement.currentStage) ||
        (!placement && rack && stage !== "Storage") ||
        (!placement && !rack && sector && stage !== sector.stage))
  );
  let refs: RouteSegmentRef[] = [];

  if (explicitStageOnly || stageOverrideForSelection) {
    refs = stageRefs(stage, sector, rack, targetDock?.id);
  } else if (placement && rack) {
    refs = [...inboundRefsForRack(rack), ...rackAccessRef(rack, true)];
    if (isBlocked) {
      refs.push(...storageToQualityControlRefs(placement.zoneId));
      if (placement.qualityStatus === "Quarantine") refs.push("qa-hold-to-quarantine");
    } else {
      refs.push(
        storageToExitSegmentId(placement.zoneId),
        "storage-exit-rfid-to-pallet-staging",
        "pallet-staging-to-packing-bench",
        "packing-bench-to-dispatch-staging",
        "dispatch-staging-to-rfid-gate-3",
        dispatchSegmentId(targetDock?.id)
      );
    }
  } else if (rack) {
    refs = inboundRefsForRack(rack);
  } else if (sector) {
    refs = inboundSegmentIdsForSector(sector);
  } else if (stage) {
    refs = stageRefs(stage, null, null, targetDock?.id);
  }

  const { points, segments } = combineRoute(refs);
  if (!points.length) {
    return {
      points: [],
      state: "normal",
      message: "No preset internal route is active. Select a sector, rack, SKU, or process stage to show a clean aisle route.",
      segments: [],
      blockedPoint: null,
      showArrows: false
    };
  }

  const blockedPoint = isBlocked ? points[points.length - 1] : null;
  const routeObject = placement?.stockBalanceId ?? rack?.id ?? sector?.name ?? stage ?? "selected process stage";
  return {
    points,
    segments,
    state: isBlocked ? "blocked" : "selected",
    blockedPoint,
    showArrows: Boolean(placement || rack || sector || stage),
    message: isBlocked
      ? `Preset route for ${routeObject} terminates at controlled ${placement?.qualityStatus === "Quarantine" ? "quarantine" : "QA Hold"} review. No dispatch path is drawn beyond the restriction.`
      : `Preset aisle route for ${routeObject} uses only validated lanes and excludes racks, walls, controlled holds, staging blocks, packing bench, and dock structures.`
  };
}
