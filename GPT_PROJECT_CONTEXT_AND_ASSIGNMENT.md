# GPT Project Context and Assignment

## GSK TwinOps AI - Supply Chain 4.0 Group Assignment II

Context prepared on 18 July 2026 (Asia/Singapore).

This file is a self-contained handoff for another GPT or coding agent. Read it before changing the project. It describes the academic brief, the current implementation, the verified runtime state, known inconsistencies, and the next assignment.

The project is currently located in the folder containing this file. Treat all paths below as relative to that project root.

---

## 1. Immediate instructions for the receiving GPT

1. Read this file completely.
2. Inspect the current source code before relying on older prose or screenshots.
3. Use the source-of-truth order in the next section.
4. Preserve the current safety boundary: the assistant is advisory and cannot mutate operational WMS/TMS state.
5. Do not expose or copy values from either .env file.
6. Do not claim that an approval workflow exists. The current approval and rejection endpoints return HTTP 410.
7. Do not use the obsolete GSK-VAX-2291 demo identifier. Use a real seeded identifier listed in this file.
8. Run verification after changes and report exact results, including warnings and failures.
9. Ask the project owner for group details, a GitHub destination, and hosting/recording decisions when those become necessary. Do not invent them.

---

## 2. Source-of-truth hierarchy

Several artifacts were created at different stages and do not all describe the current system. Use this order:

1. Current source code and current tests.
2. docs/reflection_notes.md for the intended present-day safety model.
3. README.md and docs/integrated-wms-tms.md for setup and domain architecture.
4. docs/DEVELOPMENT_LOG.md for history and rationale, not current truth.
5. Existing runbooks, screenshots, PPTX, and PDF files only as artifacts to audit. Some contain obsolete approval-era claims.

When two sources conflict, verify the code and tests. Do not silently blend both versions.

---

## 3. Academic assignment brief

### Module and assignment

- Singapore Institute of Technology.
- Module: Supply Chain 4.0, DSC2301/DSC2311.
- Group Assignment II.
- Assignment title: Building an AI Agent for Digital Supply Chain Orchestration.
- Format: LLM-assisted functional prototype plus video demonstration.
- Deadline stated in the brief:
  - DSC2311: 23 July 2026, 12:00 PM.
  - DSC2301: 24 July 2026, 12:00 PM.

### Core task

Build a functional Digital Orchestrator using vibecoding methods. The agent should synthesize real-time or simulated digital-supply-chain data to address a specific operational bottleneck. It should do more than retrieve information: it should reason across trade-offs and suggest proactive interventions.

### Learning outcomes

The assignment asks students to:

- Evaluate LLM-agent architecture in an industrial context.
- Build a functional web chatbot using rapid AI-assisted development tools.
- Integrate a state-of-the-art model/API.
- Design and simulate a professional supply-chain interaction for a defined persona.
- Critically reflect on hallucination risk versus operational agility.

### Selected scenario

The chosen scenario is The Warehouse Digital Twin Interface.

The brief's example asks how warehouse flow changes when an urgent medical shipment is prioritized and how the remaining SKUs are affected under FEFO.

This implementation specializes the scenario into a simulated pharmaceutical warehouse in Singapore, where FEFO, quality release, cold-chain integrity, traceability, docks, and transport timing must be evaluated together.

### Technical requirements from the brief

- Define an industrial persona.
- Define operating constraints.
- Define action logic for missing, out-of-distribution, or conflicting data.
- Provide a clean and responsive chat interface.
- Provide at least one dashboard/data visualization generated through a modern AI-assisted build workflow.

### Deliverables

- Functional web app: URL or source link, with GitHub repository referenced in the reflection report.
- Conversation demo: MP4, maximum 5 minutes, showing a complex digital-supply-chain what-if scenario.
- Reflection report: PDF, maximum 3 slides, documenting architecture, technical flow, and challenges.

### Evaluation rubric

| Area | Weight | What the project must demonstrate |
|---|---:|---|
| Industry authenticity | 30% | Realistic complexities of the chosen supply-chain scenario |
| Technical robustness | 30% | Stable codebase and successful API integration |
| UI/UX design | 20% | Clear information presentation and useful dashboard behavior |
| Critical reflection | 20% | Insight into ethical and operational AI risk in critical infrastructure |

---

## 4. Project identity

### Name

GSK TwinOps AI, shown in the UI as TwinOps Control.

### One-sentence description

A full-stack, GSK-inspired pharmaceutical warehouse digital twin that joins WMS, TMS, inventory, cold-chain, dock, route, monitoring, audit, and assistant evidence into one simulated Singapore operations command center.

### Simulation boundary

- All warehouse operations, orders, quantities, vehicles, partners, routes, telemetry, compliance records, and commercial relationships are simulated for academic demonstration.
- Public Singapore facilities may be used as geographic anchors for plausible transport lanes.
- The project does not represent real GSK operations or real relationships with any named organization.
- It contains no patient data.
- HSA-style or GDP-style fields are educational simulations, not compliance certification.

This disclaimer must remain visible in documentation and the demonstration.

### Operator persona

TwinOps Control acts as a Senior Pharmaceutical Warehouse Control-Tower Planner for a GDP-aligned Tier-1 3PL in Singapore.

The assistant should sound like a calm and decisive operations colleague. It should lead with the operational conclusion, cite exact evidence, explain uncertainty, and identify the next read-only check.

### Hard operating constraints

1. Patient safety, product quality, traceability, and stock integrity come before speed, cost, or utilization.
2. Cold-chain integrity is never traded away.
3. FEFO is respected unless the user explicitly requests a what-if simulation.
4. QA Hold, Quarantine, Pending QA, and expired stock are unavailable.
5. Incoming stock is unavailable until received, quality-released, and put away.
6. Reserved, picked, packed, and staged stock is not freely available.
7. A simulation must never be described as an applied change.
8. The assistant cannot create, approve, reject, or apply an operational action.
9. Unknown identifiers or missing evidence must produce an unavailable/blocked explanation, not a guess.
10. Exact IDs must be preserved for traceability.

---

## 5. Canonical present-day design decision

### The assistant is strictly read-only

The current code intentionally separates advice from authority.

- The assistant can read facts, compare trade-offs, run what-if projections, recommend a next check, and navigate the user to a workspace.
- It cannot dispatch stock, release quality status, resequence a dock, change a route, approve an action, or mutate WMS/TMS operating state.
- All new assistant enquiries are stored with requiresApproval = false and approvalStatus = not_required.
- POST /api/approve returns HTTP 410 with a message that approval is disabled.
- POST /api/reject also returns HTTP 410.
- Legacy mutation tool names remain in the deterministic router only to reject them explicitly.
- Mutation tools are not included in the model's function-calling tool schema.

What-if tools do write scenario snapshots and assistant enquiries to the audit database. Those are evidence/audit writes, not operational WMS/TMS mutations.

### Why this design should be preserved

The academic brief asks the agent to reason and suggest proactive interventions; it does not require the LLM to execute them. The current design supports agentic reasoning while avoiding unsafe or misleading autonomous authority in a pharmaceutical setting.

If the project owner later wants to restore a human approval workflow, treat that as a separate architecture decision requiring explicit authorization, tests, UI changes, audit rules, and rewritten submission artifacts. Do not infer that change from older slides.

---

## 6. Architecture overview

~~~mermaid
flowchart LR
    U["Warehouse operator"] --> C["React/Vite client"]
    C -->|"REST + SSE"| S["Express server"]
    S --> O["Orchestrator"]
    O --> A["Inventory / Logistics / Compliance agent roles"]
    O --> T["20 deterministic read-only and simulation tools"]
    T --> D["SQLite WMS/TMS operating record"]
    S -->|"Socket.io"| C
    S --> W["Open-Meteo weather"]
    S --> R["ORS -> OSRM -> fallback routing"]
    O -. "optional function calling and response wording" .-> L["OpenAI model"]
    D --> AU["Append-only audit and issue lifecycle"]
~~~

### Monorepo

| Area | Technology | Responsibility |
|---|---|---|
| client | React 18, Vite, TypeScript, Tailwind, Zustand | UI, linked navigation, dashboards, chat, evidence, 3D warehouse, map |
| server | Express, TypeScript, Socket.io, OpenAI SDK | API, deterministic tools, orchestration, routing, telemetry, audit, persistence |
| shared | TypeScript | Shared domain types, temperature grouping, schedule adherence, issues, audit event construction |
| database | Node 24 node:sqlite DatabaseSync | Persistent simulated WMS/TMS state in server/db/twinops.sqlite |

### Important runtime limitation

better-sqlite3 was not usable in the original Windows/Node 24 environment because no compatible prebuilt binary or C++ build toolchain was available. The project uses Node 24's experimental built-in node:sqlite module.

SQLite is configured with:

- WAL journal mode.
- busy_timeout = 5000.
- foreign keys enabled.

### Key files

| File | Purpose |
|---|---|
| README.md | Main setup, feature, API, and demo documentation |
| client/src/App.tsx | App shell and Socket.io subscriptions |
| client/src/store.ts | Zustand state and cross-workspace navigation |
| client/src/components/ChatPanel.tsx | Assistant UI, scenario priority, evidence, tool activity, inspector |
| client/src/components/DashboardView.tsx | Management summary, cold-chain trend, issue matrix |
| client/src/components/WarehouseView.tsx | Warehouse workspace and 3D context |
| client/src/components/WarehouseModelView.tsx | Code-rendered React Three Fiber warehouse |
| client/src/components/InventoryControlView.tsx | Inventory overview, stock, and movement ledger |
| client/src/components/LogisticsView.tsx | Leaflet network, execution board, site and leg detail |
| client/src/components/MonitoringView.tsx | Temperature and RFID live feeds |
| client/src/components/AuditView.tsx | Event ledger, exception cases, decisions, exports |
| server/src/index.ts | Express endpoints, SSE chat, audit export, startup |
| server/src/orchestrator.ts | Function-calling agent loop, deterministic fallback router, response persistence |
| server/src/agentResponse.ts | Persona, grounding prompt, structured response validation |
| server/src/tools.ts | Deterministic read-only lookups and what-if tools |
| server/src/realtime.ts | Temperature, RFID, alert, issue, and optional shipment simulation loops |
| server/src/db/database.ts | Schema, migrations, reads, and warehouse snapshot construction |
| server/src/db/seed.ts | Main simulated WMS/TMS data and POC timeline rebasing |
| shared/types/index.ts | Shared data model and deterministic business rules |
| docs/integrated-wms-tms.md | Canonical WMS/TMS operating-model rules |
| docs/reflection_notes.md | Current reflection narrative and safety boundary |
| docs/DEVELOPMENT_LOG.md | Historical design and bug-fix log |

---

## 7. User experience and screens

### Dashboard

- Cross-domain KPI row.
- Cold Storage temperature trend.
- Open operational issues shown as an urgency/importance matrix:
  - Act Now.
  - Plan.
  - Review.
  - Monitor.
- Next actions and deep links into the relevant workspace.
- Live Open-Meteo weather widget.

### Warehouse

- Interactive light-theme 3D/isometric warehouse built with React Three Fiber.
- Code-rendered rooms, racks, docks, lanes, checkpoints, sensors, pallets, and process routes.
- Selectable zones, racks, bins, stock, docks, RFID gates, and sensors.
- Operational modes include Overview, FEFO, Cold Chain, Dock Flow, and QA Hold.
- Selections synchronize with the assistant and other views.

### Inventory

- Overview, stock, planning, and movements workspaces.
- Product, batch/lot, stock-balance, quality, quantity, expiry, dwell, rack/bin, and FEFO context.
- Inbound ASN and outbound shipment drilldowns.
- Restricted quality stock is visibly separated and excluded from eligible allocation.
- The read-only Planning workspace projects 7/14/30-day stock risk using configured average demand, safety stock, reorder point, target stock, lead time, conditional quality-released inbound, and FEFO expiry exposure.
- Planning calculations make no model call. `Ask Assistant` explicitly hands the selected scenario to the existing grounded assistant flow for evidence collection and interpretation.
- Append-only movement ledger.

### Logistics

- Real Leaflet/OpenStreetMap network.
- Inbound and outbound legs in the same operating model.
- Partner sites, vehicle/carrier context, route status, appointment, dock, WMS reference, lines, schedule adherence, and operational milestones.
- Route calculation order: OpenRouteService when configured, public OSRM, then explicit fallback geometry.
- Read-only transport what-if drawer.

### Monitoring

- Five-second simulated temperature updates.
- RFID feed emitted every approximately 3-8 seconds.
- Temperature-event grouping into excursion and non-conformance history.
- Active/recovered status is kept distinct.
- Live feed can be paused at the UI level without changing server simulation.

### Audit

- Cross-domain significant-activity ledger.
- Full ledger with RFID history.
- Operational exception cases.
- Assistant enquiry/decision records.
- Append-only operational issue lifecycle.
- Filters for date range, domain, actor, source system, event type, status, and search.
- JSON export through the API and formatted print/PDF workflow in the UI.

### Assistant

- Always-available side panel.
- First-open persona introduction and example questions.
- Streaming SSE response tokens.
- Agent/tool progress events.
- Structured response card with status, verified facts, operational impact, data gaps, confidence, evidence, and next action.
- Scenario priority selector:
  - Balanced.
  - FEFO first.
  - Cold-chain first.
- Selected UI context can resolve phrases such as “this shipment,” but selected UI state is never treated as operational evidence.

---

## 8. Agent and tool architecture

### Logical agents

- Orchestrator.
- Inventory.
- Logistics.
- Compliance.

These are logical responsibilities within one backend process, not separate deployed services.

### With an OpenAI API key

1. The model receives only the tool-routing prompt, the operator query, the selected analysis priority, and sanitized UI context.
2. It may select and chain deterministic functions for up to four tool-calling rounds.
3. Tool outputs come from SQLite and deterministic services.
4. A second structured-response step formats the verified result.
5. The server validates the response schema.
6. If model formatting fails, a deterministic formatter produces the response.
7. The enquiry and evidence are persisted in ai_decisions.

### Without an OpenAI API key

A deterministic keyword/identifier router selects the same backend tools. The demo remains functional without the narrative model.

### Current function-calling tool set: 21 tools

The existing slides say 18 tools; that count is stale.

#### Inventory and warehouse evidence

1. get_inventory_summary
2. search_inventory
3. get_product_stock
4. get_inventory_planning
5. get_batch_detail
6. get_incoming_stock
7. get_outbound_stock
8. get_inventory_movements
9. check_fefo_allocation
10. simulate_shipment_allocation
11. locate_sku
12. check_fefo_impact

#### Cold-chain and compliance evidence

13. check_cold_chain_status
14. get_temperature_events

#### Logistics evidence

15. get_route_status
16. get_transport_context
17. check_dock_schedule

#### Audit evidence

18. get_audit_lookup

#### What-if simulations

19. simulate_reprioritisation
20. simulate_event_impact
21. simulate_transport_impact

All simulate tools project effects and set mutationApplied = false. They may persist a scenario snapshot for traceability.

### Structured assistant response

The model response is validated into:

- intent.
- status.
- short title.
- one-sentence summary.
- exact verified facts.
- operational impact.
- one permitted read-only next action.
- requiresApproval = false.
- explicit data gaps.
- confidence: high, medium, or low.

No hidden chain-of-thought is exposed. The UI shows evidence and concise tool summaries instead.

---

## 9. Data model and operating rules

### Canonical WMS/TMS graph

- partner_sites: warehouse, supplier, gateway, return origin, and customer locations.
- transport_legs: inbound/outbound movement, route, carrier, vehicle, timing, status, temperature requirement.
- dock_appointments: yard/dock slot linked to a transport and WMS document.
- inbound_shipments and inbound_lines: ASN and receipt state.
- outbound_shipments and outbound_lines: allocation and fulfillment state.
- products, batches, warehouse_locations, and stock_balances: inventory truth.
- inventory_movements: append-only quantity-changing execution.
- warehouse_operational_events: non-quantity WMS/TMS milestones.

Compatibility tables and objects exist for older Warehouse components, but they must remain derived projections and must not become a second mutable source of truth.

### Oversight and AI records

- alerts: current/history alert records.
- operational_issues: durable current issue index.
- operational_issue_events: append-only opened/reopened/reclassified/status-changed/updated/resolved history.
- ai_decisions: assistant enquiry, response, tools, confidence, risk, and evidence.
- scenario_snapshots: before/after what-if projections.
- approval_actions: legacy compatibility table; not a live approval queue.

### Core data integrity rules

- Every ASN has a supplier, inbound leg, route, and receiving appointment.
- Every outbound shipment has a customer, outbound leg, route, and dispatch appointment.
- Transport direction must match origin and destination roles.
- Restricted or expired inventory cannot be allocated or dispatched.
- Cold-chain loads require compatible dock/staging and vehicle capability.
- Planned times are not overwritten by actual times.
- Status should derive from milestones where possible.
- Every state change is append-only in the audit history even when a current-state row is updated.

### Seeded data shape verified from the running application

Counts below describe master/operational data and are stable after a normal reset unless the seed is changed:

| Entity | Count |
|---|---:|
| Operational zones | 8 |
| Products | 12 |
| Batches | 36 |
| Warehouse locations | 45 |
| Stock balances / inventory placements | 36 |
| Inbound ASNs | 6 |
| Outbound shipments | 8 |
| Partner sites | 15 |
| Transport legs | 14 |
| Dock appointments | 14 |

Alerts, issue counts, telemetry rows, operational events, assistant enquiries, and scenario snapshots are volatile and should be read from the current UI/API rather than quoted from memory.

### Real seeded identifiers suitable for demonstrations

Use these instead of obsolete GSK-VAX identifiers:

- Stock balance: STK-100001-01.
- Product: PH-COLD-INSGLA-PEN.
- Batch ID: B-L2601-INSGLA-01.
- Lot code: L2601-INSGLA-01.
- Cold product with a QA-held balance: PH-COLD-ADAL40-PEN.
- QA-held balance: STK-100004-02.
- Blocked outbound shipment: SHIP-005.
- Changi inbound leg: LEG-IN-1001.
- Changi ASN: ASN-1001.

Verify the current seed before recording because future changes may alter statuses or timelines.

---

## 10. Live and simulated behavior

### Ambient runtime feeds

- Temperature:
  - Server writes a new reading for each zone every 5 seconds.
  - The client receives temperature:update.
  - Temperature alerts are evaluated on the same 5-second cadence so transient excursions are not missed.
- RFID:
  - A simulated scan is persisted and emitted approximately every 3-8 seconds.
  - The client receives iot:rfid_scan.
- Alerts and issues:
  - Alert conditions reconcile and auto-resolve when their underlying state clears.
  - The shared operational-issue builder supplies the same active issue set to Dashboard and Audit.
  - Issue lifecycle changes are append-only.
- Weather:
  - Open-Meteo current conditions are fetched without an API key.
  - Weather enriches a disruption scenario only when current conditions meet disruption thresholds.
  - The deterministic simulated baseline remains available for reproducible demos.
- Shipments:
  - Automatic 25-second stage advancement is disabled in the normal proof-of-concept configuration.
  - It runs only when POC_STATIC_OPERATIONS is false and AUTO_ADVANCE_SHIPMENTS is true.

### Proof-of-concept timeline behavior

POC_STATIC_OPERATIONS defaults to true. At server startup, schedule timestamps are coherently rebased while WMS/TMS quantities, assignments, and status records remain fixed. This keeps the demo timeline current without silently completing all deliveries.

---

## 11. API surface

### Health and state

- GET /api/health
- GET /api/weather
- GET /api/warehouse
- GET /api/warehouse/inventory-placements
- GET /api/warehouse/skus
- GET /api/warehouse/zones

### Inventory and shipments

- GET /api/inventory
- GET /api/inventory/summary
- GET /api/inventory/incoming
- GET /api/inventory/outbound
- GET /api/inventory/movements
- GET /api/shipments

### Logistics

- GET /api/logistics
- GET /api/partner-sites
- GET /api/transport-legs
- GET /api/dock-appointments
- GET /api/dock-schedule
- GET /api/operations/events
- GET /api/routes
- GET /api/routes/debug
- POST /api/routes/refresh
- POST /api/routes/compute

### Oversight and audit

- GET /api/alerts
- GET /api/issues
- GET /api/issues/history
- GET /api/audit
- POST /api/audit/export

### Assistant and simulation

- POST /api/chat: SSE stream with agent, token, final, and error events.
- POST /api/tools/:toolName: deterministic tool call.
- POST /api/simulate: supported what-if entry point.
- GET /api/ai/test: optional model connectivity check; do not use it if secrets or usage are not authorized.

### Disabled legacy endpoints

- POST /api/approve: HTTP 410.
- POST /api/reject: HTTP 410.

---

## 12. Setup and operation

### Expected environment

- Windows PowerShell is supported by the included orchestrator.
- Node 24 is used in the current environment.
- npm workspaces are used for client, server, and shared packages.

### Install and reset

~~~powershell
npm run install:all
Copy-Item .env.example .env
npm run reset-db
~~~

Do not overwrite an existing .env unless the owner explicitly requests it.

### Managed start

~~~powershell
npm run start:system
npm run status:system
npm run logs:system
npm run stop:system
~~~

Managed URLs:

- Client: http://localhost:5173
- Server: http://localhost:3002
- Health: http://localhost:3002/api/health

The standalone server default is port 3001, but orchestrator.ps1 explicitly supplies port 3002.

### Environment variables

- OPENAI_API_KEY: optional; backend only.
- OPENAI_MODEL: optional model name.
- OPENAI_TIMEOUT_MS: optional model timeout.
- ORS_API_KEY: optional OpenRouteService key; backend only.
- PORT: standalone server port.
- AUTO_ADVANCE_SHIPMENTS: false by default.
- POC_STATIC_OPERATIONS: true by default.

There are currently two ignored secret files: .env and server/.env. Never print their values. A future cleanup should decide which one is canonical.

### Configuration drift to reconcile

- README.md shows OPENAI_MODEL=o3-mini.
- .env.example shows OPENAI_MODEL=gpt-4.1-nano and FALLBACK_OPENAI_MODEL=gpt-4.1-mini.
- server/src/orchestrator.ts defaults to o3-mini.
- The FALLBACK_OPENAI_MODEL template variable does not appear to be the primary current fallback mechanism; deterministic formatting is used when model formatting fails.

The receiving GPT should verify intended model support before standardizing documentation. Do not change the configured real secret value.

---

## 13. Hallucination and safety safeguards

1. Operational facts come from deterministic server tools, not from model memory.
2. The model receives tool outputs and selected UI context, but UI context is not evidence.
3. Tool calls are constrained by JSON schemas.
4. Only read and simulation tools are exposed.
5. Unknown IDs must fail rather than produce fabricated records.
6. The final response is schema-validated.
7. Missing fields are reported as unavailable.
8. The UI shows evidence, confidence, constraints, alternatives, and uncertainty.
9. OpenAI is optional; deterministic fallback mode remains usable.
10. Every assistant enquiry is auditable.
11. Simulation results are labeled as projections and mutationApplied = false.
12. The assistant does not expose hidden reasoning.

The repository also includes a seven-case adversarial guardrail evaluation script:

~~~powershell
npm run eval:guardrails
~~~

It requires an authorized OpenAI key and was not rerun during this handoff.

---

## 14. Verification performed on 18 July 2026

### Passed

- npm run typecheck passed for shared, server, and client.
- Serial server tests passed: 81/81.
- Client Vitest suite passed: 32/32 across 10 test files.
- Total tests passing when run in the verified sequence: 113.
- npm run build passed for all workspaces.
- Managed server and client were restored and reported ready on ports 3002 and 5173.
- The three-page assignment brief was visually read.
- The three-slide reflection PDF was rendered and visually inspected.

### Default test command problem

The default npm test command currently runs server test files in parallel against the same SQLite database. It failed with:

    Error: database is locked

Observed result before abort:

- Server: 80 passed, 1 failed.
- The failing test was “projects a cross-domain transport scenario without mutating operational records.”
- Because the root script stops after server failure, client tests did not run in that command.

Running the server suite serially passed all 81 tests:

~~~powershell
npx tsx --test --test-concurrency=1 src/**/*.test.ts
~~~

That command was run from the server workspace. This strongly indicates test database concurrency/isolation, not a deterministic functional assertion failure.

Recommended fix:

- Short-term: configure the server test script to use test-concurrency=1.
- Better long-term: allow a per-test/per-worker temporary database path and isolate stateful tests.

The final submission should make npm test pass without special undocumented instructions.

### Build warning

The production build emitted a Vite warning:

- Main JavaScript chunk: approximately 2.30 MB minified, 641.86 kB gzip.
- It exceeds the 500 kB chunk warning threshold.

This does not block the build, but code splitting is a sensible polish task if time allows.

---

## 15. Git and delivery status

### Git

- A .git directory exists.
- Branch name: master.
- There are no commits.
- No remote is configured.
- The whole source tree is currently untracked from Git's perspective.

Do not claim that a GitHub repository exists until one is created and the owner provides/approves the destination.

### Ignore rules currently present

- node_modules.
- dist.
- .env.
- log files.
- SQLite database and WAL/SHM files.
- client Vite cache.

The repository still shows .runtime, outputs, and tmp as untracked. Decide intentionally which generated assets should be committed and extend .gitignore where appropriate.

### Existing deliverable artifacts

- outputs/GSK_TwinOps_Reflection_3_Slides.pptx.
- outputs/GSK_TwinOps_Reflection_3_Slides.pdf.
- outputs/TwinOps_5-Minute_Demo_Runbook.md.
- outputs/TwinOps_5-Minute_Demo_Runbook_v2.md.
- Multiple visual audit screenshots and findings files.
- Desktop and mobile warehouse screenshots.

No MP4 demo file was found.

No hosted application URL was found.

---

## 16. Critical inconsistencies and risks

### Priority 0: reflection deck contradicts current code

The existing reflection PDF is visually polished, but slides 2 and 3 describe an approval endpoint that can authorize and mutate state.

Examples of stale claims:

- “only the approval endpoint can change state.”
- “Pending action requires a human.”
- “/api/approve validates status.”
- “Mutation, audit and UI refresh.”
- “Approval + append-only audit.”

Current truth:

- /api/approve and /api/reject return 410.
- The assistant cannot create pending actions.
- New assistant records are not_required for approval.
- There is no current approval queue.

The deck must be rewritten to explain read-only advice, scenario comparison, operator-owned execution outside the assistant, and append-only enquiry/issue audit.

### Priority 0: demo runbook is obsolete

outputs/TwinOps_5-Minute_Demo_Runbook_v2.md instructs the presenter to:

- show a pending approval.
- click Approve.
- show mutation of route/shipment/dock state.
- explain approval validation.

That flow cannot work in the current application and must not be used for recording.

### Priority 0: obsolete demo identifier

README.md and the v2 runbook use GSK-VAX-2291. It is not a current seeded identifier. A grounded assistant should reject it.

Replace the query with a real stock-balance, product, batch, or lot identifier from Section 9.

### Priority 0: missing source/URL and MP4

- The deck footer still contains [ADD GITHUB URL BEFORE SUBMISSION].
- No Git remote or commit exists.
- No hosted app URL exists.
- No MP4 demo exists.

These are submission blockers that require owner input/authorization.

### Priority 1: tool count is stale

The deck says 18 read-only tools. Current function-calling schema exposes 21.

### Priority 1: npm test is not robust

The default test command can fail because parallel server tests share one SQLite database. Serial execution passes.

### Priority 1: documentation/configuration drift

- Model defaults differ between README, .env.example, and code.
- README's demo sequence includes the obsolete SKU.
- Some historical development-log entries describe approval behavior that no longer exists.
- README says 7 warehouse zones in one place while the current snapshot exposes 8 operational zones.

### Priority 2: production bundle size

The build passes but the main client bundle is large. Consider lazy-loading Three.js/warehouse and Leaflet/logistics views.

### Priority 2: generated-artifact hygiene

outputs, tmp, and .runtime contain many development captures and logs. Keep final submission artifacts, remove or ignore disposable material only after confirming with the owner.

### Priority 2: external-provider variability

- OpenAI may be absent or slow.
- Open-Meteo may return clear weather or fail.
- ORS/OSRM may be unavailable or rate-limited.

The demo must have a deterministic fallback path and should distinguish live enrichment from simulation.

---

## 17. Recommended corrected demo scenario

This flow matches the current read-only application.

### 0:00-0:35 - Context and constraint

Show Dashboard.

Explain:

- Simulated Singapore pharmaceutical warehouse.
- One integrated WMS/TMS operating record.
- Safety, quality, cold chain, FEFO, and traceability outrank speed.

### 0:35-1:20 - Grounded inventory lookup

Ask:

> Locate stock balance STK-100001-01. Show the product, lot, expiry, quality status, exact warehouse position, FEFO context, and cold-chain evidence. Identify anything that is not yet verified.

Show:

- Tool/agent activity.
- Exact IDs.
- Rack/bin and zone highlight.
- Evidence, confidence, and data gaps.

### 1:20-3:10 - Complex transport what-if

Ask:

> A 60-minute weather disruption affects inbound leg LEG-IN-1001. Simulate the impact on its ASN, ETA, dock appointment, WMS lines, affected stock and batches, cold-chain risk, schedule conflicts, and safe alternatives. Use the selected scenario priority. Do not change operational state.

Show:

- Logistics, Inventory, and Compliance roles.
- Canonical leg/ASN/appointment links.
- Projected arrival and dock conflicts.
- Cold-chain and restricted-line risk.
- Alternatives and trade-offs.
- mutationApplied = false or equivalent read-only labeling.

If live weather is clear, state that Open-Meteo is an enrichment signal while the 60-minute scenario is the reproducible academic input.

### 3:10-4:10 - Cross-view traceability

Navigate from the response to Logistics, Inventory, Monitoring, or Warehouse.

Explain:

- The same IDs resolve across screens.
- The assistant has not changed the operational snapshot.
- The operator would execute any authorized action through a real external WMS/TMS governance process, which is outside this prototype.

### 4:10-4:45 - Audit

Open Audit and show:

- Assistant enquiry.
- Tools/evidence.
- Scenario record.
- Issue lifecycle or significant activity.
- Actor/timestamp/affected IDs.

### 4:45-5:00 - Reflection

Suggested close:

> TwinOps improves agility by joining inventory, transport, dock, FEFO, and cold-chain evidence in one query. Its main risk is false certainty from incomplete, simulated, or conflicting inputs. We control that risk with deterministic tools, exact IDs, visible evidence and uncertainty, read-only simulations, and append-only audit. The AI recommends at machine speed; accountable operators retain authority in the real operating system.

Stop immediately after the final sentence.

---

## 18. Assignment for the receiving GPT

### Primary objective

Make the project internally consistent, demonstrably robust, and submission-ready while preserving the current read-only assistant architecture.

### Workstream A - Reconcile all submission claims

1. Update the three-slide reflection source and regenerate PPTX/PDF.
2. Remove all claims that /api/approve can mutate state.
3. Replace approval-flow language with:
   - read-only recommendation and scenario comparison.
   - accountable operator authority outside the prototype.
   - assistant enquiry, scenario, issue, and operational audit.
4. Change 18 tools to the verified current count of 20, or avoid a count if it may change again.
5. Replace [ADD GITHUB URL BEFORE SUBMISSION] only after the owner supplies a real URL.
6. Keep the PDF at no more than three slides.
7. Render the regenerated PDF and visually verify every slide.

### Workstream B - Rewrite the video runbook

1. Replace the approval demonstration with the corrected read-only flow in Section 17.
2. Use real seeded IDs.
3. Keep the recording under 5 minutes.
4. Include a deterministic fallback plan for:
   - no OpenAI key.
   - clear live weather.
   - routing provider failure.
   - changed volatile dashboard counts.
5. Do not instruct the presenter to show secrets, .env files, or private terminal history.

### Workstream C - Fix verification reliability

1. Make the default npm test pass.
2. Prefer isolated test databases if feasible; otherwise explicitly serialize server tests.
3. Run:

~~~powershell
npm run typecheck
npm test
npm run build
~~~

4. Run npm run eval:guardrails only if an authorized API key is already configured and the owner approves external model usage/cost.
5. Record exact pass counts and build warnings.

### Workstream D - Documentation consistency

1. Correct README's obsolete demo identifier.
2. Correct the zone count or remove brittle counts.
3. Align model/environment documentation with actual supported behavior.
4. Document the standalone 3001 versus managed 3002 port behavior.
5. State clearly that scenario snapshots are audit writes but not operational mutations.
6. Keep the simulation disclaimer prominent.
7. Mark DEVELOPMENT_LOG as history so old approval entries are not mistaken for current behavior.

### Workstream E - Repository and delivery preparation

These steps require owner confirmation before external publication:

1. Collect group member names, student IDs, module code, and group number.
2. Confirm whether the owner wants GitHub and/or hosted deployment.
3. Decide which outputs and screenshots belong in source control.
4. Add appropriate ignore rules for temporary/runtime artifacts.
5. Create an intentional first commit.
6. Configure and push to the approved remote.
7. Replace the deck's repository placeholder.
8. Record and verify the maximum-five-minute MP4.

Do not publish, push, deploy, or expose secrets without explicit authorization.

### Optional polish after blockers are cleared

- Lazy-load the 3D warehouse and logistics map to reduce the large production chunk.
- Re-run visual consistency audits after final copy changes.
- Add a dedicated test database path to eliminate cross-file SQLite contention.
- Add a concise architecture diagram to the README if it helps graders.

---

## 19. Acceptance criteria

The project is submission-ready only when all of the following are true:

- The web app starts through the managed orchestrator.
- Health is ready at port 3002 and the client is ready at port 5173.
- Typecheck passes.
- The default npm test command passes without a database-lock failure.
- The full production build passes.
- The final deck is no more than three slides.
- The final deck matches the read-only code.
- The final deck contains real group/repository details or clearly awaits owner input.
- The runbook uses real seeded IDs.
- The runbook never asks the user to approve or mutate state through the disabled endpoints.
- The demo includes a complex cross-domain what-if and visible evidence.
- The demo distinguishes simulation from live enrichment.
- The simulation boundary is stated.
- No secrets appear in source, slides, video, logs, or screenshots.
- A real source/host URL is supplied if required.
- The MP4 is five minutes or less.

---

## 20. Questions that require the project owner

Do not invent answers to these:

1. Is the enrolled module DSC2301 or DSC2311, and therefore which deadline applies?
2. What are the group number, member names, and student IDs?
3. What GitHub organization/account and repository name should be used?
4. Should the app be publicly hosted, or is a source link sufficient?
5. Is external OpenAI usage authorized during final verification and recording?
6. Does the owner want the current read-only design preserved? This handoff recommends yes.
7. Which screenshots/audit artifacts should be retained in the final repository?
8. Who will record and narrate the MP4?

---

## 21. Compact prompt to give another GPT

> You are taking over the GSK TwinOps AI Supply Chain 4.0 Group Assignment II project. Read GPT_PROJECT_CONTEXT_AND_ASSIGNMENT.md completely, then inspect the current repository. Treat current code and tests as the source of truth. Preserve the strict read-only assistant boundary unless I explicitly authorize an architecture change. First reconcile the stale reflection deck and video runbook with the current code, replace obsolete demo identifiers, fix the default SQLite test-concurrency failure, align README/environment documentation, and verify typecheck, tests, build, runtime, and final PDF rendering. Do not expose .env values, invent group/GitHub details, publish externally, or claim that the disabled approval endpoints work. Report blockers that require my input.

---

## 22. Final handoff summary

The project is a substantial and mostly working academic prototype, not a blank starter. Its strongest qualities are:

- realistic pharmaceutical WMS/TMS domain modeling.
- deterministic grounding.
- cross-domain read-only what-if analysis.
- linked operational views.
- 3D warehouse and real map visualization.
- live simulated telemetry.
- explicit uncertainty and evidence.
- append-only audit and operational issue lifecycle.

The main submission risk is not missing functionality. It is inconsistency between the current read-only architecture and older approval-era deliverables. Resolve that inconsistency first, then fix the default test command, add real owner/repository details, and produce the final MP4.
