import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useAppStore } from "./store";
import { makeNavigationSnapshot } from "./test/navigationFixture";

const mocks = vi.hoisted(() => ({
  getWarehouse: vi.fn(),
  io: vi.fn()
}));

vi.mock("./api", () => ({ getWarehouse: mocks.getWarehouse }));
vi.mock("socket.io-client", () => ({ io: mocks.io }));
vi.mock("./components/Sidebar", () => ({ default: () => <aside>Sidebar</aside> }));
vi.mock("./components/DashboardView", () => ({ default: () => <div>Dashboard</div> }));
vi.mock("./components/WarehouseView", () => ({ default: () => <div>Warehouse</div> }));
vi.mock("./components/InventoryControlView", () => ({ default: () => <div>Inventory</div> }));
vi.mock("./components/LogisticsView", () => ({ default: () => <div>Logistics</div> }));
vi.mock("./components/MonitoringView", () => ({ default: () => <div>Monitoring</div> }));
vi.mock("./components/AuditView", () => ({ default: () => <div>Audit</div> }));
vi.mock("./components/OperationalAlertsPanel", () => ({ default: () => <div>Alerts</div> }));
vi.mock("./components/ChatPanel", () => ({ default: () => <div>Chat</div> }));
vi.mock("./components/ToastStack", () => ({ default: () => <div>Toasts</div> }));

const initialState = useAppStore.getInitialState();

describe("App real-time snapshot contract", () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
    mocks.getWarehouse.mockReset();
    mocks.io.mockReset();
  });

  it("keeps the four established event names and replaces the complete snapshot after a state update", async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const socket = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
        return socket;
      }),
      disconnect: vi.fn()
    };
    mocks.io.mockReturnValue(socket);

    const initialSnapshot = makeNavigationSnapshot();
    const refreshedSnapshot = makeNavigationSnapshot();
    refreshedSnapshot.kpis.activeShipments = 99;
    mocks.getWarehouse.mockResolvedValueOnce(initialSnapshot).mockResolvedValueOnce(refreshedSnapshot);

    const rendered = render(<App />);

    await waitFor(() => expect(useAppStore.getState().snapshot).toBe(initialSnapshot));
    expect([...handlers.keys()]).toEqual([
      "temperature:update",
      "iot:rfid_scan",
      "alert:new",
      "dashboard:state_update"
    ]);

    act(() => {
      handlers.get("dashboard:state_update")!();
    });

    await waitFor(() => expect(useAppStore.getState().snapshot).toBe(refreshedSnapshot));
    expect(mocks.getWarehouse).toHaveBeenCalledTimes(2);

    rendered.unmount();
    expect(socket.disconnect).toHaveBeenCalledOnce();
  });
});
