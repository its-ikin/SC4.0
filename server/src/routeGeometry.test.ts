import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateRouteGeometry } from "./routeGeometry";

describe("route geometry validation", () => {
  const origin = { lat: 1.3338, lng: 103.7466 };
  const destination = { lat: 1.3119, lng: 103.7165 };

  it("accepts a plausible road geometry that joins the requested endpoints", () => {
    const result = validateRouteGeometry({
      origin,
      destination,
      polyline: [origin, { lat: 1.326, lng: 103.735 }, destination],
      reportedDistanceKm: 4.8
    });
    assert.equal(result.valid, true);
  });

  it("rejects the stale ORS geometry that never reaches the warehouse", () => {
    const result = validateRouteGeometry({
      origin,
      destination,
      polyline: [
        { lat: 1.33322, lng: 103.748836 },
        { lat: 1.334858, lng: 103.743533 }
      ],
      reportedDistanceKm: 1.8
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /destination|shorter/);
  });
});
