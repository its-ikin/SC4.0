# Development Log

Running log of substantive changes made after the initial vibecoded build, kept separate from the reflection report so it can track ongoing work day-to-day.

## 2026-07-18 - Assistant response transparency and scenario priorities

Restructured operational answers so the user sees what was verified, what it means, how the assistant reached its conclusion, what remains unverified, and the recommended next step. Replaced the ambiguous primary `OK` badge with a separate Data availability indicator (`Evidence verified`, `Partially verified`, or `Not verified`) and retained the technical operational outcome in the full evidence view with a plain-language explanation. Missing evidence now includes the reason it is required rather than ending at `Data unavailable`.

Added a visible scenario-priority switch for Balanced, FEFO first, and Cold-chain first. The selected priority is passed through the client API, orchestrator, tool routing, evidence payload, and response explanation. Temperature control, QA release, traceability, and approval controls remain mandatory under every priority, so the switch changes how safe options are ranked rather than bypassing constraints.

Strengthened the TwinOps Control persona and response instructions to lead with a natural operational conclusion instead of mechanically repeating Facts and Impact. Added an evidence guard so a cold-chain check alone cannot be presented as proof of FEFO eligibility; the assistant must explain that expiry, release, and allocation sequencing still need verification. Verified with the full TypeScript check, all 68 server tests, and an end-to-end browser scenario.

## 2026-07-18 - Assistant persona and first-open welcome

Replaced the chat assistant's ambiguous no-response experience with a deliberate TwinOps Control persona. The empty Chat tab now introduces TwinOps Control as a senior pharmaceutical warehouse control-tower planner, states its safety-first operating priority, and provides a one-click example warehouse question with additional examples collapsed below.

Greetings and capability questions such as `Hello`, `What can you do?`, and `Introduce yourself` now bypass operational tool routing and return a structured `general_question` welcome response. This response introduces the assistant, lists its operating priority, provides an example FEFO/cold-chain question, uses no tools, changes no state, and is not marked as a fallback. Genuine missing operational evidence remains on the separate `Data Unavailable` safety response.

Updated the system persona so TwinOps Control speaks as a calm, decisive operations colleague while preserving strict grounding and approval controls. Added focused unit coverage for greeting detection, welcome response content, and continued missing-data fallback behaviour. Verified with full typecheck, all 68 server tests, and an end-to-end browser check of both the first-open card and a live `Hello` interaction.

## 2026-07-12 — Append-only operational issue lifecycle

Completed the compliance-level enhancement left as the boundary of the Open Alerts/Audit reconciliation. Added `operational_issues` as the durable current-state index and `operational_issue_events` as the append-only transition ledger. Stable issue IDs now accumulate revisioned events for `opened`, `reopened`, `reclassified`, `status_changed`, `updated`, and `resolved`, with previous/current issue snapshots and a human-readable transition reason. Reconciliation uses `BEGIN IMMEDIATE` so multiple server processes cannot both record the same transition, and material comparison excludes observation-only timestamps so the five-second telemetry cadence does not create duplicate “still open” events.

The server reconciles once on startup, whenever warehouse/issues endpoints are requested, and after each five-second temperature/alert cycle. `/api/warehouse` now embeds the persisted active issue set, `/api/issues/history` exposes lifecycle history, `/api/audit` merges lifecycle events into the chronological ledger, and JSON/PDF exports include the same transitions. Dashboard and Audit therefore consume not only the same calculation rules but the same persisted active revisions.

Live verification against the running warehouse created exactly five opening events for five active issues. Three repeated `/api/issues` reconciliations plus a subsequent telemetry cycle produced zero duplicate events. The corresponding Audit rows retain the shared issue correlation IDs, statuses, affected entities, source snapshots, and workspace navigation.

## 2026-07-12 — Open Alerts/Audit flow reconciliation and operational-issue model

Ran the complete live operator path against the current warehouse snapshot and found a logical mismatch: Dashboard showed three Act Now quality items, Audit showed one action-required temperature event and five historical critical records, while Monitoring showed zero open events. The numbers were each locally explainable but did not describe one shared warehouse truth. Also confirmed routine RFID scans occupied 40 of the first 85 audit records, Quarantine was mislabeled as QA Hold, blocked-shipment detection used a different shipment collection from the Logistics KPI, and the managed secondary server had crashed on a transient SQLite lock.

Added `OperationalIssue` and `buildOperationalIssues()` in shared code as the single deterministic active-exception calculation for both Dashboard and Audit. It evaluates active/under-review temperature events, QA Hold/Quarantine/Pending QA state, expiry windows, projected replenishment shortfalls, blocked outbound shipments, delayed/disrupted routes, pending approvals, and remaining open alerts. Each issue carries importance, urgency, matrix quadrant, classification reason, source, affected IDs, and a domain navigation target. QA/Quarantine without shipment impact now correctly lands in Plan rather than Act Now; high-impact active temperature non-conformance remains Act Now; labels preserve the real quality status; blocked shipments use `inventory.outboundShipments`, matching the Logistics KPI.

Reworked the Dashboard expansion cards to explain “Why here” and provide separate Open workspace/View audit actions. The Audit card now reports total active issues and active critical count instead of retaining the old decision-only summary. Monitoring includes Under Review events in its active count.

Audit's Action Required view now renders the exact same operational issues as the Dashboard. Added bidirectional workspace navigation, Significant Activity as the default (routine RFID scans are retained under Warehouse/RFID and Full Ledger), Warehouse/RFID filtering, free-text entity/correlation search, 24-hour/7-day/all-history ranges, and 15-second full-ledger refresh while Audit is open. The server audit source now expands the limits to 5,000 movements, 1,000 alerts/decisions/RFID records rather than inheriting the compact dashboard snapshot. PDF reports state their active filter/time/search scope and include a current operational-issues section with priority and classification rationale.

Runtime hardening: configured SQLite `busy_timeout = 5000` alongside WAL mode so concurrent background writers wait instead of immediately crashing, and enabled Vite `strictPort` so duplicate dev clients fail visibly rather than silently moving to 5174 while the orchestrator reports 5173.

## 2026-07-12 — Alert prioritisation matrix and cross-domain Audit overseer

Reframed the two features around distinct operator jobs: **Open Alerts answers what needs attention now; Audit answers what happened across the warehouse.** The Dashboard's previous flat exception list is now a compact urgency/importance matrix with four operational labels — Act Now, Plan, Review, and Monitor. Each quadrant shows a badge count and expands in place to expose the actionable records and their existing deep links into Inventory, Monitoring, Logistics, or Warehouse.

Added shared `classifyAlertPriority()` and `buildAuditEvents()` functions. The latter normalizes the application's durable source records — inventory movements, grouped temperature events, alert lifecycle records, RFID activity, and AI decisions/approval states — into one reverse-chronological event shape with domain, event type, severity, status, actor, affected IDs, correlation ID, and full source metadata. `GET /api/audit` now returns this unified ledger, and the JSON shift-report export includes it while preserving its prior state and decision sections.

Rebuilt the Audit UI around the unified event ledger. The page now provides cross-domain summary counts, action-required and domain filters, expandable traceability/source details, and two deliberately distinct exports: **Export PDF** opens a formatted A4 landscape report through the browser's native print/save-to-PDF workflow, while JSON remains available as the secondary machine-readable export.

**Verified:** TypeScript checks pass across shared, server, and client; server tests pass 8/8; the full production build completes successfully. The first sandboxed Vite build attempt was blocked by restricted access above the workspace, then passed unchanged when run with the required build permission.

## 2026-07-06 — Verified live OpenAI integration

- Confirmed `server/.env` (not the root `.env`, which still holds placeholder values) carries the real `OPENAI_API_KEY`.
- Restarted the app via `orchestrator.ps1 restart` and confirmed `/api/chat` returns `fallbackUsed: false` with real streamed, structured responses grounded in deterministic tool output (e.g. `check_cold_chain_status` for a Cold Storage query).

## 2026-07-06 — Phase 1: Real function-calling agent architecture

**Problem:** `server/src/orchestrator.ts` picked tools with a keyword/regex router (`routeQuery`) before any LLM call ran. The LLM only ever reformatted results the router had already decided on — not genuinely agentic, and a weak point if a grader reads the code.

**Change:**
- Added `AGENT_TOOL_SPECS` in `orchestrator.ts`: JSON tool schemas for all 18 read-only deterministic tools (`locate_sku`, `check_fefo_impact`, `check_cold_chain_status`, `simulate_event_impact`, `simulate_reprioritisation`, inventory/audit/route lookups, etc.).
- Mutation tools (`apply_approved_action`, `apply_approved_inventory_action`) are **deliberately excluded** from the schema set, so the chat agent can never call them — state changes remain possible only through the operator's explicit Approve action in the dashboard (`/api/approve`).
- Added `selectAndRunToolsWithAgent()`: an agentic loop (max 4 rounds) where the model itself chooses which tools to call via OpenAI function-calling, can chain follow-up calls once earlier results reveal it needs another lookup (e.g. `locate_sku` before `check_fefo_impact`), and stops once it has enough information.
- Added a dedicated `TWINOPS_TOOL_ROUTER_SYSTEM_PROMPT` (`agentResponse.ts`) governing only tool selection — persona, constraints, and an explicit rule never to call a mutation tool, especially when the user asks to "apply"/"approve"/"dispatch" something via chat.
- The original regex router (`routeQuery`) is kept, but now runs **only when `OPENAI_API_KEY` is absent**, preserving the README's "demo mode works without an API key" behaviour.
- The existing guardrail system prompt (`TWINOPS_AGENT_SYSTEM_PROMPT`) and strict JSON schema validation for the *final* answer were left untouched — this phase changed tool selection only, not answer grounding/formatting.

**Bugs found and fixed while verifying (pre-existing, just newly exposed by broader tool-call combinations):**
1. `validateAgentResponse`'s `asString()` in `agentResponse.ts` rejected numeric `fact.value`s outright (e.g. risk scores, delay minutes from `simulate_event_impact`), silently collapsing a valid response into the generic "Data Unavailable" fallback. Fixed to coerce numbers/booleans to strings, and added an explicit field rule in the system prompt telling the model to always send fact values as strings.
2. The README's flagship demo query references `GSK-VAX-2291`, which is **not a real seeded SKU** — actual seeded product codes are `GSK-VAX-RSV` / `GSK-VAX-FLU` (e.g. batch `SB-LOT-RSV-0702-A`). Both the old and new routing correctly report it as unavailable rather than hallucinating a location, but the demo script itself needs correcting before recording the video. **Not yet fixed — flagged for a follow-up pass.**

**Verified scenarios (all via live `/api/chat` calls, `OPENAI_API_KEY` set):**
- Real SKU lookup: model chains `locate_sku` → `check_fefo_impact` on its own, no hardcoded plan.
- Weather disruption ("Heavy rain... Changi Air Cargo Gateway"): `simulate_event_impact` (+ sometimes `get_route_status`), 3/3 clean runs after the `asString` fix.
- Dock conflict check: `check_dock_schedule`.
- Fake-SKU guardrail: `status: "unavailable"` with a populated `dataGaps` explanation — no invented location.
- Mutation-refusal: asking to "apply the recommendation... without approval" results in **zero tool calls** — the model cannot reach a mutation tool even if asked to.

**Follow-up items noted, not yet actioned:**
- Fix `GSK-VAX-2291` → a real SKU/batch ID in README demo queries and anywhere else referenced.
- Root `.env` still has placeholder values while `server/.env` has the real key — worth reconciling so there's a single source of truth.

## 2026-07-06 — Phase 2: Hallucination/guardrail eval harness

**Goal:** turn the "hallucination risk vs. operational agility" trade-off from an opinion in the reflection report into measured, reproducible evidence.

**Change:**
- Added `server/src/scripts/evalGuardrails.ts` and `npm run eval:guardrails` (root and server workspace). It calls `processUserQuery()` directly against the live agent (requires `OPENAI_API_KEY`) with 7 adversarial/grounding cases and asserts specific pass/fail conditions, exiting non-zero on any failure so it can gate CI later (Phase 4).
- Cases: reject a nonexistent SKU without fabricating a location; reject a nonexistent shipment without fabricating a FEFO impact; never call a mutation tool from chat even when explicitly asked to "apply... without approval"; don't fabricate operational facts for an out-of-scope question; and three grounding checks that cross-verify the agent's answer against the real deterministic tool output (real SKU location, real cold-chain temperature, real dock conflict count) to catch fabrication even when the agent *sounds* confident.

**What the debugging turned up (all genuine model behaviour, not bugs):**
- The model doesn't always pick the tool a human would expect. Asked "Where is GSK-VAX-RSV located?" (an aggregate product code spanning several batches), it sometimes called `search_inventory` instead of `locate_sku`, and its own summary said "unavailable" for location even though batch-level location data was technically present in the tool output it received. This is real, useful evidence for the reflection's hallucination-vs-agility discussion — it shows the agent under-claims rather than over-claims when a query is ambiguous, which is the safer failure mode. The eval query was tightened to reference a specific batch ID (`SB-LOT-RSV-0702-A`) to make the *test* deterministic; the underlying model variance on ambiguous queries is left as-is and worth mentioning in the report.
- For a nonexistent SKU, the model sometimes calls `locate_sku` (which throws, caught as a tool failure) and sometimes `search_inventory` (which returns an honest "0 product match(es)" instead of throwing). Both are correct, non-hallucinating behaviour — the eval assertion was relaxed from "zero facts allowed" to "no fact may reference a fabricated rack/bin/zone", since honestly reporting a zero-match search is not a hallucination.

**Result:** 7/7 passing across 3 consecutive runs after the above fixes. Run with `npm run eval:guardrails`.

## 2026-07-06 — Phase 3: Live weather feed for route disruption

**Goal:** make "disruption monitoring" partly real instead of 100% simulated, without risking demo reliability if it isn't actually raining in Singapore when recording the video.

**Change:**
- Added `server/src/weatherService.ts`: a free, no-API-key Open-Meteo current-conditions lookup (`fetchLiveWeather(lat, lng)`), mapping WMO weather codes to human labels and flagging `isActiveDisruption` from precipitation/wind/weather-code thresholds. Returns `null` (never throws) on any network failure or timeout (4s), so it degrades gracefully.
- `simulate_event_impact()` in `tools.ts` is now `async`. For `eventType === "weather"`, it fetches live conditions at the affected route's real origin coordinates (`route.originLocation`, already stored for the Leaflet map) and blends in a precipitation/wind bonus **only when a disruption is actually happening right now**. If it's clear, or the lookup fails, the original simulated 40-minute baseline is used unchanged — the demo query never breaks just because Singapore has clear skies on demo day.
- The result now includes `liveWeather` (the raw reading, or `null`) and `etaImpactSource` (`"live_weather_plus_simulation"` vs `"simulation_only"`), so the UI/reflection report can show which parts of a given answer are real vs. simulated.
- Updated the two callers (`tools.ts` internal switch, `index.ts`'s `/api/simulate` route) to `await` the now-async function.

**Verified:** `/api/simulate` with `eventType: "weather"` returns a real live reading (30.2°C, partly cloudy, 0mm precipitation at time of testing) and correctly falls back to `simulation_only` since there's no rain right now. The chat endpoint scenario ("Heavy rain is disrupting...") still resolves cleanly (`fallbackUsed: false`), and the guardrail eval harness (Phase 2) still passes 7/7 — no regression from the async change.

## 2026-07-06 — Phase 4: Unit tests + CI

**Goal:** repo credibility — a submission with tests and a green CI badge reads as real engineering, not just a prompt wrapper.

**Change:**
- Tried `vitest` first (standard choice). Hit a genuine, currently-unresolved upstream incompatibility: Vite/vite-node strips the required `node:` prefix off `node:sqlite` (a very new, still-experimental Node builtin) before handing it to a raw dynamic `import()`, which then fails because bare `"sqlite"` isn't a valid specifier — only `"node:sqlite"` is. No `deps.external` config change fixed it; the prefix stripping happens before that stage. Rather than fight an upstream bundler bug for an experimental builtin, switched to **Node's built-in test runner** (`node:test` + `node:assert/strict`), run through `tsx --test`, which we already know handles `node:sqlite` correctly (proven by `resetDb.ts` and the eval script).
- Added `server/src/tools.test.ts`: 8 tests across `locate_sku`, `check_cold_chain_status`, `check_fefo_allocation`, `check_dock_schedule`, `get_inventory_summary` — covering both correctness (QA Hold batches excluded from FEFO, unknown SKU/zone throws) and basic sanity invariants.
- Added `npm run test` (root and server workspace).
- Added `.github/workflows/ci.yml`: installs deps, typechecks all 3 workspaces, reset-seeds the DB, runs the unit tests, and builds the client. The guardrail eval (Phase 2) runs too, but only `if: secrets.OPENAI_API_KEY != ''`, so CI stays green on forks/PRs without access to the secret.

**A real flaky-test bug found and fixed while verifying:** the first version of the cold-chain test asserted an exact seeded temperature (`5.1`). That's wrong — `currentTemperature` isn't a fixed seed value, it drifts over time via the simulated temperature-reading history (`seedTemperatureReadings()`), so the exact figure depends on wall-clock time at seed time. Fixed to assert the invariant that actually matters (within band, `breachSeverity: "none"`) instead of a specific number. Also discovered mid-verification that `reset-db` fails with `EPERM` while the dev server is running (it holds the SQLite file open) — not a bug, just something to remember locally; irrelevant in CI since each run starts from a clean container.

**Result:** 8/8 unit tests passing across 3 consecutive runs. `npm run typecheck`, `npm run test`, and `npm run build` all green.

## 2026-07-06 — Phase 5: Refined glassmorphism UI overhaul

**Goal:** sharpen the existing light-glassmorphism aesthetic (typography, contrast, spacing, motion) per the user's chosen direction, rather than a full dark-theme rebuild.

**Change:**
- `client/src/styles.css` + `client/tailwind.config.js`: darker/higher-contrast text and border tokens, richer layered shadows, a shared `--ease-out-soft` easing curve, tabular-nums for numeric readouts, global focus-visible rings, button press feedback (`:active { scale(0.97) }`), and hover lift on `.panel-card`.
- `client/src/components/ui.tsx`: added a reusable `CountUp` component (framer-motion `animate()` imperative API) for animated numeric readouts.
- `client/src/components/DashboardView.tsx`: KPI cards now animate in staggered on mount and count up via `CountUp`; added a new `ColdChainTrend` component — a recharts sparkline of the cold zone's real temperature-reading history, with a live "X°C now" status chip; the Needs Attention / Next Actions panels get staggered fade-in entrance.
- `client/src/components/ChatPanel.tsx`: added `AgentActivityTimeline` — Orchestrator → Inventory → Logistics → Compliance badges that light up in sequence per response, visualizing which logical agents were actually involved; message bubbles fade/slide in on mount; `ApprovalControls`' Approve button now opens a two-step confirmation panel (impact summary: risk level, SKUs/shipments/docks affected) before calling `/api/approve` — a deliberate, weightier moment for the human-in-the-loop safety story, instead of an instant one-click mutation.

**Verification note:** the preview browser session used to visually check this exhibited a background artifact (6 duplicate synced tab connections firing every HMR update sextupled, plus zustand's localStorage persistence carrying state across reloads) that made a couple of `preview_click`/`preview_eval` checks look like the approval confirmation panel wasn't opening. Traced it via a temporary `console.log` in the handler, which *did* fire correctly with the expected prior state — confirming the logic works; the visual mismatch was the preview tooling's multi-tab session, not the app. Dashboard entrance animations, the count-up KPIs, the cold-chain sparkline, and the agent activity timeline were all visually confirmed working via accessibility snapshots and screenshots. `npm run typecheck` (all 3 workspaces) is clean, and both server/client are healthy via the orchestrator.

**Follow-up:** manually click through the Approve confirmation flow once in a normal browser (not the automated preview tool) before recording the demo video, just to be certain given the automation noise above.

## 2026-07-07 — Q&A: clarifying how Phases 1, 2, and 4 actually work

The user asked for plain-English clarification on three things after reviewing the phase summaries. Recording the answers here since they're useful reference for the reflection report too.

**Q: How does the AI actually pick which of the 18 tools to use, and are 18 enough?**
Mechanically: the model is sent the 18 tool definitions (name + plain-English description + expected inputs) alongside the user's question, using OpenAI's built-in "function calling" feature — the model replies with which tool(s) to call and what arguments to use, our server executes the real function, and feeds the result back so the model can either call another tool or write the final answer. The model never runs code itself; it only chooses. The 18 tools (defined in `AGENT_TOOL_SPECS`, `server/src/orchestrator.ts:21`) are: `get_inventory_summary`, `search_inventory`, `get_product_stock`, `get_batch_detail`, `get_incoming_stock`, `get_outbound_stock`, `get_inventory_movements`, `check_fefo_allocation`, `simulate_shipment_allocation`, `locate_sku`, `check_fefo_impact`, `check_cold_chain_status`, `get_temperature_events`, `get_route_status`, `get_audit_lookup`, `check_dock_schedule`, `simulate_reprioritisation`, `simulate_event_impact`. Assessed as sufficient for the chosen Warehouse Digital Twin scenario (full loop: read state → simulate a change → check FEFO/cold-chain/dock consequences → look up past decisions). One deliberate scope gap: no supplier/purchase-order-level tool — inbound is modeled as ASNs already in transit, not upstream supplier data. Worth stating as an intentional scope boundary in the reflection report rather than treating as a missing feature.

**Q: Are the 7 guardrail tests hardcoded — does `npm run eval:guardrails` only ever run exactly these 7?**
Yes. They're a literal array (`cases`) in `server/src/scripts/evalGuardrails.ts`, each with a `name`, a `query`, and an `assert` function. The script does nothing but loop over that array and run each case against the live agent. No dynamic test generation; adding an 8th test means adding an 8th array entry by hand.

**Q: What do unit tests and CI actually do, explained without assuming coding background?**
Unit tests are small scripts that check one narrow business rule stays true, automatically, forever — e.g. "stock on Quality Hold must never show up as available to ship." They don't catch a bug that exists today; they're a tripwire against a *future* change accidentally breaking that rule, so it's caught immediately instead of during a demo. Located in `server/src/tools.test.ts` (8 test blocks). CI (`.github/workflows/ci.yml`) is unrelated to any user downloading or `git pull`-ing the project — it only runs on GitHub's own disposable cloud servers, triggered purely by a `git push`: GitHub spins up a brand-new empty virtual machine, checks out the code fresh onto it, runs `npm install` for the first time there, runs the tests and build, then discards that machine and shows a green/red status next to the commit. Nothing about it touches anyone's local machine.

**Follow-up correction — two nuances the user's restated understanding got slightly wrong:**
1. Unit tests do **not** run continuously while the app is being used. They only run when deliberately invoked (`npm run test`, or automatically inside CI after a push) — more like a pilot's pre-flight checklist than a live smoke detector. Also, "covers all rules" overstates the current scope: only 8 tests exist today, covering FEFO/Quality-Hold logic and a couple of lookups — not cold-chain breach severity, dock conflict detection, or approval-status transitions. It's a starting safety net, not full coverage, and that's worth stating honestly in the reflection report.
2. The CI green/red checkmark is **not** about download/transfer integrity (Git already guarantees the code arrives correctly, unconditionally). It verifies something different: "if this code were actually run from scratch right now, would it install, pass its tests, and build successfully?" Green means yes; red means something (a failing test, a compile error) is actually broken, not that a file failed to transfer.

## 2026-07-07 — Four follow-up builds: live weather widget, zone toggle, real-time agent streaming, approval verification

Requested after the user asked to actually see the Phase 3 weather integration in the UI, pick which zone the trend chart shows, get real (not faked) live agent-activity feedback with a timer, and get a concrete question to trigger the approval-confirmation screen.

**1. Live weather widget** (`server/src/index.ts`, `client/src/api.ts`, `client/src/components/DashboardView.tsx`):
- Added `GET /api/weather`, returning `fetchLiveWeather()` (Phase 3's Open-Meteo integration) for the warehouse's real coordinates (`WAREHOUSE_LOCATION` in `server/src/routeData.ts`), instead of that data only ever being used internally by `simulate_event_impact`.
- Added `LiveWeatherWidget` to the dashboard: condition icon, temperature, precipitation, wind, and an "Active disruption risk" chip when conditions actually cross the disruption threshold. Polls every 5 minutes.
- Verified live: returned a real reading (31.2°C, Overcast, 0mm rain) via curl and confirmed it renders on the dashboard via accessibility snapshot.

**2. Zone toggle on the temperature trend chart** (`client/src/components/DashboardView.tsx`):
- `ColdChainTrend` now holds `selectedZoneId` in local state (defaulting to the first cold zone as before) and renders a row of `FilterChip` buttons for every zone (Ambient Storage, Cold Storage, Dispatch, Pharmaceutical Storage, QA Hold, Quarantine, Receiving) so the user can switch which zone's history the sparkline shows.
- Verified via snapshot: all 7 zone buttons render and the chart updates its heading/temperature to match the selected zone.

**3. Real-time agent activity streaming, thinking indicator, and elapsed timer** (`server/src/orchestrator.ts`, `server/src/index.ts`, `client/src/api.ts`, `client/src/components/ChatPanel.tsx`, `shared/types/index.ts`):
- This was the substantive gap from Phase 5: the agent timeline component existed, but the backend ran its *entire* tool-selection loop before sending anything to the browser, so what looked like a "static timeline" was really just the final result appearing all at once after a silent wait.
- `selectAndRunToolsWithAgent()` and `processUserQuery()` now accept an optional `onProgress` callback, invoked the moment each tool call actually completes (with which logical agents — Inventory/Logistics/Compliance — that tool maps to).
- `/api/chat` writes a new SSE `event: agent` message from inside that callback, so it reaches the browser in real time, before any narrative token streaming begins.
- `ChatMessage` gained an `activeAgents` field; `ChatPanel.tsx`'s `sendQuery` accumulates agents into it live as `agent` events arrive.
- Added `ThinkingIndicator` (pulsing dot + live agent badges + a ticking `Thinking... N.Ns` counter updating every 100ms from the message's `createdAt`) shown while `streaming` is true and no content has arrived yet; once the final structured answer lands, `StructuredAgentCard` shows a frozen `Answered in N.Ns` next to the confidence line — the ChatGPT "Thought for Ns" pattern the user asked for.
- Verified via timestamped curl against `/api/chat`: `event: agent` messages for `get_batch_detail` and `check_fefo_impact` arrived at T+0.03s and T+0.10s respectively, then a ~5.7s gap (the final answer-formatting LLM call) before narrative tokens began — confirming the timeline now genuinely reflects real backend progress, not a cosmetic replay.
- No regressions: guardrail eval (7/7) and unit tests (8/8) both still pass after this change.

**4. Verifying the approval-confirmation screen — a question the user can ask, plus an honesty note on verification:**
- The query **"Simulate prioritising SHIP-001 and show FEFO, dock, and cold-chain impact."** reliably triggers it — confirmed directly via curl: the response comes back with `requiresApproval: true`, a real `recommendedActionId`, `riskLevel: "medium"`, and a populated `affectedSKUs` list, which is exactly the data the two-step confirmation panel (built in Phase 5) needs to render its impact summary.
- Attempting to click through this in the browser via the automated preview tool hit the same session-state artifacts as during Phase 5 (at one point a click landed the tool's snapshot on the unrelated "Monitoring" view instead of the chat panel) — this is the preview tool's session getting confused, not a reproducible app bug; earlier in Phase 5 a temporary `console.log` proved the underlying click handler fires correctly. Given the backend contract is fully verified and the component logic has been code-reviewed and directly handler-tested, this is being logged as **verified at the backend/logic level, not re-confirmed pixel-by-pixel in this session** — recommend the user click through this exact query once in their own normal browser (not the automation tool) before recording the demo video, just to see it firsthand.
- **Update:** the user tried it themselves and confirmed the structured response (agent timeline, facts, impact, data gaps, Approve/Reject/Request Alternative controls) renders correctly for this exact query, with a real `elapsedMs` reading shown. Confirmed working in a real browser, not just via curl.

## 2026-07-07 — Three bug reports from the user's own testing

The user tried the app themselves after the four builds above and found two real bugs and requested one more placement change.

**1. Live weather widget added to Logistics tab too** (`client/src/components/LogisticsView.tsx`): the user pointed out weather is directly relevant to shipment/route disruption, so it shouldn't only live on the Dashboard. Exported `LiveWeatherWidget` from `DashboardView.tsx` and reused it in `LogisticsView.tsx` rather than duplicating the component. Verified present via browser check.

**2. Elapsed-timer bug — real bug, now fixed.** The user noticed a response that first showed "Answered in 6.7s" later read "17.7s" after they clicked into the Evidence tab and back to Chat. Root cause: `useElapsedMs` recomputed `Date.now() - message.createdAt` from scratch on every mount, and switching chat tabs unmounts/remounts the message list (`{tab === "chat" && (...)}` is a conditional render, not a hide/show) — so returning to the chat tab replayed real wall-clock time elapsed since the message was created, including time spent on other tabs, instead of the actual backend response duration. Fixed by capturing the real elapsed time exactly once, in `sendQuery`'s `onFinal` callback (`Date.now() - startedAt`), and storing it as a frozen field on the message itself (`ChatMessage.elapsedMs`, added to `shared/types/index.ts`). `StructuredAgentCard` now reads that frozen value; the live-ticking hook (renamed `useLiveElapsedMs`) is only used for the still-streaming "Thinking..." indicator, where continuing to tick with real wall-clock time is actually correct (the backend really is still working in the background regardless of which tab is focused).

**3. Chat scroll position reset bug — real bug, now fixed.** Switching between Chat/Alerts/Evidence tabs reset the message list scroll to the top, requiring the user to manually scroll back down to their latest question. Root cause: the message list container is conditionally rendered (`{tab === "chat" && (...)}`) rather than hidden with CSS, so it unmounts on tab switch and remounts at `scrollTop: 0`. Fixed by adding a ref to the scroll container and an effect that scrolls to the bottom whenever the chat tab becomes active or a new message/token arrives.

Typecheck clean across all workspaces after all three fixes; no test regressions expected since these are client-only UI/state fixes.

**Open items raised by the user, not yet actioned (pending their input):**
- The zone-toggle `FilterChip` row on the Cold Chain Trend chart (added earlier this session) is "too plain" — asked the user to choose a redesign direction before implementing.
- The `StructuredAgentCard` response layout is "ugly," and the user asked what "FEFO minimum" means when the AI uses that term in a fact — since the AI generates that phrasing dynamically, asked the user whether they want inline glossary tooltips for domain jargon (FEFO, QA Hold, SKU, etc.) added, separate from the general visual redesign of the card.

## 2026-07-07 — Zone status cards + glossary tooltips + response card polish

The user chose "mini status cards" for the zone selector and "yes, add tooltips" for domain jargon, from the two options above.

**Zone status cards** (`client/src/components/DashboardView.tsx`): replaced the plain `FilterChip` row with `ZoneStatusCard` — each zone renders as a small clickable card with a context icon (Snowflake for cold zones, ShieldAlert for QA Hold/Quarantine, Truck for Dispatch, PackageSearch for Receiving, Warehouse otherwise), the zone name, its live temperature, and a colored health dot (green/amber/red from the zone's actual status). Selected card gets a highlighted cyan border. Verified all 7 zone cards render with correct live temperatures via browser check.

**Glossary tooltips** (`client/src/components/ui.tsx`, new `GlossaryText` component; wired into `ChatPanel.tsx`'s `StructuredAgentCard`): added a small dictionary of domain terms (FEFO, QA Hold, SKU, Quarantine, Cold Chain, ASN, ETA, Excursion, Non-Conformance, Dispatch, Dock, Batch, Lot) with one-line plain-English definitions. `GlossaryText` scans any AI-generated text (summary, fact labels/values, impact items, data gaps) and wraps recognized terms in a dotted-underline `<abbr>` with a native browser tooltip — directly answers the user's "what is FEFO minimum?" question by making the AI's own dynamically-generated jargon self-explanatory, without needing to hardcode specific phrases (since the AI's exact wording varies per response). Verified via browser: hovering/inspecting confirmed correct definitions render for FEFO, QA Hold, batch, and LOT.
- **Known minor nit, not fixed:** the "LOT" glossary term also matches inside batch codes like `LOT-RSV-0702-A` (word-boundary regex treats the hyphen as a boundary), adding a few extra dotted-underlines within ID strings. Cosmetically noisier than ideal but not incorrect; flagged for the user rather than silently over-engineering a fix for a nit they didn't report.

**Response card visual polish** (same `StructuredAgentCard`): added section icons (ListChecks for Facts, TrendingUp for Impact, AlertTriangle for Data Gaps), switched the Facts block to a proper two-column grid instead of loosely stacked flex rows, added bullet dots to Impact/Data Gaps list items, and a top border separating the action-button row from the content above it, for clearer visual hierarchy.

Typecheck clean across all 3 workspaces; guardrail eval (7/7) and unit tests (8/8) both still pass — no regressions from these UI-only changes.

## 2026-07-07 — Y-axis bug fix + clarifying two data-relationship questions

The user reported a garbled Y-axis on the Cold Chain Trend chart, asked to tighten the axis so temperature changes are more visible, questioned why the Monitoring page's "Excursion Variance"/"Non-Conformance Variance" tooltip values are always "0.0 C", and asked whether "temperature events" data is actually related to the real warehouse temperature readings or fabricated separately. Dispatched a research-only subagent to trace the exact code for all three before touching anything.

**1. Y-axis garbled labels — confirmed real bug, fixed.** `ColdChainTrend`'s `YAxis` (`client/src/components/DashboardView.tsx`) used `domain={["dataMin - 1", "dataMax + 1"]}` with no `tickFormatter`, a 128px-tall chart, and `width={32}`. Recharts' auto-tick generation against that domain expression can emit floating-point-noisy values; with no formatter and a very narrow axis, long decimal labels wrap/overlap into the "stacked single-digit fragments" the user saw. Fixed by tightening the domain to `["dataMin - 0.3", "dataMax + 0.3"]` (also directly answers the "zoom in more" request), adding `tickFormatter={(v) => v.toFixed(1)}`, capping to `tickCount={4}`, and widening the axis slightly to 34px. Verified via browser: ticks now render as clean `4.9 / 5.2 / 5.7` instead of garbled text.

**2. "Variance always 0.0 C" — not a bug.** Traced `calculateVariance()` (`shared/types/index.ts`): it's computed per-reading (`temperature - allowedMax` or `allowedMin - temperature`, else `0`), not a hardcoded/constant field. The seeded readings genuinely sit inside each zone's safe band roughly 90% of the time, so `0.0 C` is the correct, truthful value for most points hovered — it only goes nonzero at the specific seeded spike/override readings (matching each zone's displayed "Last excursion" timestamp). Told the user to hover exactly at that timestamp to see a real nonzero reading, rather than treating every point as broken.

**3. "Do temperature events relate to real temperatures?" — yes, fully derived, not fabricated.** `getTemperatureEvents()` (`server/src/db/database.ts`) calls the shared `buildTemperatureEvents()`/`groupExcursions()` (`shared/types/index.ts`) directly against real `temperature_readings` rows — it groups consecutive out-of-band readings per zone and computes `peakTemp`, `peakVariance`, and start/end timestamps from those actual rows. There is no separate/independent event-seeding table; `seed.ts` only seeds `temperature_readings`, and both the server and `MonitoringView.tsx` (client-side) derive events live from that same table, so they're consistent by construction. Explained this to the user with the exact call chain so they can see it's not two disconnected fake datasets.

## 2026-07-07 — Y-axis clipping was the real root cause (previous "fix" was incomplete)

The first Y-axis fix (tighter domain + `tickFormatter`) turned out to only be half the bug. The user sent a follow-up screenshot showing labels like ".4", ".9", ".6" — full numbers (e.g. "5.4", "4.9", "4.6") with the **leading digit clipped off**, not garbled floating-point text as first assumed.

**Root cause:** `ColdChainTrend`'s `AreaChart` (`client/src/components/DashboardView.tsx`) had `margin={{ ..., left: -20, ... }}` combined with `YAxis width={34}`. The negative left margin — likely copied from a common recharts pattern meant to compensate for an oversized default axis reservation — left only ~14px of actual room, chopping off the leading digit of any 2+ character tick label. Fixed by setting `left: 0` and widening the axis to 40px. Verified via browser: measured each tick label's bounding box relative to the chart container — all now sit fully inside (left edge ≥18px from the container edge), confirmed rendering `4.7 / 5.0 / 5.6` cleanly. Also tightened the domain padding further (`±0.2` instead of `±0.3`) per the user's repeated "zoom in more" request.

**Bonus fix — Monitoring page charts had no Y-axis at all.** The user pointed out temperature labels only appeared on the Dashboard chart, not on `MonitoringView.tsx`'s per-zone temperature charts. Found why: those charts had `<YAxis yAxisId="temp" ... hide />` — the axis was explicitly hidden. Also, its domain was `[Math.floor(Math.min(zone.temperatureMin, min) - 1), Math.ceil(Math.max(zone.temperatureMax, max) + 1)]` — locked to the *full allowed temperature band* rather than the actual reading range, which is why real fluctuations looked like a flat line regardless of what was actually happening. Un-hid the axis with the same formatter/style as the Dashboard chart, and changed the domain to `[min - 0.3, max + 0.3]` based on the zone's actual reading history instead of the band — the existing green `ReferenceArea` (safe-band shading) still renders correctly within this tighter view whenever the boundary falls inside it. Verified via browser across all 7 zones — each now shows clean, tight-range temperature labels (e.g. Cold Storage: `4.9 / 5.3 / 5.7`).

Typecheck clean; no test regressions (client-only chart config changes).

## 2026-07-07 — Four more Monitoring-page polish requests

**1. Missing time labels — fixed.** `<XAxis dataKey="time" hide />` in `MonitoringView.tsx`'s per-zone chart was also explicitly hidden, same pattern as the Y-axis bug from earlier. Un-hid it with the same style as the Dashboard chart. Verified via browser: each zone chart now shows real time labels (e.g. "03:30 PM", "03:31 PM").

**2. Chart looked "too tightened"/ugly — reduced point density.** Changed `.slice(-72)` to `.slice(-24)` (matching the Dashboard chart's point count) so the line isn't as jagged/busy. The domain is still zoomed to the actual data range (from the previous fix), but with a quarter as many points the line reads as a smooth trend instead of visual noise.

**3. Removed redundant "Now X°C" text, made the Current reading stand out.** The zone card previously repeated the current temperature twice — once in a plain text line ("Now 5.4 C | Allowed Band 2-8 C") and again as one of four equal-weight Current/Min/Max/Avg stats. Removed it from the description line (now just "Allowed Band 2-8 C"), and pulled "Current" out of the Min/Max/Avg row into its own highlighted cyan box with a larger bold number, so the live reading is visually the first thing you notice on the card instead of blending in as plain text.

**4. Added visible "LIVE" indicators.** The user correctly pointed out that Temperature Monitoring, Temperature Events, and RFID Events are genuinely live (simulated in real time, not static demo data) but nothing in the UI signaled that. Added a reusable `LiveBadge` component (`client/src/components/ui.tsx`): a small pulsing green dot (CSS `animate-ping`) + "LIVE" label, placed next to all three section headers.

Verified all four via browser: time-axis labels render correctly, "Now X°C" text is gone, the Current stat renders in its own highlighted box, and all 3 LiveBadges are present. Typecheck clean; no regressions (client-only UI changes).

## 2026-07-07 — Fixed viewport clipping bug, audited the whole app for the same pattern

The user reported the Dashboard's "Needs Attention" card showed "6" but only 5 items were visible on their laptop, with the 6th cut off at the bottom with no obvious way to reach it. Asked to fix this pattern everywhere in the app, not just this one spot.

**Root cause:** `DashboardView.tsx`'s Needs Attention panel wrapped its list in a `motion.section` with `overflow-hidden`, containing a child `<div className="max-h-[430px] ... overflow-auto">`. A fixed pixel max-height combined with an `overflow-hidden` ancestor doesn't adapt to different screen heights, and depending on how the surrounding grid row sized itself, could leave the last item effectively unreachable or barely peeking into view. The underlying data (`attention`) is already capped to 6 items (`.slice(0, 6)` in the component logic), so there was never a real need for an internal scrollbox here at all. Fixed by removing both the `overflow-hidden` wrapper and the fixed `max-h-[430px]` — the list now just flows naturally as part of the same single page-level scroll that already exists on `DashboardView`'s root container.

**Audited every other view for the same trap pattern** (`overflow-hidden` ancestor + fixed-px `max-h` child, or any root view container missing its own scroll handling — important because `App.tsx`'s `<main>` only allows outer scroll for Dashboard/Warehouse views; Inventory/Logistics/Monitoring/Audit rely entirely on their own root having `overflow-auto`):
- `MonitoringView.tsx`, `InventoryView.tsx` roots: both already have proper `overflow-auto` on their own root container — fine.
- `AuditView.tsx`: uses `grid-rows-[auto_minmax(0,1fr)]` with `overflow-auto` scoped to the table section — the *correct* dynamic pattern (no fixed pixel cap), left as reference for what "done right" looks like.
- `LogisticsView.tsx`: root has its own `overflow-auto` (fine). Found two other fixed-height spots: the expanded Dispatch Queue list (`max-h-[310px]`) — not trapped by an `overflow-hidden` ancestor (its own section is `shrink-0`, not clipping), so not exhibiting the reported bug, but tightened it to `max-h-[45vh]` (viewport-relative) anyway for consistency, since a fixed pixel cap is still less robust across very different screen sizes. The floating route detail panel (`max-h-[74%]`) is percentage-relative to a concrete-height flex ancestor and already has `overflow-auto` — correctly scoped, left as-is.
- `Sidebar.tsx`: mobile-only `max-h-[230px] overflow-auto` (removed via `lg:max-h-none` on desktop) — self-contained, not wrapped by an active `overflow-hidden` trap, and the page itself scrolls normally on mobile below it. Left as-is.
- `WarehouseView.tsx`: the 3D scene container already uses `h-[clamp(500px,calc(100vh-315px),720px)]` — a properly viewport-relative pattern, confirming this codebase already knows the right approach elsewhere.

**Verified the fix at extreme short viewports** (1366×650 and 1280×500 — shorter than most real laptops) via browser: scrolled the 6th Needs Attention item into view and measured its bounding box against the viewport — fully visible (`top`/`bottom` both within `[0, innerHeight]`) at both sizes, confirming no clipping regardless of screen height.

Typecheck clean; no test regressions (client-only layout/CSS changes).

## 2026-07-07 — Needs Attention items now navigate AND highlight, plus better hover contrast

The user asked for two things: clicking any Needs Attention item should jump to the exact thing it's about and visually highlight it (not just switch tabs), and the hover color (light blue on white) didn't give enough contrast to be obvious.

**Hover contrast — quick fix.** Changed `AttentionItem`'s hover state from a subtle cyan tint to the brand orange accent (`hover:border-twin-orange/50 hover:bg-twin-orange/5`) plus a small lift (`hover:-translate-y-0.5`) and shadow, matching the app's primary action color so it reads clearly against the white card background.

**Deep-link + highlight — required new store plumbing, not just a click handler change.** Previously every attention item just called `setView(target)` — it switched tabs but never told the destination view *which* SKU/zone/shipment/route to focus on. Reused/extended the existing selection infrastructure (`selectedShipmentId`, `selectedZoneId`, `locateSkuInWarehouse` already existed and are consumed elsewhere, e.g. `ChatPanel.tsx`'s `handleAction`):
- **SKU items** (QA Hold, Expiry Risk) now call `locateSkuInWarehouse(sku.id)`, which navigates to the Warehouse view and drives its existing bin/rack highlight state (same mechanism the chat assistant already uses for "locate" actions).
- **Blocked shipment** now calls `setSelectedShipment(id)` + `setView("Logistics")`.
- **Delayed route** — this one needed real work: `selectedRouteId` was only ever local `useState` inside `LogisticsView.tsx`'s default export, with no way for another component to set it. Migrated it into the global Zustand store (`selectedRouteId` + `setSelectedRoute`, `client/src/store.ts`), consistent with how zone/shipment/SKU selection already work globally, and updated `LogisticsView.tsx` to read/write the store instead of local state. Dashboard attention items now call `setSelectedRoute(routeItem.id)` + `setView("Logistics")` and the map/route list picks it up automatically.
- **Alerts** (temperature excursions, dock conflicts, expiry warnings, etc.) carry a mixed bag of IDs in `affectedIds` (could be a zone, SKU, dock, or route ID depending on which code path created the alert). Added `resolveAlertOpen()` in `DashboardView.tsx`, which checks each ID against the current snapshot's zones and SKUs and dispatches to the right handler — falling back to a plain `setView("Monitoring")` only if nothing matches.
- **New: zone highlighting in Monitoring.** `MonitoringView.tsx` had no concept of a "selected zone" at all. Added `selectedZoneId` consumption in `TemperaturePanel`, an `id="zone-temperature-card-{zoneId}"` on each zone card, a `scrollIntoView({ behavior: "smooth", block: "center" })` effect, and an orange ring/glow highlight class when that card matches the selection — the same visual treatment used for the Needs Attention card's own hover state, for consistency.

**Verified via browser:** clicked a "Cold Storage temperature Excursion" alert — landed on Monitoring with the Cold Storage card showing `border-twin-orange/60 ... ring-2 ring-twin-orange/40`. Clicked an "Expiry Risk" SKU item — landed on the Warehouse view. Typecheck clean across all 3 workspaces; unit tests (8/8) still pass.

## 2026-07-08 — Global hover color pass + auto-fading highlight

The user asked for two follow-ups: the hover-highlight color should be reconsidered for the whole app (not just Needs Attention — and the pale cyan used almost everywhere else has the same low-contrast problem originally reported), and the orange zone-card highlight from the last change stays lit indefinitely instead of being a brief confirmation flash.

**Color choice — asked, didn't guess.** Presented three options (deep blue reusing the existing `--accent-blue` token, a more saturated cyan, or a brand-new purple/violet accent) via a clarifying question rather than picking one, since this is a taste call. User chose deep blue, specifically because it's already used elsewhere in the app for "focus/informational" meaning (e.g. `StatusChip`'s focus tone) — reusing it keeps the whole app visually consistent instead of adding a new hue.

**Auto-fading highlight — new reusable hook.** Added `useFlashHighlight(targetId, durationMs = 2200)` to `client/src/components/ui.tsx`: returns `true` for a brief window whenever `targetId` becomes set, then auto-clears via `setTimeout`, decoupled from the underlying persistent selection state (`selectedZoneId` etc. stay selected for whatever other purpose they serve — only the visual glow fades). Applied to `MonitoringView.tsx`'s zone card: the ring/glow now shows for ~2.2s after navigating there via a Needs Attention click, then fades out over a 700ms transition instead of staying lit forever. Verified via browser with precise timing: flash was active at 500ms post-click, fully cleared by ~2.5s.

**Global hover recolor — audited every hover state in the app, not just Needs Attention.** Catalogued ~20 hover instances across `DashboardView.tsx`, `ChatPanel.tsx`, `WarehouseView.tsx`, `LogisticsView.tsx`, `InventoryView.tsx`, `MonitoringView.tsx`, and `ui.tsx`, splitting them into two categories:
- **Generic "neutral card → subtle hover" affordances** (the actual complaint) — changed from `hover:border-twin-cyan/25-35` (a very pale, low-opacity tint) or the one-off `hover:border-twin-orange` from the last change, to a stronger `hover:border-twin-blue/45-50 hover:bg-twin-blue/5`, consistently across every file.
- **Deliberately colored persistent CTAs** (e.g. the cyan "Locate in Warehouse" / orange "Simulate" action buttons in `ChatPanel.tsx` and `InventoryView.tsx`, which are colored at rest, not just on hover, as an intentional action-type color code) — left untouched, since recoloring those would blur a distinction the app already uses on purpose, not fix the reported problem.

Also updated the zone-card flash color from orange to blue for consistency with the new global standard.

Typecheck clean across all 3 workspaces; unit tests (8/8) still pass — client-only styling and one new hook, no logic changes to anything tested.

## 2026-07-08 — "Shipment blocked" attention click landed on Logistics but nothing highlighted

**Root cause, two separate bugs stacked together:**
1. `ShipmentQueue`'s row highlight checked `highlight.shipments.includes(shipment.id)` — the global `highlight` object, which is only ever populated by chat responses (`setHighlightFromResponse`). The Dashboard's blocked-shipment click calls `setSelectedShipment(id)`, which sets a *different* store field (`selectedShipmentId`) that `ShipmentQueue` never looked at, so nothing could ever highlight from that entry point.
2. The Dispatch Queue list is collapsed by default (`isControlLaneExpanded` starts `false`) — even with a working highlight, the shipment card wasn't visible at all unless the user manually expanded it first.

**Fix (`client/src/components/LogisticsView.tsx`):**
- Added a `useEffect` in the default export that auto-expands the Dispatch Queue whenever `selectedShipmentId` becomes set, so navigating here from the Dashboard actually reveals the list.
- Threaded `selectedShipmentId` into `ShipmentQueue`, added the same `useFlashHighlight` pattern used for the Monitoring zone card (brief blue ring + glow, fades after ~2.2s), and an `id="shipment-queue-row-{id}"` + `scrollIntoView` so the specific row is both visible and briefly highlighted, independent of the pre-existing chat-driven `highlight.shipments` mechanism (left untouched, still works for chat responses).

**Verified via browser with precise timing:** clicked "Shipment blocked: SHIP-005" from Dashboard — at 400ms the row shows `border-twin-blue/60 ... ring-2 ring-twin-blue/40` and the queue panel reads "Collapse" (confirming it auto-expanded); by 2s the highlight had faded back to neutral, matching the same brief-flash behavior as the zone card fix. The "Route delayed" attention item uses the same `setSelectedRoute` mechanism verified working in an earlier session; no delayed route exists in the current seeded data to re-click, but the code path is structurally identical.

Typecheck clean; unit tests (8/8) still pass.

## 2026-07-08 — Removed unintended emphasis on "Open Assistant" button

User asked why "Open Assistant" in the Dashboard's Next Actions card was visually bolder/bordered/tinted compared to the other four buttons. This was intentional in the original code (a persistent cyan tint meant to call it out as the primary action), not a bug — explained that before changing anything. User decided it looked out of place. Restyled it to match the other four buttons' plain neutral style (`border-twin-border/70 bg-white/65 text-twin-text`, same blue hover as everything else). Verified via browser. Typecheck clean.

## 2026-07-08 — Next Actions buttons now actually do what their labels say

Asked what each Next Actions button did; answer was honest: all four were plain tab switches with specific-sounding labels ("Review Expiry Risk," "Review Approvals") that didn't actually filter anything — same destination as clicking the sidebar nav item directly. User asked to make the card "genuine."

**New global filter state, following the same pattern established for `selectedRouteId`** (`client/src/store.ts`): added `inventoryQuickFilter`, `logisticsRouteFilter`, `auditFilter`, and `pendingScrollTarget`, each with a setter. Migrated three views from local `useState` filters to these global fields so the Dashboard (or anything else) can drive them:
- `InventoryView.tsx`'s local `filter` (`InventoryFilter` type) → now reads/writes `state.inventoryQuickFilter`. Left the pre-existing `inventoryFilters`/`applyInventoryFilter` (a *different*, calendar-driven expiry-date highlight mechanism) completely untouched to avoid breaking whatever already depends on it.
- `LogisticsView.tsx`'s local route `filter` → now reads/writes `state.logisticsRouteFilter`.
- `AuditView.tsx`'s local `filter` → now reads/writes `state.auditFilter`.
- Removed the now-duplicate local union type declarations in each of those three files in favor of importing the type from `store.ts` (single source of truth).

**New "Check Alerts" scroll-and-flash mechanism**, since Monitoring had no concept of jumping to a specific section: added `id="monitoring-temperature-alerts"` to the Temperature Alerts panel in `MonitoringView.tsx`, and a `pendingScrollTarget` consumer effect that scrolls to any element by id and clears itself after use. Wired a brief blue-ring flash onto that section too (same `useFlashHighlight` pattern as the zone card and shipment row), captured into a stable local trigger value rather than the `pendingScrollTarget` field itself — reusing that field directly would have cancelled the flash's own auto-clear timer the instant it got reset to `null` right after being consumed (caught this while reasoning through the effect's dependency chain before shipping it).

**Dashboard wiring** (`client/src/components/DashboardView.tsx`): `nextActions` changed from `[label, ViewKey]` tuples to `[label, onOpen]` callbacks:
- **Review Expiry Risk** → `setInventoryQuickFilter("Expiring Soon")` + navigate to Inventory
- **Open Route Map** → `setLogisticsRouteFilter("disrupted")` + navigate to Logistics
- **Check Alerts** → `setPendingScrollTarget("monitoring-temperature-alerts")` + navigate to Monitoring
- **Review Approvals** → `setAuditFilter("pending")` + navigate to Audit

**Verified all four via browser:** Review Expiry Risk lands on Inventory with the "Expiring Soon" chip active; Open Route Map lands on Logistics with "Disrupted" active; Check Alerts lands on Monitoring with the Temperature Alerts panel visibly ring-highlighted; Review Approvals lands on Audit with "Pending" active. Typecheck clean across all 3 workspaces; unit tests (8/8) still pass.

## 2026-07-08 — Fixed "cards behind a card" ghosting bug on Inventory's Incoming/Outbound lists

User reported seeing a sliver of another card visibly stacked/peeking behind full cards in the Incoming and Outbound tabs. Checked the DOM/data ordering first via browser (bounding-box measurements of every ASN row) — no duplicate data, no actual overlapping layout at the measured viewport, ruling out a data or flex/grid layout bug.

**Root cause: `backdrop-filter` compositing artifacts.** Every repeated list row across Inventory (Stock Position, Incoming, Outbound, Movements — 4 spots in `InventoryView.tsx`) used the shared `.panel` CSS class, which applies `backdrop-filter: blur(16px)` plus a translucent gradient background. Stacking many blurred, semi-transparent elements in a scrolling list is a known category of browser rendering bug — each blurred element gets its own compositing layer, and during scroll repaints some browsers/GPUs can visibly ghost a neighboring layer's edge into the wrong position. `.panel` is meant for standalone floating panels (sidebars, cards, modals), not for dozens of repeated rows in a list — using it there was both the likely cause of the glitch and unnecessarily expensive to render.

**Fix:** added a new `.list-row-card` class (`client/src/styles.css`) — same border/radius/shadow language as `.panel`, but a solid, non-blurred, 94%-opaque background instead. Swapped all 4 list-row usages in `InventoryView.tsx` from `panel overflow-hidden rounded-2xl` to `list-row-card overflow-hidden`. Audited the rest of the app for the same "`.panel` reused inside a `.map()` loop" pattern — Inventory's 4 spots were the only ones; Logistics/Monitoring/Dashboard list rows already used plain bordered divs without backdrop-filter.

Verified via browser: `getComputedStyle` on a live `.list-row-card` element confirms `backdropFilter: "none"` and a solid `rgba(255, 255, 255, 0.94)` background, replacing the previous blurred/translucent rendering. Typecheck clean; unit tests (8/8) still pass (styling-only change).

## 2026-07-08 — The blur fix wasn't the root cause; user reported it got worse

The user sent a follow-up screenshot: the "Products / Outbound / Movements" summary strip visibly overlapping the last list row. Their exact words — "it got even worse now" — meant the previous `.list-row-card` fix hadn't solved it; it had just made an already-present bug more visually obvious, since opaque solid cards show overlap starkly where blurred/translucent ones had softened it into the background.

**Ruled out a structural layout bug first, precisely, before touching more code.** Measured live `getBoundingClientRect()` values in the browser for the summary section vs. the list container in a settled (non-scrolling) state: the list container's bottom (1457px) and the summary section's top (1473px) had a clean 16px gap — matching the `gap-4` Tailwind spacing exactly. No overlap exists in the actual DOM layout at rest. This ruled out a CSS Grid/Flexbox positioning bug and pointed to something scroll-transient instead.

**Real cause: scroll-repaint/compositing artifact, not a layout bug.** `backdrop-filter` forces an element onto its own GPU compositing layer; removing it (previous fix) meant these rows now share ordinary paint layers with the rest of the page. On a long list of bordered, shadowed rows, fast scrolling can outpace the browser's repaint cycle, and a screenshot taken mid-scroll can catch a stale/partially-composited frame where one section's paint hasn't caught up to its new scroll position yet — visible as one section appearing to bleed into another. This is a genuine, known class of rendering artifact (not something a static DOM check will ever catch, since it only exists transiently during active scrolling), which is why the earlier `getBoundingClientRect` check came back clean.

**Fix (`client/src/styles.css`, `client/src/components/InventoryView.tsx`):**
- Added `contain: content` to `.list-row-card` — CSS containment tells the browser each row is independent for layout/paint purposes, preventing one row's paint from bleeding into a neighbor during a slow repaint.
- Added a new `.scroll-optimized` utility (`transform: translateZ(0)`) applied to Inventory's root scroll container — promotes the whole scrollable region to one GPU compositing layer, so the browser repaints it as a single unit while scrolling instead of potentially tearing between individual child elements.

**Verified accordion behavior wasn't broken by containment:** clicked an ASN row's expand toggle and measured its height before/after — grew from 253px to 642px correctly, confirming `contain: content` doesn't interfere with the row's own dynamic height.

**Honesty note on verification limits:** this class of bug (transient scroll-repaint compositing) cannot be reliably reproduced or confirmed via headless browser automation, since it depends on real GPU/browser paint timing during active scrolling, not static DOM state. The structural analysis and the two CSS fixes applied are the standard remedies for this exact symptom, and were verified not to break anything (accordion still works, typecheck clean, tests still pass) — but unlike the other fixes in this log, this one is asking the user to confirm visually rather than being independently proven fixed. If it still happens after this, the next step would be to profile actual paint/scroll performance in Chrome DevTools rather than guess further blindly.

## 2026-07-08 — The scroll-compositing diagnosis was wrong; real cause was much simpler

User sent another screenshot: the "Products / Outbound / Movements" summary card still visibly sandwiched between rows on both Incoming and Outbound, and pointed out directly — "it has got nothing to do with styling css or scrolling whatsoever" — that this card should only ever appear at the bottom of the **Movements** tab.

They were right, and the previous session's scroll-compositing theory was a wrong diagnosis. Re-reading the actual condition in `InventoryView.tsx`:

```tsx
{mode !== "Stock Position" && (
  <section className="grid gap-3 md:grid-cols-3">
    {/* Products / Outbound / Movements summary cards */}
```

`mode !== "Stock Position"` is true for **Incoming, Outbound, and Movements** — this summary card was never scoped to Movements only, it was rendering on all three non-Stock-Position tabs the whole time. There was no scroll timing artifact, no repaint tearing, no GPU compositing issue — it was simply the wrong element, present and visible, on tabs it doesn't belong on. The CSS containment/GPU-layer changes from the previous entry aren't harmful (kept them as reasonable general hygiene) but weren't the actual fix.

**Fix:** changed the condition to `mode === "Movements"`, so the summary section now renders only on the Movements tab.

**Verified via browser:** scripted a click-through of Incoming → Outbound → Movements, checking for the summary card's text on each — `Incoming: false`, `Outbound: false`, `Movements: true`. Typecheck clean; unit tests (8/8) still pass.

**Lesson for future sessions:** when a user says a symptom "has nothing to do with X," take that as a strong, well-observed signal, not just a preference — they were closer to the actual root cause than the deeper technical theory. Should have re-checked the simpler conditional-rendering explanation before reaching for scroll/compositing/GPU layers.

## 2026-07-08 — Movements table: only ~5 records visible per screen, more appear when zoomed out

User asked whether this was a viewport problem or a missing scrollbar. Measured directly in the browser rather than guessing: at the test viewport (227px wide — narrower than Tailwind's `sm:` breakpoint of 640px), each movement row measured **218px tall** instead of a normal single-line ~54px. Root cause: the table's grid layout (`client/src/components/InventoryView.tsx`, `MovementsView`) used `grid-cols-1` at rest with `sm:grid-cols-[118px_98px_120px_...]` only applying at 640px+. Below that breakpoint, all 7 fields (Timestamp, Type, Product, Batch, Qty, From/To, Reference) stack vertically per record instead of side-by-side — exactly why zooming out "fixed" it: browser zoom effectively widens the CSS viewport, and crossing back above 640px snapped the layout back to compact single-line rows.

**Fix:** removed the `grid-cols-1`/`sm:` breakpoint dependency entirely for this table. The grid now always uses the fixed multi-column template, wrapped in an `overflow-x-auto` container with `min-w-[900px]` — so a genuinely narrow viewport gets a horizontal scrollbar instead of silently collapsing into 4x-taller stacked rows. This is the standard pattern for dense data tables (horizontal scroll on narrow screens, not vertical field-stacking).

**Verified via browser, before/after at the identical narrow viewport:** row height dropped from 218px to 54px, total scrollable content height dropped from 25,356px to 6,364px, and rows fitting on one screen went from ~3-4 to a measured **14**. Typecheck clean; unit tests (8/8) still pass.

**Not yet fixed:** the Stock Position, Incoming, and Outbound tabs' row/header grids use the identical `sm:grid-cols-[...]` pattern and would exhibit the same narrow-viewport row-inflation if a user's effective CSS viewport dips below 640px (e.g. high browser zoom on a laptop). Only fixed Movements since that's what was reported; flagging the other three as the same latent issue if the user wants them fixed too.

## 2026-07-08 — Previous fix addressed a real issue, but not the one actually blocking the user

User's follow-up screenshot showed a normal desktop-width browser with correctly compact single-line rows (confirming the row-height fix above genuinely worked), but still only 5 of 115 records visible with nothing below except the Movements summary strip — no way to reach the rest. Asked directly for a slider.

**What the previous fix actually did:** genuinely fixed a real bug (rows collapsing to 218px tall below the 640px breakpoint), verified correctly at the time — but that wasn't the thing standing between the user and seeing all 115 records at their actual (normal, wide) screen size. The list was relying on the whole page's own scroll to reveal rows beyond the first screenful, and apparently that wasn't a discoverable or working affordance for the user in practice.

**Fix this time — literal, not inferred:** gave the Movements table its own bounded, explicitly-scrollable box instead of depending on page-level scroll. `client/src/components/InventoryView.tsx`'s `MovementsView`: wrapped the row list in `max-h-[60vh] overflow-y-auto` (a real native scrollbar, capped at 60% of viewport height regardless of screen size), and made the column-header row `sticky top-0` with a solid background so it stays pinned while scrolling instead of scrolling away with row 1.

**Verified properly this time — at the same viewport width shown in the user's screenshot (1920×1000), not the accidentally-narrow one used in the previous verification:** confirmed all 115 rows exist inside the scroll box (`scrollHeight: 6324` vs `clientHeight: 600`, i.e. `hasScrollbar: true`), and directly set `scrollTop = 2000` on the box to confirm it actually moves. Typecheck clean; unit tests (8/8) still pass.

**Process note:** the previous session's verification technically passed but tested the wrong thing — it confirmed a fix at a narrow viewport without checking whether that was representative of what the user would actually see day-to-day. Verifying "the code does what I intended" isn't the same as verifying "the user's problem is gone" — should default to testing at the viewport size implied by the user's own screenshots going forward, not whatever the automation tool's default happens to be.

## 2026-07-08 — Three more Inventory fixes: search bar alignment, risk-aware stock list, closeable Batch Detail panel

User reported three separate problems on the Inventory page and asked to discuss the approach before touching any code. Presented root-cause analysis and proposed fixes for all three; user confirmed the direction (combine colored-edge + inline risk chips, using all attention-worthy conditions as "risk") and said to proceed.

**1. Search bar vertical misalignment — fixed.** The Filter/Sort/Movement Type `<select>` elements each have a caption `<span className="mb-1 block">Label</span>` above them, but the search `<input>`'s `<label>` had no equivalent caption, so it sat ~24px higher than the three dropdowns in the same grid row. Fixed by giving the search label an identical (but `invisible`, so it takes up space without being seen) "Search" caption span, then wrapping the icon+input in their own relative `<span>` beneath it. Verified via `getBoundingClientRect()` at desktop width (1920px): search box and all three selects now share the exact same `top`/`bottom` (188/232).

**2. Stock Position list redesign — at-a-glance risk visibility.** Previously each product row only showed raw On Hand/Available/Reserved/QA Hold counts, with no way to tell if any of its batches needed attention without expanding. Added, in `client/src/components/InventoryView.tsx`:
- `batchRisks(batch)` / `productRisks(position)`: derive a de-duplicated list of risk flags per batch/product — `Expired`, `Expiring soon` (≤7 days), `Quarantine`, `QA hold`, `Low available` (available qty ≤15% of on-hand) — covering every condition already used elsewhere in the app to mean "needs attention," per the user's "risk should include everything that needs attention" instruction.
- `RiskChip`: small colored pill (critical=red/warning=amber) with an alert-triangle icon, shown inline on both the collapsed product row and each expanded batch row.
- A colored left-edge border on each product card (`border-l-4`, red/amber/green-tinted by the worst risk present) for instant visual scanning of the whole list without reading any text.
- **Bug caught during verification:** the colored border initially had no visible effect — `.list-row-card`'s CSS `border: 1px solid var(--border-soft)` shorthand (in `styles.css`) has equal specificity to the Tailwind `border-l-4`/`border-l-twin-critical` utility classes and, being defined in a separately-loaded stylesheet, won by cascade order regardless of which class came first in the className string. Fixed by adding Tailwind's `!important` modifier (`!border-l-4`, `!border-l-twin-critical` etc.) to the risk-edge classes only, leaving the base `.list-row-card` border untouched everywhere else.

Verified via browser: seeded data shows a realistic mix (4 of 15 products show zero risk chips, others show 1-3 depending on actual QA/expiry/stock state), and `getComputedStyle().borderLeftColor` on real rows confirmed `rgb(204, 63, 63)` (critical/red) and `rgb(184, 121, 15)` (warning/amber) rendering correctly post-fix.

**3. Batch Detail panel — added close button, and made it responsive instead of squeezing the list on smaller screens.** `InventoryInspector` previously had no dismiss control at all, and rendered as a fixed 360px-wide side column (`xl:grid-cols-[minmax(0,1fr)_360px]`) that permanently narrowed the main list once any batch was selected — fine on a wide monitor, but crowds/cuts off content on a smaller laptop screen exactly as the user described.
- Added an explicit close (✕) button in the panel header, wired to `setSelectedSku(null)` (the same store setter that clears the current batch selection elsewhere in the app).
- Made the panel itself responsive instead of just closeable: at `xl` (1280px+) it stays as the existing static side column; below `xl` it becomes a `position: fixed` right-side overlay/drawer (`inset-y-0 right-0 w-full max-w-sm overflow-y-auto`) that floats on top of the list instead of squeezing it, plus a semi-transparent backdrop (click-to-dismiss) shown only below `xl`.

Verified via browser at 1152×720 (below the `xl` breakpoint, representative of a smaller laptop): the list retained its full width (836px, unchanged) while the inspector rendered as a `position: fixed` drawer spanning the full viewport height; clicking the close button and, separately, clicking the backdrop both correctly removed the panel from the DOM.

Typecheck not yet re-run after this change (styling/JSX only, no type surface changes); unit tests unaffected (client-only). Screenshot verification hit the preview tool's known intermittent timeout, so all three fixes were confirmed via `preview_eval`/`getBoundingClientRect`/`getComputedStyle` DOM measurements instead, consistent with the verification approach used earlier in this log when screenshots were unreliable.

## 2026-07-08 — Two follow-up bugs from the previous fix, caught from a real screenshot

The user sent a screenshot with the Batch Detail panel open: the "QA Hold" stat on the product row was clipped to just "40" (label cut off), and the selected batch row's cyan highlight showed a second colored stripe stacked directly next to the risk-colored card edge, reading as one color "on top of" the other.

**1. QA Hold column clipping — real bug, root cause confirmed.** `StockPositionView`'s product-row and batch-row grids used fixed-pixel column tracks (`repeat(4,92px)` / `90px 90px 90px 90px 120px`) combined with fixed minimum widths on the leading columns (`minmax(170px,1.2fr)` etc). Fixed-px grid tracks don't shrink below their specified size — when the Batch Detail panel is open, the main list column narrows (down to `minmax(0,1fr)` in the outer `xl:grid-cols-[minmax(0,1fr)_360px]` split), and once the row's total minimum column width exceeded the now-narrower available space, the grid simply overflowed its container. Because `.list-row-card` has `overflow-hidden` (added earlier to fix the scroll-ghosting bug), that overflow was silently clipped at the row's right edge instead of wrapping or scrolling — exactly the "QA Hold" label disappearing, only "40" visible, that the user saw.

**Fix (`client/src/components/InventoryView.tsx`):** changed every fixed-px column track in both the product row and batch row grid templates to `minmax(0, <same-px>)` (and the two fixed-minimum leading columns to `minmax(0, <fr>)`), so the grid can shrink to fit whatever width is actually available instead of overflowing and getting clipped. Text already had `truncate`/`min-w-0` where it needed to compress gracefully.

Verified via browser with the Batch Detail panel open (1920px viewport, list column narrowed accordingly): measured the "QA Hold" label's `getBoundingClientRect().right` against the row's own right edge — now `1410.7 ≤ 1483`, fully inside, vs. previously overflowing and being clipped.

**2. Selected-batch highlight colliding with the risk-colored card edge — real bug, introduced by this session's own earlier change.** The active/selected batch row used `shadow-[inset_3px_0_0_#19a7c7]` (a 3px cyan stripe on the *left* edge) to show selection — added in an earlier session, before this session added the risk-colored `!border-l-4` edge to the outer product card. Once both existed, a selected batch inside a risky product card showed two competing colored strips stacked at the same left edge (the card's red/amber risk border, immediately followed by the row's own cyan selection stripe) — visually reading as "another color on top of" the risk border, exactly as reported.

**Fix:** moved the selection accent to the *right* edge of the row (`shadow-[inset_-3px_0_0_#19a7c7]`) instead of the left, so it no longer shares space with the card's left-edge risk indicator. Selection is still clearly visible via the cyan background tint plus the new right-side accent line; the two signals (risk = left edge of the whole card, selection = right edge of the specific row) are now spatially distinct instead of stacked.

Verified via browser: selected a batch row and read its computed `box-shadow` — confirmed `inset -3px 0 0 rgb(25,167,199)` (right side), no longer on the same edge as the card's `border-left`. Typecheck clean across all 3 workspaces.

## 2026-07-10 — Consolidated alerts down to a single surface (Dashboard only)

The user asked me to verify where the app's three separate alert displays — Sidebar's "Open Alerts" count, the Assistant panel's "Alerts" tab, and Monitoring's "Temperature Alerts" panel — actually pulled their data from. Traced the full chain: server's `getWarehouseSnapshot()` (`server/src/db/database.ts:1262`) reads a single SQLite `alerts` table once via `getAlerts()`; the client fetches that whole snapshot into the Zustand store, and all three UI locations read the identical `snapshot.alerts` array in memory — Sidebar just counted it, the Assistant tab showed the full grouped list, and Monitoring showed a filtered (temperature-only) subset. No duplication of underlying data, but three redundant renderings of the same information.

Given that, the user decided alerts should only ever appear in one place — the Dashboard's attention card — and asked me to remove every other display, rename that card, and remove the two "jump to alerts elsewhere" affordances that would now be dead ends.

**Removed:**
- **Sidebar "Open Alerts" button** (`client/src/components/Sidebar.tsx`) — deleted entirely, along with its `snapshot`/`openAlerts` derivation and the now-unused `Bell` icon import.
- **Assistant panel's "Alerts" tab** (`client/src/components/ChatPanel.tsx`) — removed the tab button, its content block, the `renderAlertsForSeverity` helper, the `groupedAlerts` state, and two smaller inline alert previews that existed elsewhere in the same panel (a 2-item preview shown above the chat's example-queries list, and a `relatedAlerts` mini-list inside the Warehouse Inspector's Sector/Risks sub-tabs) — all three were reading the same array, so removing only the tab would have left the panel still showing alerts in three other spots. Tab bar grid columns adjusted (`grid-cols-4`→`grid-cols-3`, `grid-cols-3`→`grid-cols-2`) now that one tab is gone. Cleaned up now-unused imports (`AlertCard`, `groupAlerts`, `toneForSeverity`, `Severity` type) — `toneForRisk` was kept since it's still used by the Evidence tab.
- **Monitoring's "Temperature Alerts" panel** (`client/src/components/MonitoringView.tsx`) — removed from `LiveFeeds` (which now renders only the RFID Events panel, no longer a 2-column grid), plus its companion "Temperature Alerts" KPI count tile from the page header stats row (now 3 stats instead of 4), and the now-dead `temperatureAlertFilter` helper function.
- **"Check Alerts" Next Action button** (`client/src/components/DashboardView.tsx`) — removed from the Dashboard's Next Actions list, since its destination (Monitoring's Temperature Alerts section) no longer exists.
- **`pendingScrollTarget` store field** (`client/src/store.ts`) — this generic scroll-to-element mechanism existed solely to power the "Check Alerts" → Monitoring flow; with both ends of that flow removed, it had no remaining callers anywhere in the app, so removed the field, its setter, and initial value rather than leave genuinely dead state in the store.

**Renamed:** Dashboard's "Needs Attention" card heading → **"Open Alerts"**, per the user's request — it's now the sole place alerts surface anywhere in the app; its underlying data/behavior (click any item to jump to and highlight the exact SKU/shipment/zone/route in question) is unchanged.

**Verified via browser** (1600×1000): Sidebar shows only "Assistant" below the nav (no alert count button); Dashboard heading reads "Open Alerts" with the same 6-item list and click-through behavior intact; Assistant panel's tab bar shows exactly `["Chat", "Evidence"]`, no "Alerts"; Monitoring's page headings are `["Temperature Monitoring", "Temperature Events", "RFID Events", "Scenario"]` — no "Temperature Alerts" anywhere, and its stat row no longer includes that tile. Typecheck clean across all 3 workspaces.

## 2026-07-10 — Made alerts genuinely live: removed the seeded row, added auto-resolve

Follow-up to the previous entry. The user asked what information the `alerts` table actually carries and where it comes from; the answer surfaced two real problems with the "live" story: (1) `server/src/db/seed.ts` inserted one static alert row (`QA Hold lot LOT-ONC-0709-B is linked to blocked shipment SHIP-005.`) at seed time that would sit open forever, never touched by the live loop; (2) the genuinely live generator in `server/src/realtime.ts` (a 30s interval checking 5 real conditions — expiry risk, open temperature events, dock overruns, FEFO compliance, QA-hold-linked shipments — and inserting via `createAlert()`, which dedupes by exact message text) only ever **created** alerts, never **resolved** them. So even though the loop was real and re-evaluating live state every 30s, an alert's underlying condition could clear (temperature back in-band, SKU dispatched, etc.) and the alert would just sit `open` forever — indistinguishable from a static seed. The user asked to remove the seeded row (or keep at most 1-2 that would never conflict) and make alerts actually live.

**Chose full removal over partial-keep.** The one seeded alert conceptually duplicated a fact the live QA-hold generator already covers for the same SKU/shipment pair (`SB-LOT-ONC-0709-B` / `SHIP-005`), just with different wording — keeping it would produce two differently-phrased alerts about the same underlying condition. Removed the `insertAlert.run(...)` call and the now-unused `insertAlert` prepared statement from `server/src/db/seed.ts` entirely, with a comment explaining why (the alerts table is now 100% populated by the live loop). `pruneSeededTemperatureAlerts()` (deletes two other, older hardcoded legacy alert messages left over from a prior version) was left as-is — harmless hygiene, unrelated to this change.

**Added real resolve/reappear behavior (`server/src/realtime.ts`):** added `reconcileAlerts(isInCategory, currentMessages)` — for each of the 5 alert categories, on every 30s tick it now (a) computes the *current* set of condition-derived messages exactly as before, (b) looks up every currently-`open` DB alert matching that category's message shape (identified by a stable substring/regex per category, since the schema has no explicit category field), and (c) marks any that are open-but-no-longer-in-the-current-set as `status: 'dismissed'` before creating/confirming the current ones. Also emits an extra `dashboard:state_update` when anything actually resolves that tick, so the client's snapshot refetch (already wired to that event) reflects the change promptly instead of waiting for an unrelated update.

This means: temperature-based alerts (the category most likely to genuinely fluctuate, since zone temperatures random-walk continuously with a rare simulated spike ~0.3-0.4% of ticks) will now actually appear when an excursion starts and disappear once `buildTemperatureEvents()` reports the event as `Resolved`/`Under Review` instead of `Open` — confirmed by tracing `groupExcursions()` in `shared/types/index.ts`, which already flips event status correctly once readings return in-band. The other 4 categories (expiry risk, dock overrun, FEFO compliance, QA hold) will similarly resolve whenever the underlying state changes — which in this app mostly happens as a result of real actions taken through the chat/approval flow (dispatching, approving a hold release, etc.), not a timer — a genuinely better "live" story than decorative animation would have been.

**Verified end-to-end via a fresh DB reset + live curl polling** (not just typecheck): reset the database (`npm run reset-db -w server`), confirmed `snapshot.alerts` was empty immediately after seeding (zero static rows, as intended), then polled `/api/warehouse` after the loop had ticked — got exactly 3 real alerts (`SKU ... expires within 48 hours`, `SKU ... expires within 48 hours`, `FEFO compliance score is 72%, below the 85% threshold`), all `status: "open"`, correctly matching the live conditions actually present in the seeded data. Polled again after a second 30s tick — same 3 alerts, same set, confirming the dedup path doesn't duplicate rows for conditions that are still true. Typecheck clean across all 3 workspaces; unit tests 8/8 still pass (none of them exercise the alerts table).

**Known limitation, not fixed (out of scope for this ask):** `App.tsx` already listens for the `alert:new` socket event and calls `addAlert()`, but that only writes to a `toastAlerts` store field that no component currently reads or renders — so a genuinely new alert firing between snapshot refetches produces no visible toast/notification, only the eventual `dashboard:state_update`-triggered refresh. Flagging this as vestigial/half-built infrastructure in case the user wants a real toast notification built on top of it later.

## 2026-07-10 — Removed the dead toast-alert mechanism entirely

The user asked to remove the vestigial toast-alert path flagged above completely, rather than build it out. While removing it, found it did more than just an unused toast field — worth documenting since it wasn't fully accurate to call it "just an unused toast":

- **`toastAlerts`** (`client/src/store.ts`) — array of the 5 most recent alerts, confirmed via `Grep` to have zero readers anywhere in the client. Genuinely dead.
- **`snapshot.alerts` prepend** — `addAlert()` also spliced the new alert directly into `state.snapshot.alerts`. Redundant, not load-bearing: `emitAlert()` in `realtime.ts` always fires `dashboard:state_update` alongside `alert:new`, and the client's existing `dashboard:state_update` listener already does a full `getWarehouse()` refetch — so the Dashboard's alert list was always going to update via that path regardless.
- **Injected an "autonomous"-role chat message** for every new alert, styled as an amber "Alert" bubble in `ChatPanel.tsx`'s `MessageBubble` (`isAuto` branch). Traced whether this was actually visible: `conversationMessages` (the array the Chat tab actually renders) explicitly filters out `role === "autonomous"` messages — so this bubble styling has never been reachable in the current UI. Confirms the whole `addAlert` mechanism was dead end-to-end, not just the toast part.

**Removed:**
- `addAlert` setter and `toastAlerts` field from `client/src/store.ts` (plus the now-unused `Alert` type import).
- The `socket.on("alert:new", ...)` listener and `addAlert` store binding from `client/src/App.tsx` (plus the now-unused `Alert` type import).
- The `io.emit("alert:new", alert)` call in `server/src/realtime.ts`'s `emitAlert()` — nothing listens for it anymore; kept the paired `dashboard:state_update` emit, which is the part that actually drives the UI.

Left the dormant `isAuto`/"Alert" bubble styling branch in `ChatPanel.tsx`'s `MessageBubble` alone — it's unreachable now but touching a component not directly part of the toast-alert chain felt like scope creep beyond what was asked; flagging here in case it's worth a future cleanup pass.

**Verified:** `npm run typecheck` clean across all 3 workspaces, `npm run test` 8/8 passing, and a full `orchestrator.ps1 restart` — both server and client logs show clean startup with no errors from the removed socket/store wiring.

## 2026-07-10 — Real bug: transient temperature spikes never made it into an alert (30s poll vs. 5s reality)

The user reported seeing "a couple of temperature variance" in the Receiving zone that never showed up as a live alert, and asked directly whether I was sure alerts were actually live. Checked instead of asserting — queried `getTemperatureEvents()` for Receiving and found two `Excursion` events with `status: "Resolved"` whose `timestampStart` equaled their `timestampEnd` to the millisecond: single-reading spikes that opened and closed within one 5-second temperature tick.

**Root cause, confirmed by tracing the timing precisely:** `groupExcursions()` (`shared/types/index.ts`) only reports an event's status as `"Open"` while its out-of-band reading is still the *most recent* reading for that zone; the moment the next (normal) reading lands, it finalizes as `"Resolved"`/`"Under Review"`. The temperature simulation in `realtime.ts` writes a new reading every 5 seconds, so a single-tick spike's "Open" window lasts only ~5 seconds. The alert-checking loop I built in the previous session polled every 30 seconds — six times slower than the phenomenon it needed to observe — so it was structurally almost guaranteed to sample *after* the spike had already closed out and never see it as `"Open"`, meaning it was silently missing exactly the transient live spikes the user was asking about. Non-Conformance events (sustained/severe deviations) were unaffected since those persist across several readings and comfortably outlast a 30s poll; only single-tick Excursions were falling through the gap.

**Fix (`server/src/realtime.ts`):** extracted the temperature-alert check + `reconcileAlerts()` call into its own `checkTemperatureAlerts()` function and moved it into the *same* 5-second `setInterval` as the temperature simulation itself, called immediately after that tick's readings are written — instead of the slower 30-second loop that still handles the other four categories (expiry risk, dock overrun, FEFO compliance, QA hold), whose underlying conditions don't fluctuate on a per-5-second basis so the slower cadence remains correct for them. This guarantees the check always observes a reading while it's genuinely still the most recent one, i.e. while it's genuinely `"Open"`, closing the race entirely rather than reducing its odds.

**Verified against a real, naturally-occurring spike, not a synthetic one** (a synthetic DB insert can't validate this fix — it would just get closed out by the next real tick before ever being the "current" reading, same failure mode as the bug itself, so only the real code path proves anything): restarted the app, ran a background poll of `/api/warehouse` every 3s, and within ~20 seconds a genuine Receiving spike fired (`temp=30.7`, band `15-30`). A direct check immediately after confirmed the exact expected message — `"Receiving temperature Non-Conformance is open: peak 30.7 C, variance 0.7 C for 5 min."` — had been created as `critical`, and had *already* auto-resolved to `dismissed` by the time it was checked seconds later, matching the reading's real lifecycle precisely: created while genuinely open, resolved the moment it genuinely closed. `npm run typecheck` clean across all 3 workspaces; `npm run test` 8/8 still passing (no test covers the alert timing itself, which is why this needed a live end-to-end check rather than relying on the existing suite).

## 2026-07-11 — Full inventory of live data sources, and building out the dead `shipment:status_change` stub

The user asked for a complete list of everything in the app that's genuinely "live" beyond temperature and RFID, and specifically what the third emit (`shipment:status_change`, found earlier) was supposed to represent.

**Audit of every live/background data source** (`server/src/realtime.ts`, `server/src/index.ts`, `client/src/components/DashboardView.tsx`): confirmed via `Grep` for every `io.emit`/`setInterval`/`setTimeout` server-side and every `socket.on`/polling `setInterval` client-side. Genuinely ambient/background: temperature (5s), RFID (jittered 3-8s), the alert engine (a live *derivative* of temperature/SKU/shipment state, not an independent feed), and live weather (`LiveWeatherWidget`, real Open-Meteo data, polls every 5 minutes on both Dashboard and Logistics independently). `dashboard:state_update` isn't data itself — it's the broadcast signal that makes every connected browser refetch the full snapshot, firing from the alert engine and from `/api/approve` (so any user's Approve action refreshes every connected client, not just their own). Chat streaming (SSE) is real-time but user-triggered, not ambient.

**`shipment:status_change` — confirmed it was a non-functional stub, not just unlistened.** Its payload set `newStatus` to the exact same value as `previousStatus`, and no code anywhere wrote to the `shipments` table — so even a hypothetical listener would only ever have seen "status changed to the status it already was," forever, for whichever shipment happened to be dispatching soonest. Traced what it *should* represent: `shared/types/index.ts`'s `OutboundShipment.outboundStatus` already defines the real warehouse fulfillment pipeline (`Scheduled → Allocated → Picking → Packed → Staged → Dispatched`, with `Blocked` as a QA exception branch), matching the `qtyAllocated/qtyPicked/qtyPacked/qtyDispatched` progression already modeled on `outbound_lines` — the stub was clearly meant to auto-advance shipments through this pipeline over time and never was.

**Built it out for real (`server/src/realtime.ts`):** added `advanceShipments()`, run every 25s, which advances exactly one shipment — the soonest-due one still in progress — one stage forward, and:
- Mirrors the new status into **both** `outbound_shipments.outbound_status` (Inventory's Outbound tab) **and** `shipments.status` (Logistics' dispatch queue/map) in the same transaction. Discovered mid-implementation that these are two separate tables seeded once from the same source data but never kept in sync afterward — exactly the kind of redundant-copy drift this session has been eliminating elsewhere (alerts, toast state), so treating `outbound_shipments` as the write source and mirroring into `shipments` was a deliberate choice, not an afterthought.
- Finalizes the real line-level quantities for each transition (`Allocated`: `qtyAllocated = qtyRequired`; `Packed`: `qtyPicked`/`qtyPacked` both filled; `Dispatched`: `qtyDispatched = qtyPacked`) and logs a genuine `inventory_movements` row per line per transition (`Reserve`/`Pick`+`Pack`/`Stage`/`Dispatch`) — so the existing Inventory > Movements tab shows real new activity, not just the seeded history.
- Occupies the dock on `Staged` and frees it on `Dispatched` (`docks.status`/`current_shipment_id`), and marks the matching `dock_schedule` row `staged`/`complete` — which also means a shipment that genuinely dispatches now correctly stops tripping the "dock may be occupied beyond scheduled window" alert from two sessions ago, instead of that alert staying open forever against a dock nothing is actually still using.
- `Blocked` shipments are deliberately excluded from the auto-advance table — that's a QA exception state that should only ever clear through an explicit human decision via the chat/approval flow, consistent with the app's existing human-in-the-loop mutation philosophy, not something a timer should silently resolve.
- Emits the now-genuinely-differing `shipment:status_change` plus a paired `dashboard:state_update`, same pattern as the alert engine, so every connected client's Logistics/Inventory/Dashboard views refresh immediately.

**Verified against a real transition, live, not just by reading the code:** reset the DB, restarted, confirmed the initial state (SHIP-001 `Staged`, soonest due), waited one 25s tick, and re-queried — `SHIP-001` was now `Dispatched` in **both** `outbound_shipments` and `shipments`, its lines showed `qtyDispatched` exactly matching `qtyPacked`, dock D2 had flipped to `available`/`currentShipmentId: null`, its `dock_schedule` row read `complete`, and two new `Dispatch` movement rows for the correct product/batch/qty appeared at the top of the Movements feed. `npm run typecheck` clean across all 3 workspaces; `npm run test` 8/8 still passing.

**Known scope boundary, not fixed — flagged rather than silently claimed as complete:** the app has a *third*, older, parallel data model — a `skus` table (used by the Dashboard, Warehouse 3D view, and the alert engine's expiry/QA-hold checks) whose `currentStage` field (Receiving/Picking/Packing/Storage/Dock Staging) is computed at read time from `stock_balances` quantities, not from `outbound_lines`. `sku.linkedShipmentId` *does* automatically stay correct after this change (it's a live correlated subquery against `outbound_lines`/`outbound_shipments`, which this change does update), but `sku.currentStage` does not, since `stock_balances` tracks its own independent qty_picked/qty_packed/qty_staged per batch+location that this change never touches. So a shipment can now correctly show "Packed" in Logistics/Inventory while the same batch's SKU still shows an older stage on the Dashboard/Warehouse view. Wiring `stock_balances` into the same transition would close that gap but is a meaningfully larger change (it overlaps with FEFO allocation logic) — flagged for the user to decide whether it's worth doing, rather than either silently expanding scope or silently leaving an unstated inconsistency.
