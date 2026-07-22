import type { InboundRoute, LatLng, RouteProvider } from "@twinops/shared";
import { db, getRoutes, nowIso } from "./db/database";
import { getRouteConfig, TRANSPORT_ROUTE_CONFIGS } from "./routeData";
import { validateRouteGeometry } from "./routeGeometry";

const ORS_ENDPOINT = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
const OSRM_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";

type OpenRouteServiceResponse = {
  features?: Array<{
    geometry?: {
      coordinates?: Array<[number, number]>;
    };
    properties?: {
      summary?: {
        distance?: number;
        duration?: number;
      };
    };
  }>;
};

type OsrmResponse = {
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: {
      coordinates?: Array<[number, number]>;
    };
  }>;
};

type ComputeRouteInput = {
  routeId: string;
  origin?: LatLng;
  destination?: LatLng;
};

type ProviderRouteResult = {
  provider: Exclude<RouteProvider, "fallback">;
  statusCode: number;
  polyline: LatLng[];
  distanceKm: number;
  durationMinutes: number;
};

function getRouteById(routeId: string): InboundRoute {
  const route = getRoutes().find((item) => item.id === routeId || item.transportLegId === routeId);
  if (!route) throw new Error(`Transport route ${routeId} was not found.`);
  return route;
}

function parseDurationMinutes(seconds: number | undefined, fallbackMinutes: number) {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return fallbackMinutes;
  return Math.max(1, Math.round(seconds / 60));
}

function decodeGeoJsonLine(coordinates: Array<[number, number]> | undefined): LatLng[] {
  if (!coordinates?.length) return [];
  return coordinates.map(([lng, lat]) => ({
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6))
  }));
}

function logProviderAttempt(routeId: string, message: string) {
  console.log(`[RoutesService] routeId=${routeId} ${message}`);
}

function applyRouteCache({
  routeId,
  distanceKm,
  durationMinutes,
  polyline,
  provider
}: {
  routeId: string;
  distanceKm: number;
  durationMinutes: number;
  polyline: LatLng[];
  provider: RouteProvider;
}) {
  const current = getRouteById(routeId);
  const etaMinutes = Math.max(1, Math.round(durationMinutes));
  const delayDeltaMinutes = Math.max(0, etaMinutes - current.baseEtaMinutes);
  const status = delayDeltaMinutes > 30 ? "disrupted" : delayDeltaMinutes > 10 ? "delayed" : "on-time";
  const estimatedArrival = new Date(new Date(current.plannedArrival).getTime() + delayDeltaMinutes * 60_000).toISOString();

  const computedAt = nowIso();
  db.prepare(
    `UPDATE transport_legs
     SET encoded_polyline = NULL,
         polyline_json = ?,
         distance_km = ?,
         duration_minutes = ?,
         estimated_arrival = ?,
         route_status = ?,
         last_computed_at = ?,
         cache_source = ?,
         last_updated_at = ?
     WHERE route_id = ? OR transport_leg_id = ?`
  ).run(JSON.stringify(polyline), distanceKm, etaMinutes, estimatedArrival, status, computedAt, provider, computedAt, current.id, current.transportLegId);

  // Compatibility write surface for older tools; API reads continue to resolve from transport_legs.
  db.prepare(
    `UPDATE inbound_routes
     SET encoded_polyline = NULL, polyline_json = ?, distance_km = ?, eta_minutes = ?, status = ?,
         last_computed_at = ?, cache_source = ?
     WHERE id = ?`
  ).run(JSON.stringify(polyline), distanceKm, etaMinutes, status, computedAt, provider, current.id);

  return getRouteById(current.id);
}

function hardcodedFallbackRoute(routeId: string) {
  const config = getRouteConfig(routeId);
  if (!config) return getRouteById(routeId);

  logProviderAttempt(routeId, `provider used=fallback geometryPoints=${config.fallbackPolyline.length}`);
  return applyRouteCache({
    routeId,
    distanceKm: config.distanceKm,
    durationMinutes: config.baseEtaMinutes,
    polyline: config.fallbackPolyline,
    provider: "fallback"
  });
}

async function tryOpenRouteService(current: InboundRoute, origin?: LatLng, destination?: LatLng): Promise<ProviderRouteResult | null> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    logProviderAttempt(current.id, "provider attempted=ors skipped missing ORS_API_KEY");
    return null;
  }

  try {
    const response = await fetch(ORS_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json, application/geo+json",
        Authorization: apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        coordinates: [
          [origin?.lng ?? current.originLocation.lng, origin?.lat ?? current.originLocation.lat],
          [destination?.lng ?? current.destinationLocation.lng, destination?.lat ?? current.destinationLocation.lat]
        ],
        instructions: false,
        preference: "recommended",
        units: "m"
      })
    });

    if (!response.ok) {
      logProviderAttempt(current.id, `provider attempted=ors failed statusCode=${response.status} geometryReturned=false`);
      return null;
    }

    const payload = (await response.json()) as OpenRouteServiceResponse;
    const route = payload.features?.[0];
    const polyline = decodeGeoJsonLine(route?.geometry?.coordinates);
    const distanceKm = Number(((route?.properties?.summary?.distance ?? current.distanceKm * 1000) / 1000).toFixed(1));
    const validation = validateRouteGeometry({
      polyline,
      origin: origin ?? current.originLocation,
      destination: destination ?? current.destinationLocation,
      reportedDistanceKm: distanceKm
    });
    logProviderAttempt(current.id, `provider attempted=ors statusCode=${response.status} geometryValid=${validation.valid}${validation.reason ? ` reason=${validation.reason}` : ""}`);
    if (!validation.valid) return null;

    return {
      provider: "ors",
      statusCode: response.status,
      polyline,
      distanceKm,
      durationMinutes: parseDurationMinutes(route?.properties?.summary?.duration, current.baseEtaMinutes)
    };
  } catch (error) {
    logProviderAttempt(
      current.id,
      `provider attempted=ors failed statusCode=network geometryReturned=false error=${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

async function tryOsrm(current: InboundRoute, origin?: LatLng, destination?: LatLng): Promise<ProviderRouteResult | null> {
  const lng1 = origin?.lng ?? current.originLocation.lng;
  const lat1 = origin?.lat ?? current.originLocation.lat;
  const lng2 = destination?.lng ?? current.destinationLocation.lng;
  const lat2 = destination?.lat ?? current.destinationLocation.lat;
  const osrmUrl = `${OSRM_ENDPOINT}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(osrmUrl);
    if (!response.ok) {
      logProviderAttempt(current.id, `provider attempted=osrm failed statusCode=${response.status} geometryReturned=false`);
      return null;
    }

    const payload = (await response.json()) as OsrmResponse;
    const route = payload.routes?.[0];
    const polyline = decodeGeoJsonLine(route?.geometry?.coordinates);
    const distanceKm = Number(((route?.distance ?? current.distanceKm * 1000) / 1000).toFixed(1));
    const validation = validateRouteGeometry({
      polyline,
      origin: origin ?? current.originLocation,
      destination: destination ?? current.destinationLocation,
      reportedDistanceKm: distanceKm
    });
    logProviderAttempt(current.id, `provider attempted=osrm statusCode=${response.status} geometryValid=${validation.valid}${validation.reason ? ` reason=${validation.reason}` : ""}`);
    if (!validation.valid) return null;

    return {
      provider: "osrm",
      statusCode: response.status,
      polyline,
      distanceKm,
      durationMinutes: parseDurationMinutes(route?.duration, current.baseEtaMinutes)
    };
  } catch (error) {
    logProviderAttempt(
      current.id,
      `provider attempted=osrm failed statusCode=network geometryReturned=false error=${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

export async function computeAndCacheRoute({ routeId, origin, destination }: ComputeRouteInput) {
  const current = getRouteById(routeId);
  const orsRoute = await tryOpenRouteService(current, origin, destination);
  const providerRoute = orsRoute ?? (await tryOsrm(current, origin, destination));

  if (providerRoute) {
    logProviderAttempt(
      routeId,
      `provider used=${providerRoute.provider} statusCode=${providerRoute.statusCode} geometryPoints=${providerRoute.polyline.length}`
    );
    return applyRouteCache({
      routeId,
      distanceKm: providerRoute.distanceKm,
      durationMinutes: providerRoute.durationMinutes,
      polyline: providerRoute.polyline,
      provider: providerRoute.provider
    });
  }

  return hardcodedFallbackRoute(routeId);
}

export async function refreshInboundRoutes() {
  // Keep provider traffic bounded so a full-network refresh does not burst the ORS quota.
  for (let index = 0; index < TRANSPORT_ROUTE_CONFIGS.length; index += 3) {
    await Promise.all(TRANSPORT_ROUTE_CONFIGS.slice(index, index + 3).map((route) => computeAndCacheRoute({ routeId: route.id })));
  }
  return getRoutes();
}

export const refreshRoutes = refreshInboundRoutes;

export function getRoutesDebug() {
  return {
    orsKeyLoaded: Boolean(process.env.ORS_API_KEY),
    routes: getRoutes().map((route) => ({
      routeId: route.id,
      providerUsed: route.providerUsed,
      isRealRoadRoute: route.isRealRoadRoute,
      geometryPointCount: route.polyline.length,
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes
    }))
  };
}
