import type { Server } from "socket.io";
import { calculateVariance, type OutboundLine, type OutboundShipment } from "@twinops/shared";
import { db, getOutboundLines, getOutboundShipments, getInventoryPlacements, getTemperatureEvents, getWarehouseSnapshot, getZones, nowIso } from "./db/database";
import { createAlert } from "./tools";
import { reconcileOperationalIssues } from "./issueLifecycle";

const actions = ["IN", "OUT", "MOVE"] as const;

const temperatureProfiles: Record<string, { base: number; amplitude: number; secondaryAmplitude: number; phase: number }> = {
  CS: { base: 5.1, amplitude: 0.28, secondaryAmplitude: 0.1, phase: 0.2 },
  PH: { base: 20.8, amplitude: 0.42, secondaryAmplitude: 0.16, phase: 1.1 },
  AM: { base: 22.8, amplitude: 0.56, secondaryAmplitude: 0.22, phase: 2.4 },
  QA: { base: 20.7, amplitude: 0.24, secondaryAmplitude: 0.08, phase: 1.8 },
  QAC: { base: 5.2, amplitude: 0.22, secondaryAmplitude: 0.08, phase: 2.2 },
  QT: { base: 20.4, amplitude: 0.24, secondaryAmplitude: 0.08, phase: 2.9 },
  RCV: { base: 23.1, amplitude: 0.68, secondaryAmplitude: 0.28, phase: 0.7 },
  DS: { base: 23.4, amplitude: 0.72, secondaryAmplitude: 0.26, phase: 1.5 }
};

let temperatureTick = 0;

function syncOperationalIssueLifecycle() {
  try {
    return reconcileOperationalIssues().eventsWritten > 0;
  } catch (error) {
    console.warn("Operational issue lifecycle reconciliation failed; retrying on the next telemetry tick.", error);
    return false;
  }
}

function simulatedTemperature(zoneId: string) {
  const profile = temperatureProfiles[zoneId] ?? { base: 21, amplitude: 0.4, secondaryAmplitude: 0.12, phase: 0 };
  const smoothWalk = Math.sin(temperatureTick / 9 + profile.phase) * profile.amplitude;
  const slowDrift = Math.sin(temperatureTick / 27 + profile.phase * 0.7) * profile.secondaryAmplitude;
  const rareColdSpike = zoneId === "CS" && Math.random() < 0.003;
  const rareDockSpike = zoneId === "RCV" && Math.random() < 0.004;
  if (rareColdSpike) return 8.4;
  if (rareDockSpike) return 30.7;
  return Number((profile.base + smoothWalk + slowDrift).toFixed(1));
}

function emitAlert(io: Server, result: ReturnType<typeof createAlert>) {
  io.emit("dashboard:state_update", {
    updatedSKUs: result.alert.affectedIds.filter((id) => id.startsWith("GSK-")),
    updatedDocks: result.alert.affectedIds.filter((id) => id.startsWith("D")),
    updatedShipments: result.alert.affectedIds.filter((id) => id.startsWith("SHIP-")),
    timestamp: nowIso()
  });
  // Only genuinely new alerts trigger a toast — createAlert() dedupes by message, and every
  // category re-checks its condition every tick, so most calls here are just re-confirming an
  // alert that's already open. Toasting on every re-confirmation would mean a toast every 5-30s
  // for as long as any condition stays true, which is spam, not a notification.
  if (result.isNew) {
    io.emit("alert:new", result.alert);
  }
}

/** Auto-resolves previously-created alerts in a given category once their triggering condition
 * is no longer true (e.g. a temperature excursion clears, a SKU dispatches, QA hold is released),
 * so the alert list actually reflects current state instead of only ever growing. `isInCategory`
 * identifies which open alerts belong to this check (by message shape); `currentMessages` is the
 * full set of messages that condition currently produces. Anything open, in-category, and not in
 * that set gets marked dismissed. Returns true if anything was actually resolved. */
function reconcileAlerts(isInCategory: (message: string) => boolean, currentMessages: Set<string>): boolean {
  const openInCategory = (db.prepare("SELECT id, message FROM alerts WHERE status = 'open'").all() as { id: string; message: string }[]).filter((row) =>
    isInCategory(row.message)
  );
  const stale = openInCategory.filter((row) => !currentMessages.has(row.message));
  stale.forEach((row) => db.prepare("UPDATE alerts SET status = 'dismissed' WHERE id = ?").run(row.id));
  return stale.length > 0;
}

/** Checked on the same 5s cadence as the temperature simulation itself, not the slower 30s
 * condition-check loop below. A single out-of-band reading can open and close (finalize as
 * Resolved/Under Review) within one temperature tick — a 30s poll almost always samples after
 * that window has already closed, so it would silently miss genuinely-live spikes. Running this
 * immediately after each tick's readings are written guarantees the "Open" state is observed. */
function checkTemperatureAlerts(io: Server): boolean {
  const temperatureEvents = getTemperatureEvents()
    .filter(
      (event) =>
        event.status === "Open" &&
        (event.eventType === "Non-Conformance" || (event.eventType === "Excursion" && event.allowedBand.min === 2 && event.allowedBand.max === 8))
    )
    .slice(0, 3);
  const alertMessage = (event: (typeof temperatureEvents)[number]) =>
    `Temperature event ${event.eventId} is open in ${event.zoneName}. Review current peak, duration, and affected stock in Monitoring.`;
  const resolved = reconcileAlerts(
    (message) => message.startsWith("Temperature event ")
      || / temperature (Non-Conformance|Excursion) is open:/.test(message),
    new Set(temperatureEvents.map(alertMessage))
  );
  temperatureEvents.forEach((event) => {
    emitAlert(
      io,
      createAlert({
        severity: event.eventType === "Non-Conformance" ? "critical" : "warn",
        // Keep the alert identity stable while peak and duration continue to update. The live
        // measurements remain in Monitoring; otherwise every five-second sample created a new
        // alert row for the same physical incident.
        message: alertMessage(event),
        sourceAgent: "Compliance",
        affectedIds: [event.eventId, event.zoneId, ...event.affectedSkuIds, ...event.affectedBatchIds]
      })
    );
  });
  return resolved;
}

/** Real warehouse fulfillment pipeline, matching `OutboundShipment.outboundStatus` in
 * shared/types. "Blocked" is deliberately excluded — it's a QA exception state that only clears
 * through a controlled quality workflow outside the assistant, never auto-advanced by a timer. */
const OUTBOUND_STAGES = ["Scheduled", "Allocated", "Picking", "Packed", "Staged", "Dispatched"] as const;

function nextOutboundStage(status: string): (typeof OUTBOUND_STAGES)[number] | null {
  const index = OUTBOUND_STAGES.indexOf(status as (typeof OUTBOUND_STAGES)[number]);
  if (index === -1 || index === OUTBOUND_STAGES.length - 1) return null;
  return OUTBOUND_STAGES[index + 1];
}

let liveMovementSeq = 1;

function insertLiveMovement(
  shipment: OutboundShipment,
  line: OutboundLine,
  movementType: string,
  qty: number,
  timestamp: string,
  fromLocationId: string | null = null,
  toLocationId: string | null = null
) {
  db.prepare(
    `INSERT INTO inventory_movements
     (movement_id, timestamp, movement_type, product_id, batch_id, from_location_id, to_location_id, qty, reference_type, reference_id, user_or_system, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `MOV-LIVE-${Date.now()}-${liveMovementSeq++}`,
    timestamp,
    movementType,
    line.productId,
    line.batchId,
    fromLocationId,
    toLocationId,
    qty,
    "Outbound Shipment",
    shipment.shipmentId,
    "System",
    `Auto-advanced to ${movementType} as part of live shipment progression.`
  );
}

type BalanceQuantityColumn = "qty_available" | "qty_reserved" | "qty_picked" | "qty_packed" | "qty_staged";

type BalanceTransfer = {
  stockBalanceId: string;
  locationId: string;
  qty: number;
};

/** Moves a quantity between two stock-balance buckets. The column names are deliberately
 * restricted to this internal union, while values remain bound parameters. The caller owns the
 * surrounding transaction, so shipment, line, balance, and movement changes commit together. */
function transferBatchQuantity(
  batchId: string,
  qty: number,
  from: BalanceQuantityColumn,
  to: Exclude<BalanceQuantityColumn, "qty_available"> | "qty_dispatched",
  timestamp: string,
  reduceOnHand = false
): BalanceTransfer[] {
  if (qty <= 0) return [];
  const balances = db
    .prepare(
      `SELECT stock_balance_id, location_id, ${from} AS source_qty
       FROM stock_balances
       WHERE batch_id = ? AND ${from} > 0
       ORDER BY stock_balance_id`
    )
    .all(batchId) as Array<{ stock_balance_id: string; location_id: string; source_qty: number }>;

  let remaining = qty;
  const transfers: BalanceTransfer[] = [];
  for (const balance of balances) {
    if (remaining <= 0) break;
    const moved = Math.min(remaining, balance.source_qty);
    db.prepare(
      `UPDATE stock_balances
       SET ${from} = ${from} - @qty,
           ${to} = ${to} + @qty,
           qty_on_hand = qty_on_hand - @onHandReduction,
           last_updated = @timestamp
       WHERE stock_balance_id = @stockBalanceId`
    ).run({
      qty: moved,
      onHandReduction: reduceOnHand ? moved : 0,
      timestamp,
      stockBalanceId: balance.stock_balance_id
    });
    transfers.push({ stockBalanceId: balance.stock_balance_id, locationId: balance.location_id, qty: moved });
    remaining -= moved;
  }

  if (remaining > 0) {
    throw new Error(`Cannot move ${qty} units for batch ${batchId}: ${remaining} units are missing from ${from}.`);
  }
  return transfers;
}

/** Advances the soonest-due in-progress shipment by one stage for accelerated demos only.
 * `outbound_shipments` is the WMS source of truth; Logistics reads its canonical transport/dock
 * projection. Each transition confirms line quantities, records inventory movements, updates the
 * linked transport and appointment, and emits one cross-domain operational event. Normal runtime
 * leaves this disabled so a timer cannot impersonate a warehouse scan or goods-issue posting. */
export function advanceShipments(io: Pick<Server, "emit">) {
  const advancing = getOutboundShipments()
    .filter((shipment) => nextOutboundStage(shipment.outboundStatus) !== null)
    .sort((a, b) => new Date(a.requiredBy).getTime() - new Date(b.requiredBy).getTime());
  const shipment = advancing[0];
  if (!shipment) return;

  const previousStatus = shipment.outboundStatus;
  const newStatus = nextOutboundStage(previousStatus)!;
  const lines = getOutboundLines().filter((line) => line.shipmentId === shipment.shipmentId);
  const timestamp = nowIso();

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE outbound_shipments SET outbound_status = ? WHERE shipment_id = ?").run(newStatus, shipment.shipmentId);
    db.prepare("UPDATE outbound_lines SET allocation_status = ? WHERE shipment_id = ?").run(newStatus, shipment.shipmentId);

    if (newStatus === "Allocated") {
      lines.forEach((line) => {
        const qty = Math.max(0, line.qtyRequired - line.qtyAllocated);
        const transfers = transferBatchQuantity(line.batchId, qty, "qty_available", "qty_reserved", timestamp);
        db.prepare("UPDATE outbound_lines SET qty_allocated = qty_required WHERE outbound_line_id = ?").run(line.outboundLineId);
        transfers.forEach((transfer) =>
          insertLiveMovement(shipment, line, "Reserve", transfer.qty, timestamp, transfer.locationId, transfer.locationId)
        );
      });
    } else if (newStatus === "Picking") {
      lines.forEach((line) => {
        const qty = Math.max(0, line.qtyAllocated - line.qtyPicked);
        const transfers = transferBatchQuantity(line.batchId, qty, "qty_reserved", "qty_picked", timestamp);
        db.prepare("UPDATE outbound_lines SET qty_picked = qty_allocated WHERE outbound_line_id = ?").run(line.outboundLineId);
        transfers.forEach((transfer) =>
          insertLiveMovement(shipment, line, "Pick", transfer.qty, timestamp, transfer.locationId, transfer.locationId)
        );
      });
    } else if (newStatus === "Packed") {
      lines.forEach((line) => {
        const qty = Math.max(0, line.qtyPicked - line.qtyPacked);
        const transfers = transferBatchQuantity(line.batchId, qty, "qty_picked", "qty_packed", timestamp);
        db.prepare("UPDATE outbound_lines SET qty_packed = qty_picked WHERE outbound_line_id = ?").run(line.outboundLineId);
        transfers.forEach((transfer) =>
          insertLiveMovement(shipment, line, "Pack", transfer.qty, timestamp, transfer.locationId, transfer.locationId)
        );
      });
    } else if (newStatus === "Staged") {
      lines.forEach((line) => {
        const alreadyStaged = db
          .prepare("SELECT COALESCE(SUM(qty_staged), 0) AS qty FROM stock_balances WHERE batch_id = ?")
          .get(line.batchId) as { qty: number };
        const qty = Math.max(0, line.qtyPacked - alreadyStaged.qty);
        const transfers = transferBatchQuantity(line.batchId, qty, "qty_packed", "qty_staged", timestamp);
        transfers.forEach((transfer) =>
          insertLiveMovement(shipment, line, "Stage", transfer.qty, timestamp, transfer.locationId, `DS-${shipment.dock}`)
        );
      });
      db.prepare("UPDATE docks SET status = 'occupied', current_shipment_id = ? WHERE id = ?").run(shipment.shipmentId, shipment.dock);
      db.prepare("UPDATE dock_schedule SET status = 'staged' WHERE shipment_id = ?").run(shipment.shipmentId);
      db.prepare("UPDATE dock_appointments SET status = 'loading', actual_dock_in = COALESCE(actual_dock_in, ?), last_updated_at = ? WHERE reference_id = ?").run(
        timestamp,
        timestamp,
        shipment.shipmentId
      );
      db.prepare("UPDATE transport_legs SET transport_status = 'loading', last_updated_at = ? WHERE shipment_id = ?").run(timestamp, shipment.shipmentId);
    } else if (newStatus === "Dispatched") {
      lines.forEach((line) => {
        const qty = Math.max(0, line.qtyPacked - line.qtyDispatched);
        const transfers = transferBatchQuantity(line.batchId, qty, "qty_staged", "qty_dispatched", timestamp, true);
        db.prepare("UPDATE outbound_lines SET qty_dispatched = qty_packed WHERE outbound_line_id = ?").run(line.outboundLineId);
        transfers.forEach((transfer) =>
          insertLiveMovement(shipment, line, "Dispatch", transfer.qty, timestamp, transfer.locationId, `DS-${shipment.dock}`)
        );
      });
      db.prepare("UPDATE outbound_shipments SET actual_departure = COALESCE(actual_departure, ?), goods_issue_number = COALESCE(goods_issue_number, ?) WHERE shipment_id = ?").run(
        timestamp,
        `GI-${shipment.shipmentId.replace("SHIP-", "")}`,
        shipment.shipmentId
      );
      db.prepare("UPDATE transport_legs SET transport_status = 'departed', actual_departure = COALESCE(actual_departure, ?), last_updated_at = ? WHERE shipment_id = ?").run(
        timestamp,
        timestamp,
        shipment.shipmentId
      );
      db.prepare("UPDATE dock_appointments SET status = 'completed', actual_dock_out = COALESCE(actual_dock_out, ?), actual_gate_out = COALESCE(actual_gate_out, ?), last_updated_at = ? WHERE reference_id = ?").run(
        timestamp,
        timestamp,
        timestamp,
        shipment.shipmentId
      );
      db.prepare("UPDATE docks SET status = 'available', current_shipment_id = NULL WHERE id = ? AND current_shipment_id = ?").run(shipment.dock, shipment.shipmentId);
      db.prepare("UPDATE dock_schedule SET status = 'complete' WHERE shipment_id = ?").run(shipment.shipmentId);
    }

    const processStep: Record<string, string> = {
      Allocated: "FEFO_ALLOCATED",
      Picking: "PICKING_STARTED",
      Packed: "PACK_CONFIRMED",
      Staged: "STAGED",
      Dispatched: "GOODS_ISSUE_POSTED"
    };
    db.prepare(
      `INSERT INTO warehouse_operational_events
       (event_id, timestamp, process, direction, step, status, source_system, actor, reference_type, reference_id,
        asn_id, shipment_id, transport_leg_id, dock_appointment_id, site_id, dock_id, location_id, description,
        exception_code, metadata_json)
       VALUES (?, ?, 'outbound', 'outbound', ?, 'completed', 'WMS', 'Realtime WMS', 'Outbound Shipment', ?,
        NULL, ?, ?, ?, NULL, ?, NULL, ?, NULL, ?)`
    ).run(
      `EVT-LIVE-${shipment.shipmentId}-${newStatus}-${Date.now()}`,
      timestamp,
      processStep[newStatus] ?? "EXCEPTION_RECORDED",
      shipment.shipmentId,
      shipment.shipmentId,
      shipment.transportLegId,
      shipment.dockAppointmentId,
      shipment.dock,
      `${shipment.shipmentId} advanced from ${previousStatus} to ${newStatus}.`,
      JSON.stringify({ previousStatus, newStatus, automated: true })
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  io.emit("shipment:status_change", { shipmentId: shipment.shipmentId, previousStatus, newStatus, timestamp });
  io.emit("dashboard:state_update", { updatedSKUs: [], updatedDocks: [shipment.dock], updatedShipments: [shipment.shipmentId], timestamp });
}

export function startRealtime(io: Server) {
  setInterval(() => {
    const zones = getZones();
    const skus = getInventoryPlacements();
    temperatureTick += 1;
    zones.forEach((zone) => {
      const temp = simulatedTemperature(zone.id);
      const withinBand = temp >= zone.temperatureMin && temp <= zone.temperatureMax;
      const variance = calculateVariance({ temperature: temp, allowedMin: zone.temperatureMin, allowedMax: zone.temperatureMax });
      const status = withinBand ? "normal" : variance > 1 ? "critical" : "warn";
      const zoneSkus = withinBand ? [] : skus.filter((sku) => sku.zoneId === zone.id).slice(0, 2);
      const relatedSkuIds = zoneSkus.map((placement) => placement.stockBalanceId);
      const relatedBatchIds = zoneSkus.map((sku) => sku.batchId ?? sku.batchNo);
      const timestamp = nowIso();
      db.prepare("UPDATE zones SET current_temperature = ?, status = ? WHERE id = ?").run(temp, status, zone.id);
      db.prepare(
        `INSERT INTO temperature_readings
         (zone_id, temperature, timestamp, within_band, allowed_min, allowed_max, sensor_id, related_sku_ids_json, related_batch_ids_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        zone.id,
        temp,
        timestamp,
        withinBand ? 1 : 0,
        zone.temperatureMin,
        zone.temperatureMax,
        `${zone.id}-TEMP-01`,
        JSON.stringify(relatedSkuIds),
        JSON.stringify(relatedBatchIds)
      );
      io.emit("temperature:update", {
        zoneId: zone.id,
        temp,
        timestamp,
        withinBand,
        allowedMin: zone.temperatureMin,
        allowedMax: zone.temperatureMax,
        sensorId: `${zone.id}-TEMP-01`,
        relatedSkuIds,
        relatedBatchIds
      });
    });
    const alertsChanged = checkTemperatureAlerts(io);
    const issuesChanged = syncOperationalIssueLifecycle();
    if (alertsChanged || issuesChanged) {
      io.emit("dashboard:state_update", { updatedSKUs: [], updatedDocks: [], updatedShipments: [], timestamp: nowIso() });
    }
  }, 5000);

  const emitRfid = () => {
    const skus = getInventoryPlacements();
    if (skus.length === 0) return;
    const sku = skus[Math.floor(Math.random() * skus.length)];
    const action = actions[Math.floor(Math.random() * actions.length)];
    const severity = sku.qualityStatus === "QA Hold" || sku.qualityStatus === "Quarantine" ? "warn" : "info";
    const result = db
      .prepare("INSERT INTO rfid_events (sku_id, zone_id, action, timestamp, severity) VALUES (?, ?, ?, ?, ?)")
      .run(sku.stockBalanceId, sku.zoneId, action, nowIso(), severity);
    io.emit("iot:rfid_scan", {
      id: Number(result.lastInsertRowid),
      skuId: sku.stockBalanceId,
      zoneId: sku.zoneId,
      action,
      timestamp: nowIso(),
      severity
    });
    setTimeout(emitRfid, 3000 + Math.random() * 5000);
  };
  setTimeout(emitRfid, 2500);

  setInterval(() => {
    const snapshot = getWarehouseSnapshot();
    let anyResolved = false;

    const expiryCutoff = Date.now() + 48 * 60 * 60_000;
    const expirySkus = snapshot.inventoryPlacements.filter((sku) => new Date(sku.expiryDate).getTime() <= expiryCutoff && sku.currentStage !== "Dispatch").slice(0, 2);
    anyResolved =
      reconcileAlerts(
        (message) => (message.startsWith("SKU ") || message.startsWith("Stock balance ")) && message.includes("expires within 48 hours"),
        new Set(expirySkus.map((placement) => `Stock balance ${placement.stockBalanceId} expires within 48 hours and is not dispatched.`))
      ) || anyResolved;
    expirySkus.forEach((sku) => {
      emitAlert(
        io,
        createAlert({
          severity: "critical",
          message: `Stock balance ${sku.stockBalanceId} expires within 48 hours and is not dispatched.`,
          sourceAgent: "Inventory",
          affectedIds: [sku.stockBalanceId, sku.linkedShipmentId ?? ""].filter(Boolean)
        })
      );
    });

    // Temperature-based alerts are handled on the 5s cadence above via checkTemperatureAlerts,
    // not here — see its comment for why the faster interval is required.

    const unresolvedAppointments = snapshot.dockAppointments
      .filter((appointment) => new Date(appointment.scheduledEnd).getTime() < Date.now() && !["completed", "cancelled"].includes(appointment.status));
    const dockAlertMessage = (appointment: (typeof unresolvedAppointments)[number]) => {
      if (["checked_in", "at_dock", "loading", "unloading"].includes(appointment.status)) {
        return `Dock ${appointment.dockId} remains occupied beyond the scheduled window for ${appointment.referenceId}.`;
      }
      if (appointment.status === "exception") {
        return `Dock ${appointment.dockId} appointment exception remains open for ${appointment.referenceId}.`;
      }
      return `Dock ${appointment.dockId} appointment window was missed for ${appointment.referenceId}.`;
    };
    anyResolved =
      reconcileAlerts(
        (message) => message.startsWith("Dock ") && (
          message.includes("occupied beyond the scheduled window")
          || message.includes("appointment exception remains open")
          || message.includes("appointment window was missed")
          || message.includes("may be occupied beyond scheduled window")
        ),
        new Set(unresolvedAppointments.map(dockAlertMessage))
      ) || anyResolved;
    unresolvedAppointments.forEach((appointment) => {
      emitAlert(
        io,
        createAlert({
          severity: "warn",
          message: dockAlertMessage(appointment),
          sourceAgent: "Logistics",
          affectedIds: [appointment.dockId, appointment.referenceId, appointment.dockAppointmentId]
        })
      );
    });

    const fefoBelowThreshold = snapshot.kpis.fefoCompliance < 85;
    anyResolved =
      reconcileAlerts(
        (message) => message.startsWith("FEFO compliance score is"),
        fefoBelowThreshold ? new Set([`FEFO compliance score is ${snapshot.kpis.fefoCompliance}%, below the 85% threshold.`]) : new Set()
      ) || anyResolved;
    if (fefoBelowThreshold) {
      emitAlert(
        io,
        createAlert({
          severity: "warn",
          message: `FEFO compliance score is ${snapshot.kpis.fefoCompliance}%, below the 85% threshold.`,
          sourceAgent: "Inventory",
          affectedIds: snapshot.inventoryPlacements.slice(0, 4).map((placement) => placement.stockBalanceId)
        })
      );
    }

    const activeOutbound = new Map(snapshot.inventory.outboundShipments
      .filter((shipment) => !["Dispatched", "Delivered"].includes(shipment.outboundStatus))
      .map((shipment) => [shipment.shipmentId, shipment]));
    const qaHoldSkus = snapshot.inventoryPlacements
      .filter((sku) => sku.qualityStatus === "QA Hold")
      .flatMap((sku) => snapshot.inventory.outboundLines
        .filter((line) => line.batchId === sku.batchId && activeOutbound.has(line.shipmentId))
        .map((line) => ({ sku, shipmentId: line.shipmentId })))
      .slice(0, 4);
    anyResolved =
      reconcileAlerts(
        (message) => message.startsWith("QA Hold stock ") && message.includes("is assigned to active shipment"),
        new Set(qaHoldSkus.map(({ sku, shipmentId }) => `QA Hold stock ${sku.stockBalanceId} is assigned to active shipment ${shipmentId}.`))
      ) || anyResolved;
    qaHoldSkus.forEach(({ sku, shipmentId }) => {
      emitAlert(
        io,
        createAlert({
          severity: "critical",
          message: `QA Hold stock ${sku.stockBalanceId} is assigned to active shipment ${shipmentId}.`,
          sourceAgent: "Compliance",
          affectedIds: [sku.stockBalanceId, shipmentId]
        })
      );
    });

    // If something resolved but nothing new fired this tick, still push a refresh so the client
    // sees the alert disappear promptly instead of waiting for the next unrelated update.
    if (anyResolved) {
      io.emit("dashboard:state_update", { updatedSKUs: [], updatedDocks: [], updatedShipments: [], timestamp: nowIso() });
    }
  }, 30000);

  // Warehouse execution should normally advance from controlled scans or external WMS actions. The accelerated
  // timer is retained only as an explicit demo option so a normal session does not silently run
  // every delivery to completion and drift away from its dock/transport records.
  const staticOperationsPoc = process.env.POC_STATIC_OPERATIONS !== "false";
  if (!staticOperationsPoc && process.env.AUTO_ADVANCE_SHIPMENTS === "true") {
    setInterval(() => advanceShipments(io), 25000);
  }
}
