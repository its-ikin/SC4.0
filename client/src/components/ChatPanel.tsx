import { Fragment, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  ClipboardList,
  GitBranch,
  Info,
  ListChecks,
  PanelRightClose,
  PackageSearch,
  Send,
  ShieldQuestion,
  SlidersHorizontal,
  Sparkles,
  TrendingUp
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import type { AgentActionType, AgentName, AnalysisPriority, AssistantUiContext, ChatMessage, OperationalFocusType, OrchestratorResponse } from "@twinops/shared";
import { getWarehouse, runTool, streamChat, type AgentProgressEvent } from "../api";
import { useAppStore } from "../store";
import {
  affectedStagesForPlacement,
  buildInternalRoute,
  buildWarehouseBins,
  coldChainLabel,
  getRack,
  getRackForPlacement,
  getRackMetrics,
  getRfidCheckpoint,
  getSector,
  getSectorMetrics,
  isExpiryRisk,
  rackDisplayLabel,
  recommendedActionForPlacement,
  resolveDockIdForPlacement,
  rfidCheckpoints,
  stockBalanceLabel,
  stockDisplayCode,
  wmsLocationLabel,
  warehouseSectors,
  type WarehouseBin,
  type WarehouseRack,
  type WarehouseSector
} from "../warehouseLayout";
import { GlossaryText, StatusChip, confidenceTone, toneForRisk } from "./ui";

const examples = [
  "Where is stock item STK-100001-01, and what are its lot, STO, expiry, and quality status?",
  "What stock is available for PH-COLD-ADAL40-PEN, and which lots are excluded from FEFO?",
  "Show all QA Hold, Pending QA, and Quarantine inventory with their locations and quantities.",
  "Give me the full WMS batch detail for lot L2601-INSGLA-01, including arrival and dwell information.",
  "Check Cold Storage temperature status and identify the cold-chain inventory currently stored there."
];

export function currentAssistantUiContext(): AssistantUiContext {
  const state = useAppStore.getState();
  let focusType: OperationalFocusType = "overview";
  const activeWorkspace = state.view === "Warehouse"
    ? state.warehouseWorkspace
    : state.view === "Inventory"
      ? state.inventoryWorkspace
      : state.view === "Logistics"
        ? state.logisticsWorkspace
        : null;
  if (state.view === "Warehouse") {
    focusType = state.warehouseWorkspace === "docks"
      ? state.selectedDockAppointmentId ? "dock_appointment" : state.selectedDockId ? "dock" : "overview"
      : state.selectedRfidGateId ? "rfid" : state.selectedStockBalanceId ? "stock_balance" : state.selectedBinId ? "bin" : state.selectedRackId ? "rack" : state.selectedZoneId ? "zone" : state.selectedDockId ? "dock" : "overview";
  } else if (state.view === "Inventory") {
    focusType = state.selectedStockBalanceId ? "stock_balance" : "overview";
  } else if (state.view === "Logistics") {
    if (state.logisticsWorkspace === "inbound") {
      focusType = state.selectedInboundAsnId ? "asn" : "overview";
    } else if (state.logisticsWorkspace === "outbound") {
      focusType = state.selectedShipmentId ? "shipment" : "overview";
    } else {
      focusType = state.selectedTransportLegId ? "transport_leg" : state.selectedRouteId ? "route" : state.selectedPartnerSiteId ? "partner_site" : "overview";
    }
  } else if (state.view === "Monitoring") {
    focusType = state.selectedRfidGateId ? "rfid" : state.selectedZoneId ? "zone" : "overview";
  }

  return {
    activeView: state.view,
    activeWorkspace,
    focusType,
    selected: {
      zoneId: state.selectedZoneId,
      rackId: state.selectedRackId,
      binId: state.selectedBinId,
      stockBalanceId: state.selectedStockBalanceId,
      stage: state.selectedStage,
      dockId: state.selectedDockId,
      dockAppointmentId: state.selectedDockAppointmentId,
      shipmentId: state.selectedShipmentId,
      rfidGateId: state.selectedRfidGateId,
      routeId: state.selectedRouteId,
      transportLegId: state.selectedTransportLegId,
      partnerSiteId: state.selectedPartnerSiteId,
      inboundAsnId: state.selectedInboundAsnId
    },
    filters: {
      inventoryQuickFilter: state.inventoryQuickFilter,
      logisticsRouteFilter: state.logisticsRouteFilter,
      logisticsDirectionFilter: state.logisticsDirectionFilter,
      auditFilter: state.auditFilter
    }
  };
}

const assistantIntroduction = {
  name: "TwinOps Control",
  role: "Senior pharmaceutical warehouse control-tower planner",
  description:
    "I provide read-only checks for inventory, FEFO, cold-chain conditions, routes, docks, shipments, and audit evidence using verified system records.",
  priority: "Product quality, traceability, and cold-chain integrity come before speed or cost."
};

const priorityOptions: Array<{ value: AnalysisPriority; label: string; description: string }> = [
  {
    value: "balanced",
    label: "Balanced",
    description: "Weigh FEFO, cold-chain, dock, and service risk together."
  },
  {
    value: "fefo",
    label: "FEFO first",
    description: "Preserve earliest-expiry sequencing within mandatory safety controls."
  },
  {
    value: "cold_chain",
    label: "Cold-chain first",
    description: "Prefer temperature-safe handoffs, even when delay increases."
  }
];

type ChatTab = "inspector" | "chat" | "evidence";
type InspectorTab = "sector" | "rack" | "sku" | "rfid" | "risks" | "actions";

function operationalStatusExplanation(status: string) {
  if (status === "ok") return "No block or non-conformance was found in the checked evidence.";
  if (status === "attention") return "The evidence is available, but an operator review is recommended.";
  if (status === "blocked") return "A quality, stock, expiry, or scheduling constraint prevents the operation.";
  if (status === "non_conformance") return "The checked evidence meets the system's non-conformance rules.";
  return "The system could not verify enough evidence to classify the operation safely.";
}

function Evidence({ response }: { response: OrchestratorResponse }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-semibold text-twin-text">Evidence</span>
        <StatusChip tone={confidenceTone(response.confidence)}>{response.confidence}% confidence</StatusChip>
      </div>
      <div className="space-y-2.5 leading-relaxed text-twin-muted">
        <p><span className="text-twin-text">Intent:</span> {response.agentResponse.intent}</p>
        <p>
          <span className="text-twin-text">Operational outcome:</span>{" "}
          {response.agentResponse.status.replace("_", " ")} — {operationalStatusExplanation(response.agentResponse.status)}
        </p>
        <p><span className="text-twin-text">Analysis priority:</span> {priorityDisplay(response.analysisPriority).label}</p>
        <p><span className="text-twin-text">Fallback used:</span> {response.fallbackUsed ? "true" : "false"}</p>
        <p><span className="text-twin-text">Data used:</span> {response.decisionEvidence.dataUsed.join(", ")}</p>
        <p><span className="text-twin-text">Constraints:</span> {response.decisionEvidence.constraintsApplied.join(", ")}</p>
        <p><span className="text-twin-text">Alternatives:</span> {response.decisionEvidence.alternativesConsidered.join(" | ")}</p>
        <p><span className="text-twin-text">Uncertainty:</span> {response.decisionEvidence.uncertainties.join(" | ")}</p>
        <p><span className="text-twin-text">Why:</span> {response.decisionEvidence.whyRecommendationWasMade}</p>
        <p><span className="text-twin-text">Operating mode:</span> Read-only analysis</p>
      </div>
    </div>
  );
}

function ToolLog({ response }: { response: OrchestratorResponse }) {
  if (response.toolsCalled.length === 0) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-xs">
      <div className="mb-3 font-semibold text-twin-text">Tools</div>
      <div className="space-y-2">
        {response.toolsCalled.map((tool) => (
          <div key={`${tool.toolName}-${tool.conciseOutput}`} className="rounded-xl border border-white/10 bg-twin-bg/40 p-3">
            <div className="font-semibold text-twin-cyan">{tool.toolName}</div>
            <div className="mt-1 leading-relaxed text-twin-muted">{JSON.stringify(tool.input)} {"->"} {tool.conciseOutput}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const AGENT_ORDER: AgentName[] = ["Orchestrator", "Inventory", "Logistics", "Compliance"];

function AgentActivityTimeline({ agentsUsed }: { agentsUsed: AgentName[] }) {
  const active = new Set(agentsUsed);
  const ordered = AGENT_ORDER.filter((agent) => active.has(agent));
  if (ordered.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ordered.map((agent, index) => (
        <motion.span
          key={agent}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: index * 0.12, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center gap-1.5 rounded-full border border-twin-cyan/30 bg-twin-cyan/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-twin-blue"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-twin-cyan" />
          {agent}
          {index < ordered.length - 1 && <ChevronRight size={10} className="text-twin-muted" />}
        </motion.span>
      ))}
    </div>
  );
}

function agentStatusTone(status: string) {
  if (status === "blocked" || status === "non_conformance" || status === "unavailable") return "critical";
  if (status === "attention") return "warning";
  return "healthy";
}

function priorityDisplay(priority: AnalysisPriority | undefined) {
  return priorityOptions.find((option) => option.value === (priority ?? "balanced")) ?? priorityOptions[0];
}

function availabilityFor(response: OrchestratorResponse) {
  const agent = response.agentResponse;
  if (agent.status === "unavailable" || response.fallbackUsed) {
    return {
      label: "Not verified",
      tone: "critical" as const,
      description: "The lookup did not produce enough reliable evidence to answer safely. No values were guessed."
    };
  }
  if (agent.dataGaps.length > 0) {
    return {
      label: "Partially verified",
      tone: "warning" as const,
      description: "Some requested evidence was verified, but the missing items below may change the conclusion."
    };
  }
  return {
    label: "Evidence verified",
    tone: "healthy" as const,
    description: "The answer is supported by the warehouse records and checks listed in the answer trace."
  };
}

function friendlyToolName(name: string) {
  return name
    .replace(/^get_/, "")
    .replace(/^check_/, "")
    .replace(/^simulate_/, "simulation: ")
    .replaceAll("_", " ");
}

function actionLabel(type: AgentActionType) {
  return type.replace(/_/g, " ");
}

function StructuredAgentCard({
  response,
  onInspect,
  elapsedMs
}: {
  response: OrchestratorResponse;
  onInspect: (decisionId: string) => void;
  elapsedMs?: number;
}) {
  const agent = response.agentResponse;
  const setView = useAppStore((state) => state.setView);
  const locateStockBalanceInWarehouse = useAppStore((state) => state.locateStockBalanceInWarehouse);
  const openStockBalanceInInventory = useAppStore((state) => state.openStockBalanceInInventory);
  const openInboundInLogistics = useAppStore((state) => state.openInboundInLogistics);
  const openOutboundInLogistics = useAppStore((state) => state.openOutboundInLogistics);
  const openTransportLegInLogistics = useAppStore((state) => state.openTransportLegInLogistics);
  const openRouteInLogistics = useAppStore((state) => state.openRouteInLogistics);
  const setInventoryWorkspace = useAppStore((state) => state.setInventoryWorkspace);
  const setLogisticsWorkspace = useAppStore((state) => state.setLogisticsWorkspace);
  const setWarehouseWorkspace = useAppStore((state) => state.setWarehouseWorkspace);
  const setSelectedZone = useAppStore((state) => state.setSelectedZone);
  const openAlertsPage = useAppStore((state) => state.openAlertsPage);
  const setScenarioResult = useAppStore((state) => state.setScenarioResult);
  const addMessage = useAppStore((state) => state.addMessage);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const availability = availabilityFor(response);
  const selectedPriority = priorityDisplay(response.analysisPriority);
  const checksCompleted = response.toolsCalled.length > 0
    ? response.toolsCalled.map((tool) => friendlyToolName(tool.toolName)).join(", ")
    : response.decisionEvidence.dataUsed.slice(0, 2).join(", ");

  const handleAction = async () => {
    const action = agent.nextAction;
    const targetId = action.targetId;
    setActionNote(null);
    if (action.type === "none") return;
    if (action.type === "open_inventory") {
      if (targetId) openStockBalanceInInventory(targetId);
      else { setInventoryWorkspace("stock"); setView("Inventory"); }
      return;
    }
    if (action.type === "locate_warehouse") {
      if (targetId) locateStockBalanceInWarehouse(targetId);
      else { setWarehouseWorkspace("facility"); setView("Warehouse"); }
      return;
    }
    if (action.type === "open_logistics") {
      const snapshot = useAppStore.getState().snapshot;
      if (targetId && snapshot?.inventory.inboundShipments.some((shipment) => shipment.asnId === targetId)) {
        openInboundInLogistics(targetId);
        return;
      }
      if (targetId && (snapshot?.inventory.outboundShipments.some((shipment) => shipment.shipmentId === targetId) || snapshot?.shipments.some((shipment) => shipment.id === targetId))) {
        openOutboundInLogistics(targetId);
        return;
      }
      if (targetId && snapshot?.transportLegs.some((leg) => leg.transportLegId === targetId)) {
        openTransportLegInLogistics(targetId, "network");
        return;
      }
      if (targetId && snapshot?.routes.some((route) => route.routeId === targetId || route.id === targetId)) {
        openRouteInLogistics(targetId, "network");
        return;
      }
      setLogisticsWorkspace("network");
      setView("Logistics");
      return;
    }
    if (action.type === "open_monitoring" || action.type === "review_non_conformance") {
      if (targetId && !targetId.startsWith("NC-") && !targetId.startsWith("TE-")) setSelectedZone(targetId);
      setView("Monitoring");
      return;
    }
    if (action.type === "open_alerts") {
      openAlertsPage();
      return;
    }
    if (action.type === "open_audit") {
      setView("Audit");
      return;
    }
    if (action.type === "run_fefo_check") {
      if (!targetId) {
        setActionNote("A product, SKU, or batch target is required.");
        return;
      }
      setActionBusy(true);
      try {
        const result = await runTool<any>("check_fefo_allocation", { productId: targetId, requestedQty: 100 });
        addMessage({
          id: `FEFO-${Date.now()}`,
          role: "assistant",
          content: `${result.productCode}: ${result.totalEligibleAvailable} eligible units, ${result.shortfallQty} shortfall.`,
          createdAt: new Date().toISOString()
        });
      } finally {
        setActionBusy(false);
      }
      return;
    }
    if (action.type === "run_simulation") {
      if (!targetId?.startsWith("SHIP-")) {
        setActionNote("A shipment target is required.");
        return;
      }
      setActionBusy(true);
      try {
        const result = await runTool<any>("simulate_reprioritisation", { shipmentId: targetId });
        setScenarioResult(result);
        openOutboundInLogistics(targetId);
      } finally {
        setActionBusy(false);
      }
    }
  };

  return (
    <div className="space-y-3.5">
      <AgentActivityTimeline agentsUsed={response.agentsUsed} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold leading-snug text-twin-text">{agent.title}</div>
          <div className="mt-1 text-sm leading-relaxed text-twin-text">
            <GlossaryText text={agent.summary} />
          </div>
        </div>
      </div>

      <div className={clsx(
        "rounded-xl border p-3",
        availability.tone === "healthy" && "border-twin-green/25 bg-twin-green/10",
        availability.tone === "warning" && "border-twin-warning/25 bg-twin-warning/10",
        availability.tone === "critical" && "border-twin-critical/25 bg-twin-critical/10"
      )}>
        <div className="flex items-center gap-2">
          <StatusChip tone={availability.tone}>{availability.label}</StatusChip>
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-twin-muted">
            <Info size={11} /> Data availability
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-twin-muted">{availability.description}</p>
      </div>

      {agent.facts.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-twin-bg/30 p-3.5">
          <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-twin-muted">
            <ListChecks size={12} />
            What I found
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
            {agent.facts.map((fact) => (
              <Fragment key={fact.label}>
                <span className="text-twin-muted">
                  <GlossaryText text={fact.label} />
                </span>
                <span className="text-right font-semibold leading-snug text-twin-text">
                  <GlossaryText text={fact.value} />
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {agent.impact.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-twin-bg/30 p-3.5">
          <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-twin-muted">
            <TrendingUp size={12} />
            What this means operationally
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed text-twin-muted">
            {agent.impact.map((item) => (
              <li key={item} className="flex gap-1.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-twin-muted/60" />
                <GlossaryText text={item} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-twin-cyan/20 bg-twin-cyan/[0.055] p-3.5">
        <div className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-twin-blue">
          <GitBranch size={12} />
          How I reached this
        </div>
        <div className="space-y-3 text-xs leading-relaxed">
          <div className="grid grid-cols-[18px_1fr] gap-2">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-twin-cyan/20 text-[9px] font-bold text-twin-cyan">1</span>
            <div><span className="font-semibold text-twin-text">Checked:</span> <span className="text-twin-muted">{checksCompleted || "No operational lookup was required."}</span></div>
          </div>
          <div className="grid grid-cols-[18px_1fr] gap-2">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-twin-cyan/20 text-[9px] font-bold text-twin-cyan">2</span>
            <div>
              <span className="font-semibold text-twin-text">Applied:</span>{" "}
              <span className="text-twin-muted">{selectedPriority.label} priority. {selectedPriority.description}</span>
            </div>
          </div>
          <div className="grid grid-cols-[18px_1fr] gap-2">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-twin-cyan/20 text-[9px] font-bold text-twin-cyan">3</span>
            <div><span className="font-semibold text-twin-text">Concluded:</span> <span className="text-twin-muted">{response.decisionEvidence.whyRecommendationWasMade}</span></div>
          </div>
        </div>
      </div>

      {agent.dataGaps.length > 0 && (
        <div className="rounded-xl border border-twin-warning/25 bg-twin-warning/10 p-3.5">
          <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-twin-warning">
            <AlertTriangle size={12} />
            What I could not verify
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed text-twin-muted">
            {agent.dataGaps.map((item) => (
              <li key={item} className="flex gap-1.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-twin-warning/60" />
                <GlossaryText text={item} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-white/10 pt-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-twin-muted">
          <Check size={12} /> Recommended next step
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {agent.nextAction.type !== "none" ? (
            <button
              className="rounded-lg border border-twin-cyan/40 bg-twin-cyan/10 px-3 py-1.5 text-xs font-semibold text-twin-cyan transition hover:border-twin-cyan/60 disabled:opacity-50"
              disabled={actionBusy}
              onClick={() => void handleAction()}
            >
              {actionBusy ? "Working..." : agent.nextAction.label || actionLabel(agent.nextAction.type)}
            </button>
          ) : (
            <span className="text-xs text-twin-muted">No action is needed from the verified result.</span>
          )}
          <button
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-twin-cyan hover:border-twin-cyan/50"
            onClick={() => onInspect(response.decisionId)}
          >
            Review full evidence
          </button>
        </div>
        <div className="mt-2 text-[11px] text-twin-muted">
          {agent.confidence} confidence{response.fallbackUsed ? " | safe fallback used" : ""}
          {typeof elapsedMs === "number" && ` | Answered in ${(elapsedMs / 1000).toFixed(1)}s`}
        </div>
      </div>
      {actionNote && <div className="text-xs text-twin-muted">{actionNote}</div>}
    </div>
  );
}

// Live-ticking elapsed time while a response is still streaming. Once streaming finishes,
// the real elapsed time is frozen onto message.elapsedMs by sendQuery (see ChatPanel below) —
// this hook must not be used for that frozen value, since re-deriving it from message.createdAt
// after a remount (e.g. switching tabs and back) would count real wall-clock time instead of
// the actual response duration.
function useLiveElapsedMs(message: ChatMessage) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!message.streaming) return;
    const start = new Date(message.createdAt).getTime();
    setElapsedMs(Date.now() - start);
    const interval = setInterval(() => setElapsedMs(Date.now() - start), 100);
    return () => clearInterval(interval);
  }, [message.streaming, message.createdAt]);
  return elapsedMs;
}

function ThinkingIndicator({ message, elapsedMs }: { message: ChatMessage; elapsedMs: number }) {
  const seconds = (elapsedMs / 1000).toFixed(1);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-twin-muted">
        <span className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-twin-cyan" />
        Thinking... {seconds}s
      </div>
      {message.activeAgents && message.activeAgents.length > 0 && <AgentActivityTimeline agentsUsed={message.activeAgents} />}
    </div>
  );
}

function MessageBubble({
  message,
  onInspect
}: {
  message: ChatMessage;
  onInspect: (decisionId: string) => void;
}) {
  const isUser = message.role === "user";
  const isAuto = message.role === "autonomous";
  const liveElapsedMs = useLiveElapsedMs(message);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={clsx("flex", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={clsx(
          "max-w-[92%] rounded-2xl px-4 py-3 text-sm shadow-sm",
          isUser
            ? "bg-twin-orange text-white"
            : isAuto
              ? "border border-twin-warning/30 bg-twin-warning/10 text-amber-100"
              : "border border-white/10 bg-white/[0.045] text-twin-text"
        )}
      >
        {isAuto && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Alert</div>}
        {message.response ? (
          <StructuredAgentCard response={message.response} onInspect={onInspect} elapsedMs={message.elapsedMs} />
        ) : message.content ? (
          <div className="space-y-2">
            {message.streaming && <ThinkingIndicator message={message} elapsedMs={liveElapsedMs} />}
            <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
          </div>
        ) : message.streaming ? (
          <ThinkingIndicator message={message} elapsedMs={liveElapsedMs} />
        ) : null}
      </div>
    </motion.div>
  );
}

function TabButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      className={clsx(
        "rounded-xl px-3 py-2 text-xs font-semibold transition",
        active ? "bg-white/[0.075] text-twin-text shadow-sm" : "text-twin-muted hover:bg-white/[0.035] hover:text-twin-text"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function OperationalInspector({ onAsk }: { onAsk: (query: string) => void }) {
  const [subTab, setSubTab] = useState<InspectorTab>("sector");
  const snapshot = useAppStore((state) => state.snapshot);
  const highlight = useAppStore((state) => state.highlight);
  const selectedStockBalanceId = useAppStore((state) => state.selectedStockBalanceId);
  const selectedZoneId = useAppStore((state) => state.selectedZoneId);
  const selectedRackId = useAppStore((state) => state.selectedRackId);
  const selectedStage = useAppStore((state) => state.selectedStage);
  const selectedDockId = useAppStore((state) => state.selectedDockId);
  const selectedShipmentId = useAppStore((state) => state.selectedShipmentId);
  const selectedRfidGateId = useAppStore((state) => state.selectedRfidGateId);
  const rfidFeed = useAppStore((state) => state.rfidFeed);
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const setInventoryWorkspace = useAppStore((state) => state.setInventoryWorkspace);
  const setLogisticsWorkspace = useAppStore((state) => state.setLogisticsWorkspace);
  const setSelectedStockBalance = useAppStore((state) => state.setSelectedStockBalance);
  const setSelectedZone = useAppStore((state) => state.setSelectedZone);
  const setSelectedRack = useAppStore((state) => state.setSelectedRack);
  const setSelectedStage = useAppStore((state) => state.setSelectedStage);
  const openOutboundInLogistics = useAppStore((state) => state.openOutboundInLogistics);
  const setSelectedRfidGate = useAppStore((state) => state.setSelectedRfidGate);
  const locateStockBalanceInWarehouse = useAppStore((state) => state.locateStockBalanceInWarehouse);
  const openStockBalanceInInventory = useAppStore((state) => state.openStockBalanceInInventory);
  const selectedRfidGate = getRfidCheckpoint(selectedRfidGateId);
  const inventoryMode = view === "Inventory";

  const bins = useMemo(() => buildWarehouseBins(snapshot?.inventoryPlacements ?? []), [snapshot?.inventoryPlacements]);
  useEffect(() => {
    if (selectedRfidGate) {
      setSubTab("rfid");
      return;
    }
    if (inventoryMode) setSubTab("sku");
  }, [inventoryMode, selectedRfidGate, selectedStockBalanceId]);

  if (!snapshot) {
    return <div className="min-h-0 flex-1 p-4 text-sm text-twin-muted">Loading inspector...</div>;
  }

  const qualityFocus = selectedRfidGate ? null : snapshot.inventoryPlacements.find((sku) => sku.qualityStatus === "QA Hold" && sku.linkedShipmentId) ?? null;
  const sku = selectedRfidGate
    ? null
    : snapshot.inventoryPlacements.find((item) => item.stockBalanceId === selectedStockBalanceId) ??
      snapshot.inventoryPlacements.find((item) => highlight.stockBalances.includes(item.stockBalanceId)) ??
      qualityFocus ??
      null;
  const rack = getRack(selectedRackId) ?? getRackForPlacement(sku);
  const sector = getSector(selectedZoneId) ?? getSector(rack?.zoneId) ?? getSector(sku?.zoneId) ?? getSector(highlight.zones[0]) ?? null;
  const shipment =
    snapshot.shipments.find((item) => item.id === selectedShipmentId) ??
    snapshot.shipments.find((item) => item.id === sku?.linkedShipmentId) ??
    snapshot.shipments.find((item) => highlight.shipments.includes(item.id)) ??
    null;
  const dock =
    selectedDockId
      ? snapshot.docks.find((item) => item.id === selectedDockId) ?? null
      : shipment
        ? snapshot.docks.find((item) => item.id === shipment.dockId) ?? null
        : sku
          ? snapshot.docks.find((item) => item.id === resolveDockIdForPlacement(sku, snapshot.docks)) ?? null
          : null;
  const checkpointScans = selectedRfidGate
    ? [...rfidFeed, ...snapshot.rfidEvents]
        .filter((event, index, events) => selectedRfidGate.scanZoneIds.includes(event.zoneId) && events.findIndex((item) => item.id === event.id) === index)
        .slice(0, 4)
    : [];
  const sectorMetrics = getSectorMetrics(sector, snapshot.zones, snapshot.inventoryPlacements);
  const rackMetrics = getRackMetrics(rack, bins);
  const affectedStages = selectedRfidGate ? [selectedRfidGate.stage] : selectedStage ? [selectedStage] : affectedStagesForPlacement(sku, sector);
  const route = buildInternalRoute({
    placement: sku,
    rackId: rack?.id,
    sectorId: sector?.id,
    dockId: dock?.id,
    stage: selectedStage
  });
  const objectName = selectedRfidGate?.name ?? sku?.stockBalanceId ?? rack?.id ?? sector?.name ?? dock?.id ?? "Warehouse overview";
  const objectType = selectedRfidGate ? "RFID Checkpoint" : sku ? "SKU" : rack ? "Rack" : sector ? "Sector" : dock ? "Dock" : "Warehouse";
  const objectStatus = selectedRfidGate ? "checkpoint" : sku?.qualityStatus ?? shipment?.status ?? dock?.status ?? sectorMetrics.dataZone?.status ?? route.state;
  const recommendedAction = selectedRfidGate
    ? "Review checkpoint scans and confirm movement stage alignment."
    : sku
    ? recommendedActionForPlacement(sku)
    : route.state === "blocked"
      ? "Check blocked aisle or restricted zone."
      : sector
        ? "Select a rack row to inspect bins and route constraints."
        : "Select a sector, rack, or SKU to inspect movement route.";

  const toneForStatus = (status?: string | null) => {
    if (status === "critical" || status === "blocked" || status === "Blocked" || status === "QA Hold" || status === "Quarantine") return "critical";
    if (status === "warn" || status === "warning" || status === "Pending QA" || status === "occupied") return "warning";
    if (status === "normal" || status === "Released" || status === "available" || status === "selected") return "healthy";
    if (status === "checkpoint") return "focus";
    return "neutral";
  };
  const chooseRfidGate = (gateId: string) => {
    setSelectedRfidGate(gateId);
    setSubTab("rfid");
  };
  const chooseSector = (item: WarehouseSector) => {
    setSelectedZone(item.id);
    setSelectedStage(item.stage);
    setSubTab(item.racks.length ? "rack" : "sector");
  };
  const chooseRack = (item: WarehouseRack) => {
    setSelectedZone(item.zoneId);
    setSelectedRack(item.id);
    setSelectedStage("Storage");
    setSubTab("sku");
  };
  const chooseSku = (bin: WarehouseBin) => {
    setSelectedZone(bin.placement.zoneId);
    setSelectedRack(bin.rackId);
    setSelectedStockBalance(bin.placement.stockBalanceId);
    setSelectedStage(bin.placement.currentStage);
    setSubTab("sku");
  };
  const locateSelectedSku = async () => {
    if (!sku) return;
    await runTool("locate_sku", { stockBalanceId: sku.stockBalanceId });
    locateStockBalanceInWarehouse(sku.stockBalanceId);
  };
  const checkSelectedSkuImpact = () => {
    if (!sku) return;
    const shipmentId = sku.linkedShipmentId ?? shipment?.id ?? null;
    onAsk(
      shipmentId
        ? `Check FEFO and shipment impact for stock balance ${sku.stockBalanceId} against linked shipment ${shipmentId}. Explain the affected warehouse stages and any sequencing risk.`
        : `Check FEFO and warehouse impact for stock balance ${sku.stockBalanceId}. No linked shipment is selected, so do not assume one.`
    );
  };
  const openLinkedShipment = () => {
    const shipmentId = sku?.linkedShipmentId ?? shipment?.id ?? null;
    if (!shipmentId) return;
    openOutboundInLogistics(shipmentId);
  };
  const tabButton = (id: InspectorTab, label: string) => (
    <button
      className={clsx("rounded-lg px-2 py-2 text-xs font-semibold", subTab === id ? "bg-white/[0.08] text-twin-text" : "text-twin-muted hover:text-twin-text")}
      onClick={() => setSubTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="section-label">Inspector</div>
            <h3 className="mt-1 truncate text-lg font-semibold">{objectName}</h3>
            <div className="mt-1 text-xs text-twin-muted">{objectType} | Route: {route.state} | Stage: {affectedStages.join(" -> ")}</div>
          </div>
          <StatusChip tone={toneForStatus(objectStatus)}>{objectStatus}</StatusChip>
        </div>
        <div className="mt-4 grid grid-cols-6 rounded-xl border border-white/10 bg-twin-bg/40 p-1">
          {tabButton("sector", "Sector")}
          {tabButton("rack", "Rack")}
          {tabButton("sku", "SKU")}
          {tabButton("rfid", "RFID")}
          {tabButton("risks", "Risks")}
          {tabButton("actions", "Actions")}
        </div>
      </div>

      {subTab === "sector" && (
        <div className="mt-3 space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-twin-muted">Sector overview</div>
            <p className="mt-2 text-sm leading-relaxed text-twin-text">{sector ? `${sector.name} contains ${sector.racks.length || "no"} rack rows and is linked to ${sector.stage}.` : "Select a warehouse sector to begin drill-down."}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {warehouseSectors.filter((item) => ["RCV", "CI", "CS", "AM", "PH", "QA", "QT", "PK", "DS"].includes(item.id)).map((item) => (
              <button key={item.id} className={clsx("rounded-xl border p-2 text-left text-xs transition", sector?.id === item.id ? "border-twin-cyan/40 bg-twin-cyan/10" : "border-white/10 bg-white/[0.025] hover:text-twin-text")} onClick={() => chooseSector(item)}>
                <div className="font-semibold">{item.name}</div>
                <div className="mt-1 text-twin-muted">{item.racks.length ? `${item.racks.length} rack rows` : item.stage}</div>
              </button>
            ))}
          </div>
          {sector && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                <div className="text-[11px] text-twin-muted">Temperature</div>
                <div className="mt-1 font-semibold">{sectorMetrics.dataZone?.currentTemperature.toFixed(1) ?? "--"} C</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
                <div className="text-[11px] text-twin-muted">Risk count</div>
                <div className="mt-1 font-semibold">{sectorMetrics.riskCount}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === "rack" && (
        <div className="mt-3 space-y-3">
          {sector?.racks.length ? (
            <div className="grid grid-cols-2 gap-2">
              {sector.racks.map((rackId) => {
                const rackItem = getRack(rackId);
                const metrics = getRackMetrics(rackItem, bins);
                return rackItem ? (
                  <button key={rackItem.id} className={clsx("rounded-xl border p-3 text-left text-xs transition", rack?.id === rackItem.id ? "border-twin-cyan/40 bg-twin-cyan/10" : "border-white/10 bg-white/[0.025] hover:text-twin-text")} onClick={() => chooseRack(rackItem)}>
                    <div className="font-semibold">{rackDisplayLabel(rackItem.id)}</div>
                    <div className="mt-1 text-twin-muted">{metrics.occupancy}% occupied</div>
                  </button>
                ) : null;
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm text-twin-muted">Select Cold, Ambient, or Pharmaceutical Storage to inspect rack rows.</div>
          )}
          {rack && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{rackDisplayLabel(rack.id)}</span>
                <StatusChip tone={rackMetrics.qualityHoldCount ? "critical" : rackMetrics.expiryRiskCount ? "warning" : "healthy"}>{rackMetrics.occupancy}% occupied</StatusChip>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusChip tone={rackMetrics.expiryRiskCount ? "warning" : "healthy"}>{rackMetrics.expiryRiskCount} near expiry</StatusChip>
                <StatusChip tone={rackMetrics.qualityHoldCount ? "critical" : "healthy"}>{rackMetrics.qualityHoldCount} QA</StatusChip>
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === "sku" && (
        <div className="mt-3 space-y-2">
          {sku ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{stockDisplayCode(sku)}</span>
                  <StatusChip tone={toneForStatus(sku.qualityStatus)}>{sku.qualityStatus}</StatusChip>
                </div>
                <div className="mt-1 text-xs text-twin-muted">{sku.productName}</div>
                <div className="mt-1 font-mono text-[10px] text-twin-subtle">Stock balance {stockBalanceLabel(sku)}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <span className="font-mono">{wmsLocationLabel(sku)}</span>
                  <span>{sku.batchNo}</span>
                  <span className={isExpiryRisk(sku) ? "text-twin-warning" : "text-twin-green"}>{isExpiryRisk(sku) ? "Expiry within 7 days" : "No near-term expiry warning"}</span>
                  <span>{coldChainLabel(sku)}</span>
                  <span>{new Date(sku.expiryDate).toLocaleDateString()}</span>
                  <span>{sku.linkedShipmentId ?? "no shipment"}</span>
                </div>
              </div>
              <div className="rounded-2xl border border-twin-cyan/20 bg-twin-cyan/10 p-3 text-sm text-cyan-100">{recommendedActionForPlacement(sku)}</div>
              <div className="grid gap-2">
                <button className="flex w-full items-center gap-2 rounded-xl border border-twin-cyan/25 bg-twin-cyan/10 px-3 py-2.5 text-left text-sm font-semibold text-cyan-100 hover:border-twin-cyan/50" onClick={() => void locateSelectedSku()}>
                  <PackageSearch size={16} />
                  Locate in Warehouse
                </button>
                <button className="flex w-full items-center gap-2 rounded-xl border border-twin-orange/25 bg-twin-orange/10 px-3 py-2.5 text-left text-sm font-semibold text-orange-100 hover:border-twin-orange/50" onClick={checkSelectedSkuImpact}>
                  <ClipboardList size={16} />
                  Check Impact
                </button>
                <button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-left text-sm text-twin-text hover:border-twin-blue/50 hover:bg-twin-blue/5 disabled:opacity-40" disabled={!sku.linkedShipmentId && !shipment?.id} onClick={openLinkedShipment}>
                  <ChevronRight size={16} className="text-twin-muted" />
                  Open Shipment
                </button>
                <button className="flex w-full items-center gap-2 rounded-xl bg-twin-orange px-3 py-2.5 text-left text-sm font-semibold text-white" onClick={() => onAsk(`Check FEFO, quality, shipment, and warehouse risks for ${sku.stockBalanceId}.`)}>
                  <Sparkles size={16} />
                  Ask Assistant
                </button>
              </div>
            </div>
          ) : inventoryMode ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm leading-relaxed text-twin-muted">Select an inventory row to inspect FEFO status, quality state, shipment linkage, and warehouse location.</div>
          ) : rackMetrics.bins.length ? (
            rackMetrics.bins.map((bin) => (
              <button key={bin.id} className="w-full rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-left hover:border-twin-blue/50 hover:bg-twin-blue/5" onClick={() => chooseSku(bin)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold">{stockDisplayCode(bin.placement)}</span><span className="block truncate font-mono text-[10px] text-twin-muted">{wmsLocationLabel(bin.placement)} · {stockBalanceLabel(bin.placement)}</span></span>
                  <StatusChip tone={toneForStatus(bin.placement.qualityStatus)}>{bin.placement.qualityStatus}</StatusChip>
                </div>
                <div className="mt-1 text-xs text-twin-muted">{bin.placement.productName}</div>
              </button>
            ))
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm text-twin-muted">Select a rack to list bins and SKUs.</div>
          )}
        </div>
      )}

      {subTab === "rfid" && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2">
            {rfidCheckpoints.map((checkpoint) => (
              <button key={checkpoint.id} className={clsx("rounded-xl border p-3 text-left text-xs transition", selectedRfidGate?.id === checkpoint.id ? "border-twin-cyan/40 bg-twin-cyan/10" : "border-white/10 bg-white/[0.025] hover:text-twin-text")} onClick={() => chooseRfidGate(checkpoint.id)}>
                <div className="font-semibold">{checkpoint.name}</div>
                <div className="mt-1 text-twin-muted">Stage: {checkpoint.stage}</div>
              </button>
            ))}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-twin-muted">Checkpoint detail</div>
            {selectedRfidGate ? (
              <div className="mt-2 space-y-2 text-sm leading-relaxed text-twin-text">
                <div><span className="text-twin-muted">Name:</span> {selectedRfidGate.name}</div>
                <div><span className="text-twin-muted">Stage:</span> {selectedRfidGate.stage}</div>
                <div><span className="text-twin-muted">Purpose:</span> {selectedRfidGate.purpose}</div>
                <div className="rounded-xl border border-twin-cyan/20 bg-twin-cyan/10 p-3 text-xs text-cyan-100">RFID checkpoint</div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-twin-muted">Select one of the three material-flow RFID checkpoints.</p>
            )}
          </div>
          {selectedRfidGate && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-twin-muted">Related scan context</div>
              {checkpointScans.length ? (
                <div className="mt-2 space-y-2">
                  {checkpointScans.map((event) => (
                    <div key={`${selectedRfidGate.id}-${event.id}`} className="rounded-xl border border-white/10 bg-twin-bg/40 p-2 text-xs">
                      <div className="font-semibold">{event.skuId} / {event.action}</div>
                      <div className="mt-1 text-twin-muted">{event.zoneId} / {new Date(event.timestamp).toLocaleTimeString()}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-twin-muted">No recent scans.</p>
              )}
            </div>
          )}
        </div>
      )}

      {subTab === "risks" && (
        <div className="mt-3 space-y-2">
          {[
            ["Quality", sku?.qualityStatus ?? `${sectorMetrics.qaCount} non-released SKUs`, sku?.qualityStatus === "QA Hold" || sku?.qualityStatus === "Quarantine" || sectorMetrics.qaCount ? "critical" : "healthy"],
            ["Expiry", sku ? (isExpiryRisk(sku) ? "Expiry within 7 days" : "No near-term expiry issue") : `${sectorMetrics.expiryRiskCount} near-expiry positions`, sku ? (isExpiryRisk(sku) ? "warning" : "healthy") : sectorMetrics.expiryRiskCount ? "warning" : "healthy"],
            ["Cold-chain", sku ? coldChainLabel(sku) : sector?.temperatureRange ?? "not selected", sku?.temperatureMin && sku.temperatureMin <= 8 ? "focus" : "neutral"],
            ["Internal route", route.message, route.state === "blocked" ? "critical" : route.state === "selected" ? "focus" : "healthy"],
            ["Dock", dock?.id ?? "not selected", dock?.status === "available" ? "healthy" : dock ? "warning" : "neutral"]
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">{label}</span>
                <StatusChip tone={tone as "neutral" | "healthy" | "warning" | "critical" | "focus"}>{value}</StatusChip>
              </div>
            </div>
          ))}
        </div>
      )}

      {subTab === "actions" && (
        <div className="mt-3 space-y-2">
          <button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-left text-sm text-twin-text hover:border-twin-blue/50 hover:bg-twin-blue/5" onClick={() => {
            if (sku) openStockBalanceInInventory(sku.stockBalanceId);
            else { setInventoryWorkspace("stock"); setView("Inventory"); }
          }}>
            <PackageSearch size={16} className="text-twin-cyan" />
            Open inventory row
          </button>
          <button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-left text-sm text-twin-text hover:border-twin-blue/50 hover:bg-twin-blue/5" onClick={() => onAsk(`Check FEFO impact for ${sku?.stockBalanceId ?? rack?.id ?? sector?.name ?? "selected warehouse area"}.`)}>
            <ClipboardList size={16} className="text-twin-warning" />
            Check FEFO impact
          </button>
          <button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-left text-sm text-twin-text hover:border-twin-blue/50 hover:bg-twin-blue/5" onClick={() => onAsk(`Check cold-chain status for ${sector?.name ?? "Cold Storage"}.`)}>
            <ShieldQuestion size={16} className="text-twin-cyan" />
            Check cold-chain status
          </button>
          <button className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-left text-sm text-twin-text hover:border-twin-blue/50 hover:bg-twin-blue/5" onClick={() => {
            if (shipment) openOutboundInLogistics(shipment.id);
            else { setLogisticsWorkspace("outbound"); setView("Logistics"); }
          }}>
            <ChevronRight size={16} className="text-twin-muted" />
            View Shipment
          </button>
          <button className="flex w-full items-center gap-2 rounded-xl bg-twin-orange px-3 py-2.5 text-left text-sm font-semibold text-white" onClick={() => onAsk(`Check prioritising ${shipment?.id ?? sku?.linkedShipmentId ?? "SHIP-001"} and show FEFO, dock, cold-chain, and internal route impact.`)}>
            <Sparkles size={16} />
            Check Reprioritisation
          </button>
        </div>
      )}
    </div>
  );
}

export default function ChatPanel() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [analysisPriority, setAnalysisPriority] = useState<AnalysisPriority>("balanced");
  const view = useAppStore((state) => state.view);
  const inspectorMode = view === "Warehouse" || view === "Inventory";
  const warehouseMode = view === "Warehouse";
  const inventoryMode = view === "Inventory";
  const forceChatTab = useAppStore((state) => state.forceChatTab);
  const [tab, setTab] = useState<ChatTab>(() => {
    if (useAppStore.getState().forceChatTab) return "chat";
    return inventoryMode ? "inspector" : "chat";
  });
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null);
  const messages = useAppStore((state) => state.messages);
  const assistantQueryRequest = useAppStore((state) => state.assistantQueryRequest);
  const snapshot = useAppStore((state) => state.snapshot);
  const addMessage = useAppStore((state) => state.addMessage);
  const updateMessage = useAppStore((state) => state.updateMessage);
  const setChatOpen = useAppStore((state) => state.setChatOpen);
  const clearAssistantQueryRequest = useAppStore((state) => state.clearAssistantQueryRequest);
  const setHighlightFromResponse = useAppStore((state) => state.setHighlightFromResponse);

  useEffect(() => {
    if (forceChatTab) {
      setTab("chat");
      useAppStore.setState({ forceChatTab: false });
      return;
    }
    if (inventoryMode) {
      setTab("inspector");
      return;
    }
    setTab((current) => (current === "inspector" ? "chat" : current));
  }, [inventoryMode, view, forceChatTab]);

  const conversationMessages = messages.filter((message) => message.role !== "autonomous");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const consumedAssistantQueryRequestIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (tab === "chat" && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [tab, conversationMessages.length, conversationMessages.at(-1)?.content]);

  const latestResponseMessage = [...messages].reverse().find((message) => message.response);
  const selectedResponse =
    messages.find((message) => message.response?.decisionId === selectedDecisionId)?.response ??
    latestResponseMessage?.response ??
    null;

  const sendQuery = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setTab("chat");
    setQuery("");
    const userMessage: ChatMessage = {
      id: `USER-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString()
    };
    const assistantId = `AI-${Date.now()}`;
    const startedAt = Date.now();
    addMessage(userMessage);
    addMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      streaming: true
    });

    try {
      await streamChat(
        trimmed,
        (token) => {
          useAppStore.setState((state) => ({
            messages: state.messages.map((message) =>
              message.id === assistantId ? { ...message, content: `${message.content}${token}` } : message
            )
          }));
        },
        async (response) => {
          updateMessage(assistantId, {
            content: response.agentResponse.summary,
            response,
            streaming: false,
            elapsedMs: Date.now() - startedAt
          });
          setSelectedDecisionId(response.decisionId);
          setHighlightFromResponse(response);
          useAppStore.getState().setSnapshot(await getWarehouse());
        },
        (event: AgentProgressEvent) => {
          useAppStore.setState((state) => ({
            messages: state.messages.map((message) =>
              message.id === assistantId
                ? { ...message, activeAgents: [...new Set([...(message.activeAgents ?? []), ...event.agents])] }
                : message
            )
          }));
        },
        analysisPriority,
        currentAssistantUiContext()
      );
    } catch (error) {
      updateMessage(assistantId, {
            content: "Assistant unavailable; workspace remains active.",
        streaming: false
      });
    } finally {
      setBusy(false);
    }
  }, [addMessage, analysisPriority, busy, setHighlightFromResponse, updateMessage]);

  useEffect(() => {
    if (
      !assistantQueryRequest ||
      busy ||
      consumedAssistantQueryRequestIdRef.current === assistantQueryRequest.id
    ) return;
    consumedAssistantQueryRequestIdRef.current = assistantQueryRequest.id;
    clearAssistantQueryRequest(assistantQueryRequest.id);
    void sendQuery(assistantQueryRequest.text);
  }, [assistantQueryRequest, busy, clearAssistantQueryRequest, sendQuery]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendQuery(query);
  };

  return (
    <aside className="panel flex h-[100dvh] w-full shrink-0 flex-col border-t border-white/10 lg:h-auto lg:w-[410px] lg:border-l lg:border-t-0">
      <div className="border-b border-white/[0.075] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="section-label">Assistant</div>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Sparkles size={18} className="text-twin-orange" />
              {warehouseMode ? "Warehouse Inspector" : inventoryMode ? "Inventory Inspector" : "Assistant"}
            </h2>
          </div>
          <button className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-twin-muted hover:text-twin-text" onClick={() => setChatOpen(false)} aria-label="Collapse chat">
            <PanelRightClose size={16} />
          </button>
        </div>
        <div className={clsx("mt-4 grid rounded-2xl border border-white/10 bg-twin-bg/40 p-1", inspectorMode ? "grid-cols-3" : "grid-cols-2")}>
          {inspectorMode && <TabButton active={tab === "inspector"} onClick={() => setTab("inspector")}>Inspector</TabButton>}
          <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>Chat</TabButton>
          <TabButton active={tab === "evidence"} onClick={() => setTab("evidence")}>Evidence</TabButton>
        </div>
      </div>

      {inspectorMode && tab === "inspector" && <OperationalInspector onAsk={(text) => void sendQuery(text)} />}

      {tab === "chat" && (
        <>
          <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            {conversationMessages.length === 0 ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-twin-cyan/25 bg-twin-cyan/[0.06] p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-twin-cyan/20 text-twin-cyan">
                      <Sparkles size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-twin-text">{assistantIntroduction.name}</div>
                      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-twin-blue">
                        {assistantIntroduction.role}
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-twin-text">{assistantIntroduction.description}</p>
                  <p className="mt-2 text-[11px] leading-relaxed text-twin-muted">{assistantIntroduction.priority}</p>
                  <div className="mt-4 text-[10px] font-bold uppercase tracking-wide text-twin-muted">Try asking</div>
                  <button
                    className="mt-2 flex w-full items-center justify-between gap-2 rounded-xl border border-twin-cyan/25 bg-twin-bg/40 px-3 py-3 text-left text-xs leading-relaxed text-twin-text transition hover:border-twin-blue/60 hover:bg-twin-blue/10"
                    onClick={() => void sendQuery(examples[0])}
                  >
                    <span>{examples[0]}</span>
                    <ChevronRight size={13} className="shrink-0 text-twin-cyan" />
                  </button>
                </div>
                <details className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-xs text-twin-muted">
                  <summary className="cursor-pointer font-semibold text-twin-text">More example questions</summary>
                  <div className="mt-3 space-y-2">
                    {examples.slice(1).map((example) => (
                      <button
                        key={example}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-left text-xs leading-relaxed text-twin-muted transition hover:border-twin-blue/50 hover:bg-twin-blue/5 hover:text-twin-text"
                        onClick={() => void sendQuery(example)}
                      >
                        <span>{example}</span>
                        <ChevronRight size={13} />
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            ) : (
              <div className="space-y-3">
                <details className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 text-xs text-twin-muted">
                  <summary className="cursor-pointer font-semibold text-twin-text">Example queries</summary>
                  <div className="mt-3 space-y-2">
                    {examples.map((example) => (
                      <button
                        key={example}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-twin-bg/40 px-3 py-2 text-left text-xs text-twin-muted hover:text-twin-text"
                        onClick={() => void sendQuery(example)}
                      >
                        <span>{example}</span>
                        <ChevronRight size={13} />
                      </button>
                    ))}
                  </div>
                </details>
                {conversationMessages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    onInspect={(decisionId) => {
                      setSelectedDecisionId(decisionId);
                      setTab("evidence");
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <form className="border-t border-white/[0.075] p-3" onSubmit={onSubmit}>
            <div className="mb-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-twin-muted">
                <SlidersHorizontal size={11} /> Analysis priority
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-twin-bg/40 p-1">
                {priorityOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={clsx(
                      "rounded-lg px-2 py-1.5 text-[10px] font-semibold transition",
                      analysisPriority === option.value
                        ? "bg-twin-cyan/20 text-twin-cyan ring-1 ring-twin-cyan/30"
                        : "text-twin-muted hover:bg-white/[0.04] hover:text-twin-text"
                    )}
                    aria-pressed={analysisPriority === option.value}
                    title={option.description}
                    onClick={() => setAnalysisPriority(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-twin-muted">
                {priorityDisplay(analysisPriority).description} Safety and QA controls always remain mandatory.
              </p>
            </div>
            <div className="flex gap-2">
              <textarea
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                rows={2}
                className="min-h-[48px] flex-1 resize-none rounded-xl border border-white/10 bg-twin-surface/90 px-3 py-2 text-sm leading-relaxed outline-none transition focus:border-twin-orange/70"
                placeholder="Ask TwinOps Control..."
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendQuery(query);
                  }
                }}
              />
              <button className="flex w-12 items-center justify-center rounded-xl bg-twin-orange text-white disabled:opacity-50" disabled={busy || !query.trim()} aria-label="Send query">
                <Send size={18} />
              </button>
            </div>
          </form>
        </>
      )}

      {tab === "evidence" && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {selectedResponse ? (
            <>
              <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <div className="flex flex-wrap gap-1.5">
                  {selectedResponse.agentsUsed.map((agent) => (
                    <StatusChip key={agent} tone="focus" className="normal-case tracking-normal">{agent}</StatusChip>
                  ))}
                  <StatusChip tone={confidenceTone(selectedResponse.confidence)}>{selectedResponse.confidence}% confidence</StatusChip>
                  <StatusChip tone={toneForRisk(selectedResponse.riskLevel)}>{selectedResponse.riskLevel} risk</StatusChip>
                  <StatusChip tone={agentStatusTone(selectedResponse.agentResponse.status)}>{selectedResponse.agentResponse.status.replace("_", " ")}</StatusChip>
                  <StatusChip tone="focus">read-only analysis</StatusChip>
                </div>
              </div>
              <ToolLog response={selectedResponse} />
              <Evidence response={selectedResponse} />
            </>
          ) : (
            <div className="mt-16 text-center text-sm text-twin-muted">Ask a question to generate tool logs and answer evidence.</div>
          )}
        </div>
      )}
    </aside>
  );
}
