import { useEffect } from "react";
import { io } from "socket.io-client";
import type { Alert, RfidEvent, TemperatureReading } from "@twinops/shared";
import { getWarehouse } from "./api";
import { useAppStore } from "./store";
import Sidebar from "./components/Sidebar";
import DashboardView from "./components/DashboardView";
import WarehouseView from "./components/WarehouseView";
import InventoryView from "./components/InventoryControlView";
import LogisticsView from "./components/LogisticsView";
import MonitoringView from "./components/MonitoringView";
import AuditView from "./components/AuditView";
import OperationalAlertsPanel from "./components/OperationalAlertsPanel";
import ChatPanel from "./components/ChatPanel";
import ToastStack from "./components/ToastStack";

function MainView() {
  const view = useAppStore((state) => state.view);
  if (view === "Dashboard") return <DashboardView />;
  if (view === "Inventory") return <InventoryView />;
  if (view === "Logistics") return <LogisticsView />;
  if (view === "Monitoring") return <MonitoringView />;
  if (view === "Audit") return <AuditView />;
  if (view === "Alerts") return <OperationalAlertsPanel />;
  return <WarehouseView />;
}

export default function App() {
  const view = useAppStore((state) => state.view);
  const setSnapshot = useAppStore((state) => state.setSnapshot);
  const snapshot = useAppStore((state) => state.snapshot);
  const chatOpen = useAppStore((state) => state.chatOpen);
  const addRfidEvent = useAppStore((state) => state.addRfidEvent);
  const pushToast = useAppStore((state) => state.pushToast);

  useEffect(() => {
    getWarehouse().then(setSnapshot).catch(console.error);
    const API_BASE = import.meta.env.VITE_API_URL || "";
    const socket = io(API_BASE);
    socket.on("temperature:update", (event: Omit<TemperatureReading, "id" | "temperature"> & { temp: number }) => {
      useAppStore.setState((state) => {
        if (!state.snapshot) return state;
        return {
          snapshot: {
            ...state.snapshot,
            zones: state.snapshot.zones.map((zone) =>
              zone.id === event.zoneId
                ? {
                    ...zone,
                    currentTemperature: event.temp,
                    status: event.withinBand ? "normal" : "critical"
                  }
                : zone
            ),
            temperatureReadings: [
              ...state.snapshot.temperatureReadings.slice(-519),
              {
                id: Date.now(),
                zoneId: event.zoneId,
                temperature: event.temp,
                timestamp: event.timestamp,
                withinBand: event.withinBand,
                allowedMin: event.allowedMin,
                allowedMax: event.allowedMax,
                sensorId: event.sensorId,
                relatedSkuIds: event.relatedSkuIds,
                relatedBatchIds: event.relatedBatchIds
              }
            ]
          }
        };
      });
    });
    socket.on("iot:rfid_scan", (event: RfidEvent) => addRfidEvent(event));
    socket.on("alert:new", (alert: Alert) => pushToast(alert));
    socket.on("dashboard:state_update", () => {
      getWarehouse().then(setSnapshot).catch(console.error);
    });
    return () => {
      socket.disconnect();
    };
  }, [addRfidEvent, pushToast, setSnapshot]);

  return (
    <div className="flex min-h-screen flex-col overflow-auto bg-twin-bg text-twin-text lg:h-screen lg:overflow-hidden lg:flex-row">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main className={`min-h-[560px] flex-1 overflow-auto px-4 py-4 lg:min-h-0 lg:px-5 ${view === "Warehouse" || view === "Dashboard" || view === "Inventory" ? "lg:overflow-auto" : "lg:overflow-hidden"}`}>
          {snapshot ? <MainView /> : <div className="panel flex h-full items-center justify-center rounded-2xl text-twin-muted">Loading warehouse state...</div>}
        </main>
      </div>
      {chatOpen && <ChatPanel />}
      <ToastStack />
    </div>
  );
}
