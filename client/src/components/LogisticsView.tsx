import { useEffect, useMemo, useRef, useState } from "react";
import L, { type LatLngBoundsExpression, type LatLngExpression } from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  CalendarClock,
  CheckCircle2,
  Crosshair,
  ExternalLink,
  Link2,
  Map as MapIcon,
  MapPin,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Truck,
  Warehouse,
  X
} from "lucide-react";
import clsx from "clsx";
import type {
  DockAppointment,
  InboundRoute,
  LatLng,
  LogisticsWorkspace,
  PartnerSite,
  PartnerSiteRole,
  TransportDirection,
  TransportLeg,
  WarehouseSnapshot
} from "@twinops/shared";
import { getWarehouse, refreshRoutes } from "../api";
import { formatLocalDateTime } from "../lib/dateTime";
import {
  useAppStore,
  type LogisticsDirectionFilter,
  type LogisticsRouteFilter
} from "../store";
import { CompactMetricCard, FilterChip, StatusChip, WorkspaceNav, type Tone } from "./ui";
import LogisticsFlowView from "./LogisticsFlowView";

type RouteFilter = LogisticsRouteFilter;
type DirectionFilter = LogisticsDirectionFilter;


type TransportModel = {
  sites: PartnerSite[];
  legs: TransportLeg[];
  appointments: DockAppointment[];
  warehouseSiteId: string;
  disclosure: string;
  unified: boolean;
};

const mapCenter: LatLngExpression = [1.337, 103.815];
const inboundColor = "#1494b8";
const outboundColor = "#356cb1";
const selectedColor = "#f28b3c";
const delayedColor = "#c7473f";

const siteRoleLabel: Record<PartnerSiteRole, string> = {
  supplier: "Supplier",
  customer: "Customer",
  warehouse: "Warehouse",
  airport: "Air gateway",
  port: "Port gateway",
  return_origin: "Return origin"
};

const siteRoleColor: Record<PartnerSiteRole, string> = {
  supplier: "#168a68",
  customer: "#356cb1",
  warehouse: "#172f55",
  airport: "#7c5ac7",
  port: "#486a7c",
  return_origin: "#b46a25"
};

const legacyCustomerCoordinates: Record<string, LatLng> = {
  "Singapore General Hospital Pharmacy": { lat: 1.2799, lng: 103.8353 },
  "National Immunisation Cold Hub": { lat: 1.3691, lng: 103.8496 },
  "Tan Tock Seng Hospital Pharmacy": { lat: 1.3214, lng: 103.8451 },
  "Guardian Pharmacy Network": { lat: 1.3048, lng: 103.8318 },
  "National Cancer Centre Pharmacy": { lat: 1.2798, lng: 103.834 },
  "Changi General Hospital Pharmacy": { lat: 1.3402, lng: 103.9496 },
  "NUH Pharmacy": { lat: 1.2944, lng: 103.7837 },
  "Polyclinic Network": { lat: 1.3813, lng: 103.8457 }
};

function formatStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[character] ?? character));
}

function latLngTuple(point: LatLng): LatLngExpression {
  return [point.lat, point.lng];
}

function directionColor(direction: TransportDirection, selected: boolean) {
  if (selected) return selectedColor;
  return direction === "inbound" ? inboundColor : outboundColor;
}

function routePath(leg: TransportLeg): LatLngExpression[] {
  return leg.polyline.map(latLngTuple);
}

function routeBounds(legs: TransportLeg[], sites: PartnerSite[]): LatLngBoundsExpression | null {
  const points = [
    ...legs.flatMap((leg) => leg.polyline),
    ...sites.map((site) => site.location)
  ];
  if (!points.length) return null;
  return points.map(latLngTuple) as LatLngBoundsExpression;
}

function hasRoadDelay(leg: TransportLeg) {
  return leg.routeStatus === "delayed" && leg.delayMinutes > 0;
}

function hasRoadDisruption(leg: TransportLeg) {
  return leg.routeStatus === "disrupted";
}

function hasScheduleDelay(leg: TransportLeg) {
  return leg.scheduleAdherence === "delayed";
}

function isDelayedLeg(leg: TransportLeg) {
  return hasScheduleDelay(leg) || hasRoadDelay(leg);
}

function routeDash(leg: TransportLeg) {
  if (hasRoadDisruption(leg)) return "3 8";
  if (hasRoadDelay(leg)) return "12 8";
  return undefined;
}

function transportTone(leg: TransportLeg): Tone {
  if (leg.transportStatus === "exception" || hasRoadDisruption(leg) || leg.temperatureStatus === "excursion") return "critical";
  if (hasRoadDelay(leg) || hasScheduleDelay(leg)) return "warning";
  if (leg.transportStatus === "delivered") return "healthy";
  return "focus";
}

function scheduleTone(leg: TransportLeg): Tone {
  if (hasRoadDisruption(leg)) return "critical";
  if (leg.scheduleAdherence === "unknown") return "neutral";
  if (leg.scheduleAdherence === "delayed") return "critical";
  if (!leg.scheduleAdherence && hasRoadDelay(leg)) return "warning";
  return "healthy";
}

function scheduleStatusLabel(leg: TransportLeg) {
  if (hasRoadDisruption(leg)) return "Disrupted";
  if (leg.scheduleAdherence === "unknown") return "Schedule unknown";
  if (leg.scheduleAdherence === "delayed") return "Delayed";
  if (!leg.scheduleAdherence && hasRoadDelay(leg)) return "Road delay";
  return "On time";
}

function wmsStatusTone(status: string): Tone {
  const lower = status.toLowerCase();
  if (lower.includes("block") || lower.includes("exception") || lower.includes("quarantine") || lower.includes("expired") || lower.includes("hold")) return "critical";
  if (lower.includes("complete") || lower.includes("dispatch") || lower.includes("deliver") || lower === "released" || lower === "received") return "healthy";
  if (lower.includes("pending") || lower.includes("transit") || lower.includes("receiv") || lower.includes("pick") || lower.includes("pack") || lower.includes("load") || lower.includes("gate")) return "warning";
  return "neutral";
}

function operationalTimestamp(leg: TransportLeg) {
  if (leg.direction === "inbound" && leg.actualArrival) return { label: "Actual arrival", value: leg.actualArrival };
  if (leg.direction === "outbound" && leg.actualDeparture) return { label: "Actual departure", value: leg.actualDeparture };
  return { label: "Estimated arrival", value: leg.estimatedArrival };
}

function createSiteIcon(site: PartnerSite, selected: boolean) {
  const label = site.role === "warehouse"
    ? "DC"
    : site.role === "supplier"
      ? "S"
      : site.role === "customer"
        ? "C"
        : site.role === "airport"
          ? "A"
          : site.role === "port"
            ? "P"
            : "R";
  const color = selected ? selectedColor : siteRoleColor[site.role];
  return L.divIcon({
    className: "twin-leaflet-marker",
    html: `<span title="${escapeHtml(site.displayName)}" style="background:${color};color:#fff;border:${selected ? "3px solid #fff" : "2px solid rgba(255,255,255,.9)"};box-shadow:0 5px 14px rgba(18,45,75,.25)">${label}</span>`,
    iconAnchor: [17, 17],
    iconSize: [34, 34]
  });
}

function createVehicleIcon(leg: TransportLeg) {
  const color = leg.direction === "inbound" ? inboundColor : outboundColor;
  return L.divIcon({
    className: "twin-leaflet-marker twin-leaflet-marker--vehicle",
    html: `<span title="${escapeHtml(leg.licensePlate)}" style="background:${color};color:#fff;border:2px solid white;font-size:13px">↗</span>`,
    iconAnchor: [13, 13],
    iconSize: [26, 26]
  });
}

function midpoint(leg: TransportLeg) {
  if (leg.lastKnownLocation) return leg.lastKnownLocation;
  return leg.polyline[Math.floor((leg.polyline.length - 1) / 2)] ?? null;
}

function curvedPath(origin: LatLng, destination: LatLng, direction: TransportDirection) {
  const offset = direction === "inbound" ? 0.006 : -0.006;
  return [
    origin,
    {
      lat: (origin.lat + destination.lat) / 2 + offset,
      lng: (origin.lng + destination.lng) / 2 - offset
    },
    destination
  ];
}

function distanceKm(origin: LatLng, destination: LatLng) {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(destination.lat - origin.lat);
  const longitudeDelta = toRadians(destination.lng - origin.lng);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(origin.lat)) * Math.cos(toRadians(destination.lat)) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function siteRecord(input: {
  siteId: string;
  name: string;
  role: PartnerSiteRole;
  location: LatLng;
  address?: string;
}): PartnerSite {
  return {
    siteId: input.siteId,
    partnerId: `PARTNER-${input.siteId}`,
    partnerName: input.name,
    siteCode: input.siteId,
    role: input.role,
    displayName: input.name,
    address: input.address ?? "Singapore",
    postalCode: "",
    countryCode: "SG",
    timezone: "Asia/Singapore",
    location: input.location,
    receivingWindow: "Confirm with site",
    temperatureCapabilities: ["ambient", "2-8C", "15-25C"],
    vehicleRestrictions: [],
    simulated: true,
    publicLocationReference: null,
    dataNotice: "Legacy simulated location retained until the unified site master is refreshed."
  };
}

function makeLegacyTransportModel(snapshot: WarehouseSnapshot, routes: InboundRoute[]): TransportModel {
  const warehouseLocation = routes[0]?.destinationLocation ?? { lat: 1.3349, lng: 103.7436 };
  const warehouseSite = siteRecord({
    siteId: "SITE-WAREHOUSE-LEGACY",
    name: routes[0]?.destination ?? "Western Singapore Pharmaceutical Distribution Centre",
    role: "warehouse",
    location: warehouseLocation
  });
  const sites = new Map<string, PartnerSite>([[warehouseSite.siteId, warehouseSite]]);
  const appointments: DockAppointment[] = [];

  const inboundLegs = routes.map((route): TransportLeg => {
    const inbound = snapshot.inventory.inboundShipments.find((shipment) => shipment.linkedRouteId === route.id || shipment.linkedRouteId === route.routeId);
    const originRole: PartnerSiteRole = /air/i.test(route.originType)
      ? "airport"
      : /return/i.test(route.originType)
        ? "return_origin"
        : "supplier";
    const originSiteId = `SITE-${slug(route.origin)}`;
    sites.set(originSiteId, siteRecord({ siteId: originSiteId, name: route.origin, role: originRole, location: route.originLocation }));
    const status = inbound?.inboundStatus === "In Transit"
      ? "in_transit"
      : inbound?.inboundStatus === "At Receiving"
        ? "at_dock"
        : inbound?.inboundStatus === "Received" || inbound?.inboundStatus === "QA Pending" || inbound?.inboundStatus === "Putaway"
          ? "arrived"
          : "planned";
    const appointmentId = `APPT-${inbound?.asnId ?? route.id}`;
    const eta = inbound?.eta ?? new Date(Date.now() + route.etaMinutes * 60_000).toISOString();
    const dockId = inbound?.receivingDock ?? "Unassigned";
    appointments.push({
      dockAppointmentId: appointmentId,
      dockId,
      direction: "inbound",
      transportLegId: `LEG-${route.id}`,
      referenceType: originRole === "return_origin" ? "Return" : "ASN",
      referenceId: inbound?.asnId ?? route.id,
      scheduledStart: eta,
      scheduledEnd: new Date(new Date(eta).getTime() + 60 * 60_000).toISOString(),
      actualGateIn: null,
      actualDockIn: null,
      actualDockOut: null,
      actualGateOut: null,
      status: status === "at_dock" ? "at_dock" : status === "arrived" ? "completed" : "booked",
      carrierId: `CARRIER-${slug(route.origin)}`,
      carrierName: inbound?.source ?? route.origin,
      vehicleId: "Pending assignment",
      licensePlate: "Pending",
      temperatureRequirement: route.coldChainRequired ? "2-8C" : "ambient",
      conflictFlag: false,
      notes: "Legacy appointment inferred from the ASN receiving window.",
      lastUpdatedAt: route.lastComputedAt ?? new Date().toISOString()
    });
    return {
      transportLegId: `LEG-${route.id}`,
      routeId: route.id,
      direction: "inbound",
      asnId: inbound?.asnId ?? null,
      shipmentId: null,
      originSiteId,
      destinationSiteId: warehouseSite.siteId,
      carrierId: `CARRIER-${slug(inbound?.source ?? route.origin)}`,
      carrierName: inbound?.source ?? route.origin,
      vehicleId: "Pending assignment",
      vehicleType: route.coldChainRequired ? "Refrigerated rigid truck" : "Box truck",
      licensePlate: "Pending",
      driverId: null,
      plannedDeparture: new Date(new Date(eta).getTime() - route.etaMinutes * 60_000).toISOString(),
      actualDeparture: status === "in_transit" || status === "arrived" || status === "at_dock" ? new Date(new Date(eta).getTime() - route.etaMinutes * 60_000).toISOString() : null,
      plannedArrival: eta,
      actualArrival: status === "arrived" ? eta : null,
      estimatedArrival: eta,
      deliveryWindowStart: null,
      deliveryWindowEnd: null,
      dockAppointmentId: appointmentId,
      temperatureRequirement: route.coldChainRequired ? "2-8C" : "ambient",
      temperatureMin: route.coldChainRequired ? 2 : null,
      temperatureMax: route.coldChainRequired ? 8 : null,
      temperatureStatus: inbound?.coldChainStatus === "In Band" ? "compliant" : route.coldChainRequired ? "unknown" : "not_required",
      temperatureLoggerId: null,
      transportStatus: status,
      routeStatus: route.status,
      distanceKm: route.distanceKm,
      baseDurationMinutes: route.baseEtaMinutes,
      durationMinutes: route.currentDurationMinutes,
      delayMinutes: route.delayDeltaMinutes,
      disruptionType: route.disruptionType,
      riskLevel: route.riskLevel,
      riskNote: route.riskNote,
      receivingImpact: route.receivingImpact,
      mitigationSuggestion: route.mitigationSuggestion,
      encodedPolyline: route.encodedPolyline,
      polyline: route.polyline.length > 1 ? route.polyline : [route.originLocation, route.destinationLocation],
      lastKnownLocation: status === "in_transit" ? route.polyline[Math.floor(route.polyline.length / 2)] ?? null : null,
      lastComputedAt: route.lastComputedAt,
      cacheSource: route.cacheSource,
      providerUsed: route.providerUsed,
      isRealRoadRoute: route.isRealRoadRoute,
      sealNumber: null,
      proofOfDeliveryId: null,
      lastUpdatedAt: route.lastComputedAt ?? new Date().toISOString()
    };
  });

  const outboundLegs = snapshot.inventory.outboundShipments.map((shipment, index): TransportLeg => {
    const destinationLocation = legacyCustomerCoordinates[shipment.destination] ?? {
      lat: 1.3 + (index % 4) * 0.025,
      lng: 103.78 + Math.floor(index / 4) * 0.09
    };
    const destinationSiteId = `SITE-${slug(shipment.destination)}`;
    sites.set(destinationSiteId, siteRecord({ siteId: destinationSiteId, name: shipment.destination, role: "customer", location: destinationLocation }));
    const baseShipment = snapshot.shipments.find((item) => item.id === shipment.shipmentId);
    const coldChainRequired = Boolean(baseShipment?.coldChainRequired);
    const path = curvedPath(warehouseLocation, destinationLocation, "outbound");
    const km = distanceKm(warehouseLocation, destinationLocation);
    const duration = Math.max(20, Math.round(km / 30 * 60));
    const isBlocked = shipment.outboundStatus === "Blocked";
    const transportStatus = shipment.outboundStatus === "Dispatched" ? "in_transit" : shipment.outboundStatus === "Staged" ? "vehicle_assigned" : isBlocked ? "exception" : "planned";
    const appointmentId = `APPT-${shipment.shipmentId}`;
    appointments.push({
      dockAppointmentId: appointmentId,
      dockId: shipment.dock,
      direction: "outbound",
      transportLegId: `LEG-${shipment.routeId ?? shipment.shipmentId}`,
      referenceType: "Outbound Shipment",
      referenceId: shipment.shipmentId,
      scheduledStart: new Date(new Date(shipment.requiredBy).getTime() - duration * 60_000).toISOString(),
      scheduledEnd: shipment.requiredBy,
      actualGateIn: null,
      actualDockIn: null,
      actualDockOut: null,
      actualGateOut: null,
      status: shipment.outboundStatus === "Staged" ? "booked" : isBlocked ? "exception" : "booked",
      carrierId: "CARRIER-PENDING",
      carrierName: "Carrier pending",
      vehicleId: "Pending assignment",
      licensePlate: "Pending",
      temperatureRequirement: coldChainRequired ? "2-8C" : "ambient",
      conflictFlag: false,
      notes: "Legacy dispatch appointment inferred from the customer required-by time.",
      lastUpdatedAt: new Date().toISOString()
    });
    return {
      transportLegId: `LEG-${shipment.routeId ?? shipment.shipmentId}`,
      routeId: shipment.routeId ?? `ROUTE-${shipment.shipmentId}`,
      direction: "outbound",
      asnId: null,
      shipmentId: shipment.shipmentId,
      originSiteId: warehouseSite.siteId,
      destinationSiteId,
      carrierId: "CARRIER-PENDING",
      carrierName: "Carrier pending",
      vehicleId: "Pending assignment",
      vehicleType: coldChainRequired ? "Refrigerated rigid truck" : "Box truck",
      licensePlate: "Pending",
      driverId: null,
      plannedDeparture: new Date(new Date(shipment.requiredBy).getTime() - duration * 60_000).toISOString(),
      actualDeparture: shipment.outboundStatus === "Dispatched" ? new Date().toISOString() : null,
      plannedArrival: shipment.requiredBy,
      actualArrival: null,
      estimatedArrival: shipment.requiredBy,
      deliveryWindowStart: null,
      deliveryWindowEnd: shipment.requiredBy,
      dockAppointmentId: appointmentId,
      temperatureRequirement: coldChainRequired ? "2-8C" : "ambient",
      temperatureMin: coldChainRequired ? 2 : null,
      temperatureMax: coldChainRequired ? 8 : null,
      temperatureStatus: coldChainRequired ? "unknown" : "not_required",
      temperatureLoggerId: null,
      transportStatus,
      routeStatus: isBlocked ? "disrupted" : "on-time",
      distanceKm: km,
      baseDurationMinutes: duration,
      durationMinutes: duration,
      delayMinutes: 0,
      disruptionType: isBlocked ? "WMS release block" : null,
      riskLevel: isBlocked ? "high" : "low",
      riskNote: isBlocked ? "Warehouse release is blocked; transport must not depart." : "Legacy transport plan awaiting live carrier telemetry.",
      receivingImpact: "Customer delivery window and warehouse dispatch readiness are linked through the shipment ID.",
      mitigationSuggestion: isBlocked ? "Resolve the WMS block before vehicle loading or goods issue." : "Confirm vehicle and dock readiness before the loading cutoff.",
      encodedPolyline: null,
      polyline: path,
      lastKnownLocation: shipment.outboundStatus === "Dispatched" ? midpoint({ polyline: path, lastKnownLocation: null } as TransportLeg) : null,
      lastComputedAt: null,
      cacheSource: "fallback",
      providerUsed: "fallback",
      isRealRoadRoute: false,
      sealNumber: null,
      proofOfDeliveryId: null,
      lastUpdatedAt: new Date().toISOString()
    };
  });

  return {
    sites: [...sites.values()],
    legs: [...inboundLegs, ...outboundLegs],
    appointments,
    warehouseSiteId: warehouseSite.siteId,
    disclosure: "Fallback simulation: public geographic anchors are used only to demonstrate plausible flows; no supplier or customer relationship is asserted.",
    unified: false
  };
}

function mergeScenarioRoute(route: InboundRoute, scenario: any | null): InboundRoute {
  const projected = scenario?.projectedRoute;
  if (!projected || (projected.id !== route.id && projected.name !== route.name)) return route;
  const etaMinutes = Number(projected.etaMinutes ?? route.etaMinutes);
  return {
    ...route,
    ...projected,
    originLocation: route.originLocation,
    destinationLocation: route.destinationLocation,
    polyline: projected.polyline?.length ? projected.polyline : route.polyline,
    encodedPolyline: projected.encodedPolyline ?? route.encodedPolyline,
    distanceKm: Number(projected.distanceKm ?? route.distanceKm),
    etaMinutes,
    currentDurationMinutes: Number(projected.currentDurationMinutes ?? etaMinutes),
    delayDeltaMinutes: Math.max(0, etaMinutes - route.baseEtaMinutes),
    status: projected.status === "disrupted" ? "disrupted" : projected.status === "delayed" ? "delayed" : "on-time"
  };
}

function projectedAdherence(leg: TransportLeg, estimatedArrival: string) {
  if (leg.actualArrival) {
    return {
      scheduleAdherence: leg.scheduleAdherence,
      scheduleAdherenceLabel: leg.scheduleAdherenceLabel,
      scheduleVarianceMinutes: leg.scheduleVarianceMinutes
    };
  }
  const targetValue = leg.direction === "outbound"
    ? leg.deliveryWindowEnd ?? leg.plannedArrival
    : leg.plannedArrival;
  const target = new Date(targetValue).getTime();
  const estimate = new Date(estimatedArrival).getTime();
  if (!Number.isFinite(target) || !Number.isFinite(estimate)) {
    return {
      scheduleAdherence: "unknown" as const,
      scheduleAdherenceLabel: "Projected schedule unknown",
      scheduleVarianceMinutes: null
    };
  }
  const varianceMinutes = estimate > target
    ? Math.ceil((estimate - target) / 60_000)
    : estimate < target
      ? Math.floor((estimate - target) / 60_000)
      : 0;
  const milestone = leg.direction === "inbound" ? "arrival" : "delivery";
  return varianceMinutes > 0
    ? {
        scheduleAdherence: "delayed" as const,
        scheduleAdherenceLabel: `Projected ${milestone} ${varianceMinutes} min late`,
        scheduleVarianceMinutes: varianceMinutes
      }
    : {
        scheduleAdherence: "on-time" as const,
        scheduleAdherenceLabel: `Projected ${milestone} on time`,
        scheduleVarianceMinutes: varianceMinutes
      };
}

function mergeScenarioLeg(leg: TransportLeg, scenario: any | null): TransportLeg {
  const projected = scenario?.projectedRoute;
  if (!projected || (projected.id !== leg.routeId && projected.routeId !== leg.routeId && projected.id !== leg.transportLegId)) return leg;
  const durationMinutes = Number(projected.currentDurationMinutes ?? projected.etaMinutes ?? leg.durationMinutes);
  const departure = new Date(leg.actualDeparture ?? leg.plannedDeparture).getTime();
  const estimatedArrival = leg.actualArrival
    ?? (Number.isFinite(departure)
      ? new Date(departure + durationMinutes * 60_000).toISOString()
      : leg.estimatedArrival);
  return {
    ...leg,
    durationMinutes,
    delayMinutes: Math.max(0, durationMinutes - leg.baseDurationMinutes),
    routeStatus: projected.status === "disrupted" ? "disrupted" : projected.status === "delayed" ? "delayed" : "on-time",
    estimatedArrival,
    ...projectedAdherence(leg, estimatedArrival),
    polyline: projected.polyline?.length ? projected.polyline : leg.polyline
  };
}

function transportModel(snapshot: WarehouseSnapshot, scenario: any | null): TransportModel {
  const unifiedLegs = snapshot.logistics?.transportLegs?.length ? snapshot.logistics.transportLegs : snapshot.transportLegs;
  const unifiedSites = snapshot.logistics?.partnerSites?.length ? snapshot.logistics.partnerSites : snapshot.partnerSites;
  const appointments = snapshot.logistics?.dockAppointments?.length ? snapshot.logistics.dockAppointments : snapshot.dockAppointments;
  if (unifiedLegs?.length && unifiedSites?.length) {
    return {
      sites: unifiedSites,
      legs: unifiedLegs.map((leg) => mergeScenarioLeg(leg, scenario)),
      appointments: appointments ?? [],
      warehouseSiteId: snapshot.logistics?.warehouseSiteId ?? unifiedSites.find((site) => site.role === "warehouse")?.siteId ?? "",
      disclosure: snapshot.logistics?.simulationDisclosure ?? "This is a simulated logistics network using public geographic anchors.",
      unified: true
    };
  }
  const legacyRoutes = snapshot.routes.map((route) => mergeScenarioRoute(route, scenario));
  return makeLegacyTransportModel(snapshot, legacyRoutes);
}

function FitNetworkBounds({ legs, sites, resetNonce }: { legs: TransportLeg[]; sites: PartnerSite[]; resetNonce: number }) {
  const map = useMap();
  useEffect(() => {
    const bounds = routeBounds(legs, sites);
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      if (bounds) map.fitBounds(bounds, { paddingTopLeft: [28, 118], paddingBottomRight: [28, 28], maxZoom: 12 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [legs, map, resetNonce, sites]);
  return null;
}

function ResizeNetworkMap() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function FocusSelectedLeg({ leg }: { leg: TransportLeg | null }) {
  const map = useMap();
  useEffect(() => {
    if (!leg || leg.polyline.length < 2) return;
    map.fitBounds(leg.polyline.map(latLngTuple) as LatLngBoundsExpression, { padding: [54, 54], maxZoom: 13 });
  }, [leg, map]);
  return null;
}

function MapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-twin-muted">
      <span className="inline-flex items-center gap-1.5"><span className="h-1 w-5 rounded" style={{ backgroundColor: inboundColor }} />Inbound</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-1 w-5 rounded" style={{ backgroundColor: outboundColor }} />Outbound</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-twin-critical" />Road delay</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-dotted border-twin-critical" />Road disruption</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#168a68]" />Supplier</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#356cb1]" />Customer</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#172f55]" />DC</span>
    </div>
  );
}

function NetworkMap({
  legs,
  sites,
  selectedLeg,
  selectedSiteId,
  onSelectLeg,
  onOpenSiteDetails,
  resetNonce
}: {
  legs: TransportLeg[];
  sites: PartnerSite[];
  selectedLeg: TransportLeg | null;
  selectedSiteId: string | null;
  onSelectLeg: (leg: TransportLeg) => void;
  onOpenSiteDetails: (siteId: string) => void;
  resetNonce: number;
}) {
  const activeSiteIds = new Set(legs.flatMap((leg) => [leg.originSiteId, leg.destinationSiteId]));
  const visibleSites = sites.filter((site) => site.role === "warehouse" || activeSiteIds.has(site.siteId) || site.siteId === selectedSiteId);
  const liveVehicles = legs.filter((leg) => ["in_transit", "arrived", "at_dock", "loading", "unloading", "departed"].includes(leg.transportStatus));
  const providerCount = new Set(legs.map((leg) => leg.providerUsed)).size;
  const fallbackActive = legs.some((leg) => !leg.isRealRoadRoute);

  return (
    <div className="relative h-full">
      <MapContainer center={mapCenter} zoom={10} minZoom={9} maxZoom={16} className="twin-leaflet-map h-full w-full" zoomControl={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitNetworkBounds legs={legs} sites={visibleSites} resetNonce={resetNonce} />
        <ResizeNetworkMap />
        <FocusSelectedLeg leg={selectedLeg} />
        {legs.map((leg) => {
          const selected = leg.transportLegId === selectedLeg?.transportLegId;
          if (leg.polyline.length < 2) return null;
          return (
            <Polyline
              key={`${leg.transportLegId}-${leg.routeStatus}-${selected ? "selected" : "base"}`}
              positions={routePath(leg)}
              pathOptions={{
                color: selected ? selectedColor : hasRoadDelay(leg) || hasRoadDisruption(leg) ? delayedColor : directionColor(leg.direction, false),
                opacity: selected ? 1 : 0.82,
                weight: selected ? 7 : leg.direction === "inbound" ? 5 : 4,
                dashArray: selected ? undefined : routeDash(leg)
              }}
              eventHandlers={{ click: () => onSelectLeg(leg) }}
            />
          );
        })}
        {visibleSites.map((site) => (
          <Marker
            key={site.siteId}
            position={latLngTuple(site.location)}
            icon={createSiteIcon(site, site.siteId === selectedSiteId)}
            title={site.displayName}
          >
            <Popup>
              <strong>{site.displayName}</strong>
              <br />
              {siteRoleLabel[site.role]}
              <br />
              <button type="button" className="mt-2 font-semibold text-blue-700" onClick={() => onOpenSiteDetails(site.siteId)}>View details</button>
            </Popup>
          </Marker>
        ))}
        {liveVehicles.map((leg) => {
          const location = midpoint(leg);
          if (!location) return null;
          return (
            <Marker
              key={`${leg.transportLegId}-vehicle`}
              position={latLngTuple(location)}
              icon={createVehicleIcon(leg)}
              eventHandlers={{ click: () => onSelectLeg(leg) }}
            >
              <Popup>
                <strong>{leg.licensePlate}</strong>
                <br />
                {leg.carrierName} · {formatStatus(leg.transportStatus)}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
      <div className="absolute right-4 top-28 z-[500] rounded-xl border border-twin-border/80 bg-white/90 px-3 py-2 text-xs font-semibold text-twin-text shadow-card backdrop-blur">
        {legs.length} legs · {providerCount || 0} route source{providerCount === 1 ? "" : "s"}
      </div>
      {fallbackActive && (
        <div className="absolute bottom-4 left-4 z-[500] max-w-[280px] rounded-xl border border-twin-warning/25 bg-white/95 px-3 py-2 text-[11px] text-twin-muted shadow-card backdrop-blur">
          Some lanes use cached geometry. Operational identities still come from the shared transport record.
        </div>
      )}
    </div>
  );
}

function processRailIndex(leg: TransportLeg, wmsStatus: string) {
  if (leg.direction === "inbound") {
    const stages: Record<string, number> = {
      "ASN Received": 0,
      "Appointment Booked": 1,
      "Vehicle Assigned": 1,
      Scheduled: 1,
      "In Transit": 1,
      "Gate In": 2,
      "At Receiving": 3,
      Unloading: 3,
      Received: 3,
      "QA Pending": 4,
      "QA Hold": 4,
      Released: 4,
      Putaway: 5,
      "Putaway Complete": 5,
      Closed: 5
    };
    if (wmsStatus in stages) return stages[wmsStatus];
    if (leg.transportStatus === "at_dock" || leg.transportStatus === "unloading") return 3;
    if (leg.transportStatus === "arrived") return 2;
    if (leg.transportStatus === "in_transit") return 1;
    return 0;
  }

  const stages: Record<string, number> = {
    "Order Received": 0,
    "Delivery Created": 0,
    Scheduled: 0,
    "Wave Released": 0,
    Allocated: 1,
    Replenishment: 1,
    Picking: 2,
    Picked: 2,
    Packed: 3,
    "QA Release": 3,
    Staged: 4,
    Loading: 4,
    "Goods Issued": 5,
    Dispatched: 5,
    Delivered: 6
  };
  if (wmsStatus in stages) return stages[wmsStatus];
  if (leg.proofOfDeliveryId || leg.transportStatus === "delivered") return 6;
  if (["departed", "in_transit"].includes(leg.transportStatus)) return 5;
  if (leg.transportStatus === "loading") return 4;
  return 0;
}

function ProcessRail({ leg, wmsStatus }: { leg: TransportLeg; wmsStatus: string }) {
  const inboundSteps = ["ASN", "Appointment", "Gate-in", "Receipt", "QA", "Put-away"];
  const outboundSteps = ["Order", "Allocation", "Pick", "Pack", "Stage", "Goods issue", "POD"];
  const steps = leg.direction === "inbound" ? inboundSteps : outboundSteps;
  const activeIndex = processRailIndex(leg, wmsStatus);
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-twin-muted">
        <span>WMS handoff</span>
        <span>{wmsStatus}</span>
      </div>
      <div className="flex min-w-max items-start">
        {steps.map((step, index) => (
          <div key={step} className="flex items-start">
            <div className="w-[62px] text-center">
              <span className={clsx(
                "mx-auto flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                index < activeIndex ? "border-twin-green bg-twin-green text-white" : index === activeIndex ? "border-twin-blue bg-twin-blue text-white" : "border-twin-border bg-white text-twin-muted"
              )}>
                {index < activeIndex ? <CheckCircle2 size={12} /> : index + 1}
              </span>
              <span className={clsx("mt-1 block text-[9px] leading-tight", index <= activeIndex ? "font-semibold text-twin-text" : "text-twin-muted")}>{step}</span>
            </div>
            {index < steps.length - 1 && <span className={clsx("mt-2.5 h-px w-3", index < activeIndex ? "bg-twin-green" : "bg-twin-border")} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function TransportDetail({
  leg,
  sites,
  appointments,
  snapshot,
  embedded = false,
  onClose,
  onOpenInbound,
  onOpenOutbound,
  onOpenDock
}: {
  leg: TransportLeg;
  sites: PartnerSite[];
  appointments: DockAppointment[];
  snapshot: WarehouseSnapshot;
  embedded?: boolean;
  onClose: () => void;
  onOpenInbound: (asnId: string) => void;
  onOpenOutbound: (shipmentId: string) => void;
  onOpenDock: (dockId: string) => void;
}) {
  const origin = sites.find((site) => site.siteId === leg.originSiteId);
  const destination = sites.find((site) => site.siteId === leg.destinationSiteId);
  const appointment = appointments.find((item) => item.dockAppointmentId === leg.dockAppointmentId || item.transportLegId === leg.transportLegId);
  const inbound = leg.asnId ? snapshot.inventory.inboundShipments.find((shipment) => shipment.asnId === leg.asnId) : null;
  const outbound = leg.shipmentId ? snapshot.inventory.outboundShipments.find((shipment) => shipment.shipmentId === leg.shipmentId) : null;
  const wmsStatus = inbound?.inboundStatus ?? outbound?.outboundStatus ?? "No WMS record";
  const reference = leg.asnId ?? leg.shipmentId ?? leg.transportLegId;
  const details = [
    ["Carrier / vehicle", `${leg.carrierName} · ${leg.licensePlate}`],
    ["Planned departure", formatLocalDateTime(leg.plannedDeparture)],
    ["Actual departure", formatLocalDateTime(leg.actualDeparture)],
    ["Planned arrival", formatLocalDateTime(leg.plannedArrival)],
    ["Estimated arrival", formatLocalDateTime(leg.estimatedArrival)],
    ["Actual arrival", formatLocalDateTime(leg.actualArrival)],
    ["Schedule adherence", leg.scheduleAdherenceLabel ?? scheduleStatusLabel(leg)],
    ["Distance / duration", `${leg.distanceKm.toFixed(1)} km · ${leg.durationMinutes} min`],
    ["Dock appointment", appointment ? `${appointment.dockId} · ${formatLocalDateTime(appointment.scheduledStart)}` : "Not booked"],
    ["Temperature", `${leg.temperatureRequirement} · ${formatStatus(leg.temperatureStatus)}`],
    ["Seal / POD", `${leg.sealNumber ?? "No seal recorded"} · ${leg.proofOfDeliveryId ?? "POD pending"}`],
    ["Last updated", formatLocalDateTime(leg.lastUpdatedAt)]
  ];

  return (
    <aside className={clsx(
      "overflow-auto bg-white/95 p-4",
      embedded
        ? "h-full"
        : "absolute bottom-4 left-4 right-4 z-[540] max-h-[82%] rounded-2xl border border-twin-border/80 shadow-glow backdrop-blur lg:bottom-auto lg:left-auto lg:top-4 lg:w-[410px]"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={leg.direction === "inbound" ? "focus" : "neutral"}>{leg.direction}</StatusChip>
            <StatusChip tone={transportTone(leg)}>{formatStatus(leg.transportStatus)}</StatusChip>
            <StatusChip tone={scheduleTone(leg)}>{scheduleStatusLabel(leg)}</StatusChip>
          </div>
          <h3 className="mt-2 truncate text-lg font-semibold text-twin-text">{reference}</h3>
          <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-twin-muted">
            <span className="truncate">{origin?.displayName ?? leg.originSiteId}</span>
            <ArrowRight size={12} className="shrink-0" />
            <span className="truncate">{destination?.displayName ?? leg.destinationSiteId}</span>
          </p>
        </div>
        <button className="rounded-xl border border-twin-border/70 bg-white p-2 text-twin-muted hover:text-twin-text" onClick={onClose} aria-label="Close transport detail"><X size={15} /></button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {details.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[116px_minmax(0,1fr)] gap-3 rounded-xl border border-twin-border/70 bg-white/80 px-3 py-2 text-xs">
            <span className="text-twin-muted">{label}</span>
            <span className={clsx("truncate font-semibold text-twin-text", label === "Temperature" && leg.temperatureStatus === "excursion" && "text-twin-critical")}>{value}</span>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto"><ProcessRail leg={leg} wmsStatus={wmsStatus} /></div>

      {(leg.riskNote || leg.mitigationSuggestion) && (
        <div className={clsx("mt-4 rounded-xl border p-3 text-xs leading-relaxed", !hasRoadDelay(leg) && !hasRoadDisruption(leg) ? "border-twin-border/70 bg-white/75 text-twin-muted" : "border-twin-warning/30 bg-twin-warning/10 text-twin-text")}>
          {leg.riskNote && <p>{leg.riskNote}</p>}
          {leg.mitigationSuggestion && <p className="mt-1 font-semibold">Action: {leg.mitigationSuggestion}</p>}
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {leg.direction === "inbound" && leg.asnId && (
          <button className="flex items-center justify-between rounded-xl bg-twin-blue px-3 py-2.5 text-left text-xs font-semibold text-white" onClick={() => onOpenInbound(leg.asnId!)}>
            <span className="flex items-center gap-2"><ArrowDownToLine size={15} />Open inbound execution</span><ExternalLink size={13} />
          </button>
        )}
        {leg.direction === "outbound" && leg.shipmentId && (
          <button className="flex items-center justify-between rounded-xl bg-twin-blue px-3 py-2.5 text-left text-xs font-semibold text-white" onClick={() => onOpenOutbound(leg.shipmentId!)}>
            <span className="flex items-center gap-2"><ArrowUpFromLine size={15} />Open outbound execution</span><ExternalLink size={13} />
          </button>
        )}
        {appointment?.dockId && (
          <button className="flex items-center justify-between rounded-xl border border-twin-border bg-white px-3 py-2.5 text-left text-xs font-semibold text-twin-text" onClick={() => onOpenDock(appointment.dockId)}>
            <span className="flex items-center gap-2"><Warehouse size={15} />Open Dock Schedule · {appointment.dockId}</span><ExternalLink size={13} />
          </button>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-twin-cyan/10 px-3 py-2 text-[11px] text-twin-blue">
        <Link2 size={13} />
        Shared identity: {leg.transportLegId} · {leg.dockAppointmentId}
      </div>
    </aside>
  );
}

function SiteDetail({ site, connectedLegs, embedded = false, onClose, onSelectLeg }: { site: PartnerSite; connectedLegs: TransportLeg[]; embedded?: boolean; onClose: () => void; onSelectLeg: (leg: TransportLeg) => void }) {
  return (
    <aside className={clsx(
      "overflow-auto bg-white/95 p-4",
      embedded
        ? "h-full"
        : "absolute bottom-4 left-4 right-4 z-[540] max-h-[78%] rounded-2xl border border-twin-border/80 shadow-glow backdrop-blur lg:bottom-auto lg:left-auto lg:top-4 lg:w-[380px]"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <StatusChip tone={site.role === "warehouse" ? "focus" : site.role === "customer" ? "neutral" : "healthy"}>{siteRoleLabel[site.role]}</StatusChip>
          <h3 className="mt-2 text-lg font-semibold text-twin-text">{site.displayName}</h3>
          <p className="mt-1 text-xs leading-relaxed text-twin-muted">{site.address}{site.postalCode ? ` ${site.postalCode}` : ""}</p>
        </div>
        <button className="rounded-xl border border-twin-border/70 bg-white p-2 text-twin-muted hover:text-twin-text" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="mt-4 grid gap-2 text-xs">
        <div className="rounded-xl border border-twin-border/70 bg-white/80 px-3 py-2"><span className="text-twin-muted">Operating window</span><span className="mt-1 block font-semibold text-twin-text">{site.receivingWindow}</span></div>
        <div className="rounded-xl border border-twin-border/70 bg-white/80 px-3 py-2"><span className="text-twin-muted">Temperature capability</span><span className="mt-1 block font-semibold text-twin-text">{site.temperatureCapabilities.join(", ")}</span></div>
        {site.vehicleRestrictions.length > 0 && <div className="rounded-xl border border-twin-border/70 bg-white/80 px-3 py-2"><span className="text-twin-muted">Vehicle constraints</span><span className="mt-1 block font-semibold text-twin-text">{site.vehicleRestrictions.join(" · ")}</span></div>}
      </div>
      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Connected transport ({connectedLegs.length})</div>
        <div className="mt-2 grid gap-2">
          {connectedLegs.slice(0, 8).map((leg) => (
            <button key={leg.transportLegId} className="flex items-center justify-between rounded-xl border border-twin-border/70 bg-white/80 px-3 py-2 text-left text-xs hover:border-twin-blue/50" onClick={() => onSelectLeg(leg)}>
              <span className="min-w-0"><span className="block truncate font-semibold text-twin-text">{leg.asnId ?? leg.shipmentId ?? leg.transportLegId}</span><span className="text-twin-muted">{leg.direction} · {formatStatus(leg.transportStatus)}</span></span>
              <ArrowRight size={14} className="shrink-0 text-twin-blue" />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 rounded-xl border border-twin-border/70 bg-white/70 p-3 text-[11px] leading-relaxed text-twin-muted">{site.dataNotice}</div>
    </aside>
  );
}

function SummaryStrip({ legs, appointments }: { legs: TransportLeg[]; appointments: DockAppointment[] }) {
  const active = legs.filter((leg) => !["delivered", "cancelled"].includes(leg.transportStatus));
  const inbound = active.filter((leg) => leg.direction === "inbound").length;
  const outbound = active.filter((leg) => leg.direction === "outbound").length;
  const exceptions = active.filter((leg) => isDelayedLeg(leg) || hasRoadDisruption(leg) || leg.transportStatus === "exception" || leg.temperatureStatus === "excursion").length;
  const activeAppointments = appointments.filter((appointment) => !["completed", "cancelled"].includes(appointment.status));
  const conflicts = activeAppointments.filter((appointment) => appointment.conflictFlag || appointment.status === "missed").length;
  const coldChain = active.filter((leg) => leg.temperatureRequirement === "2-8C").length;
  const items: Array<{ label: string; value: number; detail: string; tone: Tone }> = [
    { label: "Active movements", value: active.length, detail: `${inbound} inbound · ${outbound} outbound`, tone: active.length ? "focus" : "neutral" },
    { label: "Requires attention", value: exceptions, detail: "Delayed, disrupted, or temperature risk", tone: exceptions ? "critical" : "healthy" },
    { label: "Dock handoffs", value: activeAppointments.length, detail: conflicts ? `${conflicts} appointment conflict${conflicts === 1 ? "" : "s"}` : "No appointment conflicts", tone: conflicts ? "warning" : "healthy" },
    { label: "Cold-chain movements", value: coldChain, detail: "Active transport requiring 2–8°C", tone: coldChain ? "focus" : "neutral" }
  ];
  return (
    <section className="grid shrink-0 gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Transport board indicators">
      {items.map((item) => (
        <CompactMetricCard key={item.label} label={item.label} value={item.value.toLocaleString()} detail={item.detail} tone={item.tone} />
      ))}
    </section>
  );
}

function compactSiteName(value: string) {
  return value
    .replace("Western Singapore Pharmaceutical Distribution Centre", "Western Singapore DC")
    .replace(/\s*\(simulated\)/gi, "");
}

function compactQueueTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not scheduled";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function MovementQueueRow({ leg, model, onSelect }: { leg: TransportLeg; model: TransportModel; onSelect: (leg: TransportLeg) => void }) {
  const origin = model.sites.find((site) => site.siteId === leg.originSiteId);
  const destination = model.sites.find((site) => site.siteId === leg.destinationSiteId);
  const appointment = model.appointments.find((item) => item.transportLegId === leg.transportLegId);
  const operational = operationalTimestamp(leg);
  const originName = origin?.displayName ?? leg.originSiteId;
  const destinationName = destination?.displayName ?? leg.destinationSiteId;
  const timeLabel = operational.label === "Estimated arrival" ? "ETA" : operational.label === "Actual arrival" ? "Arrived" : operational.label;
  const tone = scheduleTone(leg);

  return (
    <button className="group w-full px-3.5 py-3 text-left transition-colors hover:bg-slate-50" onClick={() => onSelect(leg)}>
      <div className="flex items-center gap-2.5">
        <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border", leg.direction === "inbound" ? "border-cyan-100 bg-cyan-50 text-cyan-700" : "border-blue-100 bg-blue-50 text-blue-700")}>{leg.direction === "inbound" ? <ArrowDownToLine size={13} /> : <ArrowUpFromLine size={13} />}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-twin-text">{leg.asnId ?? leg.shipmentId ?? leg.transportLegId}</span>
        <span className={clsx(
          "inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold",
          tone === "critical" ? "text-twin-critical" : tone === "warning" ? "text-amber-700" : "text-emerald-700"
        )}>
          <span className={clsx("h-1.5 w-1.5 rounded-full", tone === "critical" ? "bg-twin-critical" : tone === "warning" ? "bg-amber-500" : "bg-emerald-500")} />
          {scheduleStatusLabel(leg)}
        </span>
      </div>
      <div className="mt-2.5 flex min-w-0 items-center gap-2 pl-0.5 text-[11px]">
        <span className="min-w-0 flex-1 truncate text-twin-muted" title={originName}>{compactSiteName(originName)}</span>
        <ArrowRight size={13} className="shrink-0 text-twin-muted" />
        <span className="min-w-0 flex-1 truncate font-medium text-twin-text" title={destinationName}>{compactSiteName(destinationName)}</span>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[10px] text-twin-muted">
        <span><strong className="font-semibold text-twin-text">{timeLabel}</strong> {compactQueueTime(operational.value)}</span>
        <span className="shrink-0">{appointment?.dockId ? `Dock ${appointment.dockId}` : "No dock"} · {leg.licensePlate}</span>
      </div>
    </button>
  );
}

function TransportNetwork({
  model,
  legs,
  direction,
  routeFilter,
  routeCounts,
  directionCounts,
  selectedLeg,
  selectedSite,
  snapshot,
  notice,
  onDirectionChange,
  onRouteFilterChange,
  onSelectLeg,
  onOpenSiteDetails,
  onCloseSelection
}: {
  model: TransportModel;
  legs: TransportLeg[];
  direction: DirectionFilter;
  routeFilter: RouteFilter;
  routeCounts: Record<RouteFilter, number>;
  directionCounts: Record<DirectionFilter, number>;
  selectedLeg: TransportLeg | null;
  selectedSite: PartnerSite | null;
  snapshot: WarehouseSnapshot;
  notice: string | null;
  onDirectionChange: (direction: DirectionFilter) => void;
  onRouteFilterChange: (filter: RouteFilter) => void;
  onSelectLeg: (leg: TransportLeg) => void;
  onOpenSiteDetails: (siteId: string) => void;
  onCloseSelection: () => void;
}) {
  const [resetNonce, setResetNonce] = useState(0);
  const [queueOpen, setQueueOpen] = useState(true);
  const [queueFilter, setQueueFilter] = useState<"all" | "attention" | "on_track">("all");
  const openInbound = useAppStore((state) => state.openInboundInLogistics);
  const openOutbound = useAppStore((state) => state.openOutboundInLogistics);
  const openDockScheduleInWarehouse = useAppStore((state) => state.openDockScheduleInWarehouse);
  const connectedSiteLegs = selectedSite ? legs.filter((leg) => leg.originSiteId === selectedSite.siteId || leg.destinationSiteId === selectedSite.siteId) : [];
  const sortedQueueLegs = useMemo(() => [...legs].sort((a, b) => Number(transportTone(b) === "critical") - Number(transportTone(a) === "critical") || new Date(operationalTimestamp(a).value).getTime() - new Date(operationalTimestamp(b).value).getTime()), [legs]);
  const attentionQueueLegs = sortedQueueLegs.filter((leg) => ["critical", "warning"].includes(transportTone(leg)));
  const onTrackQueueLegs = sortedQueueLegs.filter((leg) => !["critical", "warning"].includes(transportTone(leg)));
  const visibleQueueLegs = queueFilter === "attention" ? attentionQueueLegs : queueFilter === "on_track" ? onTrackQueueLegs : sortedQueueLegs;
  const showSidePanel = Boolean(selectedLeg || selectedSite || queueOpen);

  const toggleQueue = () => {
    setQueueOpen((open) => !open);
    setResetNonce((value) => value + 1);
  };

  return (
    <section className="panel relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
      <div className={clsx("absolute left-3 top-3 z-[530] rounded-2xl border border-twin-border/80 bg-white/95 px-3 py-2 shadow-card backdrop-blur", showSidePanel ? "right-3 lg:right-[352px]" : "right-3")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-twin-cyan/20 bg-twin-cyan/10 text-twin-blue"><MapIcon size={17} /></span>
            <div><h2 className="text-base font-semibold text-twin-text">Transport network</h2><p className="mt-0.5 text-xs text-twin-muted">Select a movement from the queue or map to inspect its complete handoff</p></div>
          </div>
          <div className="flex items-center gap-2">
            {!selectedLeg && !selectedSite && <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-twin-border bg-white px-3 text-xs font-semibold text-twin-text hover:border-twin-blue/50" onClick={toggleQueue}>{queueOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}{queueOpen ? "Hide queue" : "Show queue"}</button>}
            <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-twin-border bg-white px-3 text-xs font-semibold text-twin-text hover:border-twin-blue/50" onClick={() => setResetNonce((value) => value + 1)}><Crosshair size={14} />Reset map</button>
          </div>
        </div>
        <div className="scroll-optimized mt-2 flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-0.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Flow</span>
          <FilterChip active={direction === "all"} onClick={() => onDirectionChange("all")}>All ({directionCounts.all})</FilterChip>
          <FilterChip active={direction === "inbound"} onClick={() => onDirectionChange("inbound")}><span className="inline-flex items-center gap-1"><ArrowDownToLine size={12} />Inbound ({directionCounts.inbound})</span></FilterChip>
          <FilterChip active={direction === "outbound"} onClick={() => onDirectionChange("outbound")}><span className="inline-flex items-center gap-1"><ArrowUpFromLine size={12} />Outbound ({directionCounts.outbound})</span></FilterChip>
          <span className="mx-1 hidden h-7 w-px bg-twin-border sm:block" />
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Condition</span>
          <FilterChip active={routeFilter === "all"} onClick={() => onRouteFilterChange("all")}>All ({routeCounts.all})</FilterChip>
          <FilterChip active={routeFilter === "cold"} onClick={() => onRouteFilterChange("cold")}>Cold-chain ({routeCounts.cold})</FilterChip>
          <FilterChip active={routeFilter === "delayed"} onClick={() => onRouteFilterChange("delayed")}>Delayed ({routeCounts.delayed})</FilterChip>
          <FilterChip active={routeFilter === "disrupted"} onClick={() => onRouteFilterChange("disrupted")}>Disrupted ({routeCounts.disrupted})</FilterChip>
        </div>
      </div>
      <div className={clsx("grid min-h-0 flex-1", showSidePanel && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
        <div className={clsx("relative min-h-[460px] overflow-hidden border-twin-border/70 lg:min-h-0", showSidePanel && "border-b lg:border-b-0 lg:border-r")}>
          <NetworkMap legs={legs} sites={model.sites} selectedLeg={selectedLeg} selectedSiteId={selectedSite?.siteId ?? null} onSelectLeg={onSelectLeg} onOpenSiteDetails={onOpenSiteDetails} resetNonce={resetNonce} />
          {legs.length === 0 && (
            <div className="absolute inset-0 z-[510] flex items-center justify-center bg-white/80 backdrop-blur-[1px]">
              <div className="rounded-2xl border border-twin-border bg-white/95 px-6 py-5 text-center shadow-card"><div className="font-semibold text-twin-text">No transport legs match</div><p className="mt-1 text-xs text-twin-muted">Clear the flow or condition filter to restore the network.</p><button className="mt-3 rounded-xl bg-twin-blue px-3 py-2 text-xs font-semibold text-white" onClick={() => { onDirectionChange("all"); onRouteFilterChange("all"); }}>Show all movements</button></div>
            </div>
          )}
          {notice && <div className="absolute left-4 top-28 z-[520] max-w-[360px] rounded-xl border border-twin-cyan/25 bg-white/95 px-3 py-2 text-xs text-twin-blue shadow-card backdrop-blur">{notice}</div>}
          <div className="absolute bottom-4 right-4 z-[500] rounded-xl border border-twin-border/80 bg-white/95 px-3 py-2 shadow-card backdrop-blur"><MapLegend /></div>
        </div>
        {showSidePanel && <div className="min-h-0 bg-white/80">
          {selectedLeg ? (
            <TransportDetail
              leg={selectedLeg}
              sites={model.sites}
              appointments={model.appointments}
              snapshot={snapshot}
              embedded
              onClose={onCloseSelection}
              onOpenInbound={openInbound}
              onOpenOutbound={openOutbound}
              onOpenDock={(dockId) => openDockScheduleInWarehouse({
                dockId,
                appointmentId: model.appointments.find((item) => item.transportLegId === selectedLeg.transportLegId)?.dockAppointmentId,
                transportLegId: selectedLeg.transportLegId,
                asnId: selectedLeg.asnId,
                shipmentId: selectedLeg.shipmentId
              })}
            />
          ) : selectedSite ? (
            <SiteDetail site={selectedSite} connectedLegs={connectedSiteLegs} embedded onClose={onCloseSelection} onSelectLeg={onSelectLeg} />
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b border-twin-border/70 px-4 pb-3 pt-3.5">
                <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-twin-text">Movement queue</h3><p className="mt-0.5 text-[11px] text-twin-muted">Prioritized transport movements</p></div><span className="text-[11px] font-medium tabular-nums text-twin-muted">{visibleQueueLegs.length} of {legs.length}</span></div>
                <div className="mt-3 grid grid-cols-3 rounded-lg border border-twin-cyan/20 bg-twin-cyan/5 p-1">
                  {([
                    ["all", "All", legs.length],
                    ["attention", "Attention", attentionQueueLegs.length],
                    ["on_track", "On track", onTrackQueueLegs.length]
                  ] as const).map(([value, label, count]) => (
                    <button
                      key={value}
                      className={clsx("rounded-md px-2 py-1.5 text-[10px] font-semibold transition", queueFilter === value ? "bg-white text-twin-text shadow-sm" : "text-twin-muted hover:text-twin-text")}
                      onClick={() => setQueueFilter(value)}
                    >
                      {label} <span className="ml-0.5 tabular-nums opacity-70">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="scroll-optimized flex-1 overflow-y-auto">
                <div className="divide-y divide-twin-border/70">
                  {visibleQueueLegs.map((leg) => <MovementQueueRow key={leg.transportLegId} leg={leg} model={model} onSelect={onSelectLeg} />)}
                </div>
                {visibleQueueLegs.length === 0 && <div className="px-5 py-10 text-center text-xs text-twin-muted">No movements in this category.</div>}
              </div>
            </div>
          )}
        </div>}
      </div>
    </section>
  );
}

function WmsState({ leg, snapshot }: { leg: TransportLeg; snapshot: WarehouseSnapshot }) {
  const inbound = leg.asnId ? snapshot.inventory.inboundShipments.find((shipment) => shipment.asnId === leg.asnId) : null;
  const outbound = leg.shipmentId ? snapshot.inventory.outboundShipments.find((shipment) => shipment.shipmentId === leg.shipmentId) : null;
  const status = inbound?.inboundStatus ?? outbound?.outboundStatus ?? "Not linked";
  return <StatusChip tone={status === "Not linked" ? "neutral" : wmsStatusTone(status)}>{status}</StatusChip>;
}

function ExecutionBoard({
  legs,
  sites,
  appointments,
  snapshot,
  selectedLegId,
  onSelectLeg
}: {
  legs: TransportLeg[];
  sites: PartnerSite[];
  appointments: DockAppointment[];
  snapshot: WarehouseSnapshot;
  selectedLegId: string | null;
  onSelectLeg: (leg: TransportLeg) => void;
}) {
  const active = legs.filter((leg) => leg.transportStatus !== "cancelled");
  return (
    <section className="panel shrink-0 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-twin-cyan/20 bg-twin-cyan/10 text-twin-blue"><Truck size={18} /></span><div><h3 className="font-semibold text-twin-text">Transport execution board</h3><p className="mt-0.5 text-xs text-twin-muted">One ledger for route progress, WMS readiness, dock assignment, and cold-chain control</p></div></div>
        <StatusChip tone="focus">{active.length} movements</StatusChip>
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-twin-border/70">
        <div className="min-w-[1010px]">
          <div className="grid grid-cols-[145px_minmax(250px,1fr)_180px_180px_170px_74px] gap-3 border-b border-twin-border/70 bg-twin-bg px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-twin-muted">
            <span>Reference</span><span>Lane</span><span>Operational time</span><span>Transport</span><span>Dock / WMS</span><span>Details</span>
          </div>
          <div className="divide-y divide-twin-border/70">
            {active.map((leg) => {
              const origin = sites.find((site) => site.siteId === leg.originSiteId);
              const destination = sites.find((site) => site.siteId === leg.destinationSiteId);
              const appointment = appointments.find((item) => item.transportLegId === leg.transportLegId);
              const selected = selectedLegId === leg.transportLegId;
              const operational = operationalTimestamp(leg);
              return (
                <div key={leg.transportLegId} className={clsx("grid min-h-[76px] grid-cols-[145px_minmax(250px,1fr)_180px_180px_170px_74px] items-center gap-3 px-4 py-2 text-xs transition", selected ? "bg-twin-cyan/10" : "bg-white hover:bg-twin-blue/5")}>
                  <div className="min-w-0"><span className="block font-semibold text-twin-text">{leg.asnId ?? leg.shipmentId ?? leg.transportLegId}</span><span className={clsx("mt-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold", leg.direction === "inbound" ? "bg-cyan-50 text-cyan-700" : "bg-blue-50 text-blue-700")}>{leg.direction === "inbound" ? <ArrowDownToLine size={11} /> : <ArrowUpFromLine size={11} />}{leg.direction}</span></div>
                  <button className="min-w-0 text-left" title={`${origin?.displayName ?? leg.originSiteId} → ${destination?.displayName ?? leg.destinationSiteId}`} onClick={() => onSelectLeg(leg)}><span className="flex items-center gap-1 truncate font-semibold text-twin-text"><span className="truncate">{origin?.displayName ?? leg.originSiteId}</span><ArrowRight size={11} className="shrink-0" /><span className="truncate">{destination?.displayName ?? leg.destinationSiteId}</span></span><span className="mt-1 block text-[10px] text-twin-muted">{leg.distanceKm.toFixed(1)} km · {formatStatus(leg.transportStatus)}</span><span className="mt-1"><StatusChip tone={scheduleTone(leg)}>{scheduleStatusLabel(leg)}</StatusChip></span></button>
                  <span><span className="block font-semibold text-twin-text">{formatLocalDateTime(operational.value)}</span><span className="mt-1 block text-[10px] text-twin-muted">{operational.label}</span></span>
                  <span className="min-w-0"><span className="block truncate font-semibold text-twin-text">{leg.carrierName}</span><span className="mt-1 block truncate text-[10px] text-twin-muted">{leg.licensePlate} · {leg.vehicleType}</span><span className={clsx("mt-1 block text-[10px]", leg.temperatureStatus === "excursion" ? "font-semibold text-twin-critical" : "text-twin-muted")}>{leg.temperatureRequirement} · {formatStatus(leg.temperatureStatus)}</span></span>
                  <span className="min-w-0"><span className="block font-semibold text-twin-text">{appointment?.dockId ? `Dock ${appointment.dockId}` : "No dock"}</span><span className="mt-1 block text-[10px] text-twin-muted">{appointment ? formatStatus(appointment.status) : "No appointment"}</span><span className="mt-1 block"><WmsState leg={leg} snapshot={snapshot} /></span></span>
                  <button className="inline-flex items-center justify-center rounded-lg border border-twin-border bg-white px-2 py-2 font-semibold text-twin-blue hover:border-twin-blue/50" onClick={() => onSelectLeg(leg)}>View</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LogisticsView() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const scenario = useAppStore((state) => state.scenarioResult);
  const routeFilter = useAppStore((state) => state.logisticsRouteFilter);
  const setRouteFilter = useAppStore((state) => state.setLogisticsRouteFilter);
  const direction = useAppStore((state) => state.logisticsDirectionFilter);
  const setDirection = useAppStore((state) => state.setLogisticsDirectionFilter);
  const selectedRouteId = useAppStore((state) => state.selectedRouteId);
  const setSelectedRoute = useAppStore((state) => state.setSelectedRoute);
  const selectedTransportLegId = useAppStore((state) => state.selectedTransportLegId);
  const setSelectedTransportLeg = useAppStore((state) => state.setSelectedTransportLeg);
  const selectedPartnerSiteId = useAppStore((state) => state.selectedPartnerSiteId);
  const setSelectedPartnerSite = useAppStore((state) => state.setSelectedPartnerSite);
  const workspace = useAppStore((state) => state.logisticsWorkspace);
  const setWorkspace = useAppStore((state) => state.setLogisticsWorkspace);
  const openTransportLegInLogistics = useAppStore((state) => state.openTransportLegInLogistics);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const autoRefreshAttempted = useRef(false);

  const model = useMemo(() => transportModel(snapshot, scenario), [scenario, snapshot]);
  const visibleLegs = useMemo(() => model.legs.filter((leg) => {
    if (direction !== "all" && leg.direction !== direction) return false;
    if (routeFilter === "cold") return leg.temperatureRequirement === "2-8C";
    if (routeFilter === "delayed") return isDelayedLeg(leg);
    if (routeFilter === "disrupted") return hasRoadDisruption(leg);
    return true;
  }), [direction, model.legs, routeFilter]);

  const selectedLeg = selectedTransportLegId ? visibleLegs.find((leg) => leg.transportLegId === selectedTransportLegId) ?? null : null;
  const selectedSite = selectedPartnerSiteId ? model.sites.find((site) => site.siteId === selectedPartnerSiteId) ?? null : null;
  const directionScoped = model.legs.filter((leg) => direction === "all" || leg.direction === direction);
  const routeCounts: Record<RouteFilter, number> = {
    all: directionScoped.length,
    cold: directionScoped.filter((leg) => leg.temperatureRequirement === "2-8C").length,
    delayed: directionScoped.filter(isDelayedLeg).length,
    disrupted: directionScoped.filter(hasRoadDisruption).length
  };
  const directionCounts: Record<DirectionFilter, number> = {
    all: model.legs.length,
    inbound: model.legs.filter((leg) => leg.direction === "inbound").length,
    outbound: model.legs.filter((leg) => leg.direction === "outbound").length
  };
  const latestUpdatedAt = model.legs.reduce<string | null>((latest, leg) => {
    if (!latest) return leg.lastUpdatedAt;
    return new Date(leg.lastUpdatedAt).getTime() > new Date(latest).getTime() ? leg.lastUpdatedAt : latest;
  }, null);
  const movementCount = model.legs.filter((leg) => leg.transportStatus !== "cancelled").length;

  const selectLeg = (leg: TransportLeg) => {
    setSelectedPartnerSite(null);
    setSelectedTransportLeg(leg.transportLegId);
    setSelectedRoute(leg.routeId);
  };

  const closeSelection = () => {
    setSelectedTransportLeg(null);
    setSelectedPartnerSite(null);
    setSelectedRoute(null);
  };

  useEffect(() => {
    if (!selectedRouteId || selectedTransportLegId) return;
    const linked = model.legs.find((leg) => leg.routeId === selectedRouteId || leg.transportLegId === selectedRouteId);
    if (linked) setSelectedTransportLeg(linked.transportLegId);
  }, [model.legs, selectedRouteId, selectedTransportLegId, setSelectedTransportLeg]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      if (model.unified) {
        await refreshRoutes();
        const refreshed = await getWarehouse();
        useAppStore.getState().setSnapshot(refreshed);
        setNotice("Road geometry and the shared WMS, TMS, yard, and site snapshot were refreshed.");
      } else {
        const routes = await refreshRoutes();
        useAppStore.setState((state) => ({ snapshot: state.snapshot ? { ...state.snapshot, routes } : state.snapshot }));
        setNotice("Legacy road geometry refreshed; unified transport records will replace this fallback after the next warehouse refresh.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Refresh failed; the last shared snapshot remains active.");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (refreshing || autoRefreshAttempted.current || !model.legs.some((leg) => !leg.isRealRoadRoute)) return;
    autoRefreshAttempted.current = true;
    void handleRefresh();
  }, [model.legs, model.unified, refreshing]);

  return (
    <div className={clsx("scroll-optimized flex h-full min-h-0 flex-col gap-2 px-1 pb-2 pr-2", workspace === "network" ? "overflow-hidden" : "overflow-auto")}>
      <section className="shrink-0 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-xl font-semibold tracking-tight text-twin-text">Logistics control tower</h1><p className="mt-0.5 max-w-3xl text-xs text-twin-muted">Transport network, inbound and outbound execution, and warehouse handoffs from one shared operational snapshot.</p></div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="rounded-xl border border-twin-border/70 bg-white/70 px-3 py-1.5 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-twin-muted">Latest transport update</div>
              <div className="mt-0.5 text-xs font-semibold text-twin-text">{formatLocalDateTime(latestUpdatedAt)}</div>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-twin-green/25 bg-twin-green/10 px-3 py-1.5 text-xs font-semibold text-twin-green"><ShieldCheck size={15} />{model.unified ? "Shared data connected" : "Compatibility mode"}</div>
            <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-twin-orange px-3 text-xs font-semibold text-white shadow-sm disabled:opacity-60" onClick={() => void handleRefresh()} disabled={refreshing}><RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />{refreshing ? "Refreshing" : "Refresh"}</button>
          </div>
        </div>
      </section>
      {notice && <div className="flex items-center justify-between gap-3 rounded-xl border border-twin-cyan/25 bg-white/75 px-3 py-2 text-xs text-twin-blue"><span>{notice}</span><button className="shrink-0 text-twin-muted hover:text-twin-text" onClick={() => setNotice(null)} aria-label="Dismiss refresh notice"><X size={14} /></button></div>}
      <WorkspaceNav
        label="Logistics workspace"
        value={workspace}
        onChange={setWorkspace}
        items={[
          { id: "network", label: "Network", detail: `${visibleLegs.length} visible`, icon: MapIcon },
          { id: "inbound", label: "Inbound", detail: `${snapshot.inventory.inboundShipments.filter((item) => !["Putaway Complete", "Closed"].includes(item.inboundStatus)).length} active`, icon: ArrowDownToLine },
          { id: "outbound", label: "Outbound", detail: `${snapshot.inventory.outboundShipments.filter((item) => !["Dispatched", "Delivered"].includes(item.outboundStatus)).length} active`, icon: ArrowUpFromLine },
          { id: "transport", label: "Transport board", detail: `${movementCount} movements`, icon: Truck }
        ]}
      />
      {workspace === "network" && (
        <TransportNetwork
          model={model}
          legs={visibleLegs}
          direction={direction}
          routeFilter={routeFilter}
          routeCounts={routeCounts}
          directionCounts={directionCounts}
          selectedLeg={selectedLeg}
          selectedSite={selectedSite}
          snapshot={snapshot}
          notice={null}
          onDirectionChange={setDirection}
          onRouteFilterChange={setRouteFilter}
          onSelectLeg={selectLeg}
          onOpenSiteDetails={setSelectedPartnerSite}
          onCloseSelection={closeSelection}
        />
      )}
      {(workspace === "inbound" || workspace === "outbound") && (
        <LogisticsFlowView snapshot={snapshot} direction={workspace} />
      )}
      {workspace === "transport" && (
        <div className="space-y-3">
          <SummaryStrip legs={model.legs} appointments={model.appointments} />
          <ExecutionBoard
            legs={model.legs}
            sites={model.sites}
            appointments={model.appointments}
            snapshot={snapshot}
            selectedLegId={selectedTransportLegId}
            onSelectLeg={(leg) => openTransportLegInLogistics(leg.transportLegId, "network")}
          />
        </div>
      )}
      <section className="shrink-0 rounded-xl border border-twin-border/70 bg-white/60 px-3 py-2 text-[11px] leading-relaxed text-twin-muted">
        <div className="flex items-start gap-3"><MapPin size={16} className="mt-0.5 shrink-0 text-twin-blue" /><div><span className="font-semibold text-twin-text">Simulation and location disclosure.</span> {model.disclosure}</div></div>
      </section>
    </div>
  );
}
