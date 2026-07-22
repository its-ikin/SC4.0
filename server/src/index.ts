import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { refreshProofOfConceptTimeline, seedIfEmpty } from "./db/seed";
import {
  getAlerts,
  getDecisions,
  getDockSchedule,
  getDockAppointments,
  getInventoryData,
  getInventoryMovements,
  getInventorySummary,
  getInboundLines,
  getInboundShipments,
  getLogisticsData,
  getOperationalEvents,
  getOutboundLines,
  getOutboundShipments,
  getPartnerSites,
  getRoutes,
  getRfidEvents,
  getShipments,
  getInventoryPlacements,
  getTransportLegs,
  getWarehouseSnapshot,
  getZones,
  nowIso
} from "./db/database";
import { aiUnavailableResponse, processUserQuery } from "./orchestrator";
import { sanitizeAssistantUiContext } from "./assistantUiContext";
import { runTool, simulate_event_impact, simulate_reprioritisation } from "./tools";
import { startRealtime } from "./realtime";
import { computeAndCacheRoute, getRoutesDebug, refreshRoutes } from "./routesService";
import { WAREHOUSE_LABEL, WAREHOUSE_LOCATION } from "./routeData";
import { fetchLiveWeather } from "./weatherService";
import { analysisPriorityValues, buildAuditEvents } from "@twinops/shared";
import type { AnalysisPriority, AuditEvent, OperationalIssueLifecycleEvent } from "@twinops/shared";
import { getActiveOperationalIssues, getOperationalIssueLifecycleEvents, reconcileOperationalIssues } from "./issueLifecycle";
import { AuditExportScopeError, filterAuditEventsForExport, parseAuditExportScope } from "./auditExport";

const serverDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(serverDir, "../.env") });

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST"]
  }
});

const port = Number(process.env.PORT || 3001);

seedIfEmpty();
if (process.env.POC_STATIC_OPERATIONS !== "false") {
  // Keep quantities, statuses, routes, and assignments fixed, but move their operational
  // schedule as one coherent timeline whenever the POC server starts.
  refreshProofOfConceptTimeline();
}
reconcileOperationalIssues();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function getAuditSnapshot() {
  const snapshot = getWarehouseSnapshot();
  return {
    ...snapshot,
    alerts: getAlerts(1000),
    decisions: getDecisions(1000),
    rfidEvents: getRfidEvents(1000),
    inventory: {
      ...snapshot.inventory,
      movements: getInventoryMovements(5000)
    }
  };
}

function lifecycleAsAuditEvent(event: OperationalIssueLifecycleEvent): AuditEvent {
  const issue = event.currentIssue ?? event.previousIssue;
  const priorityChange = event.previousIssue && event.currentIssue && event.previousIssue.priority !== event.currentIssue.priority
    ? ` Priority: ${event.previousIssue.priority.replaceAll("_", " ")} to ${event.currentIssue.priority.replaceAll("_", " ")}.`
    : "";
  return {
    id: `issue-lifecycle-${event.eventId}`,
    timestamp: event.timestamp,
    category: issue?.category ?? "Warehouse",
    eventType: `Issue ${event.eventType.replaceAll("_", " ")}`,
    title: `${event.eventType === "resolved" ? "Resolved" : event.eventType === "opened" ? "Opened" : event.eventType === "reopened" ? "Reopened" : "Updated"}: ${issue?.title ?? event.issueId}`,
    detail: `${event.reason}${priorityChange}`,
    severity: issue?.severity ?? "info",
    status: event.eventType === "resolved" ? "resolved" : issue?.status ?? "recorded",
    actor: "Operational Issue Monitor",
    affectedIds: issue?.affectedIds ?? [],
    correlationId: event.issueId,
    metadata: { lifecycleEvent: event }
  };
}

function getAuditEvents() {
  return [
    ...buildAuditEvents(getAuditSnapshot()),
    ...getOperationalIssueLifecycleEvents().map(lifecycleAsAuditEvent)
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "OK",
    service: "GSK TwinOps AI simulated warehouse orchestrator",
    timestamp: nowIso()
  });
});

app.get("/api/weather", async (_req, res) => {
  const weather = await fetchLiveWeather(WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng);
  res.json({ location: WAREHOUSE_LABEL, weather });
});

app.get("/api/warehouse", (_req, res) => {
  const { activeIssues } = reconcileOperationalIssues();
  res.json({ ...getWarehouseSnapshot(), operationalIssues: activeIssues });
});
app.get("/api/warehouse/inventory-placements", (_req, res) => res.json(getInventoryPlacements()));
// Deprecated compatibility route for older clients; payload identities are stock balances.
app.get("/api/warehouse/skus", (_req, res) => res.json(getInventoryPlacements()));
app.get("/api/warehouse/zones", (_req, res) => res.json(getZones()));
app.get("/api/inventory", (_req, res) => res.json(getInventoryData()));
app.get("/api/inventory/summary", (_req, res) => res.json(getInventorySummary()));
app.get("/api/inventory/incoming", (_req, res) => {
  const logistics = getLogisticsData();
  res.json({
    shipments: getInboundShipments(),
    lines: getInboundLines(),
    transportLegs: logistics.transportLegs.filter((leg) => leg.direction === "inbound"),
    dockAppointments: logistics.dockAppointments.filter((appointment) => appointment.direction === "inbound"),
    partnerSites: logistics.partnerSites
  });
});
app.get("/api/inventory/outbound", (_req, res) => {
  const logistics = getLogisticsData();
  res.json({
    shipments: getOutboundShipments(),
    lines: getOutboundLines(),
    transportLegs: logistics.transportLegs.filter((leg) => leg.direction === "outbound"),
    dockAppointments: logistics.dockAppointments.filter((appointment) => appointment.direction === "outbound"),
    partnerSites: logistics.partnerSites
  });
});
app.get("/api/inventory/movements", (_req, res) => res.json(getInventoryMovements()));
app.get("/api/shipments", (_req, res) => res.json(getShipments()));
app.get("/api/logistics", (_req, res) => res.json(getLogisticsData()));
app.get("/api/partner-sites", (_req, res) => res.json(getPartnerSites()));
app.get("/api/transport-legs", (req, res) => {
  const direction = req.query.direction;
  if (direction !== undefined && direction !== "inbound" && direction !== "outbound") {
    res.status(400).json({ error: "direction must be inbound or outbound" });
    return;
  }
  res.json(getTransportLegs(direction));
});
app.get("/api/dock-appointments", (_req, res) => res.json(getDockAppointments()));
app.get("/api/operations/events", (req, res) => {
  const requested = Number(req.query.limit ?? 500);
  const limit = Number.isFinite(requested) ? Math.min(5000, Math.max(1, Math.trunc(requested))) : 500;
  res.json(getOperationalEvents(limit));
});
app.get("/api/routes", (req, res) => {
  const direction = req.query.direction;
  if (direction !== undefined && direction !== "inbound" && direction !== "outbound") {
    res.status(400).json({ error: "direction must be inbound or outbound" });
    return;
  }
  res.json(getRoutes(direction));
});
app.get("/api/routes/debug", (_req, res) => res.json(getRoutesDebug()));
app.get("/api/alerts", (_req, res) => res.json(getAlerts()));
app.get("/api/issues", (_req, res) => res.json(reconcileOperationalIssues().activeIssues));
app.get("/api/issues/history", (_req, res) => res.json(getOperationalIssueLifecycleEvents()));
app.get("/api/audit", (_req, res) => res.json(getAuditEvents()));
app.get("/api/dock-schedule", (_req, res) => res.json(getDockSchedule()));

function extractResponseText(responseBody: any) {
  if (typeof responseBody?.output_text === "string") return responseBody.output_text;
  const output = Array.isArray(responseBody?.output) ? responseBody.output : [];
  return output
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .map((content: any) => content?.text ?? content?.value ?? "")
    .filter((text: unknown): text is string => typeof text === "string" && text.length > 0)
    .join("")
    .trim();
}

app.get("/api/ai/test", async (_req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = (process.env.OPENAI_MODEL || "gpt-4.1-nano").trim().toLowerCase();

  if (!apiKey) {
    res.status(503).json({
      ok: false,
      status: "missing_configuration",
      message: "OPENAI_API_KEY is not configured in server/.env."
    });
    return;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: 'Reply with exactly: OpenAI key works',
        max_output_tokens: 16
      })
    });

    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      res.status(response.status).json({
        ok: false,
        status: "openai_error",
        statusCode: response.status,
        message: responseBody?.error?.message ?? response.statusText ?? "OpenAI request failed."
      });
      return;
    }

    const outputText = extractResponseText(responseBody);
    if (outputText.trim() !== "OpenAI key works") {
      res.status(502).json({
        ok: false,
        status: "unexpected_response",
        message: "OpenAI responded, but the diagnostic reply did not match the expected text.",
        model
      });
      return;
    }

    res.json({
      ok: true,
      status: "success",
      message: "OpenAI key works",
      model
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      status: "request_failed",
      message: error instanceof Error ? error.message : "OpenAI diagnostic request failed."
    });
  }
});

app.post("/api/routes/refresh", async (_req, res) => {
  try {
    res.json(await refreshRoutes());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Route refresh failed" });
  }
});

app.post("/api/routes/compute", async (req, res) => {
  try {
    const routeId = String(req.body?.routeId ?? "");
    if (!routeId) {
      res.status(400).json({ error: "routeId is required" });
      return;
    }
    const route = await computeAndCacheRoute({
      routeId,
      origin: req.body?.origin,
      destination: req.body?.destination
    });
    res.json(route);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Route compute failed" });
  }
});

app.get("/api/routes/test-ors", async (_req, res) => {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    res.json({
      status: "missing_key",
      message: "ORS_API_KEY missing",
      orsKeyLoaded: false
    });
    return;
  }

  try {
    // Test with a simple Singapore route (Changi to Jurong)
    const response = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
      method: "POST",
      headers: {
        Accept: "application/json, application/geo+json",
        Authorization: apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        coordinates: [
          [103.9905, 1.3521], // Changi (origin)
          [103.7618, 1.3304]  // Jurong (destination)
        ],
        instructions: false,
        preference: "recommended",
        units: "m"
      })
    });

    const responseBody = await response.json();

    if (response.status === 401 || response.status === 403) {
      res.json({
        status: "unauthorized",
        statusCode: response.status,
        message: "ORS key rejected or not authorised",
        orsKeyLoaded: true,
        responseBody
      });
      return;
    }

    if (response.status === 429) {
      res.json({
        status: "rate_limited",
        statusCode: response.status,
        message: "ORS rate limit reached",
        orsKeyLoaded: true,
        responseBody
      });
      return;
    }

    if (!response.ok) {
      res.json({
        status: "error",
        statusCode: response.status,
        message: `ORS returned error: ${response.statusText}`,
        orsKeyLoaded: true,
        responseBody
      });
      return;
    }

    const hasValidRoute = responseBody.features?.length > 0 && responseBody.features[0].geometry?.coordinates?.length > 0;
    res.json({
      status: "success",
      statusCode: response.status,
      message: "ORS key is working",
      orsKeyLoaded: true,
      hasValidRoute,
      distance: responseBody.features?.[0]?.properties?.summary?.distance
        ? `${(responseBody.features[0].properties.summary.distance / 1000).toFixed(1)}km`
        : "unknown",
      duration: responseBody.features?.[0]?.properties?.summary?.duration
        ? `${Math.round(responseBody.features[0].properties.summary.duration / 60)}min`
        : "unknown"
    });
  } catch (error) {
    res.json({
      status: "fetch_error",
      message: error instanceof Error ? error.message : "Unknown error during ORS test",
      orsKeyLoaded: true,
      errorDetails: String(error)
    });
  }
});

app.post("/api/chat", async (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  const uiContext = sanitizeAssistantUiContext(req.body?.uiContext);
  const requestedPriority = String(req.body?.analysisPriority ?? "balanced");
  const analysisPriority: AnalysisPriority = analysisPriorityValues.includes(requestedPriority as AnalysisPriority)
    ? requestedPriority as AnalysisPriority
    : "balanced";
  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });

  try {
    const response = await processUserQuery(query, (event) => {
      res.write(`event: agent\ndata: ${JSON.stringify(event)}\n\n`);
    }, analysisPriority, uiContext);
    const words = response.narrative.split(/(\s+)/);
    for (const word of words) {
      res.write(`event: token\ndata: ${JSON.stringify(word)}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 6));
    }
    res.write(`event: final\ndata: ${JSON.stringify(response)}\n\n`);
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown chat orchestration error";
    console.warn("Chat orchestration failed; returning structured fallback.", message);
    const fallback = aiUnavailableResponse(query, analysisPriority);
    res.write(`event: token\ndata: ${JSON.stringify(fallback.agentResponse.summary)}\n\n`);
    res.write(`event: final\ndata: ${JSON.stringify(fallback)}\n\n`);
    res.end();
  }
});

app.post("/api/simulate", async (req, res) => {
  try {
    const type = String(req.body?.type ?? "");
    const params = req.body?.params ?? {};
    if (type === "event_impact") {
      const result = await simulate_event_impact(String(params.eventType ?? "weather"), String(params.affectedRoute ?? "Changi Air Cargo Gateway"));
      if (result.alertIsNew) {
        io.emit("alert:new", result.alert);
      }
      res.json(result);
      return;
    }
    if (type === "reprioritisation") {
      const result = simulate_reprioritisation(String(params.shipmentId ?? "SHIP-001"));
      res.json(result);
      return;
    }
    res.status(400).json({ error: "Unsupported simulation type." });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Simulation failed" });
  }
});

app.post("/api/tools/:toolName", async (req, res) => {
  try {
    const result = await runTool(req.params.toolName, req.body ?? {});
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Tool failed" });
  }
});

app.post("/api/approve", (_req, res) => {
  res.status(410).json({ error: "Approval workflow is disabled. The assistant is read-only." });
});

app.post("/api/reject", (_req, res) => {
  res.status(410).json({ error: "Approval workflow is disabled. The assistant is read-only." });
});

app.post("/api/audit/export", (req, res) => {
  try {
    const snapshot = getWarehouseSnapshot();
    reconcileOperationalIssues(snapshot);
    const allAuditEvents = getAuditEvents();
    const allOperationalIssues = getActiveOperationalIssues();
    const exportScope = parseAuditExportScope(req.body);
    const auditEvents = filterAuditEventsForExport(allAuditEvents, allOperationalIssues, exportScope);
    const selectedEventIds = new Set(auditEvents.map((event) => event.id));
    const scopedIssueEvents = filterAuditEventsForExport([], allOperationalIssues, { ...exportScope, view: "action_required" });
    const selectedIssueIds = new Set(scopedIssueEvents.map((event) => event.correlationId).filter((id): id is string => Boolean(id)));
    const operationalIssues = allOperationalIssues.filter((issue) => selectedIssueIds.has(issue.id));
    const operationalIssueLifecycle = getOperationalIssueLifecycleEvents()
      .filter((event) => selectedEventIds.has(`issue-lifecycle-${event.eventId}`));
    const decisionsThisSession = snapshot.decisions.filter((decision) => selectedEventIds.has(`decision-${decision.id}`));
    const alertHistory = snapshot.alerts.filter((alert) => selectedEventIds.has(`alert-${alert.id}`));
    res.json({
      exportedAt: nowIso(),
      exportScope: {
        ...exportScope,
        matchedEventCount: auditEvents.length,
        totalAvailableEventCount: allAuditEvents.length,
        matchedCurrentIssueCount: operationalIssues.length
      },
      currentWarehouseState: snapshot,
      auditEvents,
      operationalIssues,
      operationalIssueLifecycle,
      decisionsThisSession,
      fefoComplianceSummary: {
        score: snapshot.kpis.fefoCompliance,
        stockBalancesAtExpiryRisk: snapshot.kpis.stockBalancesAtExpiryRisk
      },
      alertHistory,
      assistantEnquiries: decisionsThisSession,
      simulatedAnalyses: decisionsThisSession.filter((decision) => decision.actionPayload.type === "scenario_analysis")
    });
  } catch (error) {
    if (error instanceof AuditExportScopeError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

io.on("connection", (socket) => {
  socket.emit("dashboard:state_update", {
    updatedSKUs: [],
    updatedDocks: [],
    updatedShipments: [],
    timestamp: nowIso()
  });
});

startRealtime(io);

server.listen(port, () => {
  console.log(`TwinOps server listening on http://localhost:${port}`);
});
