import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MonitoringView from "./MonitoringView";
import { useAppStore } from "../store";
import { makeNavigationSnapshot } from "../test/navigationFixture";

const initialState = useAppStore.getInitialState();

describe("Monitoring RFID feed", () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
    const snapshot = makeNavigationSnapshot();
    snapshot.rfidEvents = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      skuId: `STK-RFID-${index + 1}`,
      zoneId: index % 2 ? "PH" : "CS",
      action: index % 2 ? "MOVE" : "IN",
      timestamp: new Date(Date.UTC(2026, 6, 18, 10, 0, index)).toISOString(),
      severity: "info"
    }));
    useAppStore.getState().setSnapshot(snapshot);
  });

  it("shows four complete latest events and expands without a nested scrollbar", async () => {
    const user = userEvent.setup();
    render(<MonitoringView />);

    const feed = screen.getByRole("list", { name: "RFID event feed" });
    expect(feed).not.toHaveClass("max-h-64", "overflow-y-auto", "overflow-auto");
    expect(within(feed).getAllByRole("listitem")).toHaveLength(4);
    for (const row of within(feed).getAllByRole("listitem")) {
      expect(row).toHaveClass("min-h-[66px]");
    }

    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(within(feed).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Latest 4" })).toBeInTheDocument();
  });
});
