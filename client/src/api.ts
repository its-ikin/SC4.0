import type { AgentName, AnalysisPriority, AssistantUiContext, InboundRoute, LatLng, OrchestratorResponse, SimulateRequest, WarehouseSnapshot } from "@twinops/shared";

const API_BASE = import.meta.env.VITE_API_URL || "";

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export type LiveWeather = {
  source: "open-meteo";
  fetchedAt: string;
  temperatureC: number;
  precipitationMm: number;
  windSpeedKph: number;
  weatherCode: number;
  condition: string;
  isActiveDisruption: boolean;
} | null;

export const getWarehouse = () => fetchJson<WarehouseSnapshot>("/api/warehouse");
export const getWeather = () => fetchJson<{ location: string; weather: LiveWeather }>("/api/weather");
export const getRoutes = () => fetchJson<InboundRoute[]>("/api/routes");
export const refreshRoutes = () => fetchJson<InboundRoute[]>("/api/routes/refresh", { method: "POST" });

export async function computeRoute(routeId: string, origin?: LatLng, destination?: LatLng) {
  return fetchJson<InboundRoute>("/api/routes/compute", {
    method: "POST",
    body: JSON.stringify({ routeId, origin, destination })
  });
}

export async function runTool<T>(toolName: string, input: Record<string, unknown>) {
  return fetchJson<T>(`/api/tools/${toolName}`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function simulate<T>(request: SimulateRequest) {
  return fetchJson<T>("/api/simulate", {
    method: "POST",
    body: JSON.stringify(request)
  });
}

export type AgentProgressEvent = { toolName: string; agents: AgentName[] };

export async function streamChat(
  query: string,
  onToken: (token: string) => void,
  onFinal: (response: OrchestratorResponse) => void,
  onAgent?: (event: AgentProgressEvent) => void,
  analysisPriority: AnalysisPriority = "balanced",
  uiContext?: AssistantUiContext
) {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, conversationHistory: [], analysisPriority, uiContext })
  });
  if (!response.ok || !response.body) throw new Error("Chat stream failed.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const event = part.match(/^event: (.+)$/m)?.[1];
      const data = part.match(/^data: (.+)$/m)?.[1];
      if (!event || !data) continue;
      if (event === "token") onToken(JSON.parse(data) as string);
      if (event === "agent") onAgent?.(JSON.parse(data) as AgentProgressEvent);
      if (event === "final") onFinal(JSON.parse(data) as OrchestratorResponse);
      if (event === "error") throw new Error((JSON.parse(data) as { message: string }).message);
    }
  }
}
