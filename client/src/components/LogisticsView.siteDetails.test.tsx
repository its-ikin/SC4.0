import type { PropsWithChildren } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "../store";
import { makeNavigationSnapshot } from "../test/navigationFixture";

vi.mock("react-leaflet", () => {
  const mapContainer = document.createElement("div");
  const map = {
    fitBounds: vi.fn(),
    getContainer: () => mapContainer,
    invalidateSize: vi.fn()
  };
  return {
    MapContainer: ({ children }: PropsWithChildren) => <div data-testid="network-map">{children}</div>,
    Marker: ({ children, eventHandlers }: PropsWithChildren<{ eventHandlers?: { click?: () => void } }>) => (
      <div data-testid="map-marker" onClick={eventHandlers?.click}>{children}</div>
    ),
    Polyline: () => null,
    Popup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    TileLayer: () => null,
    useMap: () => map
  };
});

import LogisticsView from "./LogisticsView";

const initialState = useAppStore.getInitialState();

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterAll(() => vi.unstubAllGlobals());

describe("Logistics site details", () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
    useAppStore.getState().setSnapshot(makeNavigationSnapshot());
    useAppStore.getState().setLogisticsWorkspace("network");
  });

  it("opens the supplier popup first and waits for View details before opening the site panel", async () => {
    const user = userEvent.setup();
    render(<LogisticsView />);

    const supplierName = screen.getByText("Supplier", { selector: "strong" });
    const supplierMarker = supplierName.closest('[data-testid="map-marker"]') as HTMLElement | null;
    expect(supplierMarker).not.toBeNull();

    await user.click(supplierMarker!);
    expect(useAppStore.getState().selectedPartnerSiteId).toBeNull();
    expect(screen.queryByText("Operating window")).not.toBeInTheDocument();

    await user.click(within(supplierMarker!).getByRole("button", { name: "View details" }));
    expect(useAppStore.getState().selectedPartnerSiteId).toBe("SUPPLIER");
    expect(screen.getByText("Operating window")).toBeInTheDocument();
  });
});
