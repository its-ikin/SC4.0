import type { WarehouseSnapshot } from "@twinops/shared";

export type SimulationDirection = "inbound" | "outbound";

export type SimulationQuantities = {
  expected: number;
  received: number;
  required: number;
  allocated: number;
  picked: number;
  packed: number;
  dispatched: number;
  onHand: number;
  available: number;
};

export type SimulationImpact = {
  onHandDelta: number;
  availableDelta: number;
  reservedDelta: number;
  pickedDelta: number;
  packedDelta: number;
  stagedDelta: number;
};

export type SimulationLedgerEvent = {
  eventId: string;
  step: number;
  timestamp: string;
  stage: string;
  title: string;
  detail: string;
  domains: string[];
};

export type SimulationBlocker = {
  code: "quality_disposition_required" | "inbound_exception" | "outbound_blocked" | "allocation_shortfall";
  title: string;
  detail: string;
};

type SimulationConstraints = {
  inboundBlockedLineIds: string[];
  inboundRemainingQuantity: number;
  inboundInventoryPostingQuantity: number;
  outboundExecutableQuantity: number;
  outboundAllocationShortfall: number;
};

export type OperationsSimulation = {
  sessionId: string;
  direction: SimulationDirection;
  referenceId: string;
  referenceLabel: string;
  capturedAt: string;
  initialStatus: string;
  stages: string[];
  stageIndex: number;
  dockId: string;
  dockStatus: "Available" | "Reserved" | "Occupied";
  transportStatus: string;
  baseline: SimulationQuantities;
  projected: SimulationQuantities;
  impact: SimulationImpact;
  ledger: SimulationLedgerEvent[];
  warnings: string[];
  constraints: SimulationConstraints;
  blocker: SimulationBlocker | null;
  completed: boolean;
};

export const INBOUND_SIMULATION_STAGES = [
  "Scheduled",
  "In Transit",
  "Gate In",
  "At Receiving",
  "Unloading",
  "Received",
  "QA Pending",
  "Released",
  "Put-away",
  "Put-away Complete"
] as const;

export const OUTBOUND_SIMULATION_STAGES = [
  "Scheduled",
  "Allocated",
  "Picking",
  "Packed",
  "Staged",
  "Loading",
  "Dispatched"
] as const;

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function inboundStageIndex(status: string) {
  const aliases: Record<string, number> = {
    "ASN Received": 0,
    "Appointment Booked": 0,
    "Vehicle Assigned": 0,
    Scheduled: 0,
    "In Transit": 1,
    "Gate In": 2,
    "At Receiving": 3,
    Unloading: 4,
    Received: 5,
    "QA Pending": 6,
    "QA Hold": 6,
    Released: 7,
    Putaway: 8,
    "Put-away": 8,
    "Putaway Complete": 9,
    "Put-away Complete": 9,
    Closed: 9,
    Exception: 0
  };
  return aliases[status] ?? 0;
}

function outboundStageIndex(status: string) {
  const aliases: Record<string, number> = {
    "Order Received": 0,
    "Delivery Created": 0,
    Scheduled: 0,
    "Wave Released": 0,
    Allocated: 1,
    Replenishment: 1,
    Picking: 2,
    Picked: 2,
    Packed: 3,
    "QA Release": 3,
    Staged: 4,
    Loading: 5,
    "Goods Issued": 6,
    Dispatched: 6,
    Delivered: 6,
    Blocked: 0,
    Exception: 0
  };
  return aliases[status] ?? 0;
}

function batchInventory(snapshot: WarehouseSnapshot, batchIds: string[]) {
  const selected = new Set(batchIds);
  const balances = snapshot.inventory.stockBalances.filter((balance) => selected.has(balance.batchId));
  return {
    onHand: sum(balances.map((balance) => balance.qtyOnHand)),
    available: sum(balances.map((balance) => balance.qtyAvailable))
  };
}

function emptyImpact(): SimulationImpact {
  return { onHandDelta: 0, availableDelta: 0, reservedDelta: 0, pickedDelta: 0, packedDelta: 0, stagedDelta: 0 };
}

function sessionId(direction: SimulationDirection, referenceId: string, capturedAt: string) {
  const compactTime = [...capturedAt].filter((character) => character >= "0" && character <= "9").join("").slice(0, 14);
  return `SIM-${direction.toUpperCase()}-${referenceId}-${compactTime}`;
}

function inboundQualityBlocker(lineIds: string[]): SimulationBlocker | null {
  if (lineIds.length === 0) return null;
  return {
    code: "quality_disposition_required",
    title: "Quality disposition required",
    detail: `${lineIds.length.toLocaleString()} inbound line${lineIds.length === 1 ? "" : "s"} remain unreleased. The scenario stops at QA Pending and does not make those quantities available.`
  };
}

function inboundExceptionBlocker(status: string): SimulationBlocker | null {
  if (status !== "Exception") return null;
  return {
    code: "inbound_exception",
    title: "Inbound exception unresolved",
    detail: "Resolve the recorded receiving exception before the scenario can proceed to gate, receipt, quality, or put-away."
  };
}

function outboundStatusBlocker(status: string, blockedLineCount: number): SimulationBlocker | null {
  if (!["Blocked", "Exception"].includes(status) && blockedLineCount === 0) return null;
  return {
    code: "outbound_blocked",
    title: status === "Exception" ? "Shipment exception unresolved" : "Shipment is blocked",
    detail: blockedLineCount > 0
      ? `${blockedLineCount.toLocaleString()} outbound line${blockedLineCount === 1 ? " is" : "s are"} not eligible for allocation. Resolve the recorded blocker before allocation, picking, or dispatch.`
      : "Resolve the recorded operational blocker before allocation, picking, or dispatch."
  };
}

function allocationShortfallBlocker(shortfall: number): SimulationBlocker | null {
  if (shortfall <= 0) return null;
  return {
    code: "allocation_shortfall",
    title: "Allocation shortfall",
    detail: `${shortfall.toLocaleString()} required unit${shortfall === 1 ? " is" : "s are"} not supported by eligible available stock. The scenario cannot proceed to picking.`
  };
}

export function createOperationsSimulation(
  snapshot: WarehouseSnapshot,
  direction: SimulationDirection,
  referenceId: string,
  capturedAt = new Date().toISOString()
): OperationsSimulation {
  if (direction === "inbound") {
    const shipment = snapshot.inventory.inboundShipments.find((item) => item.asnId === referenceId);
    if (!shipment) throw new Error(`Inbound record ${referenceId} was not found in the captured baseline.`);
    const lines = snapshot.inventory.inboundLines.filter((line) => line.asnId === referenceId);
    const inventory = batchInventory(snapshot, lines.map((line) => line.batchId));
    const baseline: SimulationQuantities = {
      expected: sum(lines.map((line) => line.qtyExpected)),
      received: sum(lines.map((line) => line.qtyReceived)),
      required: 0,
      allocated: 0,
      picked: 0,
      packed: 0,
      dispatched: 0,
      ...inventory
    };
    const stageIndex = inboundStageIndex(shipment.inboundStatus);
    const inboundBlockedLineIds = lines
      .filter((line) => line.qaStatus !== "Released")
      .map((line) => line.inboundLineId);
    const inboundRemainingQuantity = sum(lines.map((line) => Math.max(0, line.qtyExpected - line.qtyReceived)));
    // Receipt scans are progress, not necessarily inventory postings. Before Goods Receipt the
    // full document quantity is still outside the frozen on-hand baseline, so ASN-1002 adds all
    // 210 units when receipt posts. Once the WMS header is at Received or later, its quantity is
    // already represented and must not be added again (ASN-1005/ASN-1006).
    const receiptAlreadyPosted = Boolean(shipment.goodsReceiptNumber) || stageIndex >= 5;
    const inboundInventoryPostingQuantity = receiptAlreadyPosted ? 0 : baseline.expected;
    const initialBlocker = inboundExceptionBlocker(shipment.inboundStatus)
      ?? (stageIndex >= 6 ? inboundQualityBlocker(inboundBlockedLineIds) : null);
    const warnings = inboundBlockedLineIds.length > 0 && !initialBlocker
      ? [`${inboundBlockedLineIds.length.toLocaleString()} inbound line${inboundBlockedLineIds.length === 1 ? " has" : "s have"} not been released by quality. This scenario will stop at QA Pending unless the captured baseline already shows a release.`]
      : [];
    return {
      sessionId: sessionId(direction, referenceId, capturedAt),
      direction,
      referenceId,
      referenceLabel: shipment.source,
      capturedAt,
      initialStatus: shipment.inboundStatus,
      stages: [...INBOUND_SIMULATION_STAGES],
      stageIndex,
      dockId: shipment.receivingDock,
      dockStatus: stageIndex >= 3 && stageIndex <= 4 ? "Occupied" : stageIndex < 3 ? "Reserved" : "Available",
      transportStatus: stageIndex < 1 ? "Planned" : stageIndex < 2 ? "In transit" : stageIndex < 5 ? "At warehouse" : "Completed",
      baseline,
      projected: {
        ...baseline
      },
      impact: emptyImpact(),
      ledger: [{
        eventId: `${sessionId(direction, referenceId, capturedAt)}-BASELINE`,
        step: 0,
        timestamp: capturedAt,
        stage: shipment.inboundStatus,
        title: "Baseline captured",
        detail: `${referenceId} was copied into an isolated scenario. No warehouse records were changed.`,
        domains: ["Simulation"]
      }],
      warnings,
      constraints: {
        inboundBlockedLineIds,
        inboundRemainingQuantity,
        inboundInventoryPostingQuantity,
        outboundExecutableQuantity: 0,
        outboundAllocationShortfall: 0
      },
      blocker: initialBlocker,
      completed: !initialBlocker && stageIndex === INBOUND_SIMULATION_STAGES.length - 1
    };
  }

  const shipment = snapshot.inventory.outboundShipments.find((item) => item.shipmentId === referenceId);
  if (!shipment) throw new Error(`Outbound record ${referenceId} was not found in the captured baseline.`);
  const lines = snapshot.inventory.outboundLines.filter((line) => line.shipmentId === referenceId);
  const inventory = batchInventory(snapshot, lines.map((line) => line.batchId));
  const baseline: SimulationQuantities = {
    expected: 0,
    received: 0,
    required: sum(lines.map((line) => line.qtyRequired)),
    allocated: sum(lines.map((line) => line.qtyAllocated)),
    picked: sum(lines.map((line) => line.qtyPicked)),
    packed: sum(lines.map((line) => line.qtyPacked)),
    dispatched: sum(lines.map((line) => line.qtyDispatched)),
    ...inventory
  };
  const stageIndex = outboundStageIndex(shipment.outboundStatus);
  const outboundExecutableQuantity = Math.min(baseline.required, baseline.available + baseline.allocated);
  const outboundAllocationShortfall = Math.max(0, baseline.required - outboundExecutableQuantity);
  const blockedLineCount = lines.filter((line) => /blocked|hold|quarantine|expired/i.test(line.allocationStatus)).length;
  const initialBlocker = outboundStatusBlocker(shipment.outboundStatus, blockedLineCount);
  const warnings = !initialBlocker && outboundAllocationShortfall > 0
      ? [`Only ${outboundExecutableQuantity.toLocaleString()} of ${baseline.required.toLocaleString()} required units are eligible for allocation in the captured baseline.`]
      : [];
  return {
    sessionId: sessionId(direction, referenceId, capturedAt),
    direction,
    referenceId,
    referenceLabel: shipment.destination,
    capturedAt,
    initialStatus: shipment.outboundStatus,
    stages: [...OUTBOUND_SIMULATION_STAGES],
    stageIndex,
    dockId: shipment.dock,
    dockStatus: stageIndex >= 4 && stageIndex <= 5 ? "Occupied" : stageIndex < 4 ? "Reserved" : "Available",
    transportStatus: stageIndex < 4 ? "Planned" : stageIndex < 6 ? "At warehouse" : "Departed",
    baseline,
    projected: { ...baseline },
    impact: emptyImpact(),
    ledger: [{
      eventId: `${sessionId(direction, referenceId, capturedAt)}-BASELINE`,
      step: 0,
      timestamp: capturedAt,
      stage: shipment.outboundStatus,
      title: "Baseline captured",
      detail: `${referenceId} was copied into an isolated scenario. No warehouse records were changed.`,
      domains: ["Simulation"]
    }],
    warnings,
    constraints: {
      inboundBlockedLineIds: [],
      inboundRemainingQuantity: 0,
      inboundInventoryPostingQuantity: 0,
      outboundExecutableQuantity,
      outboundAllocationShortfall
    },
    blocker: initialBlocker,
    completed: !initialBlocker && stageIndex === OUTBOUND_SIMULATION_STAGES.length - 1
  };
}

function inboundProjection(simulation: OperationsSimulation, nextIndex: number) {
  const baseline = simulation.baseline;
  const expected = baseline.expected;
  const remaining = simulation.constraints.inboundRemainingQuantity;
  const received = nextIndex < 4
    ? baseline.received
    : nextIndex === 4
      ? baseline.received + Math.ceil(remaining / 2)
      : expected;
  // Scanned receipt progress is not on-hand until Goods Receipt posts. The constraint is the
  // full expected quantity for an unposted ASN, or zero for a receipt already in inventory.
  const onHandDelta = nextIndex >= 5 ? simulation.constraints.inboundInventoryPostingQuantity : 0;
  // A scenario with any unreleased line is stopped at QA Pending before this can be reached.
  const availableDelta = nextIndex >= 9 && simulation.constraints.inboundBlockedLineIds.length === 0
    ? onHandDelta
    : 0;
  return {
    projected: { ...baseline, received, onHand: baseline.onHand + onHandDelta, available: baseline.available + availableDelta },
    impact: { ...emptyImpact(), onHandDelta, availableDelta }
  };
}

export function projectedInboundLineReceipts(
  simulation: OperationsSimulation,
  lines: Array<{ inboundLineId: string; qtyExpected: number; qtyReceived: number }>
) {
  return lines.map((line) => {
    const remaining = Math.max(0, line.qtyExpected - line.qtyReceived);
    const projectedReceived = simulation.stageIndex < 4
      ? line.qtyReceived
      : simulation.stageIndex === 4
        ? line.qtyReceived + Math.ceil(remaining / 2)
        : line.qtyExpected;
    return { inboundLineId: line.inboundLineId, expected: line.qtyExpected, received: projectedReceived };
  });
}

export function projectedOutboundLineAllocations(
  simulation: OperationsSimulation,
  lines: Array<{ outboundLineId: string; qtyRequired: number; qtyAllocated: number }>
) {
  let additionalAllocation = Math.max(0, simulation.projected.allocated - lines.reduce((total, line) => total + line.qtyAllocated, 0));
  return lines.map((line) => {
    const allocatable = Math.max(0, line.qtyRequired - line.qtyAllocated);
    const added = Math.min(allocatable, additionalAllocation);
    additionalAllocation -= added;
    return { outboundLineId: line.outboundLineId, required: line.qtyRequired, allocated: line.qtyAllocated + added };
  });
}

function outboundProjection(simulation: OperationsSimulation, nextIndex: number) {
  const baseline = simulation.baseline;
  const executable = simulation.constraints.outboundExecutableQuantity;
  const allocated = nextIndex >= 1 ? Math.max(baseline.allocated, executable) : baseline.allocated;
  const picked = nextIndex >= 2 ? Math.max(baseline.picked, allocated) : baseline.picked;
  const packed = nextIndex >= 3 ? Math.max(baseline.packed, picked) : baseline.packed;
  const dispatched = nextIndex >= 6 ? Math.max(baseline.dispatched, packed) : baseline.dispatched;
  const newlyAllocated = Math.max(0, allocated - baseline.allocated);
  const newlyPicked = Math.max(0, picked - baseline.picked);
  const newlyPacked = Math.max(0, packed - baseline.packed);
  const newlyDispatched = Math.max(0, dispatched - baseline.dispatched);
  const impact: SimulationImpact = {
    onHandDelta: -newlyDispatched,
    availableDelta: -newlyAllocated,
    reservedDelta: nextIndex === 1 ? newlyAllocated : 0,
    pickedDelta: nextIndex === 2 ? newlyPicked : 0,
    packedDelta: nextIndex === 3 ? newlyPacked : 0,
    stagedDelta: nextIndex >= 4 && nextIndex < 6 ? newlyPacked : 0
  };
  return {
    projected: {
      ...baseline,
      allocated,
      picked,
      packed,
      dispatched,
      onHand: baseline.onHand + impact.onHandDelta,
      available: baseline.available + impact.availableDelta
    },
    impact
  };
}

function eventDescription(direction: SimulationDirection, stage: string, simulation: OperationsSimulation) {
  if (direction === "inbound") {
    const descriptions: Record<string, string> = {
      "In Transit": "Transport leaves the supplier and begins the planned inbound leg.",
      "Gate In": `Vehicle arrival is recorded and dock ${simulation.dockId} remains reserved.`,
      "At Receiving": `Dock ${simulation.dockId} becomes occupied for receiving.`,
      Unloading: "Half of the remaining expected quantity is projected as unloaded.",
      Received: "Goods receipt completes and received stock becomes on-hand in the receiving flow.",
      "QA Pending": "Received stock waits for quality disposition and remains unavailable.",
      Released: "Quality disposition releases the stock for put-away planning.",
      "Put-away": "Stock is projected in transfer from receiving to its assigned storage location.",
      "Put-away Complete": "Put-away completes and the received stock becomes available inventory."
    };
    return descriptions[stage] ?? "Inbound execution advances to the next projected milestone.";
  }
  const descriptions: Record<string, string> = {
    Allocated: "Available stock is projected into the reserved allocation bucket.",
    Picking: "Reserved stock is projected into the picked bucket.",
    Packed: "Picked stock is projected as packed and ready for staging.",
    Staged: `Packed stock is projected at dock ${simulation.dockId}; the dock becomes occupied.`,
    Loading: "The vehicle is projected at the dock while staged stock is loaded.",
    Dispatched: "Goods issue is projected; on-hand stock decreases and the dock is released."
  };
  return descriptions[stage] ?? "Outbound execution advances to the next projected milestone.";
}

export function advanceOperationsSimulation(simulation: OperationsSimulation, timestamp = new Date().toISOString()): OperationsSimulation {
  if (simulation.completed || simulation.blocker) return simulation;
  const nextIndex = Math.min(simulation.stageIndex + 1, simulation.stages.length - 1);
  const stage = simulation.stages[nextIndex];
  const projection = simulation.direction === "inbound"
    ? inboundProjection(simulation, nextIndex)
    : outboundProjection(simulation, nextIndex);
  const inbound = simulation.direction === "inbound";
  const blocker = inbound && nextIndex >= 6
    ? inboundQualityBlocker(simulation.constraints.inboundBlockedLineIds)
    : !inbound && nextIndex >= 1
      ? allocationShortfallBlocker(simulation.constraints.outboundAllocationShortfall)
      : null;
  const dockStatus = inbound
    ? nextIndex >= 3 && nextIndex <= 4 ? "Occupied" as const : nextIndex < 3 ? "Reserved" as const : "Available" as const
    : nextIndex >= 4 && nextIndex <= 5 ? "Occupied" as const : nextIndex < 4 ? "Reserved" as const : "Available" as const;
  const transportStatus = inbound
    ? nextIndex < 1 ? "Planned" : nextIndex < 2 ? "In transit" : nextIndex < 5 ? "At warehouse" : "Completed"
    : nextIndex < 4 ? "Planned" : nextIndex < 6 ? "At warehouse" : "Departed";
  const step = simulation.ledger.length;
  return {
    ...simulation,
    stageIndex: nextIndex,
    dockStatus,
    transportStatus,
    projected: projection.projected,
    impact: projection.impact,
    blocker,
    completed: !blocker && nextIndex === simulation.stages.length - 1,
    ledger: [...simulation.ledger, {
      eventId: `${simulation.sessionId}-STEP-${String(step).padStart(2, "0")}`,
      step,
      timestamp,
      stage,
      title: `${simulation.referenceId} projected to ${stage}`,
      detail: eventDescription(simulation.direction, stage, simulation),
      domains: inbound ? ["Inbound", "Inventory", "Dock", "Logistics"] : ["Outbound", "Inventory", "Dock", "Logistics"]
    }]
  };
}
