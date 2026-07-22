import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantUiContext } from "@twinops/shared";
import { sanitizeAssistantUiContext } from "./assistantUiContext";
import { fallbackRoutingQuery } from "./orchestrator";

function context(overrides: Partial<AssistantUiContext> = {}): AssistantUiContext {
  return {
    activeView: "Logistics",
    activeWorkspace: "outbound",
    focusType: "shipment",
    selected: { shipmentId: "SHIP-007" },
    filters: {
      inventoryQuickFilter: "Attention Required",
      logisticsRouteFilter: "delayed",
      logisticsDirectionFilter: "inbound"
    },
    ...overrides
  };
}

test("assistant UI context accepts only workspaces owned by the active view", () => {
  assert.equal(sanitizeAssistantUiContext(context({ activeView: "Warehouse", activeWorkspace: "docks" }))?.activeWorkspace, "docks");
  assert.equal(sanitizeAssistantUiContext(context({ activeView: "Inventory", activeWorkspace: "movements" }))?.activeWorkspace, "movements");
  assert.equal(sanitizeAssistantUiContext(context({ activeView: "Logistics", activeWorkspace: "inbound" }))?.activeWorkspace, "inbound");
  assert.equal(sanitizeAssistantUiContext(context({ activeView: "Warehouse", activeWorkspace: "inbound" }))?.activeWorkspace, null);
  assert.equal(sanitizeAssistantUiContext(context({ activeView: "Dashboard", activeWorkspace: "network" }))?.activeWorkspace, null);
});

test("assistant UI context recognises dock appointment focus and rejects malformed appointment IDs", () => {
  const valid = sanitizeAssistantUiContext(context({
    activeView: "Warehouse",
    activeWorkspace: "docks",
    focusType: "dock_appointment",
    selected: { dockAppointmentId: "APT-IN-1001", dockId: "D2" }
  }));
  assert.equal(valid?.focusType, "dock_appointment");
  assert.equal(valid?.selected.dockAppointmentId, "APT-IN-1001");

  const malformed = sanitizeAssistantUiContext(context({ selected: { dockAppointmentId: "not a valid id" } }));
  assert.equal(malformed?.selected.dockAppointmentId, undefined);
  const oversized = sanitizeAssistantUiContext(context({ selected: { dockAppointmentId: `APT-${"X".repeat(200)}` } }));
  assert.equal(oversized?.selected.dockAppointmentId, undefined);
});

test("deterministic fallback routing supplements only one selected identifier for deictic queries", () => {
  const uiContext = context();
  assert.equal(fallbackRoutingQuery("Check this shipment", uiContext), "Check this shipment SHIP-007");
  assert.equal(fallbackRoutingQuery("Give me an overview", uiContext), "Give me an overview");
  assert.equal(fallbackRoutingQuery("Check this shipment", context({ selected: { shipmentId: "SHIP 007; delayed" } })), "Check this shipment");
  assert.ok(!fallbackRoutingQuery("Check this shipment", uiContext).includes("Attention Required"));
  assert.ok(!fallbackRoutingQuery("Check this shipment", uiContext).includes("inbound"));
});
