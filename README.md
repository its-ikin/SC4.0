# GSK TwinOps AI - Agentic Warehouse Digital Twin Orchestrator

Academic Supply Chain 4.0 prototype for a simulated GSK-inspired pharmaceutical warehouse digital twin in Singapore. The app combines a React operations dashboard, a persistent SQLite backend, deterministic server-side tools, a logical multi-agent orchestration layer, Socket.io telemetry, and a strictly read-only assistant.

Simulation mode: This prototype uses GSK-inspired pharmaceutical warehouse, IoT, shipment, route, and compliance data for academic demonstration. Public Singapore facilities may be used as geographic anchors for plausible transport lanes, but all commercial relationships and operations are fictional. It does not represent real GSK or partner operations.

## What It Includes

- Full-stack monorepo: React 18 + Vite + TypeScript client, Express + TypeScript server, shared TypeScript types.
- SQLite persistence with 12 simulated products, 36 batch/location stock balances, 7 warehouse zones, 6 docks, 6 inbound ASNs, 8 outbound shipments, 15 partner sites, 14 transport legs, telemetry, alerts, assistant enquiries, and scenario snapshots.
- One integrated WMS/TMS operating model for partner sites, ASNs, customer deliveries, bidirectional transport legs, dock appointments, warehouse milestones, inventory movements, and auditable operational events.
- Four logical agents: Orchestrator, Inventory, Logistics, Compliance.
- Read-only deterministic tools for inventory, FEFO, cold-chain, dock, route, audit, and what-if analysis.
- Always-visible chat panel with streaming SSE response UI, agent badges, tool call log, confidence score, and evidence panel.
- Dashboard views: Warehouse 3D scene, Inventory, Leaflet/OpenStreetMap bidirectional Logistics, Monitoring, and a cross-domain Audit ledger.
- Inventory includes a read-only Risk & Replenishment planner with 7/14/30-day demand scenarios, lead-time stock-out detection, safety-stock and reorder thresholds, conditional inbound supply, FEFO expiry exposure, and suggested order quantities.
- Inventory, Logistics, Warehouse, Monitoring, and Audit resolve the same operational IDs and records rather than maintaining separate shipment workflows.
- Dashboard Open Alerts uses an urgency/importance matrix (Act Now, Plan, Review, Monitor) with expandable alert counts.
- Open Alerts and Audit share one deterministic operational-issue model, so active counts, urgency, importance, status, and classification reasons remain consistent across views.
- Operational issue lifecycle transitions are persisted append-only: opened, reopened, reclassified, status changed, updated, and resolved events remain traceable in Audit.
- Audit combines inventory movements, cold-chain incidents, logistics alerts, RFID activity, and assistant enquiries in one chronological record. Significant Activity is the readable default, while Full Ledger retains every available RFID record; PDF and JSON exports are both available.
- Socket.io events for temperature updates, RFID scans, alerts, shipment status, and dashboard refreshes.
- Demo mode works without `OPENAI_API_KEY`; OpenAI is optional and only called from the backend.

## Inventory Risk & Replenishment Planning

The Inventory `Planning` workspace is a deterministic planning projection, not a learned demand forecast. It uses the current available quantity together with each product's configured average daily demand, safety stock, reorder point, target stock, supplier lead time, quality-released outstanding inbound, and released FEFO lots. Users can compare 7, 14, and 30-day horizons and vary demand from 0.5x to 2x without changing operational records.

The canonical pharmaceutical fixture includes three connected 14-day examples: adalimumab has a critical lead-time stock-out linked to `SHIP-006`, influenza vaccine has a safety-stock replenishment warning linked to three `SHIP-002` batch allocations, and omeprazole has released-lot FEFO expiry exposure. These are not Planning-only rows: the same products, lots, stock buckets, warehouse locations, outbound lines, transport records, movements, and audit evidence appear throughout the operational workspaces.

The planner itself makes no model call. Its `Ask Assistant` button follows the same handoff used elsewhere: it sends the visible scenario values and stable product identifiers, then the read-only `get_inventory_planning` tool independently reproduces the projection from authoritative warehouse data before the assistant explains it. Incoming quantities remain conditional until receipt, quality release, and put-away, and suggested replenishment quantities do not create purchase orders.

## SQLite Runtime Note

The requested `better-sqlite3` native install failed in this environment because Node 24 had no prebuilt binary and the Windows Visual Studio C++ build toolchain was unavailable. To keep `npm run install:all` and the demo working, the server uses Node 24's built-in `node:sqlite` `DatabaseSync` fallback. It still persists to `server/db/twinops.sqlite` and keeps deterministic tool results grounded in SQLite records.

## Setup

```bash
npm run install:all
cp .env.example .env
npm run reset-db
npm run start:system
```

Default URLs:

- Client: `http://localhost:5173`
- Server: `http://localhost:3002`
- Health: `http://localhost:3002/api/health`

The included orchestrator starts the server on `3002` and the Vite client on `5173`, writes logs under `.runtime/logs`, and tracks process IDs in `.runtime/orchestrator-state.json`.

```powershell
npm run start:system
npm run status:system
npm run logs:system
npm run stop:system
```

You can also call it directly:

```powershell
.\orchestrator.cmd start
.\orchestrator.cmd status
.\orchestrator.cmd logs
.\orchestrator.cmd stop
.\orchestrator.cmd restart
```

Double-clicking `orchestrator.cmd` opens an interactive menu for start, stop, restart, status, and logs.

Optional `.env` values:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=o3-mini
PORT=3001
NODE_ENV=development
ORS_API_KEY=your_openrouteservice_key_here
AUTO_ADVANCE_SHIPMENTS=false
```

Never put real secrets in committed files. The frontend never reads `OPENAI_API_KEY` or `ORS_API_KEY`; OpenRouteService routing is called only from the backend.

## Logistics Map

The Logistics view uses `react-leaflet`, `leaflet`, and OpenStreetMap tiles for one bidirectional inbound/outbound execution map. Suppliers, customers, the warehouse, transport legs, dock appointments, and WMS records share stable IDs. The backend computes driving geometry, distance, and duration in this order: OpenRouteService when `ORS_API_KEY` is configured, then the public OSRM route API, then fallback geometry only if both providers fail. Compatibility route projections are cached in SQLite and refreshed manually from the Logistics page or via:

```powershell
Invoke-RestMethod -Method Post http://localhost:3002/api/routes/refresh
```

Route endpoints:

- `GET /api/logistics` - returns the canonical partner sites, transport legs, dock appointments, and operational events in one payload.
- `GET /api/partner-sites` - returns supplier, customer, warehouse, and carrier-site master data.
- `GET /api/transport-legs?direction=inbound|outbound` - returns canonical legs, optionally filtered by direction.
- `GET /api/dock-appointments` - returns appointments linked to transports and WMS documents.
- `GET /api/operations/events` - returns cross-domain WMS/TMS operational events.
- `GET /api/routes?direction=inbound|outbound` - returns the compatibility route projection with decoded coordinates.
- `GET /api/routes/debug` - returns provider diagnostics without exposing API keys.
- `POST /api/routes/refresh` - refreshes all configured inbound routes through OpenRouteService, OSRM, then fallback.
- `POST /api/routes/compute` - computes and caches one route by `routeId`.

Oversight endpoints:

- `GET /api/issues` - returns the current cross-domain operational issues used by both the Dashboard matrix and Audit action queue.
- `GET /api/issues/history` - returns the append-only operational issue lifecycle, including priority and status transitions.
- `GET /api/audit` - returns the expanded chronological event ledger, including full available inventory-movement, alert, decision, and RFID history.
- `POST /api/audit/export` - returns the machine-readable shift report with current issues and the expanded audit ledger.

If `ORS_API_KEY` is missing, quota-limited, or OpenRouteService fails, the server tries OSRM before using fallback coordinates. The Logistics page still renders a real Leaflet/OpenStreetMap map in every case; the fallback badge appears only when both routing providers fail. Public facilities are geographic anchors only: partner relationships, volumes, schedules, vehicles, and operating events are explicitly simulated. `AUTO_ADVANCE_SHIPMENTS` is off by default so normal WMS states change only through confirmed operations; set it to `true` only for an accelerated unattended demo.

## Scripts

- `npm run install:all` - install root, client, server, and shared workspace dependencies.
- `npm run dev` - run Express/Socket.io server and Vite client.
- `npm run build` - typecheck all workspaces and build the client.
- `npm run typecheck` - run TypeScript checks only.
- `npm run start:system` - start backend and frontend through `orchestrator.cmd`.
- `npm run stop:system` - stop the backend/frontend processes started by the orchestrator.
- `npm run restart:system` - stop and start the managed system.
- `npm run status:system` - show process and HTTP readiness for server/client.
- `npm run logs:system` - show recent server/client orchestrator logs.
- `npm run seed` - seed only if the database is empty.
- `npm run reset-db` - delete and reseed the local SQLite database.

## Demo Queries

1. `Where is stock item STK-100001-01, and what are its lot, STO, expiry, and quality status?`
2. `What stock is available for PH-COLD-ADAL40-PEN, and which lots are excluded from FEFO?`
3. `Show all QA Hold, Pending QA, and Quarantine inventory with their locations and quantities.`
4. `Give me the full WMS batch detail for lot L2601-INSGLA-01, including arrival and dwell information.`
5. `Check Cold Storage temperature status and identify the cold-chain inventory currently stored there.`

## 5-Minute Video Script

1. Open the dashboard on Warehouse view. Point out the 3D zones, KPI bar, persistent chat panel, and simulation disclaimer.
2. Run the SKU query for `GSK-VAX-2291`. Show Cold Storage pulsing, the zone drawer, Rack `CS-R04`, Bin `B17`, FEFO grid highlight, stage chain, tool log, and confidence.
3. Run the heavy rain Changi route disruption query. Show Logistics, Compliance, and Inventory agents, route ETA impact, dock conflict, FEFO/cold-chain evidence, and the read-only analysis badge.
4. Open Monitoring and submit the same Weather Disruption scenario. Show mitigation options A/B/C and confirm that the scenario creates no operational alert or state change.
5. Open Assistant Chat Log in Audit. Show the recorded question, response, evidence, referenced records, and read-only operating mode.
6. Expand an Open Alerts matrix quadrant, then export the readable PDF shift report. Close by explaining hallucination safeguards: deterministic SQLite tools, evidence panel, no hidden chain-of-thought, and no assistant mutation authority.

## Known Limitations

- Telemetry, routes, weather, RFID, and compliance fields are simulated for academic demonstration.
- The OpenAI call is optional narrative enhancement; deterministic orchestration remains the source of operational facts.
- `node:sqlite` is experimental in Node 24, but it avoids native build failures and persists a real SQLite file.
- The 3D warehouse uses simple geometry, not a CAD-accurate warehouse model.
- HSA-style regulatory fields are for academic simulation only; this app does not claim real HSA compliance.
