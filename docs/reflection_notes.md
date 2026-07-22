# Reflection Notes

## Architecture

GSK TwinOps AI is structured as a full-stack digital twin prototype. The React client presents the warehouse command centre, while the Express server owns all operational facts, SQLite reads, deterministic tools, AI orchestration, WebSocket events, and scenario evidence. Shared TypeScript types in `shared/types` keep the client and server aligned.

The agent design separates narrative from authority. The Orchestrator Agent routes each query to Inventory, Logistics, and Compliance logic, but the actual facts come from deterministic tools backed by SQLite. OpenAI is optional and only enhances the narrative when an API key is available.

## Technical Flow

1. The user submits a chat query through the right-side control panel.
2. `/api/chat` streams an SSE response and calls the Orchestrator Agent.
3. The Orchestrator loads warehouse state, selects agents, and executes deterministic tools.
4. Tool outputs are persisted as an `ai_decisions` compatibility record with confidence, risk, evidence, and affected entities. New records are always read-only and `not_required` for approval.
5. The client highlights SKUs, zones, stages, shipments, and docks from the structured response.
6. What-if tools store scenario snapshots only; they do not create pending actions, alerts, or warehouse mutations.
7. Legacy approval endpoints return `410 Gone`, and mutation tool names are rejected by the server router.
8. Inventory Planning runs a deterministic risk and replenishment projection without calling the model; only an explicit Ask Assistant action starts the existing grounded assistant flow. That handoff includes the displayed scenario values and stable product identifiers, while `get_inventory_planning` independently reproduces the projection from canonical warehouse data.
9. Planning risk examples are seeded as connected WMS/TMS records rather than UI flags. Outbound allocations create the critical and warning cases, a released FEFO lot creates expiry exposure, execution buckets reconcile to on-hand stock, and stable movement/audit records make the same evidence visible in other workspaces.

## Hallucination Safeguards

- The model is never trusted as the source of SKU, dock, route, temperature, FEFO, quality, or shipment facts.
- Every operational answer includes tool call logs and decision evidence instead of hidden reasoning trace.
- If OpenAI is unavailable, the dashboard and deterministic simulations still work.
- The UI uses HSA-style regulatory fields for academic simulation and does not claim HSA compliance.
- The footer and README explicitly state that no real GSK systems, data, logos, or patient information are used.

## Read-Only Assistant Boundary

The assistant provides facts, risks, evidence, navigation, and what-if comparisons only. It cannot choose an option for management, create a pending action, request approval, dispatch stock, release quality status, resequence docks, or mutate the operational snapshot. Historical records remain available as audit evidence, but they do not form a current approval queue.

## Challenges

- `better-sqlite3` could not install under Node 24 without a native build toolchain, so the project uses Node's built-in SQLite fallback while preserving file persistence.
- Building a credible 3D warehouse without CAD assets required restrained simple geometry and operational highlighting.
- The assignment calls for agentic behaviour, but safe supply-chain prototypes need deterministic guardrails; this app demonstrates agentic routing while keeping the assistant strictly advisory.

## Reflection

Agentic orchestration can improve operational awareness by combining inventory, logistics, and compliance signals quickly during disruptions. The risk is that an LLM may overstate certainty or invent missing operational facts. This prototype reduces that risk by grounding every answer in SQLite tool outputs, showing evidence and uncertainty, and preventing the assistant from creating or applying management decisions.

Simulation mode: This prototype uses GSK-inspired pharmaceutical warehouse, IoT, shipment, route, and compliance data for academic demonstration. It does not represent real GSK operations.
