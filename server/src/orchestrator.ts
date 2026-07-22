import OpenAI from "openai";
import type {
  ActionPayload,
  AgentName,
  AgentIntent,
  AgentResponse,
  AnalysisPriority,
  AssistantUiContext,
  DecisionEvidence,
  OrchestratorResponse,
  RiskLevel,
  ToolCallSummary
} from "@twinops/shared";
import {
  TWINOPS_AGENT_SYSTEM_PROMPT,
  TWINOPS_TOOL_ROUTER_SYSTEM_PROMPT,
  assistantWelcomeAgentResponse,
  fallbackAgentResponseFor,
  isAssistantIntroductionQuery,
  parseAgentJson,
  validateAgentResponse
} from "./agentResponse";
import { db, getWarehouseSnapshot, nowIso } from "./db/database";
import { runTool, summariseToolCall, type ToolExecution } from "./tools";

const stringify = (value: unknown) => JSON.stringify(value);

type ToolPlan = { name: string; input: Record<string, unknown> };

function priorityLabel(priority: AnalysisPriority) {
  if (priority === "fefo") return "FEFO first";
  if (priority === "cold_chain") return "Cold-chain first";
  return "Balanced";
}

function priorityInstruction(priority: AnalysisPriority) {
  if (priority === "fefo") {
    return "Rank FEFO preservation first among safe options. Never trade away cold-chain integrity, quality release, or traceability.";
  }
  if (priority === "cold_chain") {
    return "Rank cold-chain integrity and controlled handoffs first, even when this increases delay or FEFO pressure.";
  }
  return "Balance FEFO, cold-chain, dock, and service risks while preserving all quality and traceability controls.";
}

function uiContextPrompt(uiContext?: AssistantUiContext) {
  if (!uiContext) return "No current UI selection was supplied.";
  return `Current UI context: ${JSON.stringify(uiContext)}\nUse this only to understand the operator's current page, selection, filters, and pronouns. It is not evidence of operational status; call deterministic tools for every factual claim.`;
}

function safeSelectedIdentifier(value: string | null | undefined) {
  return typeof value === "string" && value.length <= 160 && /^[A-Z0-9][A-Z0-9._:-]*$/i.test(value)
    ? value
    : null;
}

/**
 * The deterministic router may use one explicit selected identifier to resolve a phrase such as
 * "this shipment". Feeding it the whole UI-context JSON changes keyword matching simply because
 * workspace and filter names happen to contain words such as "outbound" or "delayed".
 */
export function fallbackRoutingQuery(query: string, uiContext?: AssistantUiContext) {
  if (!uiContext || !/\b(?:this|that|it|selected|current)\b/i.test(query)) return query;
  const text = query.toLowerCase();
  const selected = uiContext.selected;
  let identifier: string | null = null;

  if (/\b(?:shipment|delivery|outbound)\b/.test(text)) identifier = safeSelectedIdentifier(selected.shipmentId);
  else if (/\b(?:asn|inbound)\b/.test(text)) identifier = safeSelectedIdentifier(selected.inboundAsnId);
  else if (/\b(?:appointment|booking)\b/.test(text)) identifier = safeSelectedIdentifier(selected.dockAppointmentId);
  else if (/\b(?:transport leg|leg)\b/.test(text)) identifier = safeSelectedIdentifier(selected.transportLegId);
  else if (/\broute\b/.test(text)) identifier = safeSelectedIdentifier(selected.routeId);
  else if (/\bdock\b/.test(text)) identifier = safeSelectedIdentifier(selected.dockId);
  else if (/\b(?:stock|sku|lot|batch|position)\b/.test(text)) identifier = safeSelectedIdentifier(selected.stockBalanceId);
  else {
    const selectedForFocus: Partial<Record<NonNullable<AssistantUiContext["focusType"]>, string | null | undefined>> = {
      shipment: selected.shipmentId,
      asn: selected.inboundAsnId,
      dock_appointment: selected.dockAppointmentId,
      transport_leg: selected.transportLegId,
      route: selected.routeId,
      dock: selected.dockId,
      stock_balance: selected.stockBalanceId,
      zone: selected.zoneId,
      rack: selected.rackId,
      bin: selected.binId,
      rfid: selected.rfidGateId,
      partner_site: selected.partnerSiteId
    };
    identifier = safeSelectedIdentifier(uiContext.focusType ? selectedForFocus[uiContext.focusType] : null);
  }

  return identifier && !query.toLowerCase().includes(identifier.toLowerCase())
    ? `${query} ${identifier}`
    : query;
}

// JSON schemas for every read-only deterministic tool. Mutation tools are deliberately excluded:
// the assistant may look up facts and simulate effects, but it cannot create or apply operational
// actions or enter a management-decision workflow.
const AGENT_TOOL_SPECS = [
  {
    type: "function" as const,
    function: {
      name: "get_inventory_summary",
      description: "Get the current on-hand, available, reserved, incoming, outbound, and QA Hold totals across the whole warehouse.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "search_inventory",
      description: "Free-text search across products, batches, inbound, and outbound records when no specific SKU or batch ID is known.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text search term, e.g. product name, material code, lot, STO, goods receipt, handling unit, inspection lot, or location." },
          filters: {
            type: "array",
            items: { type: "string" },
            description: "Optional filters such as 'Released', 'QA Hold', 'Quarantine', 'Cold Chain', 'Available', 'Reserved', 'Expiring Soon', 'Incoming', 'Outbound'."
          },
          sort: { type: "string", description: "Optional sort key, e.g. 'Earliest expiry', 'Available', 'On-hand', 'Location', 'Status', 'Product'." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_product_stock",
      description: "Get on-hand, available, reserved, and batch-level stock for a specific product ID or product code.",
      parameters: {
        type: "object",
        properties: { productId: { type: "string", description: "Product ID or material code, e.g. MAT-100004 or PH-COLD-ADAL40-PEN." } },
        required: ["productId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_inventory_planning",
      description: "Reproduce the Inventory Planning dashboard's deterministic replenishment and expiry-risk projection for one product using canonical stock, policy, released inbound, and FEFO expiry data.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: "string", description: "Product ID or product code, e.g. PROD-VAX-RSV or GSK-VAX-RSV." },
          horizonDays: { type: "number", description: "Projection horizon in days, normally 7, 14, or 30." },
          demandMultiplier: { type: "number", description: "Scenario multiplier applied to configured average daily demand." }
        },
        required: ["productId", "horizonDays", "demandMultiplier"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_batch_detail",
      description: "Get full detail (quantity, quality status, location, expiry) for a specific batch or lot ID.",
      parameters: {
        type: "object",
        properties: { batchId: { type: "string", description: "Batch ID, lot code, or stock-balance ID, e.g. B-L2601-INSGLA-01, L2601-INSGLA-01, or STK-100001-01." } },
        required: ["batchId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_incoming_stock",
      description: "List inbound ASNs (advance shipment notices) with expected and received quantities.",
      parameters: {
        type: "object",
        properties: { filters: { type: "array", items: { type: "string" }, description: "Optional filters, e.g. an inbound status or receiving dock." } },
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_outbound_stock",
      description: "List outbound shipments with allocated and required quantities.",
      parameters: {
        type: "object",
        properties: { filters: { type: "array", items: { type: "string" }, description: "Optional filters, e.g. an outbound status, destination, or dock." } },
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_inventory_movements",
      description: "Get the inventory movement ledger (receive, reserve, pick, pack, dispatch records), optionally filtered.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text search across movement records." },
          movementType: { type: "string", description: "Filter by movement type, e.g. Receive, Reserve, Pick, Pack, Dispatch." },
          product: { type: "string", description: "Filter by product ID, code, or name." },
          batch: { type: "string", description: "Filter by batch ID." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "check_fefo_allocation",
      description: "Check which batches of a product are FEFO-eligible for a requested quantity, and which are excluded and why.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: "string", description: "Product ID or product code." },
          requestedQty: { type: "number", description: "Quantity being requested for allocation." }
        },
        required: ["productId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "simulate_shipment_allocation",
      description: "Simulate (does not mutate state) allocating or dispatching stock for a specific outbound shipment, showing before/after inventory impact.",
      parameters: {
        type: "object",
        properties: { shipmentId: { type: "string", description: "Outbound shipment ID, e.g. SHIP-003." } },
        required: ["shipmentId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "locate_sku",
      description: "Locate a specific inventory placement in the warehouse: stock balance, product, batch, zone, rack, bin, FEFO position, and linked shipment.",
      parameters: {
        type: "object",
        properties: { stockBalanceId: { type: "string", description: "Stock-balance, batch, lot, or product identifier, e.g. STK-100001-01 or L2601-INSGLA-01." } },
        required: ["stockBalanceId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "check_fefo_impact",
      description: "Check the FEFO (First-Expired-First-Out) impact of prioritising a specific SKU for a specific shipment.",
      parameters: {
        type: "object",
        properties: {
          stockBalanceId: { type: "string", description: "Stock-balance, batch, lot, or product identifier." },
          shipmentId: { type: "string", description: "Outbound shipment ID." }
        },
        required: ["stockBalanceId", "shipmentId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "check_cold_chain_status",
      description: "Check current temperature and cold-chain breach severity for a warehouse zone, optionally against a specific SKU's required band.",
      parameters: {
        type: "object",
        properties: {
          zoneId: { type: "string", description: "Zone ID or name, e.g. Cold Storage." },
          skuId: { type: "string", description: "Optional SKU to check against its own temperature band." }
        },
        required: ["zoneId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_temperature_events",
      description: "Get recorded temperature excursion or non-conformance events, optionally filtered by zone or event type.",
      parameters: {
        type: "object",
        properties: {
          zoneId: { type: "string", description: "Optional zone ID or name to filter by." },
          eventType: { type: "string", description: "Optional event type, e.g. Excursion or Non-Conformance." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_route_status",
      description: "Get route status, ETA, delay, and risk for an inbound or outbound route, leg, ASN, shipment, appointment, origin, destination, carrier, or vehicle.",
      parameters: {
        type: "object",
        properties: { routeName: { type: "string", description: "Optional route name or origin to filter by; omit to list all routes." } },
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_transport_context",
      description: "Read canonical joined transport data. Resolves a transport leg, route, ASN, outbound shipment, dock appointment, dock, partner site, carrier, vehicle, or licence plate and returns its linked TMS leg, WMS document and lines, sites, yard appointment, physical dock, schedule adherence, and operational events. Omit referenceId for a transport overview.",
      parameters: {
        type: "object",
        properties: {
          referenceId: { type: "string", description: "Optional exact or recognisable transport reference, e.g. LEG-IN-1001, ASN-1001, SHIP-005, ROUTE-DISPATCH-NCC, APT-OUT-005, D2, a site, carrier, vehicle, or licence plate." },
          direction: { type: "string", enum: ["inbound", "outbound", "all"], description: "Optional directional filter." },
          status: { type: "string", description: "Optional exact transport, route, or schedule-adherence status." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "get_audit_lookup",
      description: "Search the audit log of past read-only assistant enquiries and their evidence.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Free-text search, e.g. an enquiry ID or query text." } },
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "check_dock_schedule",
      description: "Check for dock slot conflicts and availability within a time window.",
      parameters: {
        type: "object",
        properties: {
          timeWindow: { type: "string", description: "Time window to check, e.g. 'next 4 hours' or 'next 12 hours'. Defaults to next 4 hours." },
          shipmentId: { type: "string", description: "Optional shipment ID to check against the schedule." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "simulate_reprioritisation",
      description: "Simulate (does not mutate state) prioritising a shipment as URGENT, showing impacted SKUs, stages, docks, and risk delta.",
      parameters: {
        type: "object",
        properties: { shipmentId: { type: "string", description: "Shipment ID to simulate prioritising, e.g. SHIP-001." } },
        required: ["shipmentId"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "simulate_facility_disruption",
      description: "Simulate (without mutating state) a warehouse-wide outage such as a tornado, flood, earthquake, power outage, or closure. Evaluates FEFO expiry exposure and all inbound/outbound work during the outage without assuming a transport route.",
      parameters: {
        type: "object",
        properties: {
          eventType: {
            type: "string",
            enum: ["severe_weather", "facility_shutdown", "tornado", "flood", "earthquake", "power_outage"],
            description: "Facility disruption type."
          },
          durationMinutes: { type: "number", description: "Full facility downtime in minutes, e.g. 10080 for one week." }
        },
        required: ["eventType", "durationMinutes"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "simulate_event_impact",
      description: "Simulate (does not mutate state) the impact of a disruption event on an inbound route: ETA delay, FEFO risk, dock conflicts, and mitigation options.",
      parameters: {
        type: "object",
        properties: {
          eventType: {
            type: "string",
            enum: ["weather", "supplier_delay", "vehicle_breakdown", "customs_hold", "temperature_excursion", "manufacturing_delay", "quality_hold"],
            description: "Type of disruption event."
          },
          affectedRoute: { type: "string", description: "Name of the affected inbound route, e.g. Changi Air Cargo Gateway." }
        },
        required: ["eventType", "affectedRoute"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "simulate_transport_impact",
      description: "Run a read-only, cross-domain what-if for an exact transport leg, route, ASN, outbound shipment, or dock appointment. Projects ETA/service variance, yard appointment and dock conflicts, cold-chain and WMS line exposure, affected stock/batches/stages, and option trade-offs without mutating operations.",
      parameters: {
        type: "object",
        properties: {
          referenceId: { type: "string", description: "Exact transport leg, route, ASN, shipment, or appointment ID." },
          eventType: {
            type: "string",
            enum: ["traffic_delay", "weather", "supplier_delay", "vehicle_breakdown", "customs_hold", "temperature_excursion", "manufacturing_delay", "quality_hold", "dock_closure", "capacity_constraint"],
            description: "Scenario event to project."
          },
          delayMinutes: { type: "number", description: "Optional explicit delay in minutes; otherwise the scenario baseline is used." }
        },
        required: ["referenceId", "eventType"],
        additionalProperties: false
      }
    }
  }
];

const TOOL_TO_AGENTS: Record<string, AgentName[]> = {
  get_inventory_summary: ["Inventory"],
  search_inventory: ["Inventory"],
  get_product_stock: ["Inventory"],
  get_inventory_planning: ["Inventory"],
  get_batch_detail: ["Inventory"],
  get_incoming_stock: ["Inventory"],
  get_outbound_stock: ["Inventory"],
  get_inventory_movements: ["Inventory"],
  check_fefo_allocation: ["Inventory"],
  simulate_shipment_allocation: ["Inventory", "Logistics"],
  locate_sku: ["Inventory"],
  check_fefo_impact: ["Inventory", "Logistics"],
  check_cold_chain_status: ["Compliance", "Inventory"],
  get_temperature_events: ["Compliance"],
  get_route_status: ["Logistics"],
  get_transport_context: ["Logistics", "Inventory"],
  get_audit_lookup: ["Compliance"],
  check_dock_schedule: ["Logistics"],
  simulate_reprioritisation: ["Inventory", "Logistics", "Compliance"],
  simulate_facility_disruption: ["Inventory", "Logistics", "Compliance"],
  simulate_event_impact: ["Logistics", "Compliance", "Inventory"],
  simulate_transport_impact: ["Logistics", "Compliance", "Inventory"]
};

const TOOL_TO_INTENT: Record<string, AgentIntent> = {
  locate_sku: "sku_location",
  check_fefo_impact: "sku_location",
  check_fefo_allocation: "fefo_check",
  simulate_shipment_allocation: "stock_position",
  get_inventory_summary: "stock_position",
  search_inventory: "stock_position",
  get_product_stock: "stock_position",
  get_inventory_planning: "stock_position",
  get_batch_detail: "batch_detail",
  get_incoming_stock: "incoming_stock",
  get_outbound_stock: "outbound_stock",
  get_inventory_movements: "stock_position",
  check_cold_chain_status: "temperature_event",
  get_temperature_events: "temperature_event",
  get_route_status: "route_status",
  get_transport_context: "transport_status",
  check_dock_schedule: "route_status",
  get_audit_lookup: "audit_lookup",
  simulate_reprioritisation: "scenario_simulation",
  simulate_facility_disruption: "scenario_simulation",
  simulate_event_impact: "shipment_impact",
  simulate_transport_impact: "scenario_simulation"
};

function guessIntentFromExecutions(executions: ToolExecution[]): AgentIntent {
  if (executions.some((execution) => execution.name === "simulate_facility_disruption")) return "scenario_simulation";
  if (executions.some((execution) => execution.name === "simulate_transport_impact" || execution.name === "simulate_reprioritisation")) return "scenario_simulation";
  for (const execution of executions) {
    const intent = TOOL_TO_INTENT[execution.name];
    if (intent) return intent;
  }
  return "general_question";
}

function agentsFromExecutions(executions: ToolExecution[]): AgentName[] {
  const agents = new Set<AgentName>(["Orchestrator"]);
  for (const execution of executions) {
    for (const agent of TOOL_TO_AGENTS[execution.name] ?? []) agents.add(agent);
  }
  return [...agents];
}

const MAX_TOOL_ROUNDS = 4;

export type ProgressEvent = { toolName: string; agents: AgentName[] };
export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * Lets the model itself choose which deterministic tools to call (real function-calling),
 * instead of a keyword router pre-deciding. Mutation tools are excluded from AGENT_TOOL_SPECS,
 * so the model can only ever read/simulate, never apply a change.
 */
async function selectAndRunToolsWithAgent(
  client: OpenAI,
  model: string,
  query: string,
  onProgress?: ProgressCallback,
  analysisPriority: AnalysisPriority = "balanced",
  uiContext?: AssistantUiContext
): Promise<{ executions: ToolExecution[]; toolFailures: string[] }> {
  const executions: ToolExecution[] = [];
  const toolFailures: string[] = [];
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: TWINOPS_TOOL_ROUTER_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Analysis priority: ${priorityLabel(analysisPriority)}. ${priorityInstruction(analysisPriority)}\n\n${uiContextPrompt(uiContext)}\n\nOperator request: ${query}`
    }
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      tools: AGENT_TOOL_SPECS,
      tool_choice: "auto",
      messages
    });

    const message = completion.choices?.[0]?.message;
    const toolCalls = message?.tool_calls?.filter((call) => call.type === "function") ?? [];
    if (!message || toolCalls.length === 0) break;

    messages.push(message);
    for (const call of toolCalls) {
      let input: Record<string, unknown> = {};
      try {
        input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        input = {};
      }
      try {
        const output = await runTool(call.function.name, input);
        executions.push({ name: call.function.name, input, output, summary: summariseToolCall(call.function.name, input, output) });
        messages.push({ role: "tool", tool_call_id: call.id, content: stringify(output) });
        onProgress?.({ toolName: call.function.name, agents: TOOL_TO_AGENTS[call.function.name] ?? [] });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Tool execution failed.";
        toolFailures.push(`${call.function.name}: ${errorMessage}`);
        messages.push({ role: "tool", tool_call_id: call.id, content: stringify({ error: errorMessage }) });
      }
    }
  }

  const stockBalanceId = extractSku(query);
  const executionNames = new Set(executions.map((execution) => execution.name));
  if (isFacilityDisruptionQuery(query)) {
    for (let index = executions.length - 1; index >= 0; index -= 1) {
      if (["simulate_event_impact", "simulate_transport_impact"].includes(executions[index].name)) executions.splice(index, 1);
    }
    executionNames.clear();
    for (const execution of executions) executionNames.add(execution.name);
    if (!executionNames.has("simulate_facility_disruption")) {
      const input = { eventType: normaliseFacilityEventType(query), durationMinutes: extractFacilityDurationMinutes(query) };
      try {
        const output = await runTool("simulate_facility_disruption", input);
        executions.push({ name: "simulate_facility_disruption", input, output, summary: summariseToolCall("simulate_facility_disruption", input, output) });
        executionNames.add("simulate_facility_disruption");
        onProgress?.({ toolName: "simulate_facility_disruption", agents: TOOL_TO_AGENTS.simulate_facility_disruption });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Tool execution failed.";
        toolFailures.push(`simulate_facility_disruption: ${errorMessage}`);
      }
    }
  }
  for (const referenceId of extractTransportReferences(query)) {
    if (hasToolExecution(executions, "get_transport_context", "referenceId", referenceId)) continue;
    const input = { referenceId };
    try {
      const output = await runTool("get_transport_context", input);
      executions.push({ name: "get_transport_context", input, output, summary: summariseToolCall("get_transport_context", input, output) });
      onProgress?.({ toolName: "get_transport_context", agents: TOOL_TO_AGENTS.get_transport_context });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Tool execution failed.";
      toolFailures.push(`get_transport_context(${referenceId}): ${errorMessage}`);
    }
  }
  for (const stockReference of extractStockReferences(query)) {
    if (!hasToolExecution(executions, "locate_sku", "stockBalanceId", stockReference)) {
      const input = { stockBalanceId: stockReference };
      try {
        const output = await runTool("locate_sku", input);
        executions.push({ name: "locate_sku", input, output, summary: summariseToolCall("locate_sku", input, output) });
        onProgress?.({ toolName: "locate_sku", agents: TOOL_TO_AGENTS.locate_sku });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Tool execution failed.";
        toolFailures.push(`locate_sku(${stockReference}): ${errorMessage}`);
      }
    }
    if (/\bfefo\b/i.test(query) && !hasToolExecution(executions, "check_fefo_allocation", "productId", stockReference)) {
      const input = { productId: stockReference, requestedQty: 0 };
      try {
        const output = await runTool("check_fefo_allocation", input);
        executions.push({ name: "check_fefo_allocation", input, output, summary: summariseToolCall("check_fefo_allocation", input, output) });
        onProgress?.({ toolName: "check_fefo_allocation", agents: TOOL_TO_AGENTS.check_fefo_allocation });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Tool execution failed.";
        toolFailures.push(`check_fefo_allocation(${stockReference}): ${errorMessage}`);
      }
    }
  }
  if (/\bwarehouse impact\b/i.test(query) && stockBalanceId?.startsWith("STK-") && !hasToolExecution(executions, "locate_sku", "stockBalanceId", stockBalanceId)) {
    const input = { stockBalanceId };
    try {
      const output = await runTool("locate_sku", input);
      executions.push({ name: "locate_sku", input, output, summary: summariseToolCall("locate_sku", input, output) });
      executionNames.add("locate_sku");
      onProgress?.({ toolName: "locate_sku", agents: TOOL_TO_AGENTS.locate_sku });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Tool execution failed.";
      toolFailures.push(`locate_sku: ${errorMessage}`);
    }
  }
  if (/\bfefo\b/i.test(query) && stockBalanceId?.startsWith("STK-") && !hasToolExecution(executions, "check_fefo_allocation", "productId", stockBalanceId) && !executionNames.has("check_fefo_impact")) {
    const input = { productId: stockBalanceId, requestedQty: 0 };
    try {
      const output = await runTool("check_fefo_allocation", input);
      executions.push({ name: "check_fefo_allocation", input, output, summary: summariseToolCall("check_fefo_allocation", input, output) });
      executionNames.add("check_fefo_allocation");
      onProgress?.({ toolName: "check_fefo_allocation", agents: TOOL_TO_AGENTS.check_fefo_allocation });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Tool execution failed.";
      toolFailures.push(`check_fefo_allocation: ${errorMessage}`);
    }
  }

  return { executions, toolFailures };
}

function extractSku(query: string) {
  const text = query.toLowerCase();
  const explicit =
    query.match(/\bSTK-[A-Z0-9-]+\b/i)?.[0].toUpperCase() ??
    query.match(/\bSB-LOT-[A-Z0-9]+-\d{4}-[A-Z]\b/i)?.[0].toUpperCase() ??
    query.match(/\bLOT-[A-Z0-9]+-\d{4}-[A-Z]\b/i)?.[0].toUpperCase() ??
    query.match(/\bGSK-[A-Z]+-[A-Z0-9]+\b/i)?.[0].toUpperCase();
  if (explicit) return explicit;
  if (text.includes("rsv")) return "GSK-VAX-RSV";
  if (text.includes("flu") || text.includes("influenza")) return "GSK-VAX-FLU";
  if (text.includes("insulin")) return "GSK-BIO-INS";
  if (text.includes("respiratory") || text.includes("inhaler")) return "GSK-RESP-INH";
  return undefined;
}

function extractPlanningHorizon(query: string) {
  const value = Number(query.match(/\b(\d{1,2})\s*-?\s*day\s+(?:horizon|projection)\b/i)?.[1] ?? 14);
  return Math.max(1, Math.min(90, value));
}

function extractPlanningProduct(query: string) {
  return (
    query.match(/\bPH-[A-Z0-9-]+\b/i)?.[0].toUpperCase() ??
    query.match(/\bMAT-[A-Z0-9-]+\b/i)?.[0].toUpperCase() ??
    query.match(/\bPROD-[A-Z0-9-]+\b/i)?.[0].toUpperCase() ??
    extractSku(query)
  );
}

function extractDemandMultiplier(query: string) {
  const value = Number(query.match(/\b(\d+(?:\.\d+)?)\s*x\s+(?:average\s+)?demand\b/i)?.[1] ?? 1);
  return Math.max(0, Math.min(10, value));
}

function extractShipment(query: string) {
  return query.match(/\bSHIP-[A-Z0-9-]+\b/i)?.[0].toUpperCase();
}

function extractTransportReference(query: string) {
  return (
    query.match(/\bLEG-(?:IN|OUT)-[A-Z0-9-]+\b/i)?.[0].toUpperCase() ??
    query.match(/\bAPT-(?:IN|OUT)-[A-Z0-9-]+\b/i)?.[0].toUpperCase() ??
    query.match(/\bASN-[A-Z0-9-]+\b/i)?.[0].toUpperCase() ??
    extractShipment(query) ??
    query.match(/\bROUTE-[A-Z0-9-]+\b/i)?.[0].toUpperCase()
  );
}

function extractTransportReferences(query: string) {
  const references = query.match(/\b(?:LEG-(?:IN|OUT)-[A-Z0-9-]+|APT-(?:IN|OUT)-[A-Z0-9-]+|ASN-[A-Z0-9-]+|SHIP-[A-Z0-9-]+|ROUTE-[A-Z0-9-]+)\b/gi) ?? [];
  const docks = [...query.matchAll(/\bdock\s+(D\d+)\b/gi)].map((match) => match[1]);
  return [...new Set([...references, ...docks].map((reference) => reference.toUpperCase()))];
}

function extractStockReferences(query: string) {
  return [...new Set((query.match(/\bSTK-[A-Z0-9-]+\b/gi) ?? []).map((reference) => reference.toUpperCase()))];
}

function hasToolExecution(executions: ToolExecution[], name: string, inputKey: string, value: string) {
  return executions.some((execution) =>
    execution.name === name && String(execution.input[inputKey] ?? "").toLowerCase() === value.toLowerCase()
  );
}

function extractDelayMinutes(query: string) {
  const match = query.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return /^(?:hour|hr)/i.test(match[2]) ? Math.round(value * 60) : Math.round(value);
}

function normaliseEventType(query: string) {
  const text = query.toLowerCase();
  if (text.includes("dock closure") || text.includes("dock closed")) return "dock_closure";
  if (text.includes("capacity")) return "capacity_constraint";
  if (text.includes("rain") || text.includes("weather")) return "weather";
  if (text.includes("supplier")) return "supplier_delay";
  if (text.includes("vehicle") || text.includes("breakdown")) return "vehicle_breakdown";
  if (text.includes("customs")) return "customs_hold";
  if (text.includes("temperature excursion")) return "temperature_excursion";
  if (text.includes("manufacturing")) return "manufacturing_delay";
  if (text.includes("quality hold")) return "quality_hold";
  return "traffic_delay";
}

function isFacilityDisruptionQuery(query: string) {
  const facility = /\b(?:singapore\s+western\s+dc|western\s+dc|warehouse|facility|distribution\s+cent(?:re|er)|dc)\b/i.test(query);
  const disruption = /\b(?:tornado|hurricane|typhoon|cyclone|earthquake|flood(?:ing)?|power\s+outage|shutdown|shut\s+down|clos(?:e|ed|ure)|inaccessible|down\s+for)\b/i.test(query);
  return facility && disruption;
}

function extractFacilityDurationMinutes(query: string) {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
  const match = query.match(/\b(\d+(?:\.\d+)?|one|two|three|four)\s*(years?|yrs?|weeks?|days?|hours?|hrs?|minutes?|mins?)\b/i);
  if (!match) return 7 * 24 * 60;
  const value = Number(match[1]) || words[match[1].toLowerCase()] || 1;
  if (/^(?:year|yr)/i.test(match[2])) return Math.round(value * 365 * 24 * 60);
  if (/^week/i.test(match[2])) return Math.round(value * 7 * 24 * 60);
  if (/^day/i.test(match[2])) return Math.round(value * 24 * 60);
  if (/^(?:hour|hr)/i.test(match[2])) return Math.round(value * 60);
  return Math.round(value);
}

function normaliseFacilityEventType(query: string) {
  const text = query.toLowerCase();
  if (text.includes("tornado") || text.includes("hurricane") || text.includes("typhoon") || text.includes("cyclone")) return "severe_weather";
  if (text.includes("flood")) return "flood";
  if (text.includes("earthquake")) return "earthquake";
  if (text.includes("power outage")) return "power_outage";
  return "facility_shutdown";
}

function extractTransportSearchReference(query: string) {
  const explicit = extractTransportReference(query);
  if (explicit) return explicit;
  const text = query.toLowerCase();
  for (const place of ["changi", "tuas", "jurong", "senoko", "woodlands", "tampines", "hospital", "polyclinic"]) {
    if (text.includes(place)) return place;
  }
  return undefined;
}

function extractZone(query: string) {
  const text = query.toLowerCase();
  if (text.includes("cold")) return "Cold Storage";
  if (text.includes("pharmaceutical")) return "Pharmaceutical Storage";
  if (text.includes("ambient")) return "Ambient Storage";
  if (text.includes("receiving")) return "Receiving";
  if (text.includes("qa")) return "QA Hold";
  if (text.includes("quarantine")) return "Quarantine";
  if (text.includes("dispatch")) return "Dispatch";
  return "Cold Storage";
}

function zoneCode(value: string) {
  const text = value.toLowerCase();
  if (text.includes("cold")) return "CS";
  if (text.includes("ambient")) return "AM";
  if (text.includes("pharmaceutical")) return "PH";
  if (text.includes("qa")) return "QA";
  if (text.includes("quarantine")) return "QT";
  if (text.includes("receiving")) return "RCV";
  if (text.includes("dispatch")) return "DS";
  return value;
}

function hasExplicitZone(query: string) {
  const text = query.toLowerCase();
  return ["cold", "ambient", "pharmaceutical", "receiving", "dispatch", "qa", "quarantine"].some((zone) => text.includes(zone));
}

function routeQuery(query: string): { agents: AgentName[]; tools: ToolPlan[]; intent: AgentIntent } {
  const text = query.toLowerCase();
  const skuId = extractSku(query);
  const shipmentId = extractShipment(query);
  const tools: ToolPlan[] = [];
  const agents = new Set<AgentName>(["Orchestrator"]);

  if (text.includes("apply recommendation")) {
    return { agents: ["Orchestrator"], tools, intent: "general_question" };
  }

  if (text.includes("audit") || text.includes("evidence") || text.includes("assistant history")) {
    agents.add("Compliance");
    tools.push({ name: "get_audit_lookup", input: { query } });
    return { agents: [...agents], tools, intent: "audit_lookup" };
  }

  if (isFacilityDisruptionQuery(query)) {
    agents.add("Inventory");
    agents.add("Logistics");
    agents.add("Compliance");
    tools.push({
      name: "simulate_facility_disruption",
      input: { eventType: normaliseFacilityEventType(query), durationMinutes: extractFacilityDurationMinutes(query) }
    });
    for (const referenceId of extractTransportReferences(query)) {
      tools.push({ name: "get_transport_context", input: { referenceId } });
    }
    for (const stockReference of extractStockReferences(query)) {
      tools.push({ name: "locate_sku", input: { stockBalanceId: stockReference } });
      if (/\bfefo\b/i.test(query)) tools.push({ name: "check_fefo_allocation", input: { productId: stockReference, requestedQty: 0 } });
    }
    return { agents: [...agents], tools, intent: "scenario_simulation" };
  }

  if (
    text.includes("inventory planning") ||
    text.includes("replenishment and expiry risk") ||
    text.includes("demand multiplier") ||
    (text.includes("projected") && text.includes("replenishment"))
  ) {
    agents.add("Inventory");
    const productId = extractPlanningProduct(query);
    if (productId) {
      tools.push({
        name: "get_inventory_planning",
        input: {
          productId,
          horizonDays: extractPlanningHorizon(query),
          demandMultiplier: extractDemandMultiplier(query)
        }
      });
    } else {
      tools.push({ name: "search_inventory", input: { query } });
    }
    return { agents: [...agents], tools, intent: "stock_position" };
  }

  if (skuId?.startsWith("STK-") && text.includes("impact")) {
    agents.add("Inventory");
    tools.push({ name: "locate_sku", input: { stockBalanceId: skuId } });
    if (shipmentId) {
      agents.add("Logistics");
      tools.push({ name: "check_fefo_impact", input: { stockBalanceId: skuId, shipmentId } });
    } else if (text.includes("fefo")) {
      tools.push({ name: "check_fefo_allocation", input: { productId: skuId, requestedQty: 0 } });
    }
    return { agents: [...agents], tools, intent: "sku_location" };
  }

  if (text.includes("what-if") || text.includes("what if") || text.includes("simulate") || text.includes("scenario") || text.includes("prioritise") || text.includes("prioritize")) {
    agents.add("Inventory");
    agents.add("Logistics");
    agents.add("Compliance");
    const transportReference = extractTransportSearchReference(query);
    const explicitTransportEvent = /\b(?:delay|late|weather|rain|supplier|vehicle|breakdown|customs|temperature excursion|manufacturing|quality hold|dock clos|capacity)\b/i.test(query);
    if (transportReference && explicitTransportEvent) {
      tools.push({ name: "get_transport_context", input: { referenceId: transportReference } });
      tools.push({
        name: "simulate_transport_impact",
        input: {
          referenceId: transportReference,
          eventType: normaliseEventType(query),
          delayMinutes: extractDelayMinutes(query)
        }
      });
    } else if (shipmentId) {
      tools.push({ name: "get_transport_context", input: { referenceId: shipmentId } });
      tools.push({ name: "simulate_reprioritisation", input: { shipmentId } });
    } else {
      tools.push({ name: "get_transport_context", input: {} });
    }
    return { agents: [...agents], tools, intent: transportReference || shipmentId ? "scenario_simulation" : "transport_status" };
  }

  const explicitTransportReference = extractTransportReference(query);
  if (explicitTransportReference) {
    agents.add("Logistics");
    agents.add("Inventory");
    tools.push({ name: "get_transport_context", input: { referenceId: explicitTransportReference } });
    return { agents: [...agents], tools, intent: "transport_status" };
  }

  if (text.includes("non-conformance") || text.includes("non conformance") || text.includes("excursion")) {
    agents.add("Compliance");
    tools.push({
      name: "get_temperature_events",
      input: {
        zoneId: hasExplicitZone(query) ? extractZone(query) : undefined,
        eventType: text.includes("non") ? "Non-Conformance" : "Excursion"
      }
    });
    return { agents: [...agents], tools, intent: text.includes("non") ? "non_conformance" : "temperature_event" };
  }

  if (text.includes("temperature") || text.includes("cold-chain") || text.includes("cold chain")) {
    agents.add("Compliance");
    agents.add("Inventory");
    tools.push({ name: "get_temperature_events", input: { zoneId: extractZone(query) } });
    tools.push({ name: "check_cold_chain_status", input: { zoneId: extractZone(query), skuId } });
    return { agents: [...agents], tools, intent: "temperature_event" };
  }

  if (
    text.includes("transport") || text.includes("carrier") || text.includes("vehicle") || text.includes("licence plate") ||
    text.includes("license plate") || text.includes("network") || text.includes("asn") || text.includes("delivery") ||
    text.includes("appointment") || (text.includes("inbound") && !text.includes("stock")) ||
    (text.includes("outbound") && !text.includes("stock"))
  ) {
    agents.add("Logistics");
    agents.add("Inventory");
    tools.push({
      name: "get_transport_context",
      input: {
        referenceId: extractTransportSearchReference(query),
        direction: text.includes("inbound") ? "inbound" : text.includes("outbound") ? "outbound" : undefined,
        status: text.includes("delayed") ? "delayed" : text.includes("exception") ? "exception" : undefined
      }
    });
    return { agents: [...agents], tools, intent: "transport_status" };
  }

  if (
    text.includes("inventory") ||
    text.includes("stock") ||
    text.includes("available") ||
    text.includes("reserved") ||
    text.includes("incoming") ||
    text.includes("outbound") ||
    text.includes("movement") ||
    text.includes("ledger") ||
    text.includes("batch") ||
    text.includes("lot") ||
    text.includes("qa hold") ||
    text.includes("fefo")
  ) {
    agents.add("Inventory");
    if (text.includes("incoming")) tools.push({ name: "get_incoming_stock", input: {} });
    if (text.includes("outbound") || text.includes("reserved")) tools.push({ name: "get_outbound_stock", input: {} });
    if (text.includes("movement") || text.includes("ledger") || text.includes("trace")) tools.push({ name: "get_inventory_movements", input: { query } });
    if (shipmentId && (text.includes("after") || text.includes("dispatch") || text.includes("priorit"))) {
      agents.add("Logistics");
      tools.push({ name: "simulate_shipment_allocation", input: { shipmentId } });
    }
    if (skuId?.startsWith("STK-")) {
      tools.push({ name: "locate_sku", input: { stockBalanceId: skuId } });
      if (shipmentId && (text.includes("impact") || text.includes("priorit") || text.includes("sequence"))) {
        agents.add("Logistics");
        tools.push({ name: "check_fefo_impact", input: { stockBalanceId: skuId, shipmentId } });
      }
    } else if (skuId?.startsWith("GSK-")) {
      tools.push({ name: "get_product_stock", input: { productId: skuId } });
      if (text.includes("fefo") || text.includes("allocate") || text.includes("excluded")) {
        tools.push({ name: "check_fefo_allocation", input: { productId: skuId, requestedQty: 100 } });
      }
    } else if (skuId) {
      tools.push({ name: "get_batch_detail", input: { batchId: skuId } });
    }
    if (tools.length === 0) {
      tools.push({ name: "get_inventory_summary", input: {} });
      tools.push({ name: "search_inventory", input: { query } });
    }
    if (skuId?.startsWith("STK-") && text.includes("impact")) return { agents: [...agents], tools, intent: "sku_location" };
    if (text.includes("incoming")) return { agents: [...agents], tools, intent: "incoming_stock" };
    if (text.includes("outbound")) return { agents: [...agents], tools, intent: "outbound_stock" };
    if (text.includes("fefo")) return { agents: [...agents], tools, intent: "fefo_check" };
    if (skuId?.startsWith("LOT-") || skuId?.startsWith("SB-LOT-")) return { agents: [...agents], tools, intent: "batch_detail" };
    return { agents: [...agents], tools, intent: "stock_position" };
  }

  if (text.includes("weather") || text.includes("rain") || text.includes("supplier") || text.includes("customs") || text.includes("breakdown")) {
    agents.add("Logistics");
    agents.add("Compliance");
    agents.add("Inventory");
    const referenceId = extractTransportSearchReference(query);
    if (referenceId) {
      tools.push({ name: "get_transport_context", input: { referenceId } });
      tools.push({ name: "simulate_transport_impact", input: { referenceId, eventType: normaliseEventType(query), delayMinutes: extractDelayMinutes(query) } });
      return { agents: [...agents], tools, intent: "scenario_simulation" };
    }
    tools.push({ name: "get_transport_context", input: {} });
    return { agents: [...agents], tools, intent: "transport_status" };
  }

  if (text.includes("route") || text.includes("delay") || text.includes("changi") || text.includes("tuas") || text.includes("jurong")) {
    agents.add("Logistics");
    tools.push({ name: "get_transport_context", input: { referenceId: extractTransportSearchReference(query), status: text.includes("delayed") ? "delayed" : undefined } });
    return { agents: [...agents], tools, intent: "transport_status" };
  }

  if (text.includes("dock conflict") || text.includes("dock conflicts") || text.includes("dock schedule")) {
    agents.add("Logistics");
    tools.push({ name: "check_dock_schedule", input: { timeWindow: text.includes("12") ? "next 12 hours" : "next 4 hours", shipmentId } });
    return { agents: [...agents], tools, intent: "route_status" };
  }

  if (skuId) {
    agents.add("Inventory");
    tools.push({ name: "locate_sku", input: { stockBalanceId: skuId } });
    if (text.includes("priorit") || text.includes("impact") || text.includes("stage")) {
      agents.add("Logistics");
      tools.push({ name: "check_fefo_impact", input: { stockBalanceId: skuId, shipmentId: shipmentId ?? "SHIP-001" } });
    }
    return { agents: [...agents], tools, intent: skuId.startsWith("LOT-") || skuId.startsWith("SB-LOT-") ? "batch_detail" : "sku_location" };
  }

  tools.push({ name: "check_dock_schedule", input: { timeWindow: "next 4 hours" } });
  agents.add("Logistics");
  return { agents: [...agents], tools, intent: "general_question" };
}

function basePayload(): ActionPayload {
  return {
    type: "analysis",
    affectedSKUs: [],
    affectedZones: [],
    affectedStages: [],
    affectedShipments: [],
    affectedDocks: [],
    recommendedActionId: null
  };
}

function assistantIntroductionResponse(analysisPriority: AnalysisPriority = "balanced"): OrchestratorResponse {
  const agentResponse = assistantWelcomeAgentResponse();
  return {
    decisionId: `WELCOME-${Date.now()}`,
    narrative: agentResponse.summary,
    agentResponse,
    agentsUsed: ["Orchestrator"],
    toolsCalled: [],
    confidence: 100,
    riskLevel: "low",
    actionPayload: basePayload(),
    decisionEvidence: {
      dataUsed: ["TwinOps Control persona and operating rules"],
      constraintsApplied: ["No operational facts were requested", "No warehouse state was changed"],
      alternativesConsidered: ["Ask an inventory, FEFO, cold-chain, route, shipment, dock, or audit question"],
      uncertainties: [],
      whyRecommendationWasMade: "The operator opened a conversation without requesting an operational lookup."
    },
    requiresApproval: false,
    approvalStatus: "not_required",
    fallbackUsed: false,
    analysisPriority
  };
}

function readOnlyBoundaryAgentResponse(): AgentResponse {
  return {
    intent: "general_question",
    status: "attention",
    title: "Read-Only Assistant",
    summary: "I can explain the current state and compare scenarios, but I cannot create, approve, or apply an operational decision.",
    facts: [
      { label: "Operating mode", value: "Read-only analysis" },
      { label: "State changes", value: "None created or applied" }
    ],
    impact: ["Use the operational workspace and its controlled business process for any real execution change."],
    nextAction: { label: "No action created", type: "none", targetId: null },
    requiresApproval: false,
    dataGaps: [],
    confidence: "high"
  };
}

function matchingExecution(executions: ToolExecution[], name: string, inputKey: string, value: string) {
  return executions.find((execution) =>
    execution.name === name && String(execution.input[inputKey] ?? "").toLowerCase() === value.toLowerCase()
  );
}

function facilityScenarioPresentation(query: string, executions: ToolExecution[], simulation: any) {
  const durationDays = simulation.durationMinutes / (24 * 60);
  const durationLabel = durationDays % 365 === 0
    ? `${durationDays / 365}-year`
    : `${Number.isInteger(durationDays) ? String(durationDays) : durationDays.toFixed(1)}-day`;
  const durationFact = durationDays % 365 === 0
    ? `${durationDays / 365} year${durationDays === 365 ? "" : "s"} (${durationDays} days)`
    : `${Number.isInteger(durationDays) ? String(durationDays) : durationDays.toFixed(1)} days`;
  const facts: AgentResponse["facts"] = [
    { label: "Facility scope", value: simulation.scope },
    { label: "Outage duration", value: durationFact },
    {
      label: "FEFO exposure",
      value: `${simulation.expiresDuringOutage.length} lots / ${simulation.expiresDuringOutageUnits} units during; ${simulation.expiresWithin7DaysAfterRecovery.length} lots / ${simulation.restartCriticalUnits} units after recovery`
    }
  ];
  const impacts: string[] = [];
  const dataGaps = ["Backup power, alternate-site capacity, and post-event stock-condition evidence were not provided."];

  const stockReferences = extractStockReferences(query);
  for (const reference of stockReferences) {
    const located = matchingExecution(executions, "locate_sku", "stockBalanceId", reference)?.output as any;
    const fefo = matchingExecution(executions, "check_fefo_allocation", "productId", reference)?.output as any;
    if (!located) {
      dataGaps.push(`${reference} could not be verified.`);
      continue;
    }
    facts.push({
      label: reference,
      value: `${located.quantity} units; ${located.qualityReleaseStatus}; expires ${located.expiryDate}; ${located.zone?.name ?? "location unavailable"}`
    });
    const restartCritical = simulation.expiresWithin7DaysAfterRecovery.some((lot: any) => lot.stockBalanceId === reference);
    const expiresDuring = simulation.expiresDuringOutage.some((lot: any) => lot.stockBalanceId === reference);
    impacts.push(
      `${reference} is ${located.qualityReleaseStatus} and FEFO position ${located.fefoPosition}; ${expiresDuring ? "it expires during the outage" : restartCritical ? "it is restart-critical after reopening" : "it is not in the simulated expiry windows"}${fefo ? `, with ${fefo.totalEligibleAvailable} eligible units verified for its product` : ""}.`
    );
  }

  const transportReferences = extractTransportReferences(query);
  const exactRecords: any[] = [];
  for (const reference of transportReferences) {
    const context = matchingExecution(executions, "get_transport_context", "referenceId", reference)?.output as any;
    if (!context) {
      dataGaps.push(`${reference} could not be verified.`);
      continue;
    }
    if (context.recordCount !== 1) {
      facts.push({ label: reference, value: `${context.recordCount} linked transport movements; unavailability is a scenario condition` });
      continue;
    }
    const record = context.records[0];
    exactRecords.push(record);
    const documentStatus = record.wmsDocument?.inboundStatus ?? record.wmsDocument?.outboundStatus ?? "WMS status unavailable";
    const schedule = record.transportLeg?.scheduleAdherenceLabel ?? record.transportLeg?.routeStatus ?? "schedule unavailable";
    const dock = record.dockAppointment?.dockId ? `Dock ${record.dockAppointment.dockId}` : "no linked dock";
    facts.push({ label: reference, value: `${documentStatus}; ${schedule}; ${dock}` });
  }

  const inboundRecords = exactRecords.filter((record) => record.transportLeg?.direction === "inbound");
  const outboundRecords = exactRecords.filter((record) => record.transportLeg?.direction === "outbound");
  if (inboundRecords.length) {
    impacts.push(
      `${inboundRecords.map((record) => record.referenceId).join(", ")} cannot be received or put away during the closure; any stated dock unavailability compounds the receiving block.`
    );
  }
  if (outboundRecords.length) {
    const blocked = outboundRecords.filter((record) => /blocked|hold|quarantine/i.test(String(record.wmsDocument?.outboundStatus ?? "")));
    impacts.push(
      blocked.length
        ? `${blocked.map((record) => record.referenceId).join(", ")} remains blocked by its verified quality or allocation restriction regardless of scenario urgency.`
        : `${outboundRecords.map((record) => record.referenceId).join(", ")} cannot be picked, staged, or dispatched during the closure.`
    );
  }
  impacts.push(`Across the outage window, ${simulation.inboundAffected.length} inbound and ${simulation.outboundAffected.length} outbound movement(s) require replanning before FEFO allocation resumes.`);

  return {
    durationLabel,
    facts: facts.slice(0, 8),
    impacts: [...new Set(impacts)].slice(0, 5),
    dataGaps: [...new Set(dataGaps)].slice(0, 4)
  };
}

function deterministicAgentResponse(
  intent: AgentIntent,
  executions: ToolExecution[],
  narrative: string,
  query = ""
): AgentResponse {
  const outputs = Object.fromEntries(executions.map((execution) => [execution.name, execution.output as any]));
  const context = outputs.get_transport_context;
  const facilitySimulation = outputs.simulate_facility_disruption;
  const transportSimulation = outputs.simulate_transport_impact;
  const reprioritisation = outputs.simulate_reprioritisation;

  if (facilitySimulation) {
    const presentation = facilityScenarioPresentation(query, executions, facilitySimulation);
    return {
      intent: "scenario_simulation",
      status: "attention",
      title: "Facility FEFO Scenario",
      summary: `A ${presentation.durationLabel} shutdown of ${facilitySimulation.scope} pauses FEFO execution across the warehouse; ${facilitySimulation.expiresDuringOutage.length} released lot(s) expire during the outage and ${facilitySimulation.expiresWithin7DaysAfterRecovery.length} expire within seven days after recovery.`,
      facts: presentation.facts,
      impact: presentation.impacts.length ? presentation.impacts : facilitySimulation.operationalImpact.slice(0, 5),
      nextAction: { label: "Open Inventory", type: "open_inventory", targetId: null },
      requiresApproval: false,
      dataGaps: presentation.dataGaps,
      confidence: "high"
    };
  }

  if (outputs.get_inventory_planning) {
    const plan = outputs.get_inventory_planning;
    const stockout = plan.stockoutDay === null ? "not projected" : `day ${plan.stockoutDay}`;
    const action = plan.recommendedOrderQty > 0
      ? `Review a replenishment quantity of ${plan.recommendedOrderQty} units against the incoming schedule before any operational order is raised.`
      : plan.expiryRiskUnits > 0
        ? "Prioritise the listed released lots through FEFO and review demand coverage before replenishing."
        : "Monitor the projection; no replenishment is suggested by the current policy thresholds.";
    return {
      intent: "stock_position",
      status: plan.risk === "healthy" ? "ok" : "attention",
      title: "Inventory Planning Review",
      summary: `${plan.product.productCode} is ${plan.risk} risk in the verified ${plan.horizonDays}-day, ${plan.demandMultiplier.toFixed(2)}x demand scenario: ${plan.availableNow} available now and ${plan.projectedAtHorizon} projected at the horizon.`,
      facts: [
        { label: "Available now", value: String(plan.availableNow) },
        { label: "Projected at lead time", value: String(plan.projectedAtLeadTime) },
        { label: "Projected at horizon", value: String(plan.projectedAtHorizon) },
        { label: "Stock-out", value: stockout },
        { label: "Expiry-risk units", value: String(plan.expiryRiskUnits) },
        { label: "Suggested replenishment", value: String(plan.recommendedOrderQty) }
      ],
      impact: [plan.riskReason, action, "This projection is advisory and did not change inventory or create an order."],
      nextAction: { label: "Open Inventory", type: "open_inventory", targetId: plan.product.productId },
      requiresApproval: false,
      dataGaps: [],
      confidence: "high"
    };
  }

  if (transportSimulation) {
    const serviceVariance = transportSimulation.serviceVarianceMinutes == null
      ? "Unavailable"
      : `${transportSimulation.serviceVarianceMinutes} min`;
    return {
      intent: "scenario_simulation",
      status: "attention",
      title: "Transport Scenario",
      summary: `${transportSimulation.referenceId} is projected ${transportSimulation.delayMinutes} minutes later with ${transportSimulation.dockConflictsCreated.length} dock conflict(s); no operational state changed.`,
      facts: [
        { label: "Transport leg", value: transportSimulation.transportLegId },
        { label: "Event", value: transportSimulation.eventType.replaceAll("_", " ") },
        { label: "Projected delay", value: `${transportSimulation.delayMinutes} min` },
        { label: "Service variance", value: serviceVariance },
        { label: "Dock impact", value: `${transportSimulation.dockConflictsCreated.length} conflict(s)` },
        { label: "Cold-chain risk", value: transportSimulation.coldChainRisk }
      ],
      impact: [
        `${transportSimulation.affectedSkus.length} SKU(s), ${transportSimulation.affectedBatches.length} batch(es), and ${transportSimulation.affectedStockBalances.length} stock balance(s) are connected to the scenario.`,
        `${transportSimulation.options.length} operating options were compared without selecting one for management.`,
        "The scenario snapshot is advisory and did not alter TMS, WMS, yard, dock, or inventory records."
      ],
      nextAction: { label: "Open Logistics", type: "open_logistics", targetId: transportSimulation.transportLegId },
      requiresApproval: false,
      dataGaps: transportSimulation.serviceVarianceMinutes == null ? ["A valid service-window timestamp was unavailable for variance calculation."] : [],
      confidence: "high"
    };
  }

  if (intent === "scenario_simulation" && context?.recordCount && !reprioritisation) {
    return {
      intent: "scenario_simulation",
      status: "attention",
      title: "Exact Reference Required",
      summary: `${context.recordCount} transport records match the request, so no what-if was run without an exact leg, ASN, shipment, route, or appointment ID.`,
      facts: [
        { label: "Matching records", value: String(context.recordCount) },
        { label: "Inbound", value: String(context.summary.inbound) },
        { label: "Outbound", value: String(context.summary.outbound) }
      ],
      impact: ["No scenario snapshot or operational change was created from an ambiguous reference."],
      nextAction: { label: "Open Logistics", type: "open_logistics", targetId: null },
      requiresApproval: false,
      dataGaps: ["Select one exact transport leg, ASN, shipment, route, or dock appointment for the scenario."],
      confidence: "high"
    };
  }

  if (context?.recordCount) {
    const exact = context.query && context.recordCount === 1 ? context.records[0] : null;
    if (exact) {
      const leg = exact.transportLeg;
      const wmsStatus = exact.wmsDocument?.inboundStatus ?? exact.wmsDocument?.outboundStatus ?? "Unavailable";
      const conflict = Boolean(exact.dockAppointment?.conflictFlag);
      const blocked = String(wmsStatus).toLowerCase().includes("blocked");
      const delayed = leg.scheduleAdherence === "delayed";
      const scheduleLabel = leg.scheduleAdherenceLabel ?? leg.routeStatus;
      return {
        intent: "transport_status",
        status: blocked ? "blocked" : delayed || conflict || leg.transportStatus === "exception" || leg.routeStatus === "disrupted" ? "attention" : "ok",
        title: "Transport Record",
        summary: `${exact.referenceId} is ${leg.transportStatus} on ${leg.routeId}; ${scheduleLabel}, with ${wmsStatus} in WMS.`,
        facts: [
          { label: "Transport leg", value: leg.transportLegId },
          { label: "Route", value: `${exact.originSite?.displayName ?? leg.originSiteId} to ${exact.destinationSite?.displayName ?? leg.destinationSiteId}` },
          { label: "Carrier / vehicle", value: `${leg.carrierName} / ${leg.licensePlate}` },
          { label: "Schedule", value: leg.scheduleAdherenceLabel ?? leg.routeStatus },
          { label: "Dock appointment", value: exact.dockAppointment ? `${exact.dockAppointment.dockAppointmentId} / Dock ${exact.dockAppointment.dockId} / ${exact.dockAppointment.status}` : "Unavailable" },
          { label: "WMS lines", value: `${exact.wmsLines.length}` }
        ],
        impact: [
          `${exact.wmsLines.length} WMS line(s) and ${exact.operationalEvents.length} recorded milestone(s) are linked to the movement.`,
          leg.temperatureRequirement === "2-8C" ? `Temperature control is ${leg.temperatureStatus} against ${leg.temperatureRequirement}.` : `Temperature requirement is ${leg.temperatureRequirement}.`,
          conflict ? "The linked dock appointment has a scheduling conflict." : "No conflict is flagged on the linked dock appointment."
        ],
        nextAction: { label: "Open Logistics", type: "open_logistics", targetId: leg.transportLegId },
        requiresApproval: false,
        dataGaps: exact.dockAppointment ? [] : ["No canonical dock appointment is linked to this movement."],
        confidence: "high"
      };
    }
    return {
      intent: "transport_status",
      status: context.summary.exceptions || context.summary.dockConflicts ? "attention" : "ok",
      title: "Transport Overview",
      summary: `${context.recordCount} transport records include ${context.summary.inbound} inbound, ${context.summary.outbound} outbound, ${context.summary.delayed} delayed, and ${context.summary.exceptions} exception movement(s).`,
      facts: [
        { label: "Inbound", value: String(context.summary.inbound) },
        { label: "Outbound", value: String(context.summary.outbound) },
        { label: "Delayed", value: String(context.summary.delayed) },
        { label: "Exceptions", value: String(context.summary.exceptions) },
        { label: "Cold-chain", value: String(context.summary.coldChain) },
        { label: "Dock conflicts", value: String(context.summary.dockConflicts) }
      ],
      impact: ["Each movement is linked to its WMS document, partner sites, vehicle, route, yard appointment, dock, and event history."],
      nextAction: { label: "Open Logistics", type: "open_logistics", targetId: null },
      requiresApproval: false,
      dataGaps: [],
      confidence: "high"
    };
  }

  if (reprioritisation) {
    return {
      intent: "scenario_simulation",
      status: "attention",
      title: "Shipment Scenario",
      summary: `The ${reprioritisation.shipmentId} reprioritisation scenario affects ${reprioritisation.impactedStockBalances.length} stock balance(s) without changing operations.`,
      facts: [
        { label: "Shipment", value: reprioritisation.shipmentId },
        { label: "Stock balances", value: String(reprioritisation.impactedStockBalances.length) },
        { label: "Docks", value: reprioritisation.affectedDocks.join(", ") || "None" },
        { label: "Stages", value: reprioritisation.affectedStages.join(" -> ") }
      ],
      impact: ["Inventory allocation and dock effects are projected only; no shipment priority or stock record changed."],
      nextAction: { label: "Open Logistics", type: "open_logistics", targetId: reprioritisation.shipmentId },
      requiresApproval: false,
      dataGaps: [],
      confidence: "high"
    };
  }

  return {
    intent,
    status: "ok",
    title: intent === "route_status" ? "Route Status" : intent === "temperature_event" ? "Temperature Status" : "Verified Operations",
    summary: narrative.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? narrative,
    facts: executions.slice(0, 6).map((execution) => ({ label: execution.name.replaceAll("_", " "), value: execution.summary.conciseOutput })),
    impact: ["The answer uses deterministic warehouse records and does not change operational state."],
    nextAction: { label: "No Action", type: "none", targetId: null },
    requiresApproval: false,
    dataGaps: [],
    confidence: "high"
  };
}

function buildNarrative(intent: string, executions: ToolExecution[], analysisPriority: AnalysisPriority = "balanced") {
  const outputs = Object.fromEntries(executions.map((execution) => [execution.name, execution.output as any]));
  if (intent === "stock_position" || intent === "incoming_stock" || intent === "outbound_stock" || intent === "batch_detail" || intent === "fefo_check") {
    const parts: string[] = [];
    if (outputs.get_inventory_planning) {
      const plan = outputs.get_inventory_planning;
      parts.push(`${plan.product.productCode} is ${plan.risk} risk for the ${plan.horizonDays}-day projection at ${plan.demandMultiplier.toFixed(2)}x average demand: ${plan.availableNow} available now, ${plan.projectedAtLeadTime} projected at lead time, ${plan.projectedAtHorizon} at the horizon, ${plan.expiryRiskUnits} expiry-risk units, and ${plan.recommendedOrderQty} suggested replenishment units. ${plan.riskReason}`);
    }
    if (outputs.get_inventory_summary) {
      const summary = outputs.get_inventory_summary;
      parts.push(`Inventory summary: ${summary.onHand} on hand, ${summary.available} available, ${summary.reserved} reserved, ${summary.incomingToday} incoming today, ${summary.outboundToday} outbound today, and ${summary.qaHold} in QA Hold.`);
    }
    if (outputs.get_product_stock) {
      const stock = outputs.get_product_stock;
      parts.push(`${stock.product.productCode} has ${stock.totalOnHand} on hand, ${stock.totalAvailable} available, ${stock.totalReserved + stock.totalPicked + stock.totalPacked + stock.totalStaged} reserved or in outbound flow, and ${stock.totalQaHold} on hold.`);
    }
    if (outputs.get_batch_detail) {
      const batch = outputs.get_batch_detail;
      parts.push(`${batch.lotCode} is ${batch.qualityStatus} at ${batch.location.locationId}, with ${batch.qtyOnHand} on hand and ${batch.qtyAvailable} available.`);
    }
    if (outputs.check_fefo_allocation) {
      const fefo = outputs.check_fefo_allocation;
      parts.push(`FEFO for ${fefo.productCode}: ${fefo.totalEligibleAvailable} eligible units, ${fefo.shortfallQty} shortfall, and ${fefo.excludedBatches.length} excluded batch(es).`);
    }
    if (outputs.get_incoming_stock) {
      const incoming = outputs.get_incoming_stock;
      parts.push(`Incoming stock: ${incoming.length} ASN(s), ${incoming.reduce((sum: number, asn: any) => sum + asn.expectedQuantity, 0)} expected units.`);
    }
    if (outputs.get_outbound_stock) {
      const outbound = outputs.get_outbound_stock;
      parts.push(`Outbound stock: ${outbound.length} shipment(s), ${outbound.reduce((sum: number, shipment: any) => sum + shipment.allocatedQuantity, 0)} allocated units.`);
    }
    if (outputs.get_inventory_movements) {
      parts.push(`Movement ledger returned ${outputs.get_inventory_movements.length} record(s).`);
    }
    if (outputs.simulate_shipment_allocation) {
      const sim = outputs.simulate_shipment_allocation;
      parts.push(`Simulation for ${sim.shipmentId} changes on-hand from ${sim.beforeSummary.onHand} to ${sim.afterSummary.onHand} and available from ${sim.beforeSummary.available} to ${sim.afterSummary.available}. This is advisory analysis only; no operational action was created or applied.`);
    }
    return parts.length ? parts.join(" ") : "Inventory data is unavailable for that request; use an inventory summary, product stock, batch detail, incoming, outbound, or movement tool.";
  }
  if (intent === "sku_location") {
    const located = outputs.locate_sku;
    const fefo = outputs.check_fefo_impact;
    return [
      `${located.productCode ?? located.stockBalanceId} (${located.stockBalanceId}) is in ${located.zone.name}, Rack ${located.rack}, Bin ${located.bin}. It is a ${located.priority} ${located.category} batch linked to ${located.linkedShipmentId ?? "no active shipment"}.`,
      fefo
        ? `Prioritising it affects ${fefo.affectedStages.join(" -> ")}. FEFO check shows ${fefo.fefoViolationCount} violation(s) and a cascade risk score of ${fefo.cascadeRiskScore}.`
        : "No resequencing tool was required for this location-only query.",
      "This is read-only analysis; no operational action was created or applied."
    ].join(" ");
  }
  if (intent === "shipment_impact") {
    const event = outputs.simulate_event_impact;
    const selectedMitigation = analysisPriority === "cold_chain"
      ? event.mitigationOptions?.[0]
      : event.mitigationOptions?.[1] ?? event.selectedMitigation;
    return [
      `${event.eventType.replace("_", " ")} on ${event.affectedRoute} adds ${event.inboundEtaImpactMinutes} minutes to inbound ETA and marks ${event.affectedSkus.length} SKU(s) as affected.`,
      `${priorityLabel(analysisPriority)} ranks ${selectedMitigation?.label ?? "the lowest compatible risk option"} highest for comparison: ${selectedMitigation?.coldChainImpact ?? "cold-chain controls remain mandatory"} ${selectedMitigation?.fefoImpact ?? "FEFO is checked before resequencing"}`,
      "This is advisory analysis only; no route, dock, or shipment change was created or applied."
    ].join(" ");
  }
  if (intent === "temperature_event" || intent === "non_conformance") {
    if (outputs.get_temperature_events?.events?.length) {
      const event = outputs.get_temperature_events.events[0];
      return `${event.zoneName} has a ${event.eventType} at ${event.peakTemp} C against ${event.allowedBand}. Variance is ${event.peakVariance} C for ${event.durationMinutes} minutes. Status is ${event.status}.`;
    }
    const cold = outputs.check_cold_chain_status;
    return cold
      ? `${cold.zoneName} is at ${cold.currentTemperature} C against a required ${cold.requiredMin}-${cold.requiredMax} C band. Breach severity is ${cold.breachSeverity}. ${cold.recommendedMitigation}`
      : "No temperature event is recorded for the selected zone.";
  }
  if (intent === "route_status") {
    if (outputs.get_route_status) {
      const routes = outputs.get_route_status.routes ?? [];
      return routes.length
        ? `${routes[0].name} is ${routes[0].status} with ETA ${routes[0].etaMinutes} minutes and delay delta ${routes[0].delayDeltaMinutes} minutes.`
        : "No route status record matched the request.";
    }
    const dock = outputs.check_dock_schedule;
    return `Dock scan for ${dock.timeWindow} found ${dock.dockSlotConflicts.length} conflict(s). Available options include ${dock.availableSlots.map((slot: any) => slot.dockId).join(", ") || "no spare dock slots in the window"}.`;
  }
  if (intent === "transport_status") {
    const context = outputs.get_transport_context;
    if (!context?.recordCount) return "No canonical transport record matched the request.";
    if (context.query && context.recordCount === 1) {
      const record = context.records[0];
      const leg = record.transportLeg;
      const documentStatus = record.wmsDocument?.inboundStatus ?? record.wmsDocument?.outboundStatus ?? "unavailable";
      return `${record.referenceId} is linked to ${leg.transportLegId} on ${leg.routeId}. Transport is ${leg.transportStatus}, route status is ${leg.routeStatus}, and WMS status is ${documentStatus}. ETA is ${leg.estimatedArrival}; ${record.dockAppointment ? `${record.dockAppointment.dockAppointmentId} is ${record.dockAppointment.status} at Dock ${record.dockAppointment.dockId}` : "no dock appointment is linked"}.`;
    }
    return `Transport overview: ${context.recordCount} records (${context.summary.inbound} inbound, ${context.summary.outbound} outbound), with ${context.summary.delayed} delayed, ${context.summary.exceptions} exception, ${context.summary.coldChain} cold-chain, and ${context.summary.dockConflicts} dock conflict record(s).`;
  }
  if (intent === "scenario_simulation") {
    const facility = outputs.simulate_facility_disruption;
    if (facility) {
      const durationDays = facility.durationMinutes / (24 * 60);
      const durationLabel = durationDays % 365 === 0
        ? `${durationDays / 365}-year`
        : `${Number.isInteger(durationDays) ? String(durationDays) : durationDays.toFixed(1)}-day`;
      return `A ${durationLabel} outage at ${facility.scope} pauses FEFO execution across receiving, storage, allocation, and dispatch. ${facility.expiresDuringOutage.length} released lot(s) / ${facility.expiresDuringOutageUnits} unit(s) expire during the outage, and ${facility.expiresWithin7DaysAfterRecovery.length} lot(s) / ${facility.restartCriticalUnits} unit(s) expire within seven days after recovery. ${facility.inboundAffected.length} inbound and ${facility.outboundAffected.length} outbound movement(s) fall in the outage window. FEFO must be recalculated before allocation resumes; this scenario changed no operational state.`;
    }
    const transport = outputs.simulate_transport_impact;
    if (transport) {
      return `Scenario for ${transport.referenceId} projects a ${transport.delayMinutes} minute delay, ${transport.serviceVarianceMinutes ?? "unavailable"} minutes of service variance, and ${transport.dockConflictsCreated.length} dock conflict(s). It connects ${transport.affectedSkus.length} SKU(s), ${transport.affectedBatches.length} batch(es), and ${transport.affectedStages.join(" -> ")}; cold-chain risk is ${transport.coldChainRisk}. The ${transport.options.length} options are comparisons only; no operational state was changed.`;
    }
    const sim = outputs.simulate_reprioritisation;
    if (sim) {
      return `Simulation for ${sim.shipmentId} projects affected stock balances ${sim.impactedStockBalances.join(", ")} across ${sim.affectedStages.join(" -> ")}. This is advisory analysis only; no operational action was created or applied.`;
    }
    return "A transport overview was verified, but an exact leg, ASN, shipment, route, or appointment reference is required to run the what-if projection.";
  }
  return `Operational scan completed. ${executions.map((execution) => execution.summary.conciseOutput).join(" ")}`;
}

function buildPayloadAndEvidence(intent: string, executions: ToolExecution[], analysisPriority: AnalysisPriority = "balanced") {
  const payload = basePayload();
  const outputs = Object.fromEntries(executions.map((execution) => [execution.name, execution.output as any]));
  let confidence = 86;
  let riskLevel: RiskLevel = "low";

  if (outputs.locate_sku) {
    payload.affectedSKUs.push(outputs.locate_sku.stockBalanceId);
    payload.affectedZones.push(outputs.locate_sku.zone.id);
    payload.affectedStages.push(...outputs.locate_sku.stageImpacts);
    if (outputs.locate_sku.linkedShipmentId) payload.affectedShipments.push(outputs.locate_sku.linkedShipmentId);
    confidence = 94;
  }
  if (outputs.check_fefo_impact) {
    payload.affectedSKUs.push(...outputs.check_fefo_impact.affectedSkus.map((sku: any) => sku.skuId));
    payload.affectedStages.push(...outputs.check_fefo_impact.affectedStages);
    payload.affectedShipments.push(outputs.check_fefo_impact.shipmentId);
    riskLevel = outputs.check_fefo_impact.cascadeRiskScore > 50 ? "medium" : "low";
  }
  if (outputs.check_cold_chain_status) {
    payload.affectedZones.push(outputs.check_cold_chain_status.zoneId);
    payload.affectedSKUs.push(...outputs.check_cold_chain_status.affectedSkus);
    if (outputs.check_cold_chain_status.breachSeverity === "warn") riskLevel = "medium";
    if (outputs.check_cold_chain_status.breachSeverity === "critical") riskLevel = "critical";
    confidence = Math.max(confidence, 88);
  }
  if (outputs.get_product_stock) {
    payload.affectedSKUs.push(...outputs.get_product_stock.batches.map((batch: any) => batch.stockBalanceId));
    payload.affectedZones.push(...outputs.get_product_stock.batches.map((batch: any) => zoneCode(batch.location.zone)));
    payload.affectedStages.push("Storage");
    confidence = Math.max(confidence, 93);
  }
  if (outputs.get_inventory_planning) {
    const planning = outputs.get_inventory_planning;
    payload.type = "scenario_analysis";
    payload.affectedSKUs.push(planning.product.productCode, ...planning.expiryRiskLots.map((lot: any) => lot.stockBalanceId));
    payload.affectedStages.push("Storage", "Replenishment planning");
    riskLevel = planning.risk === "critical" ? "critical" : planning.risk === "healthy" ? "low" : "medium";
    confidence = Math.max(confidence, 95);
  }
  if (outputs.get_batch_detail) {
    payload.affectedSKUs.push(outputs.get_batch_detail.stockBalanceId);
    payload.affectedZones.push(zoneCode(outputs.get_batch_detail.location.zone));
    payload.affectedStages.push("Storage");
    confidence = Math.max(confidence, 94);
    if (outputs.get_batch_detail.qualityStatus !== "Released") riskLevel = "medium";
  }
  if (outputs.check_fefo_allocation) {
    payload.affectedSKUs.push(...outputs.check_fefo_allocation.eligibleBatches.map((batch: any) => batch.stockBalanceId));
    payload.affectedStages.push("Storage", "Reservation");
    if (outputs.check_fefo_allocation.shortfallQty > 0 || outputs.check_fefo_allocation.excludedBatches.length > 0) riskLevel = "medium";
  }
  if (outputs.simulate_shipment_allocation) {
    payload.type = "scenario_analysis";
    payload.affectedSKUs.push(...outputs.simulate_shipment_allocation.stockImpact.map((impact: any) => impact.stockBalanceId ?? `SB-${impact.batchId}`));
    payload.affectedShipments.push(outputs.simulate_shipment_allocation.shipmentId);
    payload.affectedStages.push(...outputs.simulate_shipment_allocation.affectedStages);
    riskLevel = "medium";
    confidence = 92;
  }
  if (outputs.check_dock_schedule) {
    payload.affectedDocks.push(...outputs.check_dock_schedule.dockSlotConflicts.map((conflict: any) => conflict.dockId));
    payload.affectedShipments.push(...outputs.check_dock_schedule.affectedShipments);
    if (outputs.check_dock_schedule.dockSlotConflicts.length > 0) riskLevel = "medium";
  }
  if (outputs.get_transport_context) {
    const records = outputs.get_transport_context.records ?? [];
    payload.affectedSKUs.push(...records.flatMap((record: any) => record.wmsLines?.map((line: any) => line.product?.productCode ?? line.productId) ?? []));
    payload.affectedShipments.push(...records.map((record: any) => record.transportLeg?.shipmentId).filter(Boolean));
    payload.affectedDocks.push(...records.map((record: any) => record.dockAppointment?.dockId).filter(Boolean));
    payload.affectedStages.push(...records.flatMap((record: any) => record.transportLeg?.direction === "inbound"
      ? ["Transport", "Receiving"]
      : ["Transport", "Dispatch"]));
    if (records.some((record: any) => record.transportLeg?.transportStatus === "exception" || record.transportLeg?.routeStatus === "disrupted")) riskLevel = "high";
    else if (records.some((record: any) => record.transportLeg?.scheduleAdherence === "delayed" || record.dockAppointment?.conflictFlag)) riskLevel = "medium";
    confidence = Math.max(confidence, 95);
  }
  if (outputs.simulate_reprioritisation) {
    payload.type = "scenario_analysis";
    payload.affectedSKUs.push(...outputs.simulate_reprioritisation.impactedStockBalances);
    payload.affectedStages.push(...outputs.simulate_reprioritisation.affectedStages);
    payload.affectedDocks.push(...outputs.simulate_reprioritisation.affectedDocks);
    payload.affectedShipments.push(outputs.simulate_reprioritisation.shipmentId);
    riskLevel = "medium";
    confidence = 89;
  }
  if (outputs.simulate_facility_disruption) {
    const simulation = outputs.simulate_facility_disruption;
    payload.type = "scenario_analysis";
    payload.affectedSKUs.push(...simulation.affectedStockBalances, ...simulation.affectedSkus);
    payload.affectedStages.push(...simulation.affectedStages);
    payload.affectedShipments.push(
      ...simulation.inboundAffected.map((shipment: any) => shipment.asnId),
      ...simulation.outboundAffected.map((shipment: any) => shipment.shipmentId)
    );
    payload.affectedDocks.push(
      ...simulation.inboundAffected.map((shipment: any) => shipment.receivingDock),
      ...simulation.outboundAffected.map((shipment: any) => shipment.dock)
    );
    riskLevel = simulation.expiresDuringOutage.length > 0 ? "high" : "medium";
    confidence = 96;
  }
  if (outputs.simulate_event_impact) {
    payload.type = "scenario_analysis";
    payload.affectedSKUs.push(...outputs.simulate_event_impact.affectedSkus);
    payload.affectedZones.push("CS");
    payload.affectedStages.push("Inbound", "Receiving", "Storage", "Dock Staging", "Dispatch");
    payload.affectedDocks.push(...outputs.simulate_event_impact.dockConflictsCreated.map((conflict: any) => conflict.dockId));
    payload.affectedShipments.push("SHIP-001");
    riskLevel = outputs.simulate_event_impact.coldChainRisk > 45 ? "high" : "medium";
    confidence = 91;
  }
  if (outputs.simulate_transport_impact) {
    const simulation = outputs.simulate_transport_impact;
    payload.type = "scenario_analysis";
    payload.affectedSKUs.push(...simulation.affectedStockBalances, ...simulation.affectedSkus);
    payload.affectedStages.push(...simulation.affectedStages);
    payload.affectedDocks.push(...[simulation.dockId, ...simulation.dockConflictsCreated.map((conflict: any) => conflict.dockId)].filter(Boolean));
    if (simulation.shipmentId) payload.affectedShipments.push(simulation.shipmentId);
    riskLevel = simulation.coldChainRisk === "critical" ? "critical" : simulation.coldChainRisk === "high" ? "high" : "medium";
    confidence = 96;
  }

  payload.affectedSKUs = [...new Set(payload.affectedSKUs)];
  payload.affectedZones = [...new Set(payload.affectedZones)];
  payload.affectedStages = [...new Set(payload.affectedStages)];
  payload.affectedShipments = [...new Set(payload.affectedShipments)];
  payload.affectedDocks = [...new Set(payload.affectedDocks)];
  payload.recommendedActionId = null;

  const evidence: DecisionEvidence = {
    dataUsed: [
      "SQLite warehouse snapshot",
      "Product, batch, stock-balance, expiry, quality, temperature-band, and shipment records",
      "Canonical TMS legs, routes, partner sites, carrier and vehicle records",
      "Connected WMS documents and lines, yard appointments, physical docks, and operational events",
      "Recent simulated IoT temperature/RFID events"
    ],
    constraintsApplied: [
      `Selected scenario priority: ${priorityLabel(analysisPriority)}`,
      priorityInstruction(analysisPriority),
      "QA Hold and Quarantine stock remain restricted; the assistant cannot advance them",
      "Assistant output is read-only and cannot create or apply management decisions",
      "HSA-style regulatory fields are academic simulation fields only"
    ],
    alternativesConsidered: outputs.simulate_facility_disruption
      ? outputs.simulate_facility_disruption.mitigationOptions.map((option: any) => `${option.label}: ${option.tradeoff}`)
      : outputs.simulate_transport_impact
      ? outputs.simulate_transport_impact.options.map((option: any) => `${option.label}: ${option.tradeoff}`)
      : outputs.simulate_event_impact
        ? outputs.simulate_event_impact.mitigationOptions.map((option: any) => `${option.label}: risk score ${option.riskScore}`)
        : ["Maintain current schedule", "Expedite urgent shipment", "Use safer dock buffer"],
    uncertainties: [
      outputs.simulate_facility_disruption
        ? "The facility outage is hypothetical; backup power, alternate-site capacity, safe access, and post-event stock condition are not established."
        : "Scenario disruption duration is simulated unless an explicit delay was supplied",
      "IoT telemetry is generated for academic demonstration",
      "No real GSK operational system is connected"
    ],
    whyRecommendationWasMade:
      intent === "shipment_impact" || intent === "scenario_simulation"
        ? `${priorityLabel(analysisPriority)} was used to compare the simulated options. The result is advisory and does not choose or apply a management decision.`
        : `The answer follows deterministic records using ${priorityLabel(analysisPriority).toLowerCase()} ranking and remains read-only.`
  };

  return { payload, evidence, confidence, riskLevel };
}

function outputTextFromResponse(responseBody: any) {
  if (typeof responseBody?.output_text === "string") return responseBody.output_text;
  const output = Array.isArray(responseBody?.output) ? responseBody.output : [];
  return output
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .map((item: any) => item?.text ?? item?.content ?? "")
    .filter(Boolean)
    .join("\n");
}

function alignAgentResponse(
  response: AgentResponse,
  routedIntent: AgentIntent,
  executions: ToolExecution[],
  query = ""
): AgentResponse {
  let aligned = response;
  const outputs = Object.fromEntries(executions.map((execution) => [execution.name, execution.output as any]));

  if (routedIntent === "transport_status" || routedIntent === "scenario_simulation") {
    aligned = { ...aligned, intent: routedIntent };
  }

  const facilitySimulation = outputs.simulate_facility_disruption;
  if (facilitySimulation) {
    const presentation = facilityScenarioPresentation(query, executions, facilitySimulation);
    aligned = {
      ...aligned,
      intent: "scenario_simulation",
      status: "attention",
      title: "Facility FEFO Scenario",
      summary: `A ${presentation.durationLabel} shutdown of ${facilitySimulation.scope} pauses FEFO execution across the warehouse; ${facilitySimulation.expiresDuringOutage.length} released lot(s) expire during the outage and ${facilitySimulation.expiresWithin7DaysAfterRecovery.length} expire within seven days after recovery.`,
      facts: presentation.facts,
      impact: presentation.impacts.length ? presentation.impacts : facilitySimulation.operationalImpact.slice(0, 5),
      nextAction: { label: "Open Inventory", type: "open_inventory", targetId: null },
      dataGaps: presentation.dataGaps,
      confidence: "high"
    };
  }

  const exactTransport = outputs.get_transport_context?.query && outputs.get_transport_context?.recordCount === 1
    ? outputs.get_transport_context.records?.[0]
    : null;
  if (routedIntent === "transport_status" && exactTransport) {
    const leg = exactTransport.transportLeg;
    const scheduleLabel = leg.scheduleAdherenceLabel ?? leg.routeStatus ?? "Schedule unknown";
    const wmsStatus = exactTransport.wmsDocument?.inboundStatus ?? exactTransport.wmsDocument?.outboundStatus ?? "Unavailable";
    const coldChainStatus = exactTransport.wmsDocument?.coldChainStatus ?? leg.temperatureStatus ?? "Unavailable";
    aligned = {
      ...aligned,
      status: leg.scheduleAdherence === "delayed" && aligned.status === "ok" ? "attention" : aligned.status,
      summary: `${exactTransport.referenceId} is ${String(leg.transportStatus).replaceAll("_", " ")}; ${scheduleLabel}, with ${wmsStatus} in WMS and cold-chain status ${coldChainStatus}.`,
      facts: [
        { label: "Schedule adherence", value: scheduleLabel },
        ...aligned.facts.filter((fact) => !/schedule|adherence/i.test(fact.label))
      ].slice(0, 6),
      impact: aligned.impact.filter((item) => !/\bon schedule\b|\bon[- ]time\b|\bno (?:current )?(?:delay|schedule risk)\b/i.test(item))
    };
  }

  if (routedIntent === "non_conformance" && Number(outputs.get_temperature_events?.eventCount ?? 0) > 0) {
    const event = outputs.get_temperature_events.events?.[0];
    aligned = {
      ...aligned,
      intent: "non_conformance",
      status: "non_conformance",
      nextAction:
        aligned.nextAction.type === "none"
          ? {
              label: "Review Non-Conformance",
              type: "review_non_conformance",
              targetId: event?.ncId ?? event?.eventId ?? null
            }
          : aligned.nextAction
    };
  }

  if (routedIntent === "outbound_stock") {
    const blockedShipment = outputs.get_outbound_stock?.find?.((shipment: any) => String(shipment.outboundStatus ?? shipment.status ?? "").toLowerCase().includes("blocked"));
    if (blockedShipment) {
      aligned = {
        ...aligned,
        status: "blocked",
        nextAction:
          aligned.nextAction.type === "none"
            ? {
                label: "Open Logistics",
                type: "open_logistics",
                targetId: blockedShipment.shipmentId ?? blockedShipment.id ?? null
              }
            : aligned.nextAction
      };
    }
  }

  const fefoEvidenceAvailable = Boolean(
    outputs.check_fefo_allocation
    || outputs.check_fefo_impact
    || outputs.simulate_shipment_allocation?.allocations
    || outputs.simulate_facility_disruption
  );
  const unsupportedFefoConclusion = (text: string) =>
    /(?:available|eligible|compliant).*fefo|fefo.*(?:available|eligible|dispatch|compliant)|\b(?:no|zero)\s+(?:current\s+)?fefo\s+(?:conflicts?|violations?|issues?|risks?)\b|\b(?:no|zero)\s+(?:current\s+)?expiry\s+(?:conflicts?|issues?|risks?)\b/i.test(text);
  const claimedFefoAvailability = unsupportedFefoConclusion([aligned.summary, ...aligned.impact].join(" "));
  if (!fefoEvidenceAvailable && claimedFefoAvailability) {
    const coldChainWasChecked = Boolean(outputs.check_cold_chain_status);
    aligned = {
      ...aligned,
      status: aligned.status === "ok" ? "attention" : aligned.status,
      summary: coldChainWasChecked
        ? "I verified the cold-chain condition for the listed lots, but FEFO eligibility is still unverified because expiry and allocation sequencing were not checked."
        : "I could not verify FEFO eligibility because the required expiry and allocation sequencing evidence was not checked.",
      impact: [
        ...aligned.impact.filter((item) => !unsupportedFefoConclusion(item)),
        "Do not allocate these lots as FEFO-eligible until the FEFO check is completed."
      ].slice(0, 3),
      dataGaps: [
        ...new Set([
          ...aligned.dataGaps,
          "FEFO eligibility requires lot expiry, quality release, and allocation sequencing evidence."
        ])
      ].slice(0, 4)
    };
  }

  const coldChainEvidenceAvailable = Boolean(outputs.check_cold_chain_status || outputs.get_temperature_events);
  if (!coldChainEvidenceAvailable) {
    aligned = {
      ...aligned,
      impact: aligned.impact.filter((item) => !/(?:no|without)\s+(?:current\s+)?(?:impact|issue|risk).*(?:cold[- ]chain|temperature)|(?:cold[- ]chain|temperature).*(?:maintained|compliant|satisfied|safe|intact|within (?:the )?band|no (?:impact|issue|risk))/i.test(item))
    };
  }

  const completeUnlinkedStockCheck = Boolean(
    (outputs.locate_sku || outputs.get_batch_detail)
    && outputs.check_fefo_allocation
    && /\bno linked shipment\b/i.test(query)
  );
  if (completeUnlinkedStockCheck) {
    aligned = {
      ...aligned,
      dataGaps: aligned.dataGaps.filter((item) => !/fefo|batch|expiry|allocation|sequenc|shipment/i.test(item))
    };
  }

  return {
    ...aligned,
    requiresApproval: false
  };
}

function shouldRetryWithoutJsonMode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("response_format") ||
    message.includes("json_object") ||
    message.includes("unsupported") ||
    message.includes("unknown parameter") ||
    message.includes("temperature")
  );
}

async function createStructuredResponseWithOpenAI(
  query: string,
  routedIntent: AgentIntent,
  executions: ToolExecution[],
  draft: Omit<OrchestratorResponse, "agentResponse" | "fallbackUsed">,
  analysisPriority: AnalysisPriority = "balanced",
  uiContext?: AssistantUiContext
): Promise<{ agentResponse: AgentResponse; fallbackUsed: boolean }> {
  if (executions.length === 0 && routedIntent === "general_question") {
    return { agentResponse: readOnlyBoundaryAgentResponse(), fallbackUsed: false };
  }
  if (!process.env.OPENAI_API_KEY) {
    return {
      agentResponse: deterministicAgentResponse(routedIntent, executions, draft.narrative, query),
      fallbackUsed: false
    };
  }
  if (executions.length === 0) {
    return { agentResponse: fallbackAgentResponseFor("Required deterministic tool output was unavailable."), fallbackUsed: true };
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: Number(process.env.OPENAI_TIMEOUT_MS ?? 12_000) });
  const model = (process.env.OPENAI_MODEL || "o3-mini").trim();
  const prompt = {
    userQuery: query,
    questionCoverage: {
      namedReferences: [...new Set([...extractTransportReferences(query), ...extractStockReferences(query)])],
      requirement: "Account for every named reference and stated condition in facts, impact, or dataGaps; do not let a broad scenario hide a narrower clause."
    },
    analysisPriority: priorityLabel(analysisPriority),
    priorityRule: priorityInstruction(analysisPriority),
    routedIntent,
    selectedUiState: uiContext ?? null,
    deterministicNarrative: draft.narrative,
    actionPayload: draft.actionPayload,
    requiresApproval: draft.requiresApproval,
    approvalStatus: draft.approvalStatus,
    tools: executions.map((execution) => ({
      toolName: execution.name,
      input: execution.input,
      conciseOutput: execution.summary.conciseOutput,
      output: execution.output
    })),
    evidence: draft.decisionEvidence
  };

  const anyClient = client as any;
  const parseAndValidate = (text: string) => alignAgentResponse(validateAgentResponse(parseAgentJson(text)), routedIntent, executions, query);

  try {
    if (anyClient.responses?.create) {
      try {
        const completion = await anyClient.responses.create({
          model,
          temperature: 0,
          max_output_tokens: 900,
          text: { format: { type: "json_object" } },
          input: [
            { role: "system", content: TWINOPS_AGENT_SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(prompt) }
          ]
        });
        return { agentResponse: parseAndValidate(outputTextFromResponse(completion)), fallbackUsed: false };
      } catch (error) {
        if (!shouldRetryWithoutJsonMode(error)) throw error;
        console.warn("OpenAI JSON response mode failed; retrying strict JSON parsing without response_format.", error);
        const completion = await anyClient.responses.create({
          model,
          max_output_tokens: 900,
          input: [
            { role: "system", content: TWINOPS_AGENT_SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(prompt) }
          ]
        });
        return { agentResponse: parseAndValidate(outputTextFromResponse(completion)), fallbackUsed: false };
      }
    }

    try {
      const completion = await anyClient.chat.completions.create({
        model,
        temperature: 0,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: TWINOPS_AGENT_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(prompt) }
        ]
      });
      return { agentResponse: parseAndValidate(completion.choices?.[0]?.message?.content ?? ""), fallbackUsed: false };
    } catch (error) {
      if (!shouldRetryWithoutJsonMode(error)) throw error;
      console.warn("OpenAI chat JSON mode failed; retrying strict JSON parsing without response_format.", error);
      const completion = await anyClient.chat.completions.create({
        model,
        temperature: 0,
        max_tokens: 900,
        messages: [
          { role: "system", content: TWINOPS_AGENT_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(prompt) }
        ]
      });
      return { agentResponse: parseAndValidate(completion.choices?.[0]?.message?.content ?? ""), fallbackUsed: false };
    }
  } catch (error) {
    console.warn("OpenAI response formatting failed; using the deterministic grounded formatter.", error);
    return {
      agentResponse: deterministicAgentResponse(routedIntent, executions, draft.narrative, query),
      fallbackUsed: false
    };
  }
}

async function runDeterministicRouting(
  query: string,
  onProgress?: ProgressCallback,
  uiContext?: AssistantUiContext
) {
  const plan = routeQuery(fallbackRoutingQuery(query, uiContext));
  const executions: ToolExecution[] = [];
  const toolFailures: string[] = [];
  for (const tool of plan.tools) {
    try {
      const output = await runTool(tool.name, tool.input);
      executions.push({
        name: tool.name,
        input: tool.input,
        output,
        summary: summariseToolCall(tool.name, tool.input, output)
      });
      onProgress?.({ toolName: tool.name, agents: TOOL_TO_AGENTS[tool.name] ?? [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed.";
      console.warn(`Tool ${tool.name} failed during deterministic routing.`, message);
      toolFailures.push(`${tool.name}: ${message}`);
      break;
    }
  }
  return { executions, toolFailures, intent: plan.intent, agentsUsed: plan.agents };
}

export async function processUserQuery(
  query: string,
  onProgress?: ProgressCallback,
  analysisPriority: AnalysisPriority = "balanced",
  uiContext?: AssistantUiContext
): Promise<OrchestratorResponse> {
  if (isAssistantIntroductionQuery(query)) return assistantIntroductionResponse(analysisPriority);

  getWarehouseSnapshot();

  const model = (process.env.OPENAI_MODEL || "o3-mini").trim();
  let executions: ToolExecution[];
  let toolFailures: string[];
  let intent: AgentIntent;
  let agentsUsed: AgentName[];

  if (process.env.OPENAI_API_KEY) {
    // Real agentic tool selection: the model chooses which deterministic tools to call.
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: Number(process.env.OPENAI_TIMEOUT_MS ?? 12_000) });
      const selected = await selectAndRunToolsWithAgent(client, model, query, onProgress, analysisPriority, uiContext);
      executions = selected.executions;
      toolFailures = selected.toolFailures;
      intent = guessIntentFromExecutions(executions);
      agentsUsed = agentsFromExecutions(executions);
    } catch {
      console.warn("OpenAI tool routing failed; using deterministic warehouse routing.");
      const selected = await runDeterministicRouting(query, onProgress, uiContext);
      executions = selected.executions;
      toolFailures = selected.toolFailures;
      intent = selected.intent;
      agentsUsed = selected.agentsUsed;
    }
  } else {
    // No API key configured: fall back to the deterministic keyword router so the demo
    // still works without any LLM call, instead of failing outright.
    const selected = await runDeterministicRouting(query, onProgress, uiContext);
    executions = selected.executions;
    toolFailures = selected.toolFailures;
    intent = selected.intent;
    agentsUsed = selected.agentsUsed;
  }

  const fallbackFromToolFailure = executions.length === 0 && toolFailures.length > 0 ? fallbackAgentResponseFor(toolFailures.join(" | ")) : null;
  const { payload, evidence, confidence, riskLevel } = fallbackFromToolFailure
    ? {
        payload: basePayload(),
        evidence: {
          dataUsed: ["No complete deterministic tool output was available"],
          constraintsApplied: ["Invalid or missing tool output cannot be used for operational facts"],
          alternativesConsidered: ["Retry with a valid SKU, shipment, route, or zone identifier"],
          uncertainties: toolFailures,
          whyRecommendationWasMade: "No operational recommendation was made."
        } as DecisionEvidence,
        confidence: 0,
        riskLevel: "medium" as RiskLevel
      }
    : buildPayloadAndEvidence(intent, executions, analysisPriority);
  const decisionId = `DEC-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const requiresApproval = false;
  const toolsCalled: ToolCallSummary[] = executions.map((execution) => execution.summary);
  const draft: Omit<OrchestratorResponse, "agentResponse" | "fallbackUsed"> = {
    decisionId,
    narrative: fallbackFromToolFailure ? fallbackFromToolFailure.summary : buildNarrative(intent, executions, analysisPriority),
    agentsUsed,
    toolsCalled,
    confidence,
    riskLevel,
    actionPayload: payload,
    decisionEvidence: evidence,
    requiresApproval,
    approvalStatus: "not_required",
    toolResults: Object.fromEntries(executions.map((execution) => [execution.name, execution.output])),
    analysisPriority
  };

  const structured = fallbackFromToolFailure
    ? { agentResponse: fallbackFromToolFailure, fallbackUsed: true }
    : await createStructuredResponseWithOpenAI(query, intent, executions, draft, analysisPriority, uiContext);
  const finalResponse: OrchestratorResponse = {
    ...draft,
    narrative: structured.agentResponse.summary,
    agentResponse: structured.agentResponse,
    fallbackUsed: structured.fallbackUsed
  };

  db.prepare(
    `INSERT INTO ai_decisions
     (id, timestamp, query, narrative, structured_response_json, fallback_used, agents_used_json, tools_called_json, confidence, risk_level, action_payload_json, decision_evidence_json, requires_approval, approval_status)
     VALUES (@id, @timestamp, @query, @narrative, @structuredResponse, @fallbackUsed, @agentsUsed, @toolsCalled, @confidence, @riskLevel, @actionPayload, @decisionEvidence, @requiresApproval, @approvalStatus)`
  ).run({
    id: decisionId,
    timestamp: nowIso(),
    query,
    narrative: finalResponse.narrative,
    structuredResponse: stringify(finalResponse.agentResponse),
    fallbackUsed: finalResponse.fallbackUsed ? 1 : 0,
    agentsUsed: stringify(finalResponse.agentsUsed),
    toolsCalled: stringify(finalResponse.toolsCalled),
    confidence: finalResponse.confidence,
    riskLevel: finalResponse.riskLevel,
    actionPayload: stringify(finalResponse.actionPayload),
    decisionEvidence: stringify(finalResponse.decisionEvidence),
    requiresApproval: finalResponse.requiresApproval ? 1 : 0,
    approvalStatus: finalResponse.approvalStatus
  });

  const scenarioIds = executions
    .map((execution) => (execution.output as { scenarioId?: unknown })?.scenarioId)
    .filter((scenarioId): scenarioId is string => typeof scenarioId === "string" && scenarioId.startsWith("SCN-"));
  const linkScenario = db.prepare("UPDATE scenario_snapshots SET decision_id = ? WHERE id = ? AND decision_id IS NULL");
  scenarioIds.forEach((scenarioId) => linkScenario.run(decisionId, scenarioId));

  return finalResponse;
}

export function aiUnavailableResponse(
  query: string,
  analysisPriority: AnalysisPriority = "balanced"
): OrchestratorResponse {
  if (isAssistantIntroductionQuery(query)) return assistantIntroductionResponse(analysisPriority);

  const agentResponse = fallbackAgentResponseFor("Chat orchestration failed.");
  return {
    decisionId: `DEC-${Date.now()}-FALLBACK`,
    narrative: agentResponse.summary,
    agentResponse,
    agentsUsed: ["Orchestrator"],
    toolsCalled: [],
    confidence: 0,
    riskLevel: "medium",
    actionPayload: basePayload(),
    decisionEvidence: {
      dataUsed: ["No model response was generated"],
      constraintsApplied: ["Dashboard and deterministic tools remain available"],
      alternativesConsidered: ["Retry with API key", "Use deterministic simulation buttons"],
      uncertainties: [query],
      whyRecommendationWasMade: "No operational recommendation was made."
    },
    requiresApproval: false,
    approvalStatus: "not_required",
    fallbackUsed: true,
    analysisPriority
  };
}
