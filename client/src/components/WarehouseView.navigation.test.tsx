import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WarehouseView from "./WarehouseView";
import { useAppStore } from "../store";
import { makeNavigationSnapshot } from "../test/navigationFixture";

vi.mock("./WarehouseModelView", () => ({
  default: () => <div data-testid="warehouse-model" />
}));

const initialState = useAppStore.getInitialState();

describe("Warehouse workspace navigation", () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
    useAppStore.getState().setSnapshot(makeNavigationSnapshot());
  });

  it("offers only Facility, Storage locations, and Dock schedule", () => {
    render(<WarehouseView />);

    const navigation = screen.getByRole("navigation", { name: "Warehouse workspace" });
    const metrics = screen.getByRole("region", { name: "Warehouse management metrics" });
    expect(navigation.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(navigation).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Facility",
      "Storage locations",
      "Dock schedule"
    ]);
    for (const rejectedLens of ["Overview", "Cold Chain", "Dock Flow", "Quality", "FEFO"]) {
      expect(within(navigation).queryByRole("button", { name: rejectedLens })).not.toBeInTheDocument();
    }
  });

  it("opens the Warehouse-owned dock board and round-trips an inbound appointment to Logistics", async () => {
    const user = userEvent.setup();
    render(<WarehouseView />);

    await user.click(screen.getByRole("button", { name: "Dock schedule" }));
    expect(useAppStore.getState().warehouseWorkspace).toBe("docks");
    expect(screen.getByRole("heading", { name: "Dock schedule and physical readiness" })).toBeInTheDocument();

    await user.click(screen.getByText("ASN-IN").closest("button")!);
    expect(useAppStore.getState()).toMatchObject({
      selectedDockAppointmentId: "APPT-IN",
      selectedDockId: "D-01",
      selectedInboundAsnId: "ASN-IN"
    });

    await user.click(screen.getByRole("button", { name: "Open flow" }));
    expect(useAppStore.getState()).toMatchObject({
      view: "Logistics",
      logisticsWorkspace: "inbound",
      selectedInboundAsnId: "ASN-IN"
    });
  });

  it("shows canonical conflicts and reveals completed and cancelled appointments in history", async () => {
    const user = userEvent.setup();
    const snapshot = makeNavigationSnapshot();
    snapshot.dockAppointments[0] = { ...snapshot.dockAppointments[0], status: "completed" };
    snapshot.dockAppointments[1] = { ...snapshot.dockAppointments[1], status: "cancelled" };
    snapshot.dockAppointments.push({
      ...snapshot.dockAppointments[0],
      dockAppointmentId: "APPT-CONFLICT",
      referenceId: "ASN-CONFLICT",
      status: "booked",
      conflictFlag: true
    });
    useAppStore.getState().setSnapshot(snapshot);
    render(<WarehouseView />);

    await user.click(screen.getByRole("button", { name: "Dock schedule" }));
    expect(screen.getByText("APPT-CONFLICT")).toBeInTheDocument();
    expect(screen.getByText("Appointment conflict")).toBeInTheDocument();
    expect(screen.queryByText("APPT-IN")).not.toBeInTheDocument();
    expect(screen.queryByText("APPT-OUT")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Include history" }));
    expect(screen.getByText("APPT-IN")).toBeInTheDocument();
    expect(screen.getByText("APPT-OUT")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});
