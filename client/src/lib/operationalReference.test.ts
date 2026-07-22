import { describe, expect, it } from "vitest";
import { makeNavigationSnapshot } from "../test/navigationFixture";
import { resolveOperationalReference } from "./operationalReference";

describe("resolveOperationalReference", () => {
  it("resolves a dock appointment before its related dock and directional flow", () => {
    expect(resolveOperationalReference(makeNavigationSnapshot(), ["APPT-IN", "D-02", "SHIP-OUT"])).toEqual({
      kind: "dock_appointment",
      id: "APPT-IN",
      dockId: "D-01",
      transportLegId: "LEG-IN",
      asnId: "ASN-IN",
      shipmentId: null
    });
  });

  it("normalises a compatibility route ID to the canonical route ID", () => {
    expect(resolveOperationalReference(makeNavigationSnapshot(), ["LEGACY-ROUTE-OUT"])).toEqual({
      kind: "route",
      id: "ROUTE-OUT"
    });
  });
});
