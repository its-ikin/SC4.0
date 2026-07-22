import type { LatLng } from "@twinops/shared";

const EARTH_RADIUS_KM = 6371;
const ENDPOINT_TOLERANCE_KM = 1.5;

export type RouteGeometryValidation = {
  valid: boolean;
  reason: string | null;
  straightLineKm: number;
  geometryDistanceKm: number;
  startGapKm: number;
  endGapKm: number;
};

function isCoordinate(point: LatLng | undefined): point is LatLng {
  return Boolean(
    point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 && point.lat <= 90 &&
    point.lng >= -180 && point.lng <= 180
  );
}

export function haversineKm(a: LatLng, b: LatLng) {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(value));
}

export function validateRouteGeometry({
  polyline,
  origin,
  destination,
  reportedDistanceKm
}: {
  polyline: LatLng[];
  origin: LatLng;
  destination: LatLng;
  reportedDistanceKm: number;
}): RouteGeometryValidation {
  const empty = { straightLineKm: 0, geometryDistanceKm: 0, startGapKm: 0, endGapKm: 0 };
  if (!isCoordinate(origin) || !isCoordinate(destination)) return { valid: false, reason: "invalid requested endpoint", ...empty };
  if (polyline.length < 2 || polyline.some((point) => !isCoordinate(point))) return { valid: false, reason: "invalid or empty geometry", ...empty };

  const straightLineKm = haversineKm(origin, destination);
  const startGapKm = haversineKm(origin, polyline[0]);
  const endGapKm = haversineKm(destination, polyline[polyline.length - 1]);
  const geometryDistanceKm = polyline.slice(1).reduce((sum, point, index) => sum + haversineKm(polyline[index], point), 0);
  const metrics = { straightLineKm, geometryDistanceKm, startGapKm, endGapKm };

  if (startGapKm > ENDPOINT_TOLERANCE_KM) return { valid: false, reason: `origin snap is ${startGapKm.toFixed(1)} km away`, ...metrics };
  if (endGapKm > ENDPOINT_TOLERANCE_KM) return { valid: false, reason: `destination snap is ${endGapKm.toFixed(1)} km away`, ...metrics };
  if (!Number.isFinite(reportedDistanceKm) || reportedDistanceKm <= 0) return { valid: false, reason: "invalid reported distance", ...metrics };
  if (reportedDistanceKm < straightLineKm * 0.8) return { valid: false, reason: "reported distance is shorter than the endpoint separation", ...metrics };
  if (reportedDistanceKm > Math.max(straightLineKm * 6, straightLineKm + 20)) return { valid: false, reason: "reported distance is implausibly long", ...metrics };
  if (geometryDistanceKm < reportedDistanceKm * 0.65 || geometryDistanceKm > reportedDistanceKm * 1.35) {
    return { valid: false, reason: "geometry length does not match the reported distance", ...metrics };
  }
  return { valid: true, reason: null, ...metrics };
}
