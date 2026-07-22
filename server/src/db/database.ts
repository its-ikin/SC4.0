import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getTemperatureEvents as buildTemperatureEvents,
  inboundScheduleAdherence,
  outboundScheduleAdherence
} from "@twinops/shared";
import { fallbackAgentResponse } from "../agentResponse";
import type {
  AiDecision,
  Alert,
  Batch,
  BatchDetail,
  BatchStockPosition,
  Dock,
  DockAppointment,
  DockSchedule,
  InboundRoute,
  InboundLine,
  InboundShipment,
  InventoryData,
  InventoryMovement,
  InventorySummary,
  LatLng,
  LogisticsData,
  OutboundLine,
  OutboundShipment,
  PartnerSite,
  Product,
  ProductStockPosition,
  RfidEvent,
  RouteCacheSource,
  RouteStatus,
  Shipment,
  InventoryPlacement,
  StockBalance,
  TemperatureEvent,
  TemperatureReading,
  TransportDirection,
  TransportLeg,
  WarehouseOperationalEvent,
  WarehouseLocation,
  WarehouseSnapshot,
  Zone
} from "@twinops/shared";
import {
  getRouteConfig,
  INBOUND_ROUTE_CONFIGS,
  PARTNER_SITE_CONFIGS,
  SIMULATION_DISCLOSURE,
  TRANSPORT_ROUTE_CONFIGS,
  WAREHOUSE_SITE_ID
} from "../routeData";
import { validateRouteGeometry } from "../routeGeometry";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = resolve(__dirname, "../../db/twinops.sqlite");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA foreign_keys = ON");

const json = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const nowIso = () => new Date().toISOString();
export const addMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
export const addHours = (hours: number) => addMinutes(hours * 60);
export const addDays = (days: number) => addHours(days * 24);

export function normaliseRouteStatus(value: unknown): RouteStatus {
  const text = String(value ?? "on-time").toLowerCase();
  if (text.includes("disrupt") || text === "critical") return "disrupted";
  if (text.includes("delay") || text === "warn" || text === "warning") return "delayed";
  return "on-time";
}

function normaliseCacheSource(value: unknown): RouteCacheSource {
  if (value === "ors" || value === "openrouteservice") return "ors";
  if (value === "osrm") return "osrm";
  return "fallback";
}

function hasColumn(table: string, column: string) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row: any) => row.name === column);
}

function ensureColumn(table: string, column: string, definition: string) {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureInboundRouteColumns() {
  ensureColumn("inbound_routes", "origin_type", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("inbound_routes", "origin_lat", "REAL NOT NULL DEFAULT 0");
  ensureColumn("inbound_routes", "origin_lng", "REAL NOT NULL DEFAULT 0");
  ensureColumn("inbound_routes", "destination_lat", "REAL NOT NULL DEFAULT 0");
  ensureColumn("inbound_routes", "destination_lng", "REAL NOT NULL DEFAULT 0");
  ensureColumn("inbound_routes", "encoded_polyline", "TEXT");
  ensureColumn("inbound_routes", "polyline_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("inbound_routes", "distance_km", "REAL NOT NULL DEFAULT 0");
  ensureColumn("inbound_routes", "cold_chain_required", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("inbound_routes", "risk_note", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("inbound_routes", "receiving_impact", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("inbound_routes", "mitigation_suggestion", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("inbound_routes", "last_computed_at", "TEXT");
  ensureColumn("inbound_routes", "cache_source", "TEXT NOT NULL DEFAULT 'fallback'");
}

function ensureTemperatureReadingColumns() {
  ensureColumn("temperature_readings", "allowed_min", "REAL");
  ensureColumn("temperature_readings", "allowed_max", "REAL");
  ensureColumn("temperature_readings", "sensor_id", "TEXT");
  ensureColumn("temperature_readings", "related_sku_ids_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("temperature_readings", "related_batch_ids_json", "TEXT NOT NULL DEFAULT '[]'");
}

function ensureAiDecisionColumns() {
  ensureColumn("ai_decisions", "structured_response_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("ai_decisions", "fallback_used", "INTEGER NOT NULL DEFAULT 0");
}

function ensureProductReplenishmentColumns() {
  ensureColumn("products", "safety_stock", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("products", "reorder_point", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("products", "target_stock", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("products", "lead_time_days", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("products", "average_daily_demand", "REAL NOT NULL DEFAULT 0");
  db.exec(`
    UPDATE products SET
      safety_stock = CASE product_family WHEN 'Vaccine' THEN 100 WHEN 'Biologic' THEN 80 WHEN 'Packaging' THEN 180 ELSE 120 END,
      reorder_point = CASE product_family WHEN 'Vaccine' THEN 180 WHEN 'Biologic' THEN 150 WHEN 'Packaging' THEN 320 ELSE 220 END,
      target_stock = CASE product_family WHEN 'Vaccine' THEN 420 WHEN 'Biologic' THEN 360 WHEN 'Packaging' THEN 800 ELSE 520 END,
      lead_time_days = CASE product_family WHEN 'Vaccine' THEN 5 WHEN 'Biologic' THEN 7 WHEN 'Packaging' THEN 3 ELSE 4 END,
      average_daily_demand = CASE product_family WHEN 'Vaccine' THEN 16 WHEN 'Biologic' THEN 10 WHEN 'Packaging' THEN 45 ELSE 25 END
    WHERE reorder_point = 0
  `);
}

function ensureWmsMasterDataColumns() {
  ensureColumn("products", "gtin", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("products", "manufacturer", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("products", "dosage_form", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("products", "strength", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("products", "pack_size", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("batches", "sto_number", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("batches", "goods_receipt_number", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("batches", "arrival_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("batches", "putaway_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("batches", "handling_unit", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("batches", "inspection_lot", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("batches", "country_of_origin", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("batches", "last_cycle_count_at", "TEXT NOT NULL DEFAULT ''");
}

function ensureShipmentOperationsColumns() {
  ensureColumn("inbound_shipments", "purchase_order_id", "TEXT");
  ensureColumn("inbound_shipments", "supplier_site_id", "TEXT");
  ensureColumn("inbound_shipments", "transport_leg_id", "TEXT");
  ensureColumn("inbound_shipments", "dock_appointment_id", "TEXT");
  ensureColumn("inbound_shipments", "planned_arrival", "TEXT");
  ensureColumn("inbound_shipments", "actual_arrival", "TEXT");
  ensureColumn("inbound_shipments", "goods_receipt_number", "TEXT");
  ensureColumn("inbound_shipments", "vehicle_id", "TEXT");
  ensureColumn("inbound_shipments", "seal_number", "TEXT");

  ensureColumn("outbound_shipments", "customer_order_id", "TEXT");
  ensureColumn("outbound_shipments", "delivery_id", "TEXT");
  ensureColumn("outbound_shipments", "customer_site_id", "TEXT");
  ensureColumn("outbound_shipments", "transport_leg_id", "TEXT");
  ensureColumn("outbound_shipments", "dock_appointment_id", "TEXT");
  ensureColumn("outbound_shipments", "planned_departure", "TEXT");
  ensureColumn("outbound_shipments", "actual_departure", "TEXT");
  ensureColumn("outbound_shipments", "delivery_window_start", "TEXT");
  ensureColumn("outbound_shipments", "delivery_window_end", "TEXT");
  ensureColumn("outbound_shipments", "goods_issue_number", "TEXT");
  ensureColumn("outbound_shipments", "proof_of_delivery_id", "TEXT");
  ensureColumn("outbound_shipments", "vehicle_id", "TEXT");
  ensureColumn("outbound_shipments", "seal_number", "TEXT");
}

function relocateRestrictedStockToControlledAreas() {
  const restricted = db.prepare(`
    SELECT sb.stock_balance_id, sb.location_id, sb.qty_on_hand, b.batch_id, b.product_id,
      b.quality_status, b.temp_band, wl.zone AS current_zone
    FROM stock_balances sb
    JOIN batches b ON b.batch_id = sb.batch_id
    JOIN warehouse_locations wl ON wl.location_id = sb.location_id
    WHERE (b.quality_status IN ('QA Hold', 'Pending QA') AND (
             (b.temp_band LIKE '2-8%' AND wl.zone != 'QA Cold Hold')
          OR (b.temp_band NOT LIKE '2-8%' AND wl.zone != 'QA Hold')
          ))
       OR (b.quality_status = 'Quarantine' AND wl.zone != 'Quarantine')
    ORDER BY sb.stock_balance_id
  `).all() as Array<{
    stock_balance_id: string;
    location_id: string;
    qty_on_hand: number;
    batch_id: string;
    product_id: string;
    quality_status: string;
    temp_band: string;
    current_zone: string;
  }>;
  if (!restricted.length) return;

  const insertLocation = db.prepare(`
    INSERT OR IGNORE INTO warehouse_locations
      (location_id, zone, rack, bin, temp_band, capacity, current_fill)
    VALUES (@locationId, @zone, @rack, @bin, @tempBand, @capacity, 0)
  `);
  const moveBalance = db.prepare(`
    UPDATE stock_balances
    SET location_id = @locationId, last_updated = @timestamp
    WHERE stock_balance_id = @stockBalanceId
  `);
  const recordMovement = db.prepare(`
    INSERT OR IGNORE INTO inventory_movements
      (movement_id, timestamp, movement_type, product_id, batch_id, from_location_id,
       to_location_id, qty, reference_type, reference_id, user_or_system, note)
    VALUES (@movementId, @timestamp, @movementType, @productId, @batchId, @fromLocationId,
      @toLocationId, @qty, 'Quality Disposition', @stockBalanceId, 'WMS migration', @note)
  `);
  let qaIndex = 1;
  let quarantineIndex = 1;
  const timestamp = nowIso();

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of restricted) {
      const quarantine = row.quality_status === "Quarantine";
      const sequence = quarantine ? quarantineIndex++ : qaIndex++;
      const suffix = String(sequence).padStart(2, "0");
      const coldHold = !quarantine && row.temp_band.startsWith("2-8");
      const locationId = quarantine ? `QT-${suffix}` : coldHold ? `QA-COLD-${suffix}` : `QA-HOLD-${suffix}`;
      const zone = quarantine ? "Quarantine" : coldHold ? "QA Cold Hold" : "QA Hold";
      const rack = quarantine ? "QT" : coldHold ? "QAC" : "QA";
      const bin = `${quarantine ? "Q" : coldHold ? "C" : "H"}${suffix}`;
      insertLocation.run({
        locationId,
        zone,
        rack,
        bin,
        tempBand: row.temp_band,
        capacity: Math.max(coldHold ? 220 : 480, row.qty_on_hand)
      });
      moveBalance.run({ locationId, timestamp, stockBalanceId: row.stock_balance_id });
      recordMovement.run({
        movementId: `MOV-CONTROLLED-${row.stock_balance_id}`,
        timestamp,
        movementType: quarantine ? "Quarantine" : "QA Hold",
        productId: row.product_id,
        batchId: row.batch_id,
        fromLocationId: row.location_id,
        toLocationId: locationId,
        qty: row.qty_on_hand,
        stockBalanceId: row.stock_balance_id,
        note: `${row.quality_status} stock relocated from ${row.current_zone} to its controlled warehouse area.`
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyInboundRouteDefaults() {
  const updateRoute = db.prepare(`
    UPDATE inbound_routes
    SET
      origin = @origin,
      origin_type = @originType,
      destination = @destination,
      origin_lat = @originLat,
      origin_lng = @originLng,
      destination_lat = @destinationLat,
      destination_lng = @destinationLng,
      base_eta_minutes = @baseEtaMinutes,
      expected_skus_json = @expectedSkusJson,
      cold_chain_required = @coldChainRequired,
      risk_note = @riskNote,
      receiving_impact = @receivingImpact,
      mitigation_suggestion = @mitigationSuggestion,
      polyline_json = CASE
        WHEN polyline_json IS NULL OR polyline_json = '' OR polyline_json = '[]' THEN @polylineJson
        ELSE polyline_json
      END,
      distance_km = CASE
        WHEN distance_km IS NULL OR distance_km <= 0 THEN @distanceKm
        ELSE distance_km
      END,
      cache_source = CASE
        WHEN cache_source IS NULL OR cache_source = '' THEN 'fallback'
        WHEN cache_source = 'openrouteservice' THEN 'ors'
        WHEN cache_source NOT IN ('ors', 'osrm', 'fallback') THEN 'fallback'
        ELSE cache_source
      END
    WHERE id = @id
  `);

  for (const route of INBOUND_ROUTE_CONFIGS) {
    updateRoute.run({
      id: route.id,
      origin: route.origin,
      originType: route.originType,
      destination: route.destination,
      originLat: route.originLocation.lat,
      originLng: route.originLocation.lng,
      destinationLat: route.destinationLocation.lat,
      destinationLng: route.destinationLocation.lng,
      baseEtaMinutes: route.baseEtaMinutes,
      expectedSkusJson: JSON.stringify(route.expectedSkus),
      coldChainRequired: route.coldChainRequired ? 1 : 0,
      riskNote: route.riskNote,
      receivingImpact: route.receivingImpact,
      mitigationSuggestion: route.mitigationSuggestion,
      polylineJson: JSON.stringify(route.fallbackPolyline),
      distanceKm: route.distanceKm
    });
  }

  db.prepare("UPDATE inbound_routes SET status = lower(status) WHERE status != lower(status)").run();
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      temperature_min REAL NOT NULL,
      temperature_max REAL NOT NULL,
      capacity_units INTEGER NOT NULL,
      current_temperature REAL NOT NULL,
      fill_percent REAL NOT NULL,
      status TEXT NOT NULL,
      product_types TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skus (
      id TEXT PRIMARY KEY,
      product_name TEXT NOT NULL,
      category TEXT NOT NULL,
      zone_id TEXT NOT NULL,
      rack TEXT NOT NULL,
      bin TEXT NOT NULL,
      batch_no TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      priority TEXT NOT NULL,
      temperature_min REAL NOT NULL,
      temperature_max REAL NOT NULL,
      reg_field TEXT NOT NULL,
      quality_status TEXT NOT NULL,
      linked_shipment_id TEXT,
      current_stage TEXT NOT NULL,
      dispatch_sequence INTEGER NOT NULL,
      FOREIGN KEY (zone_id) REFERENCES zones(id)
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      destination TEXT NOT NULL,
      priority TEXT NOT NULL,
      dock_id TEXT NOT NULL,
      dispatch_time TEXT NOT NULL,
      status TEXT NOT NULL,
      sku_ids_json TEXT NOT NULL,
      cold_chain_required INTEGER NOT NULL,
      sla_deadline TEXT NOT NULL,
      quality_flags_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS docks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      current_shipment_id TEXT,
      next_available_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dock_schedule (
      id TEXT PRIMARY KEY,
      dock_id TEXT NOT NULL,
      shipment_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL,
      conflict_flag INTEGER NOT NULL,
      FOREIGN KEY (dock_id) REFERENCES docks(id)
    );

    CREATE TABLE IF NOT EXISTS inbound_routes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      origin TEXT NOT NULL,
      origin_type TEXT NOT NULL DEFAULT '',
      origin_lat REAL NOT NULL DEFAULT 0,
      origin_lng REAL NOT NULL DEFAULT 0,
      destination TEXT NOT NULL,
      destination_lat REAL NOT NULL DEFAULT 0,
      destination_lng REAL NOT NULL DEFAULT 0,
      eta_minutes INTEGER NOT NULL,
      base_eta_minutes INTEGER NOT NULL,
      status TEXT NOT NULL,
      expected_skus_json TEXT NOT NULL,
      cold_chain_required INTEGER NOT NULL DEFAULT 0,
      disruption_type TEXT,
      risk_level TEXT NOT NULL,
      risk_note TEXT NOT NULL DEFAULT '',
      receiving_impact TEXT NOT NULL DEFAULT '',
      mitigation_suggestion TEXT NOT NULL DEFAULT '',
      encoded_polyline TEXT,
      polyline_json TEXT NOT NULL DEFAULT '[]',
      distance_km REAL NOT NULL DEFAULT 0,
      last_computed_at TEXT,
      cache_source TEXT NOT NULL DEFAULT 'fallback'
    );

    CREATE TABLE IF NOT EXISTS temperature_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_id TEXT NOT NULL,
      temperature REAL NOT NULL,
      timestamp TEXT NOT NULL,
      within_band INTEGER NOT NULL,
      allowed_min REAL,
      allowed_max REAL,
      sensor_id TEXT,
      related_sku_ids_json TEXT NOT NULL DEFAULT '[]',
      related_batch_ids_json TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (zone_id) REFERENCES zones(id)
    );

    CREATE TABLE IF NOT EXISTS rfid_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku_id TEXT NOT NULL,
      zone_id TEXT NOT NULL,
      action TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      severity TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      source_agent TEXT NOT NULL,
      affected_ids_json TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operational_issues (
      issue_id TEXT PRIMARY KEY,
      lifecycle_status TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resolved_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      current_issue_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operational_issue_events (
      event_id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      revision INTEGER NOT NULL,
      previous_issue_json TEXT,
      current_issue_json TEXT,
      reason TEXT NOT NULL,
      FOREIGN KEY (issue_id) REFERENCES operational_issues(issue_id)
    );

    CREATE TABLE IF NOT EXISTS ai_decisions (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      query TEXT NOT NULL,
      narrative TEXT NOT NULL,
      structured_response_json TEXT NOT NULL DEFAULT '{}',
      fallback_used INTEGER NOT NULL DEFAULT 0,
      agents_used_json TEXT NOT NULL,
      tools_called_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      risk_level TEXT NOT NULL,
      action_payload_json TEXT NOT NULL,
      decision_evidence_json TEXT NOT NULL,
      requires_approval INTEGER NOT NULL,
      approval_status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approval_actions (
      id TEXT PRIMARY KEY,
      decision_id TEXT,
      action_id TEXT NOT NULL UNIQUE,
      action_type TEXT NOT NULL,
      before_snapshot_json TEXT NOT NULL,
      after_snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL,
      approved_at TEXT,
      rejected_at TEXT,
      user_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS scenario_snapshots (
      id TEXT PRIMARY KEY,
      decision_id TEXT,
      scenario_type TEXT NOT NULL,
      before_state_json TEXT NOT NULL,
      after_state_json TEXT NOT NULL,
      risk_delta_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      product_id TEXT PRIMARY KEY,
      product_code TEXT NOT NULL UNIQUE,
      product_name TEXT NOT NULL,
      product_family TEXT NOT NULL,
      default_temp_band TEXT NOT NULL,
      storage_class TEXT NOT NULL,
      unit_type TEXT NOT NULL,
      safety_stock INTEGER NOT NULL DEFAULT 0,
      reorder_point INTEGER NOT NULL DEFAULT 0,
      target_stock INTEGER NOT NULL DEFAULT 0,
      lead_time_days INTEGER NOT NULL DEFAULT 0,
      average_daily_demand REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS batches (
      batch_id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      lot_code TEXT NOT NULL UNIQUE,
      expiry_date TEXT NOT NULL,
      manufacture_date TEXT,
      quality_status TEXT NOT NULL,
      temp_band TEXT NOT NULL,
      serialization_status TEXT,
      notes TEXT,
      FOREIGN KEY (product_id) REFERENCES products(product_id)
    );

    CREATE TABLE IF NOT EXISTS warehouse_locations (
      location_id TEXT PRIMARY KEY,
      zone TEXT NOT NULL,
      rack TEXT NOT NULL,
      bin TEXT NOT NULL,
      temp_band TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      current_fill INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stock_balances (
      stock_balance_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      qty_on_hand INTEGER NOT NULL,
      qty_available INTEGER NOT NULL,
      qty_reserved INTEGER NOT NULL,
      qty_picked INTEGER NOT NULL,
      qty_packed INTEGER NOT NULL,
      qty_staged INTEGER NOT NULL,
      qty_dispatched INTEGER NOT NULL,
      qty_on_hold INTEGER NOT NULL,
      last_updated TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES batches(batch_id),
      FOREIGN KEY (location_id) REFERENCES warehouse_locations(location_id)
    );

    CREATE TABLE IF NOT EXISTS inbound_shipments (
      asn_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      route_name TEXT NOT NULL,
      eta TEXT NOT NULL,
      receiving_dock TEXT NOT NULL,
      inbound_status TEXT NOT NULL,
      cold_chain_status TEXT NOT NULL,
      linked_route_id TEXT
    );

    CREATE TABLE IF NOT EXISTS inbound_lines (
      inbound_line_id TEXT PRIMARY KEY,
      asn_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      qty_expected INTEGER NOT NULL,
      qty_received INTEGER NOT NULL,
      temp_band TEXT NOT NULL,
      receiving_status TEXT NOT NULL,
      qa_status TEXT NOT NULL,
      FOREIGN KEY (asn_id) REFERENCES inbound_shipments(asn_id),
      FOREIGN KEY (product_id) REFERENCES products(product_id),
      FOREIGN KEY (batch_id) REFERENCES batches(batch_id)
    );

    CREATE TABLE IF NOT EXISTS outbound_shipments (
      shipment_id TEXT PRIMARY KEY,
      destination TEXT NOT NULL,
      required_by TEXT NOT NULL,
      dock TEXT NOT NULL,
      outbound_status TEXT NOT NULL,
      priority_level TEXT,
      route_id TEXT
    );

    CREATE TABLE IF NOT EXISTS outbound_lines (
      outbound_line_id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      qty_required INTEGER NOT NULL,
      qty_allocated INTEGER NOT NULL,
      qty_picked INTEGER NOT NULL,
      qty_packed INTEGER NOT NULL,
      qty_dispatched INTEGER NOT NULL,
      allocation_status TEXT NOT NULL,
      FOREIGN KEY (shipment_id) REFERENCES outbound_shipments(shipment_id),
      FOREIGN KEY (product_id) REFERENCES products(product_id),
      FOREIGN KEY (batch_id) REFERENCES batches(batch_id)
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      movement_id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      product_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      from_location_id TEXT,
      to_location_id TEXT,
      qty INTEGER NOT NULL,
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      user_or_system TEXT NOT NULL,
      note TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(product_id),
      FOREIGN KEY (batch_id) REFERENCES batches(batch_id)
    );

    CREATE TABLE IF NOT EXISTS partner_sites (
      site_id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      partner_name TEXT NOT NULL,
      site_code TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      address TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country_code TEXT NOT NULL,
      timezone TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      receiving_window TEXT NOT NULL,
      temperature_capabilities_json TEXT NOT NULL,
      vehicle_restrictions_json TEXT NOT NULL,
      simulated INTEGER NOT NULL DEFAULT 1,
      public_location_reference TEXT,
      data_notice TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transport_legs (
      transport_leg_id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL UNIQUE,
      direction TEXT NOT NULL,
      asn_id TEXT,
      shipment_id TEXT,
      origin_site_id TEXT NOT NULL,
      destination_site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      origin_type TEXT NOT NULL,
      expected_skus_json TEXT NOT NULL DEFAULT '[]',
      carrier_id TEXT NOT NULL,
      carrier_name TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      license_plate TEXT NOT NULL,
      driver_id TEXT,
      planned_departure TEXT NOT NULL,
      actual_departure TEXT,
      planned_arrival TEXT NOT NULL,
      actual_arrival TEXT,
      estimated_arrival TEXT NOT NULL,
      delivery_window_start TEXT,
      delivery_window_end TEXT,
      dock_appointment_id TEXT NOT NULL,
      temperature_requirement TEXT NOT NULL,
      temperature_min REAL,
      temperature_max REAL,
      temperature_status TEXT NOT NULL,
      temperature_logger_id TEXT,
      transport_status TEXT NOT NULL,
      route_status TEXT NOT NULL,
      distance_km REAL NOT NULL,
      base_duration_minutes INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      disruption_type TEXT,
      risk_level TEXT NOT NULL,
      risk_note TEXT NOT NULL,
      receiving_impact TEXT NOT NULL,
      mitigation_suggestion TEXT NOT NULL,
      encoded_polyline TEXT,
      polyline_json TEXT NOT NULL DEFAULT '[]',
      last_known_location_json TEXT,
      last_computed_at TEXT,
      cache_source TEXT NOT NULL DEFAULT 'fallback',
      seal_number TEXT,
      proof_of_delivery_id TEXT,
      last_updated_at TEXT NOT NULL,
      FOREIGN KEY (origin_site_id) REFERENCES partner_sites(site_id),
      FOREIGN KEY (destination_site_id) REFERENCES partner_sites(site_id)
    );

    CREATE TABLE IF NOT EXISTS dock_appointments (
      dock_appointment_id TEXT PRIMARY KEY,
      dock_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      transport_leg_id TEXT NOT NULL UNIQUE,
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      scheduled_start TEXT NOT NULL,
      scheduled_end TEXT NOT NULL,
      actual_gate_in TEXT,
      actual_dock_in TEXT,
      actual_dock_out TEXT,
      actual_gate_out TEXT,
      status TEXT NOT NULL,
      carrier_id TEXT NOT NULL,
      carrier_name TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      license_plate TEXT NOT NULL,
      temperature_requirement TEXT NOT NULL,
      conflict_flag INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      last_updated_at TEXT NOT NULL,
      FOREIGN KEY (transport_leg_id) REFERENCES transport_legs(transport_leg_id)
    );

    CREATE TABLE IF NOT EXISTS warehouse_operational_events (
      event_id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      process TEXT NOT NULL,
      direction TEXT,
      step TEXT NOT NULL,
      status TEXT NOT NULL,
      source_system TEXT NOT NULL,
      actor TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      asn_id TEXT,
      shipment_id TEXT,
      transport_leg_id TEXT,
      dock_appointment_id TEXT,
      site_id TEXT,
      dock_id TEXT,
      location_id TEXT,
      description TEXT NOT NULL,
      exception_code TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_batches_product_id ON batches(product_id);
    CREATE INDEX IF NOT EXISTS idx_stock_balances_batch_id ON stock_balances(batch_id);
    CREATE INDEX IF NOT EXISTS idx_inbound_lines_asn_id ON inbound_lines(asn_id);
    CREATE INDEX IF NOT EXISTS idx_outbound_lines_shipment_id ON outbound_lines(shipment_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_batch_id ON inventory_movements(batch_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference ON inventory_movements(reference_type, reference_id);
    CREATE INDEX IF NOT EXISTS idx_operational_issue_events_issue_id ON operational_issue_events(issue_id);
    CREATE INDEX IF NOT EXISTS idx_operational_issue_events_timestamp ON operational_issue_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_transport_legs_direction ON transport_legs(direction);
    CREATE INDEX IF NOT EXISTS idx_transport_legs_asn_id ON transport_legs(asn_id);
    CREATE INDEX IF NOT EXISTS idx_transport_legs_shipment_id ON transport_legs(shipment_id);
    CREATE INDEX IF NOT EXISTS idx_dock_appointments_schedule ON dock_appointments(dock_id, scheduled_start);
    CREATE INDEX IF NOT EXISTS idx_warehouse_operational_events_reference ON warehouse_operational_events(reference_type, reference_id);
    CREATE INDEX IF NOT EXISTS idx_warehouse_operational_events_transport ON warehouse_operational_events(transport_leg_id, timestamp);
  `);

  ensureInboundRouteColumns();
  ensureTemperatureReadingColumns();
  ensureAiDecisionColumns();
  ensureProductReplenishmentColumns();
  ensureWmsMasterDataColumns();
  ensureShipmentOperationsColumns();
  applyInboundRouteDefaults();

  db.exec(`
    DROP TRIGGER IF EXISTS trg_legacy_inbound_route_to_transport_leg;
    CREATE TRIGGER trg_legacy_inbound_route_to_transport_leg
    AFTER UPDATE OF eta_minutes, status, disruption_type, risk_level, encoded_polyline, polyline_json,
      distance_km, last_computed_at, cache_source ON inbound_routes
    BEGIN
      UPDATE transport_legs
      SET duration_minutes = NEW.eta_minutes,
          route_status = lower(NEW.status),
          disruption_type = NEW.disruption_type,
          risk_level = NEW.risk_level,
          encoded_polyline = NEW.encoded_polyline,
          polyline_json = NEW.polyline_json,
          distance_km = NEW.distance_km,
          last_computed_at = NEW.last_computed_at,
          cache_source = NEW.cache_source,
          last_updated_at = COALESCE(NEW.last_computed_at, last_updated_at)
      WHERE route_id = NEW.id;
    END;

    DROP TRIGGER IF EXISTS trg_legacy_dock_schedule_to_appointment;
    CREATE TRIGGER trg_legacy_dock_schedule_to_appointment
    AFTER UPDATE OF dock_id, start_time, end_time, status, conflict_flag ON dock_schedule
    BEGIN
      UPDATE dock_appointments
      SET dock_id = NEW.dock_id,
          scheduled_start = NEW.start_time,
          scheduled_end = NEW.end_time,
          status = CASE
            WHEN lower(NEW.status) IN ('complete', 'completed') THEN 'completed'
            WHEN lower(NEW.status) = 'blocked' THEN 'exception'
            WHEN lower(NEW.status) IN ('loading', 'unloading', 'booked', 'checked_in', 'at_dock', 'missed', 'cancelled', 'exception') THEN lower(NEW.status)
            ELSE status
          END,
          conflict_flag = NEW.conflict_flag,
          last_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE reference_id = NEW.shipment_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_stock_balance_location_fill_insert
    AFTER INSERT ON stock_balances
    BEGIN
      UPDATE warehouse_locations
      SET current_fill = COALESCE((
        SELECT SUM(qty_on_hand) FROM stock_balances WHERE location_id = NEW.location_id
      ), 0)
      WHERE location_id = NEW.location_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_stock_balance_location_fill_update
    AFTER UPDATE OF qty_on_hand, location_id ON stock_balances
    BEGIN
      UPDATE warehouse_locations
      SET current_fill = COALESCE((
        SELECT SUM(qty_on_hand) FROM stock_balances WHERE location_id = OLD.location_id
      ), 0)
      WHERE location_id = OLD.location_id;

      UPDATE warehouse_locations
      SET current_fill = COALESCE((
        SELECT SUM(qty_on_hand) FROM stock_balances WHERE location_id = NEW.location_id
      ), 0)
      WHERE location_id = NEW.location_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_stock_balance_location_fill_delete
    AFTER DELETE ON stock_balances
    BEGIN
      UPDATE warehouse_locations
      SET current_fill = COALESCE((
        SELECT SUM(qty_on_hand) FROM stock_balances WHERE location_id = OLD.location_id
      ), 0)
      WHERE location_id = OLD.location_id;
    END;
  `);

  // Repair databases created before stock and location occupancy were synchronized.
  db.exec(`
    UPDATE warehouse_locations
    SET current_fill = COALESCE((
      SELECT SUM(sb.qty_on_hand)
      FROM stock_balances sb
      WHERE sb.location_id = warehouse_locations.location_id
    ), 0)
  `);
  // Existing demo databases may predate the temperature-controlled quality-hold cage. Insert it
  // only when a warehouse has already been seeded so an otherwise empty database stays empty.
  db.exec(`
    INSERT OR IGNORE INTO zones
      (id, name, code, temperature_min, temperature_max, capacity_units,
       current_temperature, fill_percent, status, product_types)
    SELECT 'QAC', 'QA Cold Hold', 'QAC', 2, 8, 220, 5.2, 0, 'normal',
           '["cold-chain quality hold","pending cold-chain release"]'
    WHERE EXISTS (SELECT 1 FROM zones WHERE id != 'QAC')
  `);
  relocateRestrictedStockToControlledAreas();
}

export function zoneFromRow(row: any): Zone {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    temperatureMin: row.temperature_min,
    temperatureMax: row.temperature_max,
    capacityUnits: row.capacity_units,
    currentTemperature: row.current_temperature,
    fillPercent: row.fill_percent,
    status: row.status,
    productTypes: json<string[]>(row.product_types, [])
  };
}

export function inventoryPlacementFromLegacyRow(row: any): InventoryPlacement {
  return {
    stockBalanceId: row.id,
    productName: row.product_name,
    category: row.category,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    rack: row.rack,
    bin: row.bin,
    locationId: row.location_id ?? undefined,
    batchNo: row.batch_no,
    expiryDate: row.expiry_date,
    quantity: row.quantity,
    priority: row.priority,
    temperatureMin: row.temperature_min,
    temperatureMax: row.temperature_max,
    regField: row.reg_field,
    qualityStatus: row.quality_status,
    linkedShipmentId: row.linked_shipment_id,
    currentStage: row.current_stage,
    dispatchSequence: row.dispatch_sequence
  };
}

export function shipmentFromRow(row: any): Shipment {
  const legacyStockBalanceIds = json<string[]>(row.sku_ids_json, []);
  return {
    id: row.id,
    destination: row.destination,
    priority: row.priority,
    dockId: row.dock_id,
    dispatchTime: row.dispatch_time,
    status: row.status,
    productIds: [],
    batchIds: [],
    stockBalanceIds: legacyStockBalanceIds,
    coldChainRequired: Boolean(row.cold_chain_required),
    slaDeadline: row.sla_deadline,
    qualityFlags: json<string[]>(row.quality_flags_json, [])
  };
}

export function dockFromRow(row: any): Dock {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    currentShipmentId: row.current_shipment_id,
    nextAvailableAt: row.next_available_at
  };
}

export function dockScheduleFromRow(row: any): DockSchedule {
  return {
    id: row.id,
    dockId: row.dock_id,
    shipmentId: row.shipment_id,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    conflictFlag: Boolean(row.conflict_flag)
  };
}

export function partnerSiteFromRow(row: any): PartnerSite {
  return {
    siteId: row.site_id,
    partnerId: row.partner_id,
    partnerName: row.partner_name,
    siteCode: row.site_code,
    role: row.role,
    displayName: row.display_name,
    address: row.address,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    timezone: row.timezone,
    location: { lat: Number(row.latitude), lng: Number(row.longitude) },
    receivingWindow: row.receiving_window,
    temperatureCapabilities: json(row.temperature_capabilities_json, []),
    vehicleRestrictions: json(row.vehicle_restrictions_json, []),
    simulated: Boolean(row.simulated),
    publicLocationReference: row.public_location_reference ?? null,
    dataNotice: row.data_notice
  };
}

export function transportLegFromRow(row: any): TransportLeg {
  const config = getRouteConfig(row.route_id);
  const baseDurationMinutes = Number(row.base_duration_minutes ?? 0);
  const storedDurationMinutes = Number(row.duration_minutes ?? baseDurationMinutes);
  const providerUsed = normaliseCacheSource(row.cache_source);
  const storedPolyline = json<LatLng[]>(row.polyline_json, []);
  const originLocation = config?.originLocation;
  const destinationLocation = config?.destinationLocation;
  const storedDistanceKm = Number(row.distance_km ?? 0);
  const validation = originLocation && destinationLocation && (providerUsed === "ors" || providerUsed === "osrm")
    ? validateRouteGeometry({ polyline: storedPolyline, origin: originLocation, destination: destinationLocation, reportedDistanceKm: storedDistanceKm })
    : null;
  const validRoadGeometry = Boolean(validation?.valid);
  const useFallback = (providerUsed === "ors" || providerUsed === "osrm") && !validRoadGeometry && Boolean(config);
  const polyline = useFallback ? config!.fallbackPolyline : storedPolyline;
  const distanceKm = useFallback ? config!.distanceKm : storedDistanceKm;
  const durationMinutes = useFallback ? config!.baseEtaMinutes : storedDurationMinutes;
  const effectiveProvider = useFallback ? "fallback" : providerUsed;
  return {
    transportLegId: row.transport_leg_id,
    routeId: row.route_id,
    direction: row.direction,
    asnId: row.asn_id ?? null,
    shipmentId: row.shipment_id ?? null,
    originSiteId: row.origin_site_id,
    destinationSiteId: row.destination_site_id,
    carrierId: row.carrier_id,
    carrierName: row.carrier_name,
    vehicleId: row.vehicle_id,
    vehicleType: row.vehicle_type,
    licensePlate: row.license_plate,
    driverId: row.driver_id ?? null,
    plannedDeparture: row.planned_departure,
    actualDeparture: row.actual_departure ?? null,
    plannedArrival: row.planned_arrival,
    actualArrival: row.actual_arrival ?? null,
    estimatedArrival: row.estimated_arrival,
    deliveryWindowStart: row.delivery_window_start ?? null,
    deliveryWindowEnd: row.delivery_window_end ?? null,
    dockAppointmentId: row.dock_appointment_id,
    temperatureRequirement: row.temperature_requirement,
    temperatureMin: row.temperature_min == null ? null : Number(row.temperature_min),
    temperatureMax: row.temperature_max == null ? null : Number(row.temperature_max),
    temperatureStatus: row.temperature_status,
    temperatureLoggerId: row.temperature_logger_id ?? null,
    transportStatus: row.transport_status,
    routeStatus: normaliseRouteStatus(row.route_status),
    distanceKm,
    baseDurationMinutes,
    durationMinutes,
    delayMinutes: Math.max(0, durationMinutes - baseDurationMinutes),
    disruptionType: row.disruption_type ?? null,
    riskLevel: row.risk_level,
    riskNote: row.risk_note,
    receivingImpact: row.receiving_impact,
    mitigationSuggestion: row.mitigation_suggestion,
    encodedPolyline: row.encoded_polyline ?? null,
    polyline,
    lastKnownLocation: json<LatLng | null>(row.last_known_location_json, null),
    lastComputedAt: row.last_computed_at ?? null,
    cacheSource: effectiveProvider,
    providerUsed: effectiveProvider,
    isRealRoadRoute: validRoadGeometry,
    sealNumber: row.seal_number ?? null,
    proofOfDeliveryId: row.proof_of_delivery_id ?? null,
    lastUpdatedAt: row.last_updated_at
  };
}

export function dockAppointmentFromRow(row: any): DockAppointment {
  return {
    dockAppointmentId: row.dock_appointment_id,
    dockId: row.dock_id,
    direction: row.direction,
    transportLegId: row.transport_leg_id,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    actualGateIn: row.actual_gate_in ?? null,
    actualDockIn: row.actual_dock_in ?? null,
    actualDockOut: row.actual_dock_out ?? null,
    actualGateOut: row.actual_gate_out ?? null,
    status: row.status,
    carrierId: row.carrier_id,
    carrierName: row.carrier_name,
    vehicleId: row.vehicle_id,
    licensePlate: row.license_plate,
    temperatureRequirement: row.temperature_requirement,
    conflictFlag: Boolean(row.conflict_flag),
    notes: row.notes,
    lastUpdatedAt: row.last_updated_at
  };
}

export function operationalEventFromRow(row: any): WarehouseOperationalEvent {
  return {
    eventId: row.event_id,
    timestamp: row.timestamp,
    process: row.process,
    direction: row.direction ?? null,
    step: row.step,
    status: row.status,
    sourceSystem: row.source_system,
    actor: row.actor,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    asnId: row.asn_id ?? null,
    shipmentId: row.shipment_id ?? null,
    transportLegId: row.transport_leg_id ?? null,
    dockAppointmentId: row.dock_appointment_id ?? null,
    siteId: row.site_id ?? null,
    dockId: row.dock_id ?? null,
    locationId: row.location_id ?? null,
    description: row.description,
    exceptionCode: row.exception_code ?? null,
    metadata: json(row.metadata_json, {})
  };
}

export function routeFromTransportLegRow(row: any): InboundRoute {
  const config = getRouteConfig(row.route_id);
  const leg = transportLegFromRow(row);
  const originLocation: LatLng = {
    lat: Number(row.origin_latitude ?? config?.originLocation.lat ?? 0),
    lng: Number(row.origin_longitude ?? config?.originLocation.lng ?? 0)
  };
  const destinationLocation: LatLng = {
    lat: Number(row.destination_latitude ?? config?.destinationLocation.lat ?? 0),
    lng: Number(row.destination_longitude ?? config?.destinationLocation.lng ?? 0)
  };
  return {
    routeId: leg.routeId,
    id: leg.routeId,
    name: row.name,
    origin: row.origin_display_name ?? config?.origin ?? leg.originSiteId,
    originType: row.origin_type,
    originLocation,
    destination: row.destination_display_name ?? config?.destination ?? leg.destinationSiteId,
    destinationLocation,
    etaMinutes: leg.durationMinutes,
    baseEtaMinutes: leg.baseDurationMinutes,
    currentDurationMinutes: leg.durationMinutes,
    durationMinutes: leg.durationMinutes,
    delayDeltaMinutes: leg.delayMinutes,
    distanceKm: leg.distanceKm,
    status: leg.routeStatus,
    expectedSkus: json(row.expected_skus_json, []),
    coldChainRequired: leg.temperatureRequirement === "2-8C",
    disruptionType: leg.disruptionType,
    riskLevel: leg.riskLevel,
    riskNote: leg.riskNote,
    receivingImpact: leg.receivingImpact,
    mitigationSuggestion: leg.mitigationSuggestion,
    encodedPolyline: leg.encodedPolyline,
    polyline: leg.polyline,
    geometry: leg.polyline,
    lastComputedAt: leg.lastComputedAt,
    cacheSource: leg.cacheSource,
    providerUsed: leg.providerUsed,
    isRealRoadRoute: leg.isRealRoadRoute,
    direction: leg.direction,
    transportLegId: leg.transportLegId,
    asnId: leg.asnId,
    shipmentId: leg.shipmentId,
    originSiteId: leg.originSiteId,
    destinationSiteId: leg.destinationSiteId,
    transportStatus: leg.transportStatus,
    plannedArrival: leg.plannedArrival,
    estimatedArrival: leg.estimatedArrival,
    dockAppointmentId: leg.dockAppointmentId,
    temperatureStatus: leg.temperatureStatus,
    carrierName: leg.carrierName,
    vehicleId: leg.vehicleId,
    licensePlate: leg.licensePlate
  };
}

export function routeFromRow(row: any): InboundRoute {
  const canonical = db.prepare(
    `SELECT tl.*,
       origin.display_name AS origin_display_name, origin.latitude AS origin_latitude, origin.longitude AS origin_longitude,
       destination.display_name AS destination_display_name, destination.latitude AS destination_latitude, destination.longitude AS destination_longitude
     FROM transport_legs tl
     LEFT JOIN partner_sites origin ON origin.site_id = tl.origin_site_id
     LEFT JOIN partner_sites destination ON destination.site_id = tl.destination_site_id
     WHERE tl.route_id = ?`
  ).get(row.id);
  if (canonical) return routeFromTransportLegRow(canonical);

  const config = getRouteConfig(row.id);
  const baseEtaMinutes = row.base_eta_minutes ?? config?.baseEtaMinutes ?? row.eta_minutes ?? 0;
  const etaMinutes = row.eta_minutes ?? baseEtaMinutes;
  const originLocation: LatLng = {
    lat: Number(row.origin_lat || config?.originLocation.lat || 0),
    lng: Number(row.origin_lng || config?.originLocation.lng || 0)
  };
  const destinationLocation: LatLng = {
    lat: Number(row.destination_lat || config?.destinationLocation.lat || 0),
    lng: Number(row.destination_lng || config?.destinationLocation.lng || 0)
  };
  const polyline = json<LatLng[]>(row.polyline_json, config?.fallbackPolyline ?? []);
  const providerUsed = normaliseCacheSource(row.cache_source);
  return {
    routeId: row.id,
    id: row.id,
    name: row.name,
    origin: row.origin,
    originType: row.origin_type || config?.originType || "Inbound logistics node",
    originLocation,
    destination: row.destination,
    destinationLocation,
    etaMinutes,
    baseEtaMinutes,
    currentDurationMinutes: etaMinutes,
    durationMinutes: etaMinutes,
    delayDeltaMinutes: Math.max(0, etaMinutes - baseEtaMinutes),
    distanceKm: Number(row.distance_km || config?.distanceKm || 0),
    status: normaliseRouteStatus(row.status),
    expectedSkus: json<string[]>(row.expected_skus_json, []),
    coldChainRequired: Boolean(row.cold_chain_required),
    disruptionType: row.disruption_type,
    riskLevel: row.risk_level,
    riskNote: row.risk_note || config?.riskNote || "",
    receivingImpact: row.receiving_impact || config?.receivingImpact || "",
    mitigationSuggestion: row.mitigation_suggestion || config?.mitigationSuggestion || "",
    encodedPolyline: row.encoded_polyline ?? null,
    polyline,
    geometry: polyline,
    lastComputedAt: row.last_computed_at ?? null,
    cacheSource: providerUsed,
    providerUsed,
    isRealRoadRoute: providerUsed === "ors" || providerUsed === "osrm",
    direction: config?.direction ?? "inbound",
    transportLegId: config?.transportLegId ?? row.id,
    asnId: config?.asnId ?? null,
    shipmentId: config?.shipmentId ?? null,
    originSiteId: config?.originSiteId ?? "",
    destinationSiteId: config?.destinationSiteId ?? "",
    transportStatus: config?.transportStatus ?? "planned",
    plannedArrival: addMinutes(etaMinutes),
    estimatedArrival: addMinutes(etaMinutes),
    dockAppointmentId: config?.dockAppointmentId ?? "",
    temperatureStatus: config?.temperatureStatus ?? "unknown",
    carrierName: config?.carrierName ?? "",
    vehicleId: config?.vehicleId ?? "",
    licensePlate: config?.licensePlate ?? ""
  };
}

export function alertFromRow(row: any): Alert {
  return {
    id: row.id,
    severity: row.severity,
    message: row.message,
    sourceAgent: row.source_agent,
    affectedIds: json<string[]>(row.affected_ids_json, []),
    timestamp: row.timestamp,
    status: row.status
  };
}

export function decisionFromRow(row: any): AiDecision {
  return {
    id: row.id,
    timestamp: row.timestamp,
    query: row.query,
    narrative: row.narrative,
    agentResponse: json(row.structured_response_json, fallbackAgentResponse),
    agentsUsed: json(row.agents_used_json, []),
    toolsCalled: json(row.tools_called_json, []),
    confidence: row.confidence,
    riskLevel: row.risk_level,
    actionPayload: json(row.action_payload_json, {
      type: "none",
      affectedSKUs: [],
      affectedZones: [],
      affectedStages: [],
      affectedShipments: [],
      affectedDocks: [],
      recommendedActionId: null
    }),
    decisionEvidence: json(row.decision_evidence_json, {
      dataUsed: [],
      constraintsApplied: [],
      alternativesConsidered: [],
      uncertainties: [],
      whyRecommendationWasMade: ""
    }),
    requiresApproval: Boolean(row.requires_approval),
    approvalStatus: row.approval_status,
    fallbackUsed: Boolean(row.fallback_used)
  };
}

export function productFromRow(row: any): Product {
  return {
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    productFamily: row.product_family,
    defaultTempBand: row.default_temp_band,
    storageClass: row.storage_class,
    unitType: row.unit_type,
    safetyStock: row.safety_stock,
    reorderPoint: row.reorder_point,
    targetStock: row.target_stock,
    leadTimeDays: row.lead_time_days,
    averageDailyDemand: row.average_daily_demand,
    gtin: row.gtin ?? "",
    manufacturer: row.manufacturer ?? "",
    dosageForm: row.dosage_form ?? "",
    strength: row.strength ?? "",
    packSize: row.pack_size ?? ""
  };
}

export function batchFromRow(row: any): Batch {
  return {
    batchId: row.batch_id,
    productId: row.product_id,
    lotCode: row.lot_code,
    expiryDate: row.expiry_date,
    manufactureDate: row.manufacture_date ?? null,
    qualityStatus: row.quality_status,
    tempBand: row.temp_band,
    serializationStatus: row.serialization_status ?? null,
    notes: row.notes ?? null,
    stoNumber: row.sto_number ?? "",
    goodsReceiptNumber: row.goods_receipt_number ?? "",
    arrivalAt: row.arrival_at ?? "",
    putawayAt: row.putaway_at ?? "",
    handlingUnit: row.handling_unit ?? "",
    inspectionLot: row.inspection_lot ?? "",
    countryOfOrigin: row.country_of_origin ?? "",
    lastCycleCountAt: row.last_cycle_count_at ?? ""
  };
}

export function locationFromRow(row: any): WarehouseLocation {
  return {
    locationId: row.location_id,
    zone: row.zone,
    rack: row.rack,
    bin: row.bin,
    tempBand: row.temp_band,
    capacity: row.capacity,
    currentFill: row.current_fill
  };
}

export function stockBalanceFromRow(row: any): StockBalance {
  return {
    stockBalanceId: row.stock_balance_id,
    batchId: row.batch_id,
    locationId: row.location_id,
    qtyOnHand: row.qty_on_hand,
    qtyAvailable: row.qty_available,
    qtyReserved: row.qty_reserved,
    qtyPicked: row.qty_picked,
    qtyPacked: row.qty_packed,
    qtyStaged: row.qty_staged,
    qtyDispatched: row.qty_dispatched,
    qtyOnHold: row.qty_on_hold,
    lastUpdated: row.last_updated
  };
}

export function inboundShipmentFromRow(row: any): InboundShipment {
  return {
    asnId: row.asn_id,
    source: row.source,
    routeName: row.route_name,
    eta: row.eta,
    receivingDock: row.receiving_dock,
    inboundStatus: row.inbound_status,
    coldChainStatus: row.cold_chain_status,
    linkedRouteId: row.linked_route_id ?? row.route_id ?? null,
    purchaseOrderId: row.purchase_order_id ?? null,
    supplierSiteId: row.supplier_site_id ?? row.origin_site_id ?? null,
    transportLegId: row.transport_leg_id ?? null,
    dockAppointmentId: row.dock_appointment_id ?? null,
    plannedArrival: row.planned_arrival ?? row.eta,
    actualArrival: row.actual_arrival ?? null,
    goodsReceiptNumber: row.goods_receipt_number ?? null,
    vehicleId: row.vehicle_id ?? null,
    sealNumber: row.seal_number ?? null
  };
}

export function inboundLineFromRow(row: any): InboundLine {
  return {
    inboundLineId: row.inbound_line_id,
    asnId: row.asn_id,
    productId: row.product_id,
    batchId: row.batch_id,
    qtyExpected: row.qty_expected,
    qtyReceived: row.qty_received,
    tempBand: row.temp_band,
    receivingStatus: row.receiving_status,
    qaStatus: row.qa_status
  };
}

export function outboundShipmentFromRow(row: any): OutboundShipment {
  return {
    shipmentId: row.shipment_id,
    destination: row.destination,
    requiredBy: row.required_by,
    dock: row.dock,
    outboundStatus: row.outbound_status,
    priorityLevel: row.priority_level ?? null,
    routeId: row.route_id ?? null,
    customerOrderId: row.customer_order_id ?? null,
    deliveryId: row.delivery_id ?? null,
    customerSiteId: row.customer_site_id ?? row.destination_site_id ?? null,
    transportLegId: row.transport_leg_id ?? null,
    dockAppointmentId: row.dock_appointment_id ?? null,
    plannedDeparture: row.planned_departure ?? row.required_by,
    actualDeparture: row.actual_departure ?? null,
    deliveryWindowStart: row.delivery_window_start ?? null,
    deliveryWindowEnd: row.delivery_window_end ?? null,
    goodsIssueNumber: row.goods_issue_number ?? null,
    proofOfDeliveryId: row.proof_of_delivery_id ?? null,
    vehicleId: row.vehicle_id ?? null,
    sealNumber: row.seal_number ?? null
  };
}

export function outboundLineFromRow(row: any): OutboundLine {
  return {
    outboundLineId: row.outbound_line_id,
    shipmentId: row.shipment_id,
    productId: row.product_id,
    batchId: row.batch_id,
    qtyRequired: row.qty_required,
    qtyAllocated: row.qty_allocated,
    qtyPicked: row.qty_picked,
    qtyPacked: row.qty_packed,
    qtyDispatched: row.qty_dispatched,
    allocationStatus: row.allocation_status
  };
}

export function movementFromRow(row: any): InventoryMovement {
  return {
    movementId: row.movement_id,
    timestamp: row.timestamp,
    movementType: row.movement_type,
    productId: row.product_id,
    batchId: row.batch_id,
    fromLocationId: row.from_location_id ?? null,
    toLocationId: row.to_location_id ?? null,
    qty: row.qty,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    userOrSystem: row.user_or_system,
    note: row.note
  };
}

function richInventorySeeded() {
  const result = db.prepare("SELECT COUNT(*) AS count FROM products").get() as { count: number };
  return result.count > 0;
}

function zoneCode(zone: string) {
  const normalized = zone.toLowerCase();
  if (normalized.includes("qa cold")) return "QAC";
  if (normalized.includes("cold")) return "CS";
  if (normalized.includes("ambient")) return "AM";
  if (normalized.includes("pharmaceutical")) return "PH";
  if (normalized.includes("qa")) return "QA";
  if (normalized.includes("quarantine")) return "QT";
  if (normalized.includes("receiving")) return "RCV";
  if (normalized.includes("dispatch")) return "DS";
  return zone;
}

function tempRange(tempBand: string): { min: number; max: number } {
  const match = tempBand.match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return { min: 15, max: 30 };
  return { min: Number(match[1]), max: Number(match[2]) };
}

function stageFromBalance(balance: StockBalance, location: WarehouseLocation) {
  if (balance.qtyStaged > 0 || location.zone === "Dispatch") return "Dock Staging";
  if (balance.qtyPacked > 0) return "Packing";
  if (balance.qtyPicked > 0) return "Picking";
  if (location.zone === "Receiving") return "Receiving";
  return "Storage";
}

function priorityFromShipment(status: string | null | undefined): InventoryPlacement["priority"] {
  if (status === "Staged" || status === "Picking") return "HIGH";
  if (status === "Blocked") return "HIGH";
  return "NORMAL";
}

function inventoryPlacementFromInventoryRow(row: any): InventoryPlacement {
  const balance = stockBalanceFromRow(row);
  const temp = tempRange(row.temp_band);
  const linkedShipmentId = row.linked_shipment_id ?? null;
  const outboundStatus = row.outbound_status ?? null;
  const zoneId = zoneCode(row.zone);
  return {
    productId: row.product_id,
    productCode: row.product_code,
    batchId: row.batch_id,
    stockBalanceId: balance.stockBalanceId,
    locationId: row.location_id,
    productName: row.product_name,
    category: row.product_family,
    zoneId,
    zoneName: row.zone,
    rack: row.rack,
    bin: row.bin,
    batchNo: row.lot_code,
    expiryDate: row.expiry_date,
    quantity: balance.qtyOnHand,
    priority: priorityFromShipment(outboundStatus),
    temperatureMin: temp.min,
    temperatureMax: temp.max,
    regField: row.product_code,
    qualityStatus: row.quality_status,
    linkedShipmentId,
    currentStage: stageFromBalance(balance, locationFromRow(row)),
    dispatchSequence: Number(row.dispatch_sequence ?? 999),
    qtyAvailable: balance.qtyAvailable,
    qtyReserved: balance.qtyReserved,
    qtyPicked: balance.qtyPicked,
    qtyPacked: balance.qtyPacked,
    qtyStaged: balance.qtyStaged,
    qtyOnHold: balance.qtyOnHold
  };
}

export function getZones(): Zone[] {
  return db
    .prepare(
      `SELECT z.*,
        CASE WHEN COALESCE(SUM(wl.capacity), 0) > 0
          THEN SUM(wl.capacity)
          ELSE z.capacity_units
        END AS capacity_units,
        CASE WHEN COALESCE(SUM(wl.capacity), 0) > 0
          THEN ROUND(100.0 * SUM(wl.current_fill) / SUM(wl.capacity))
          ELSE 0
        END AS fill_percent
       FROM zones z
       LEFT JOIN warehouse_locations wl ON wl.zone = z.name
       GROUP BY z.id
       ORDER BY z.id`
    )
    .all()
    .map(zoneFromRow);
}

export function getInventoryPlacements(): InventoryPlacement[] {
  if (richInventorySeeded()) {
    return db
      .prepare(
        `SELECT
          sb.*,
          b.product_id,
          b.lot_code,
          b.expiry_date,
          b.quality_status,
          b.temp_band,
          p.product_code,
          p.product_name,
          p.product_family,
          wl.location_id,
          wl.zone,
          wl.rack,
          wl.bin,
          wl.capacity,
          wl.current_fill,
          COALESCE((
            SELECT ol.shipment_id
            FROM outbound_lines ol
            JOIN outbound_shipments os ON os.shipment_id = ol.shipment_id
            WHERE ol.batch_id = b.batch_id
              AND os.outbound_status NOT IN ('Dispatched', 'Delivered')
            ORDER BY CASE WHEN ol.qty_allocated + ol.qty_picked + ol.qty_packed + ol.qty_dispatched > 0 THEN 0 ELSE 1 END,
              datetime(os.required_by)
            LIMIT 1
          ), NULL) AS linked_shipment_id,
          COALESCE((
            SELECT os.outbound_status
            FROM outbound_lines ol
            JOIN outbound_shipments os ON os.shipment_id = ol.shipment_id
            WHERE ol.batch_id = b.batch_id
              AND os.outbound_status NOT IN ('Dispatched', 'Delivered')
            ORDER BY datetime(os.required_by)
            LIMIT 1
          ), NULL) AS outbound_status,
          ROW_NUMBER() OVER (ORDER BY datetime(b.expiry_date), p.product_code, b.lot_code) AS dispatch_sequence
        FROM stock_balances sb
        JOIN batches b ON b.batch_id = sb.batch_id
        JOIN products p ON p.product_id = b.product_id
        JOIN warehouse_locations wl ON wl.location_id = sb.location_id
        WHERE sb.qty_on_hand > 0
        ORDER BY datetime(b.expiry_date), p.product_code, b.lot_code`
      )
      .all()
      .map(inventoryPlacementFromInventoryRow);
  }

  return db
    .prepare(
      `SELECT skus.*, zones.name AS zone_name
       FROM skus
       JOIN zones ON zones.id = skus.zone_id
       ORDER BY datetime(expiry_date), dispatch_sequence`
    )
    .all()
    .map(inventoryPlacementFromLegacyRow);
}

export function getProducts(): Product[] {
  return db.prepare("SELECT * FROM products ORDER BY product_code").all().map(productFromRow);
}

export function getBatches(): Batch[] {
  return db.prepare("SELECT * FROM batches ORDER BY product_id, datetime(expiry_date), lot_code").all().map(batchFromRow);
}

export function getWarehouseLocations(): WarehouseLocation[] {
  return db.prepare("SELECT * FROM warehouse_locations ORDER BY zone, rack, bin").all().map(locationFromRow);
}

export function getStockBalances(): StockBalance[] {
  return db.prepare("SELECT * FROM stock_balances ORDER BY stock_balance_id").all().map(stockBalanceFromRow);
}

export function getInboundShipments(): InboundShipment[] {
  return db.prepare(
    `SELECT inbound.*, tl.route_id, tl.origin_site_id, tl.transport_leg_id AS canonical_transport_leg_id,
       tl.dock_appointment_id AS canonical_dock_appointment_id, tl.planned_arrival AS canonical_planned_arrival,
       tl.actual_arrival AS canonical_actual_arrival, tl.vehicle_id AS canonical_vehicle_id, tl.seal_number AS canonical_seal_number
     FROM inbound_shipments inbound
     LEFT JOIN transport_legs tl ON tl.asn_id = inbound.asn_id
     ORDER BY datetime(COALESCE(tl.estimated_arrival, inbound.eta)), inbound.asn_id`
  ).all().map((row: any) => inboundShipmentFromRow({
    ...row,
    transport_leg_id: row.transport_leg_id ?? row.canonical_transport_leg_id,
    dock_appointment_id: row.dock_appointment_id ?? row.canonical_dock_appointment_id,
    planned_arrival: row.planned_arrival ?? row.canonical_planned_arrival,
    actual_arrival: row.actual_arrival ?? row.canonical_actual_arrival,
    vehicle_id: row.vehicle_id ?? row.canonical_vehicle_id,
    seal_number: row.seal_number ?? row.canonical_seal_number
  }));
}

export function getInboundLines(): InboundLine[] {
  return db.prepare("SELECT * FROM inbound_lines ORDER BY asn_id, inbound_line_id").all().map(inboundLineFromRow);
}

export function getOutboundShipments(): OutboundShipment[] {
  return db.prepare(
    `SELECT outbound.*, tl.destination_site_id, tl.transport_leg_id AS canonical_transport_leg_id,
       tl.dock_appointment_id AS canonical_dock_appointment_id, tl.planned_departure AS canonical_planned_departure,
       tl.actual_departure AS canonical_actual_departure, tl.delivery_window_start AS canonical_window_start,
       tl.delivery_window_end AS canonical_window_end, tl.proof_of_delivery_id AS canonical_pod_id,
       tl.vehicle_id AS canonical_vehicle_id, tl.seal_number AS canonical_seal_number
     FROM outbound_shipments outbound
     LEFT JOIN transport_legs tl ON tl.shipment_id = outbound.shipment_id
     ORDER BY datetime(COALESCE(tl.planned_departure, outbound.required_by)), outbound.shipment_id`
  ).all().map((row: any) => outboundShipmentFromRow({
    ...row,
    transport_leg_id: row.transport_leg_id ?? row.canonical_transport_leg_id,
    dock_appointment_id: row.dock_appointment_id ?? row.canonical_dock_appointment_id,
    planned_departure: row.planned_departure ?? row.canonical_planned_departure,
    actual_departure: row.actual_departure ?? row.canonical_actual_departure,
    delivery_window_start: row.delivery_window_start ?? row.canonical_window_start,
    delivery_window_end: row.delivery_window_end ?? row.canonical_window_end,
    proof_of_delivery_id: row.proof_of_delivery_id ?? row.canonical_pod_id,
    vehicle_id: row.vehicle_id ?? row.canonical_vehicle_id,
    seal_number: row.seal_number ?? row.canonical_seal_number
  }));
}

export function getOutboundLines(): OutboundLine[] {
  return db.prepare("SELECT * FROM outbound_lines ORDER BY shipment_id, outbound_line_id").all().map(outboundLineFromRow);
}

export function getInventoryMovements(limit = 140): InventoryMovement[] {
  return db
    .prepare("SELECT * FROM inventory_movements ORDER BY datetime(timestamp) DESC LIMIT ?")
    .all(limit)
    .map(movementFromRow);
}

function dateKey(value: string) {
  return value.slice(0, 10);
}

export function getInventorySummary(): InventorySummary {
  if (!richInventorySeeded()) {
    const skus = getInventoryPlacements();
    const today = dateKey(nowIso());
    const shipments = getShipments();
    return {
      onHand: skus.reduce((sum, sku) => sum + sku.quantity, 0),
      available: skus.filter((sku) => sku.qualityStatus === "Released").reduce((sum, sku) => sum + sku.quantity, 0),
      reserved: skus.filter((sku) => sku.linkedShipmentId).reduce((sum, sku) => sum + sku.quantity, 0),
      incomingToday: 0,
      outboundToday: shipments.filter((shipment) => dateKey(shipment.dispatchTime) === today).reduce((sum, shipment) => sum + shipment.batchIds.length, 0),
      qaHold: skus.filter((sku) => sku.qualityStatus !== "Released").reduce((sum, sku) => sum + sku.quantity, 0),
      productCount: new Set(skus.map((sku) => sku.productName)).size,
      batchCount: skus.length
    };
  }

  const stock = db
    .prepare(
      `SELECT
        COALESCE(SUM(qty_on_hand), 0) AS onHand,
        COALESCE(SUM(qty_available), 0) AS available,
        COALESCE(SUM(qty_reserved + qty_picked + qty_packed + qty_staged), 0) AS reserved,
        COALESCE(SUM(qty_on_hold), 0) AS qaHold
       FROM stock_balances`
    )
    .get() as { onHand: number; available: number; reserved: number; qaHold: number };
  const today = dateKey(nowIso());
  const incoming = db
    .prepare(
      `SELECT COALESCE(SUM(il.qty_expected - il.qty_received), 0) AS total
       FROM inbound_lines il
       JOIN inbound_shipments inbound ON inbound.asn_id = il.asn_id
       WHERE date(inbound.eta) = date(?)
         AND inbound.inbound_status IN ('Scheduled', 'In Transit', 'At Receiving', 'QA Pending', 'Received')`
    )
    .get(today) as { total: number };
  const outbound = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN ol.qty_allocated > 0 THEN ol.qty_allocated ELSE ol.qty_required END), 0) AS total
       FROM outbound_lines ol
       JOIN outbound_shipments os ON os.shipment_id = ol.shipment_id
       WHERE date(os.required_by) = date(?)
         AND os.outbound_status != 'Dispatched'`
    )
    .get(today) as { total: number };
  const counts = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM products) AS productCount,
        (SELECT COUNT(*) FROM batches) AS batchCount`
    )
    .get() as { productCount: number; batchCount: number };

  return {
    onHand: stock.onHand,
    available: stock.available,
    reserved: stock.reserved,
    incomingToday: incoming.total,
    outboundToday: outbound.total,
    qaHold: stock.qaHold,
    productCount: counts.productCount,
    batchCount: counts.batchCount
  };
}

function batchStockFromJoinedRow(row: any): BatchStockPosition {
  return {
    batchId: row.batch_id,
    lotCode: row.lot_code,
    productId: row.product_id,
    expiryDate: row.expiry_date,
    manufactureDate: row.manufacture_date ?? null,
    qualityStatus: row.quality_status,
    tempBand: row.temp_band,
    serializationStatus: row.serialization_status ?? null,
    notes: row.notes ?? null,
    stoNumber: row.sto_number ?? "",
    goodsReceiptNumber: row.goods_receipt_number ?? "",
    arrivalAt: row.arrival_at ?? "",
    putawayAt: row.putaway_at ?? "",
    handlingUnit: row.handling_unit ?? "",
    inspectionLot: row.inspection_lot ?? "",
    countryOfOrigin: row.country_of_origin ?? "",
    lastCycleCountAt: row.last_cycle_count_at ?? "",
    location: locationFromRow(row),
    stockBalanceId: row.stock_balance_id,
    qtyOnHand: row.qty_on_hand,
    qtyAvailable: row.qty_available,
    qtyReserved: row.qty_reserved,
    qtyPicked: row.qty_picked,
    qtyPacked: row.qty_packed,
    qtyStaged: row.qty_staged,
    qtyDispatched: row.qty_dispatched,
    qtyOnHold: row.qty_on_hold,
    linkedInboundIds: json<string[]>(row.linked_inbound_ids, []),
    linkedShipmentIds: json<string[]>(row.linked_shipment_ids, [])
  };
}

export function getProductStockPositions(): ProductStockPosition[] {
  if (!richInventorySeeded()) return [];
  const rows = db
    .prepare(
      `SELECT
        p.*,
        b.*,
        wl.*,
        sb.*,
        COALESCE((
          SELECT json_group_array(DISTINCT il.asn_id)
          FROM inbound_lines il
          WHERE il.batch_id = b.batch_id
        ), '[]') AS linked_inbound_ids,
        COALESCE((
          SELECT json_group_array(DISTINCT ol.shipment_id)
          FROM outbound_lines ol
          JOIN outbound_shipments os ON os.shipment_id = ol.shipment_id
          WHERE ol.batch_id = b.batch_id
            AND os.outbound_status != 'Dispatched'
        ), '[]') AS linked_shipment_ids
       FROM products p
       JOIN batches b ON b.product_id = p.product_id
       LEFT JOIN stock_balances sb ON sb.batch_id = b.batch_id
       LEFT JOIN warehouse_locations wl ON wl.location_id = sb.location_id
       WHERE sb.stock_balance_id IS NOT NULL
       ORDER BY p.product_code, datetime(b.expiry_date), b.lot_code`
    )
    .all();
  const grouped = new Map<string, { product: Product; batches: BatchStockPosition[] }>();
  for (const row of rows as any[]) {
    const product = productFromRow(row);
    const current = grouped.get(product.productId) ?? { product, batches: [] };
    current.batches.push(batchStockFromJoinedRow(row));
    grouped.set(product.productId, current);
  }

  return [...grouped.values()].map(({ product, batches }) => {
    const earliest = batches
      .filter((batch) => batch.qualityStatus !== "Expired" && batch.qtyOnHand > 0)
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0]?.expiryDate ?? null;
    return {
      product,
      totalOnHand: batches.reduce((sum, batch) => sum + batch.qtyOnHand, 0),
      totalAvailable: batches.reduce((sum, batch) => sum + batch.qtyAvailable, 0),
      totalReserved: batches.reduce((sum, batch) => sum + batch.qtyReserved, 0),
      totalPicked: batches.reduce((sum, batch) => sum + batch.qtyPicked, 0),
      totalPacked: batches.reduce((sum, batch) => sum + batch.qtyPacked, 0),
      totalStaged: batches.reduce((sum, batch) => sum + batch.qtyStaged, 0),
      totalQaHold: batches.reduce((sum, batch) => sum + batch.qtyOnHold, 0),
      earliestExpiry: earliest,
      batches
    };
  });
}

export function getProductStock(productIdOrCode: string): ProductStockPosition | null {
  const needle = productIdOrCode.trim().toLowerCase();
  return (
    getProductStockPositions().find(
      (position) => position.product.productId.toLowerCase() === needle || position.product.productCode.toLowerCase() === needle
    ) ?? null
  );
}

export function getBatchDetail(batchIdOrLot: string): BatchDetail | null {
  const needle = batchIdOrLot.trim().toLowerCase();
  const positions = getProductStockPositions();
  for (const position of positions) {
    const batch = position.batches.find(
      (item) =>
        item.batchId.toLowerCase() === needle ||
        item.lotCode.toLowerCase() === needle ||
        item.stockBalanceId.toLowerCase() === needle
    );
    if (!batch) continue;
    return {
      ...batch,
      product: position.product,
      movements: getInventoryMovements(240).filter((movement) => movement.batchId === batch.batchId),
      inboundLines: getInboundLines().filter((line) => line.batchId === batch.batchId),
      outboundLines: getOutboundLines().filter((line) => line.batchId === batch.batchId)
    };
  }
  return null;
}

export function getInventoryData(): InventoryData {
  return {
    products: getProducts(),
    batches: getBatches(),
    locations: getWarehouseLocations(),
    stockBalances: getStockBalances(),
    inboundShipments: getInboundShipments(),
    inboundLines: getInboundLines(),
    outboundShipments: getOutboundShipments(),
    outboundLines: getOutboundLines(),
    movements: getInventoryMovements(),
    stockPositions: getProductStockPositions(),
    summary: getInventorySummary()
  };
}

export function getShipments(): Shipment[] {
  const outbound = getOutboundShipments();
  if (!outbound.length) {
    return db.prepare("SELECT * FROM shipments ORDER BY datetime(dispatch_time)").all().map(shipmentFromRow);
  }
  const lines = getOutboundLines();
  const balances = getStockBalances();
  const products = new Map(getProducts().map((product) => [product.productId, product]));
  const legs = new Map(getTransportLegs().filter((leg) => leg.shipmentId).map((leg) => [leg.shipmentId!, leg]));
  return outbound.map((item) => {
    const shipmentLines = lines.filter((line) => line.shipmentId === item.shipmentId);
    const leg = legs.get(item.shipmentId);
    const coldChainRequired = shipmentLines.some((line) => products.get(line.productId)?.defaultTempBand === "2-8 C") || leg?.temperatureRequirement === "2-8C";
    const priority: Shipment["priority"] = item.priorityLevel === "Medical Priority" ? "URGENT" : item.outboundStatus === "Blocked" ? "HIGH" : "NORMAL";
    return {
      id: item.shipmentId,
      destination: item.destination,
      priority,
      dockId: item.dock,
      dispatchTime: item.plannedDeparture || item.requiredBy,
      status: item.outboundStatus,
      productIds: [...new Set(shipmentLines.map((line) => line.productId))],
      batchIds: [...new Set(shipmentLines.map((line) => line.batchId))],
      stockBalanceIds: [...new Set(
        shipmentLines.flatMap((line) => balances.filter((balance) => balance.batchId === line.batchId).map((balance) => balance.stockBalanceId))
      )],
      coldChainRequired,
      slaDeadline: item.deliveryWindowEnd ?? item.requiredBy,
      qualityFlags: item.outboundStatus === "Blocked" ? ["Quality-released FEFO stock is required before allocation"] : [],
      routeId: item.routeId,
      transportLegId: item.transportLegId,
      customerSiteId: item.customerSiteId,
      dockAppointmentId: item.dockAppointmentId
    };
  }).sort((a, b) => new Date(a.dispatchTime).getTime() - new Date(b.dispatchTime).getTime());
}

export function getDocks(): Dock[] {
  const base = db.prepare("SELECT * FROM docks ORDER BY id").all().map(dockFromRow);
  const occupiedStatuses = new Set(["checked_in", "at_dock", "loading", "unloading"]);
  const appointments = getDockAppointments();
  return base.map((dock) => {
    if (dock.status === "maintenance") return dock;
    const active = appointments
      .filter((appointment) => appointment.dockId === dock.id && occupiedStatuses.has(appointment.status))
      .sort((a, b) => {
        const aTime = new Date(a.actualDockIn ?? a.actualGateIn ?? a.scheduledStart).getTime();
        const bTime = new Date(b.actualDockIn ?? b.actualGateIn ?? b.scheduledStart).getTime();
        return bTime - aTime;
      })[0];
    if (!active) return { ...dock, status: "available", currentShipmentId: null };
    return {
      ...dock,
      status: "occupied",
      currentShipmentId: active.referenceId,
      nextAvailableAt: active.scheduledEnd
    };
  });
}

export function getDockSchedule(): DockSchedule[] {
  const appointments = getDockAppointments();
  if (!appointments.length) {
    return db.prepare("SELECT * FROM dock_schedule ORDER BY dock_id, datetime(start_time)").all().map(dockScheduleFromRow);
  }
  return appointments.map((appointment) => ({
    id: appointment.dockAppointmentId,
    dockId: appointment.dockId,
    shipmentId: appointment.referenceId,
    startTime: appointment.scheduledStart,
    endTime: appointment.scheduledEnd,
    status: appointment.status === "completed" ? "complete" : appointment.status,
    conflictFlag: appointment.conflictFlag,
    direction: appointment.direction,
    transportLegId: appointment.transportLegId,
    referenceType: appointment.referenceType
  }));
}

export function getPartnerSites(): PartnerSite[] {
  return db.prepare("SELECT * FROM partner_sites ORDER BY role, display_name").all().map(partnerSiteFromRow);
}

export function getTransportLegs(direction?: TransportDirection): TransportLeg[] {
  const sql = direction
    ? "SELECT * FROM transport_legs WHERE direction = ? ORDER BY datetime(estimated_arrival), route_id"
    : "SELECT * FROM transport_legs ORDER BY datetime(estimated_arrival), route_id";
  const rows = direction ? db.prepare(sql).all(direction) : db.prepare(sql).all();
  return rows.map(transportLegFromRow);
}

export function getDockAppointments(): DockAppointment[] {
  const appointments = db.prepare("SELECT * FROM dock_appointments ORDER BY datetime(scheduled_start), dock_id").all().map(dockAppointmentFromRow);
  const conflicting = new Set<string>();
  const byDock = new Map<string, DockAppointment[]>();
  appointments
    .filter((appointment) => appointment.status !== "cancelled")
    .forEach((appointment) => byDock.set(appointment.dockId, [...(byDock.get(appointment.dockId) ?? []), appointment]));
  byDock.forEach((dockAppointments) => {
    const ordered = [...dockAppointments].sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime());
    ordered.forEach((appointment, index) => {
      const starts = new Date(appointment.scheduledStart).getTime();
      if (!Number.isFinite(starts)) return;
      const overlapsEarlier = ordered.slice(0, index).some((earlier) => {
        const earlierEnd = new Date(earlier.scheduledEnd).getTime();
        return Number.isFinite(earlierEnd) && starts < earlierEnd;
      });
      // Flag the later appointment: that is the record yard control must resequence.
      if (overlapsEarlier) conflicting.add(appointment.dockAppointmentId);
    });
  });
  return appointments.map((appointment) => ({ ...appointment, conflictFlag: conflicting.has(appointment.dockAppointmentId) }));
}

export function getOperationalEvents(limit = 500): WarehouseOperationalEvent[] {
  return db.prepare("SELECT * FROM warehouse_operational_events ORDER BY datetime(timestamp) DESC LIMIT ?").all(limit).map(operationalEventFromRow);
}

export function getLogisticsData(): LogisticsData {
  const inboundById = new Map(getInboundShipments().map((shipment) => [shipment.asnId, shipment]));
  const outboundById = new Map(getOutboundShipments().map((shipment) => [shipment.shipmentId, shipment]));
  const transportLegs = getTransportLegs().map((leg) => {
    const adherence = leg.asnId
      ? inboundById.has(leg.asnId) ? inboundScheduleAdherence(inboundById.get(leg.asnId)!) : null
      : leg.shipmentId && outboundById.has(leg.shipmentId) ? outboundScheduleAdherence(outboundById.get(leg.shipmentId)!) : null;
    if (!adherence) return leg;
    return {
      ...leg,
      scheduleAdherence: adherence.status,
      scheduleAdherenceLabel: adherence.label,
      scheduleVarianceMinutes: adherence.varianceMinutes
    };
  });
  return {
    warehouseSiteId: WAREHOUSE_SITE_ID,
    simulationDisclosure: SIMULATION_DISCLOSURE,
    partnerSites: getPartnerSites(),
    transportLegs,
    dockAppointments: getDockAppointments(),
    operationalEvents: getOperationalEvents()
  };
}

export function getRoutes(direction?: TransportDirection): InboundRoute[] {
  const where = direction ? "WHERE tl.direction = ?" : "";
  const rows = db.prepare(
    `SELECT tl.*,
       origin.display_name AS origin_display_name, origin.latitude AS origin_latitude, origin.longitude AS origin_longitude,
       destination.display_name AS destination_display_name, destination.latitude AS destination_latitude, destination.longitude AS destination_longitude
     FROM transport_legs tl
     LEFT JOIN partner_sites origin ON origin.site_id = tl.origin_site_id
     LEFT JOIN partner_sites destination ON destination.site_id = tl.destination_site_id
     ${where}
     ORDER BY tl.direction, datetime(tl.estimated_arrival), tl.route_id`
  );
  const canonicalRows = direction ? rows.all(direction) : rows.all();
  if (canonicalRows.length) return canonicalRows.map(routeFromTransportLegRow);
  return db.prepare("SELECT * FROM inbound_routes ORDER BY id").all().map(routeFromRow);
}

export function getTemperatureReadings(limit = 520): TemperatureReading[] {
  return db
    .prepare(
      `SELECT
        temperature_readings.*,
        zones.temperature_min AS zone_temperature_min,
        zones.temperature_max AS zone_temperature_max
       FROM temperature_readings
       LEFT JOIN zones ON zones.id = temperature_readings.zone_id
       ORDER BY datetime(temperature_readings.timestamp) DESC
       LIMIT ?`
    )
    .all(limit)
    .reverse()
    .map((row: any) => ({
      id: row.id,
      zoneId: row.zone_id,
      temperature: row.temperature,
      timestamp: row.timestamp,
      withinBand: Boolean(row.within_band),
      allowedMin: Number(row.allowed_min ?? row.zone_temperature_min ?? 0),
      allowedMax: Number(row.allowed_max ?? row.zone_temperature_max ?? 0),
      sensorId: row.sensor_id ?? `${row.zone_id}-TEMP-01`,
      relatedSkuIds: json<string[]>(row.related_sku_ids_json, []),
      relatedBatchIds: json<string[]>(row.related_batch_ids_json, [])
    }));
}

export function getTemperatureEvents(zoneId?: string): TemperatureEvent[] {
  return buildTemperatureEvents(getTemperatureReadings(5000), getZones(), zoneId);
}

export function getRfidEvents(limit = 40): RfidEvent[] {
  return db
    .prepare("SELECT * FROM rfid_events ORDER BY datetime(timestamp) DESC LIMIT ?")
    .all(limit)
    .map((row: any) => ({
      id: row.id,
      skuId: row.sku_id,
      zoneId: row.zone_id,
      action: row.action,
      timestamp: row.timestamp,
      severity: row.severity
    }));
}

export function getAlerts(limit = 60): Alert[] {
  return db
    .prepare("SELECT * FROM alerts ORDER BY datetime(timestamp) DESC LIMIT ?")
    .all(limit)
    .map(alertFromRow);
}

export function getDecisions(limit = 80): AiDecision[] {
  return db
    .prepare("SELECT * FROM ai_decisions ORDER BY datetime(timestamp) DESC LIMIT ?")
    .all(limit)
    .map(decisionFromRow);
}

export function calculateKpis() {
  const skus = getInventoryPlacements();
  const zones = getZones();
  const shipments = getShipments();
  const docks = getDocks();
  const decisions = getDecisions();
  const releasedSorted = skus
    .filter((sku) => sku.qualityStatus === "Released" && (sku.qtyAvailable ?? sku.quantity) > 0 && new Date(sku.expiryDate).getTime() > Date.now())
    .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  const inversions = releasedSorted.filter((sku, index) => sku.dispatchSequence > index + 5).length;
  const heldOrExpired = skus.filter((sku) => sku.qualityStatus !== "Released" || new Date(sku.expiryDate).getTime() <= Date.now()).length;
  const fefoCompliance = releasedSorted.length
    ? Math.max(72, Math.round(100 - ((inversions + Math.min(heldOrExpired, 4)) / (releasedSorted.length + heldOrExpired)) * 100))
    : 100;
  const inBandZones = zones.filter((zone) => zone.currentTemperature >= zone.temperatureMin && zone.currentTemperature <= zone.temperatureMax).length;
  const coldChainIntegrity = zones.length ? Math.round((inBandZones / zones.length) * 100) : 100;
  const occupiedDocks = docks.filter((dock) => dock.status === "occupied").length;
  const dockUtilisation = docks.length ? Math.round((occupiedDocks / docks.length) * 100) : 0;
  const expiryCutoff = Date.now() + 7 * 24 * 60 * 60_000;
  const stockBalancesAtExpiryRisk = skus.filter(
    (sku) => new Date(sku.expiryDate).getTime() <= expiryCutoff && sku.currentStage !== "Dispatch" && sku.qualityStatus === "Released"
  ).length;
  return {
    fefoCompliance,
    coldChainIntegrity,
    dockUtilisation,
    activeShipments: shipments.filter((shipment) => shipment.status !== "Dispatched").length,
    stockBalancesAtExpiryRisk,
    assistantEnquiries: decisions.length
  };
}

export function getWarehouseSnapshot(): WarehouseSnapshot {
  const logistics = getLogisticsData();
  return {
    zones: getZones(),
    inventoryPlacements: getInventoryPlacements(),
    shipments: getShipments(),
    docks: getDocks(),
    dockSchedule: getDockSchedule(),
    routes: getRoutes(),
    temperatureReadings: getTemperatureReadings(),
    temperatureEvents: getTemperatureEvents(),
    rfidEvents: getRfidEvents(),
    alerts: getAlerts(),
    decisions: getDecisions(),
    partnerSites: logistics.partnerSites,
    transportLegs: logistics.transportLegs,
    dockAppointments: logistics.dockAppointments,
    operationalEvents: logistics.operationalEvents,
    logistics,
    inventory: getInventoryData(),
    kpis: calculateKpis()
  };
}

migrate();
