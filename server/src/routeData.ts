import type {
  DockAppointmentStatus,
  LatLng,
  PartnerSite,
  RiskLevel,
  TemperatureCapability,
  TemperatureComplianceStatus,
  TransportDirection,
  TransportStatus
} from "@twinops/shared";

export const SIMULATION_DISCLOSURE =
  "Public Singapore locations are used as geographic anchors for a simulated pharmaceutical network. The data does not represent actual supplier, customer, carrier, or commercial relationships.";

export type PartnerSiteSeed = PartnerSite;

export type RouteSeedConfig = {
  id: string;
  transportLegId: string;
  direction: TransportDirection;
  asnId: string | null;
  shipmentId: string | null;
  name: string;
  origin: string;
  originType: string;
  originSiteId: string;
  originLocation: LatLng;
  destination: string;
  destinationSiteId: string;
  destinationLocation: LatLng;
  baseEtaMinutes: number;
  distanceKm: number;
  expectedSkus: string[];
  coldChainRequired: boolean;
  riskLevel: RiskLevel;
  riskNote: string;
  receivingImpact: string;
  mitigationSuggestion: string;
  fallbackPolyline: LatLng[];
  carrierId: string;
  carrierName: string;
  vehicleId: string;
  vehicleType: string;
  licensePlate: string;
  driverId: string | null;
  plannedDepartureOffsetMinutes: number;
  actualDepartureOffsetMinutes: number | null;
  plannedArrivalOffsetMinutes: number;
  actualArrivalOffsetMinutes: number | null;
  deliveryWindowStartOffsetMinutes: number | null;
  deliveryWindowEndOffsetMinutes: number | null;
  dockAppointmentId: string;
  dockId: string;
  appointmentStartOffsetMinutes: number;
  appointmentEndOffsetMinutes: number;
  appointmentStatus: DockAppointmentStatus;
  transportStatus: TransportStatus;
  temperatureRequirement: TemperatureCapability;
  temperatureMin: number | null;
  temperatureMax: number | null;
  temperatureStatus: TemperatureComplianceStatus;
  temperatureLoggerId: string | null;
  sealNumber: string | null;
  proofOfDeliveryId: string | null;
  lastKnownLocation: LatLng | null;
};

const site = (input: Omit<PartnerSiteSeed, "countryCode" | "timezone" | "simulated" | "dataNotice">): PartnerSiteSeed => ({
  ...input,
  countryCode: "SG",
  timezone: "Asia/Singapore",
  simulated: true,
  dataNotice: SIMULATION_DISCLOSURE
});

export const PARTNER_SITE_CONFIGS: PartnerSiteSeed[] = [
  site({
    siteId: "SITE-WH-WEST",
    partnerId: "PARTNER-TWINOPS",
    partnerName: "TwinOps Academic Simulation",
    siteCode: "SG-WEST-DC",
    role: "warehouse",
    displayName: "Western Singapore Pharmaceutical Distribution Centre (simulated)",
    address: "Jalan Buroh industrial logistics area, Singapore",
    postalCode: "128817",
    location: { lat: 1.3119, lng: 103.7165 },
    receivingWindow: "24 hours; controlled dock appointment required",
    temperatureCapabilities: ["ambient", "2-8C", "15-25C"],
    vehicleRestrictions: ["Pre-booked slot", "GDP-qualified vehicle for controlled-temperature loads", "Seal check at gate"],
    publicLocationReference: "Jalan Buroh industrial logistics area"
  }),
  site({
    siteId: "SITE-CHANGI-AFC",
    partnerId: "PARTNER-AIR-GATEWAY",
    partnerName: "Simulated Airfreight Gateway Partner",
    siteCode: "SG-AFC",
    role: "airport",
    displayName: "Changi Airfreight Centre",
    address: "Airline Road, Changi Airfreight Centre, Singapore",
    postalCode: "819827",
    location: { lat: 1.3639, lng: 103.99 },
    receivingWindow: "Mon-Sun 00:00-23:59; cargo release appointment required",
    temperatureCapabilities: ["ambient", "2-8C", "15-25C"],
    vehicleRestrictions: ["Airfreight security clearance", "Cargo release reference", "Temperature hand-off record"],
    publicLocationReference: "Changi Airfreight Centre"
  }),
  site({
    siteId: "SITE-TUAS-BIOMED",
    partnerId: "PARTNER-SUPPLIER-TUAS",
    partnerName: "Simulated Tuas Biopharma Supplier",
    siteCode: "SG-TUAS-BIO",
    role: "supplier",
    displayName: "Tuas Biomedical Park supplier campus (simulated)",
    address: "Tuas Biomedical Park, Tuas South Avenue 3, Singapore",
    postalCode: "637746",
    location: { lat: 1.3183, lng: 103.636 },
    receivingWindow: "Mon-Fri 07:00-19:00",
    temperatureCapabilities: ["2-8C", "15-25C"],
    vehicleRestrictions: ["GDP-qualified vehicle", "Preconditioned reefer", "Security seal required"],
    publicLocationReference: "JTC Tuas Biomedical Park"
  }),
  site({
    siteId: "SITE-JURONG-MFG",
    partnerId: "PARTNER-SUPPLIER-JURONG",
    partnerName: "Simulated Jurong Pharmaceutical Manufacturer",
    siteCode: "SG-JURONG-MFG",
    role: "supplier",
    displayName: "Jurong manufacturing supplier campus (simulated)",
    address: "Jurong Island Highway industrial area, Singapore",
    postalCode: "627878",
    location: { lat: 1.2778, lng: 103.7112 },
    receivingWindow: "Mon-Sat 07:00-20:00",
    temperatureCapabilities: ["ambient", "15-25C"],
    vehicleRestrictions: ["Site security clearance", "Covered vehicle", "Appointment reference"],
    publicLocationReference: "Jurong Island industrial area"
  }),
  site({
    siteId: "SITE-SENOKO-COLD",
    partnerId: "PARTNER-SUPPLIER-COLD",
    partnerName: "Simulated Northern Cold-chain Supplier",
    siteCode: "SG-SENOKO-COLD",
    role: "supplier",
    displayName: "Senoko cold-chain supplier hub (simulated)",
    address: "Senoko industrial estate, Singapore",
    postalCode: "758156",
    location: { lat: 1.4628, lng: 103.8045 },
    receivingWindow: "Mon-Sun 06:00-22:00",
    temperatureCapabilities: ["2-8C", "15-25C"],
    vehicleRestrictions: ["Reefer validation current", "Continuous temperature logger", "Tail-lift preferred"],
    publicLocationReference: "Senoko industrial estate"
  }),
  site({
    siteId: "SITE-WOODLANDS-PKG",
    partnerId: "PARTNER-SUPPLIER-PKG",
    partnerName: "Simulated Packaging Supplier",
    siteCode: "SG-WOODLANDS-PKG",
    role: "supplier",
    displayName: "Woodlands packaging supplier (simulated)",
    address: "Woodlands Sector 1 industrial area, Singapore",
    postalCode: "738068",
    location: { lat: 1.4469, lng: 103.7992 },
    receivingWindow: "Mon-Fri 08:00-18:00",
    temperatureCapabilities: ["ambient"],
    vehicleRestrictions: ["Covered vehicle", "Dry load compartment", "Pallet exchange recorded"],
    publicLocationReference: "Woodlands industrial area"
  }),
  site({
    siteId: "SITE-TOH-GUAN-RETURN",
    partnerId: "PARTNER-RETURNS",
    partnerName: "Simulated Healthcare Returns Consolidator",
    siteCode: "SG-RETURNS",
    role: "return_origin",
    displayName: "Toh Guan healthcare returns point (simulated)",
    address: "Toh Guan logistics area, Singapore",
    postalCode: "608831",
    location: { lat: 1.3338, lng: 103.7466 },
    receivingWindow: "Mon-Fri 09:00-17:00",
    temperatureCapabilities: ["ambient", "2-8C", "15-25C"],
    vehicleRestrictions: ["Return authorisation required", "Segregated handling units", "Do not commingle with saleable stock"],
    publicLocationReference: "Toh Guan logistics area"
  }),
  site({
    siteId: "SITE-SGH",
    partnerId: "PARTNER-CUSTOMER-SGH",
    partnerName: "Simulated Public Healthcare Customer",
    siteCode: "SG-SGH",
    role: "customer",
    displayName: "Singapore General Hospital campus",
    address: "Outram Road, Singapore",
    postalCode: "169608",
    location: { lat: 1.2796, lng: 103.8357 },
    receivingWindow: "Mon-Fri 08:00-17:00; urgent medical delivery by arrangement",
    temperatureCapabilities: ["ambient", "2-8C", "15-25C"],
    vehicleRestrictions: ["Hospital delivery window", "No unattended delivery", "POD required"],
    publicLocationReference: "Singapore General Hospital public campus location"
  }),
  site({
    siteId: "SITE-BIOPOLIS-IMM",
    partnerId: "PARTNER-CUSTOMER-IMM",
    partnerName: "Simulated National Immunisation Customer",
    siteCode: "SG-IMM-HUB",
    role: "customer",
    displayName: "National immunisation distribution node at one-north (simulated)",
    address: "Biopolis Way, one-north, Singapore",
    postalCode: "138667",
    location: { lat: 1.3039, lng: 103.7922 },
    receivingWindow: "Mon-Sat 07:00-19:00",
    temperatureCapabilities: ["2-8C"],
    vehicleRestrictions: ["Cold-chain vehicle", "Logger download at receipt", "POD and seal reconciliation"],
    publicLocationReference: "Biopolis public district"
  }),
  site({
    siteId: "SITE-TTSH",
    partnerId: "PARTNER-CUSTOMER-TTSH",
    partnerName: "Simulated Public Healthcare Customer",
    siteCode: "SG-TTSH",
    role: "customer",
    displayName: "Tan Tock Seng Hospital campus",
    address: "11 Jalan Tan Tock Seng, Singapore",
    postalCode: "308433",
    location: { lat: 1.3214, lng: 103.8455 },
    receivingWindow: "Mon-Fri 08:00-17:00",
    temperatureCapabilities: ["ambient", "2-8C", "15-25C"],
    vehicleRestrictions: ["Hospital loading-bay booking", "POD required"],
    publicLocationReference: "Tan Tock Seng Hospital public campus location"
  }),
  site({
    siteId: "SITE-TAMPINES-RETAIL",
    partnerId: "PARTNER-CUSTOMER-RETAIL",
    partnerName: "Simulated Retail Pharmacy Network",
    siteCode: "SG-RETAIL-DC",
    role: "customer",
    displayName: "Tampines retail pharmacy consolidation point (simulated)",
    address: "Tampines LogisPark area, Singapore",
    postalCode: "528765",
    location: { lat: 1.3603, lng: 103.9344 },
    receivingWindow: "Mon-Sat 07:00-20:00",
    temperatureCapabilities: ["ambient", "15-25C"],
    vehicleRestrictions: ["Booked unloading slot", "Pallet label scan", "POD required"],
    publicLocationReference: "Tampines logistics district"
  }),
  site({
    siteId: "SITE-NCCS",
    partnerId: "PARTNER-CUSTOMER-NCCS",
    partnerName: "Simulated Public Healthcare Customer",
    siteCode: "SG-NCCS",
    role: "customer",
    displayName: "National Cancer Centre Singapore campus",
    address: "30 Hospital Boulevard, Singapore",
    postalCode: "168583",
    location: { lat: 1.2791, lng: 103.8349 },
    receivingWindow: "Mon-Fri 08:00-17:00; medical priority slot by arrangement",
    temperatureCapabilities: ["ambient", "2-8C", "15-25C"],
    vehicleRestrictions: ["Hospital delivery window", "Release documentation required", "POD required"],
    publicLocationReference: "National Cancer Centre Singapore public campus location"
  }),
  site({
    siteId: "SITE-CGH",
    partnerId: "PARTNER-CUSTOMER-CGH",
    partnerName: "Simulated Public Healthcare Customer",
    siteCode: "SG-CGH",
    role: "customer",
    displayName: "Changi General Hospital campus",
    address: "2 Simei Street 3, Singapore",
    postalCode: "529889",
    location: { lat: 1.3404, lng: 103.9493 },
    receivingWindow: "Mon-Fri 08:00-17:00",
    temperatureCapabilities: ["ambient", "2-8C", "15-25C"],
    vehicleRestrictions: ["Hospital loading-bay booking", "POD required"],
    publicLocationReference: "Changi General Hospital public campus location"
  }),
  site({
    siteId: "SITE-NUH",
    partnerId: "PARTNER-CUSTOMER-NUH",
    partnerName: "Simulated Public Healthcare Customer",
    siteCode: "SG-NUH",
    role: "customer",
    displayName: "National University Hospital campus",
    address: "5 Lower Kent Ridge Road, Singapore",
    postalCode: "119074",
    location: { lat: 1.2937, lng: 103.7832 },
    receivingWindow: "Mon-Fri 08:00-17:00",
    temperatureCapabilities: ["ambient", "2-8C", "15-25C"],
    vehicleRestrictions: ["Hospital loading-bay booking", "POD required"],
    publicLocationReference: "National University Hospital public campus location"
  }),
  site({
    siteId: "SITE-CCK-POLY",
    partnerId: "PARTNER-CUSTOMER-POLY",
    partnerName: "Simulated Polyclinic Network",
    siteCode: "SG-POLY-CCK",
    role: "customer",
    displayName: "Choa Chu Kang Polyclinic",
    address: "2 Teck Whye Crescent, Singapore",
    postalCode: "688846",
    location: { lat: 1.3814, lng: 103.7512 },
    receivingWindow: "Mon-Sat 08:00-16:00",
    temperatureCapabilities: ["ambient", "2-8C", "15-25C"],
    vehicleRestrictions: ["Small rigid truck or van", "POD required"],
    publicLocationReference: "Choa Chu Kang Polyclinic public location"
  })
];

const bySite = new Map(PARTNER_SITE_CONFIGS.map((item) => [item.siteId, item]));
const location = (siteId: string) => bySite.get(siteId)!.location;
const label = (siteId: string) => bySite.get(siteId)!.displayName;

export const WAREHOUSE_SITE_ID = "SITE-WH-WEST";
export const WAREHOUSE_LOCATION: LatLng = location(WAREHOUSE_SITE_ID);
export const WAREHOUSE_LABEL = label(WAREHOUSE_SITE_ID);

type RouteInput = Omit<RouteSeedConfig, "origin" | "originLocation" | "destination" | "destinationLocation" | "fallbackPolyline"> & {
  via?: LatLng[];
};

function route(input: RouteInput): RouteSeedConfig {
  const originLocation = location(input.originSiteId);
  const destinationLocation = location(input.destinationSiteId);
  return {
    ...input,
    origin: label(input.originSiteId),
    originLocation,
    destination: label(input.destinationSiteId),
    destinationLocation,
    fallbackPolyline: [originLocation, ...(input.via ?? []), destinationLocation]
  };
}

const inboundDefaults = {
  direction: "inbound" as const,
  destinationSiteId: WAREHOUSE_SITE_ID,
  shipmentId: null,
  driverId: null,
  proofOfDeliveryId: null,
  deliveryWindowStartOffsetMinutes: null,
  deliveryWindowEndOffsetMinutes: null
};

const outboundDefaults = {
  direction: "outbound" as const,
  originSiteId: WAREHOUSE_SITE_ID,
  asnId: null,
  driverId: null,
  temperatureStatus: "compliant" as const,
  actualDepartureOffsetMinutes: null,
  actualArrivalOffsetMinutes: null,
  proofOfDeliveryId: null
};

export const TRANSPORT_ROUTE_CONFIGS: RouteSeedConfig[] = [
  route({ ...inboundDefaults, id: "ROUTE-CHANGI", transportLegId: "LEG-IN-1001", asnId: "ASN-1001", name: "Changi air cargo to Western DC", originType: "Air freight cold-chain gateway", originSiteId: "SITE-CHANGI-AFC", baseEtaMinutes: 52, distanceKm: 42.5, expectedSkus: ["PH-COLD-FLUVAX-PFS", "PH-COLD-ADAL40-PEN"], coldChainRequired: true, riskLevel: "low", riskNote: "Cold-chain hand-off and airport cargo-release timing are the principal risks.", receivingImpact: "Supplies vaccine and biologic receipts to controlled receiving.", mitigationSuggestion: "Protect the cold dock slot and verify logger continuity before unloading.", carrierId: "CARRIER-SIM-COLD", carrierName: "Simulated GDP Cold Logistics", vehicleId: "VEH-COLD-17", vehicleType: "Refrigerated rigid truck", licensePlate: "SIM-1701", plannedDepartureOffsetMinutes: 60, actualDepartureOffsetMinutes: 75, plannedArrivalOffsetMinutes: 112, actualArrivalOffsetMinutes: null, dockAppointmentId: "APT-IN-1001", dockId: "D2", appointmentStartOffsetMinutes: 105, appointmentEndOffsetMinutes: 165, appointmentStatus: "booked", transportStatus: "in_transit", temperatureRequirement: "2-8C", temperatureMin: 2, temperatureMax: 8, temperatureStatus: "compliant", temperatureLoggerId: "TL-CHG-1001", sealNumber: "SIM-SEAL-1001", lastKnownLocation: { lat: 1.327, lng: 103.861 }, via: [{ lat: 1.355, lng: 103.947 }, { lat: 1.337, lng: 103.846 }, { lat: 1.326, lng: 103.77 }] }),
  route({ ...inboundDefaults, id: "ROUTE-JURONG", transportLegId: "LEG-IN-1002", asnId: "ASN-1002", name: "Jurong manufacturing to Western DC", originType: "Pharmaceutical manufacturing source", originSiteId: "SITE-JURONG-MFG", baseEtaMinutes: 34, distanceKm: 14.8, expectedSkus: ["PH-CRT-SALB100-INH", "PH-CRT-AMOX500-CAP"], coldChainRequired: false, riskLevel: "low", riskNote: "Short industrial lane; gate congestion can affect the booked receiving window.", receivingImpact: "Feeds controlled-room-temperature receiving.", mitigationSuggestion: "Retain the booked door until seal and paperwork checks finish.", carrierId: "CARRIER-SIM-GDP", carrierName: "Simulated GDP Ground Transport", vehicleId: "VEH-CRT-08", vehicleType: "Insulated box truck", licensePlate: "SIM-0802", plannedDepartureOffsetMinutes: -75, actualDepartureOffsetMinutes: -68, plannedArrivalOffsetMinutes: -41, actualArrivalOffsetMinutes: -34, dockAppointmentId: "APT-IN-1002", dockId: "D1", appointmentStartOffsetMinutes: -45, appointmentEndOffsetMinutes: 20, appointmentStatus: "at_dock", transportStatus: "at_dock", temperatureRequirement: "15-25C", temperatureMin: 15, temperatureMax: 25, temperatureStatus: "compliant", temperatureLoggerId: "TL-JUR-1002", sealNumber: "SIM-SEAL-1002", lastKnownLocation: WAREHOUSE_LOCATION, via: [{ lat: 1.292, lng: 103.716 }, { lat: 1.304, lng: 103.717 }] }),
  route({ ...inboundDefaults, id: "ROUTE-TUAS", transportLegId: "LEG-IN-1003", asnId: "ASN-1003", name: "Tuas Biomedical Park to Western DC", originType: "Biopharma manufacturing source", originSiteId: "SITE-TUAS-BIOMED", baseEtaMinutes: 31, distanceKm: 12.6, expectedSkus: ["PH-COLD-FLUVAX-PFS", "PH-COLD-INSGLA-PEN"], coldChainRequired: true, riskLevel: "low", riskNote: "Cold-chain exposure grows if the pickup or dock slot is resequenced.", receivingImpact: "Replenishes vaccine and insulin cold storage.", mitigationSuggestion: "Precondition the reefer and keep cold staging capacity available.", carrierId: "CARRIER-SIM-COLD", carrierName: "Simulated GDP Cold Logistics", vehicleId: "VEH-COLD-22", vehicleType: "Refrigerated rigid truck", licensePlate: "SIM-2203", plannedDepartureOffsetMinutes: 315, actualDepartureOffsetMinutes: null, plannedArrivalOffsetMinutes: 346, actualArrivalOffsetMinutes: null, dockAppointmentId: "APT-IN-1003", dockId: "D4", appointmentStartOffsetMinutes: 340, appointmentEndOffsetMinutes: 400, appointmentStatus: "booked", transportStatus: "vehicle_assigned", temperatureRequirement: "2-8C", temperatureMin: 2, temperatureMax: 8, temperatureStatus: "unknown", temperatureLoggerId: "TL-TUAS-1003", sealNumber: null, lastKnownLocation: location("SITE-TUAS-BIOMED"), via: [{ lat: 1.314, lng: 103.661 }, { lat: 1.311, lng: 103.692 }] }),
  route({ ...inboundDefaults, id: "ROUTE-SUPPLIER-COLD", transportLegId: "LEG-IN-1004", asnId: "ASN-1004", name: "Senoko cold hub to Western DC", originType: "External cold-chain supplier hub", originSiteId: "SITE-SENOKO-COLD", baseEtaMinutes: 46, distanceKm: 34.1, expectedSkus: ["PH-COLD-INSHUM-VIAL", "PH-COLD-ADAL40-PEN"], coldChainRequired: true, riskLevel: "medium", riskNote: "Cross-island travel and concurrent cold-dock demand can narrow temperature-safe handling time.", receivingImpact: "Feeds controlled biologic and insulin replenishment.", mitigationSuggestion: "Maintain continuous logger telemetry and reserve a cold receiving door.", carrierId: "CARRIER-SIM-COLD", carrierName: "Simulated GDP Cold Logistics", vehicleId: "VEH-COLD-31", vehicleType: "Refrigerated rigid truck", licensePlate: "SIM-3104", plannedDepartureOffsetMinutes: 135, actualDepartureOffsetMinutes: 142, plannedArrivalOffsetMinutes: 181, actualArrivalOffsetMinutes: null, dockAppointmentId: "APT-IN-1004", dockId: "D6", appointmentStartOffsetMinutes: 175, appointmentEndOffsetMinutes: 235, appointmentStatus: "booked", transportStatus: "in_transit", temperatureRequirement: "2-8C", temperatureMin: 2, temperatureMax: 8, temperatureStatus: "compliant", temperatureLoggerId: "TL-SEN-1004", sealNumber: "SIM-SEAL-1004", lastKnownLocation: { lat: 1.389, lng: 103.781 }, via: [{ lat: 1.425, lng: 103.793 }, { lat: 1.37, lng: 103.769 }, { lat: 1.333, lng: 103.736 }] }),
  route({ ...inboundDefaults, id: "ROUTE-PACKAGING", transportLegId: "LEG-IN-1005", asnId: "ASN-1005", name: "Woodlands packaging supplier to Western DC", originType: "Ambient packaging supplier", originSiteId: "SITE-WOODLANDS-PKG", baseEtaMinutes: 43, distanceKm: 31.6, expectedSkus: ["PH-AMB-ORS20-SACH", "PH-AMB-POVI10-SOL"], coldChainRequired: false, riskLevel: "low", riskNote: "Packaging availability can constrain dispatch even when medicine stock is available.", receivingImpact: "Supplies ambient handling and dispatch materials.", mitigationSuggestion: "Complete quantity verification before releasing the vehicle and route discrepancies to procurement.", carrierId: "CARRIER-SIM-AMBIENT", carrierName: "Simulated Singapore Distribution", vehicleId: "VEH-AMB-12", vehicleType: "Curtainside truck", licensePlate: "SIM-1205", plannedDepartureOffsetMinutes: -190, actualDepartureOffsetMinutes: -182, plannedArrivalOffsetMinutes: -147, actualArrivalOffsetMinutes: -139, dockAppointmentId: "APT-IN-1005", dockId: "D3", appointmentStartOffsetMinutes: -150, appointmentEndOffsetMinutes: -80, appointmentStatus: "completed", transportStatus: "arrived", temperatureRequirement: "ambient", temperatureMin: null, temperatureMax: 30, temperatureStatus: "not_required", temperatureLoggerId: null, sealNumber: "SIM-SEAL-1005", lastKnownLocation: WAREHOUSE_LOCATION, via: [{ lat: 1.407, lng: 103.781 }, { lat: 1.36, lng: 103.755 }, { lat: 1.329, lng: 103.728 }] }),
  route({ ...inboundDefaults, id: "ROUTE-QA-RETURN", transportLegId: "LEG-IN-1006", asnId: "ASN-1006", name: "Toh Guan returns point to Western DC", originType: "Healthcare return consolidation point", originSiteId: "SITE-TOH-GUAN-RETURN", baseEtaMinutes: 18, distanceKm: 8.1, expectedSkus: ["PH-CRT-AMLO5-TAB", "PH-CRT-OMEP20-CAP"], coldChainRequired: false, riskLevel: "medium", riskNote: "Returned stock requires segregation and quality disposition before any inventory use.", receivingImpact: "Feeds quarantine and QA-hold receiving only.", mitigationSuggestion: "Unload to the returns cage and prevent availability until QMS disposition.", carrierId: "CARRIER-SIM-RETURNS", carrierName: "Simulated Healthcare Returns Transport", vehicleId: "VEH-RET-03", vehicleType: "Segregated box van", licensePlate: "SIM-0306", plannedDepartureOffsetMinutes: -90, actualDepartureOffsetMinutes: -82, plannedArrivalOffsetMinutes: -72, actualArrivalOffsetMinutes: -65, dockAppointmentId: "APT-IN-1006", dockId: "D5", appointmentStartOffsetMinutes: -70, appointmentEndOffsetMinutes: -10, appointmentStatus: "unloading", transportStatus: "unloading", temperatureRequirement: "15-25C", temperatureMin: 15, temperatureMax: 25, temperatureStatus: "compliant", temperatureLoggerId: "TL-RET-1006", sealNumber: "SIM-SEAL-1006", lastKnownLocation: WAREHOUSE_LOCATION, via: [{ lat: 1.329, lng: 103.738 }, { lat: 1.318, lng: 103.728 }] }),

  route({ ...outboundDefaults, id: "ROUTE-DISPATCH-SGH", transportLegId: "LEG-OUT-001", shipmentId: "SHIP-001", name: "Western DC to Singapore General Hospital", originType: "Pharmaceutical distribution centre", destinationSiteId: "SITE-SGH", baseEtaMinutes: 29, distanceKm: 18.4, expectedSkus: ["PH-COLD-FLUVAX-PFS", "PH-COLD-ADAL40-PEN"], coldChainRequired: true, riskLevel: "low", riskNote: "Hospital receiving window and cold-chain hand-off determine service risk.", receivingImpact: "Medical-priority delivery for hospital pharmacy receipt.", mitigationSuggestion: "Complete release check, logger activation, loading and seal confirmation before goods issue.", carrierId: "CARRIER-SIM-COLD", carrierName: "Simulated GDP Cold Logistics", vehicleId: "VEH-COLD-41", vehicleType: "Refrigerated van", licensePlate: "SIM-4101", plannedDepartureOffsetMinutes: 95, plannedArrivalOffsetMinutes: 124, deliveryWindowStartOffsetMinutes: 115, deliveryWindowEndOffsetMinutes: 175, dockAppointmentId: "APT-OUT-001", dockId: "D2", appointmentStartOffsetMinutes: 35, appointmentEndOffsetMinutes: 90, appointmentStatus: "loading", transportStatus: "loading", temperatureRequirement: "2-8C", temperatureMin: 2, temperatureMax: 8, temperatureLoggerId: "TL-OUT-001", sealNumber: null, lastKnownLocation: WAREHOUSE_LOCATION, via: [{ lat: 1.301, lng: 103.736 }, { lat: 1.287, lng: 103.79 }] }),
  route({ ...outboundDefaults, id: "ROUTE-DISPATCH-NICH", transportLegId: "LEG-OUT-002", shipmentId: "SHIP-002", name: "Western DC to immunisation node", originType: "Pharmaceutical distribution centre", destinationSiteId: "SITE-BIOPOLIS-IMM", baseEtaMinutes: 22, distanceKm: 12.7, expectedSkus: ["PH-COLD-FLUVAX-PFS", "PH-COLD-INSGLA-PEN"], coldChainRequired: true, riskLevel: "low", riskNote: "Cold-chain release and delivery-window adherence are the main controls.", receivingImpact: "Medical-priority vaccine distribution.", mitigationSuggestion: "Finish FEFO picking and precondition the vehicle before wave completion.", carrierId: "CARRIER-SIM-COLD", carrierName: "Simulated GDP Cold Logistics", vehicleId: "VEH-COLD-42", vehicleType: "Refrigerated van", licensePlate: "SIM-4202", plannedDepartureOffsetMinutes: 210, plannedArrivalOffsetMinutes: 232, deliveryWindowStartOffsetMinutes: 225, deliveryWindowEndOffsetMinutes: 285, dockAppointmentId: "APT-OUT-002", dockId: "D4", appointmentStartOffsetMinutes: 150, appointmentEndOffsetMinutes: 205, appointmentStatus: "booked", transportStatus: "vehicle_assigned", temperatureRequirement: "2-8C", temperatureMin: 2, temperatureMax: 8, temperatureLoggerId: "TL-OUT-002", sealNumber: null, lastKnownLocation: WAREHOUSE_LOCATION, via: [{ lat: 1.305, lng: 103.75 }, { lat: 1.299, lng: 103.775 }] }),
  route({ ...outboundDefaults, id: "ROUTE-DISPATCH-TTSH", transportLegId: "LEG-OUT-003", shipmentId: "SHIP-003", name: "Western DC to Tan Tock Seng Hospital", originType: "Pharmaceutical distribution centre", destinationSiteId: "SITE-TTSH", baseEtaMinutes: 31, distanceKm: 21.2, expectedSkus: ["PH-CRT-SALB100-INH", "PH-CRT-AMOX500-CAP"], coldChainRequired: false, riskLevel: "low", riskNote: "Urban traffic and hospital loading-bay access may affect the delivery window.", receivingImpact: "Controlled-room-temperature hospital replenishment.", mitigationSuggestion: "Confirm bay booking before departure and retain POD reference.", carrierId: "CARRIER-SIM-GDP", carrierName: "Simulated GDP Ground Transport", vehicleId: "VEH-CRT-19", vehicleType: "Insulated box van", licensePlate: "SIM-1903", plannedDepartureOffsetMinutes: 320, plannedArrivalOffsetMinutes: 351, deliveryWindowStartOffsetMinutes: 345, deliveryWindowEndOffsetMinutes: 405, dockAppointmentId: "APT-OUT-003", dockId: "D1", appointmentStartOffsetMinutes: 260, appointmentEndOffsetMinutes: 315, appointmentStatus: "booked", transportStatus: "planned", temperatureRequirement: "15-25C", temperatureMin: 15, temperatureMax: 25, temperatureLoggerId: "TL-OUT-003", sealNumber: null, lastKnownLocation: WAREHOUSE_LOCATION, via: [{ lat: 1.314, lng: 103.754 }, { lat: 1.317, lng: 103.807 }] }),
  route({ ...outboundDefaults, id: "ROUTE-DISPATCH-GUARDIAN", transportLegId: "LEG-OUT-004", shipmentId: "SHIP-004", name: "Western DC to Tampines retail consolidation", originType: "Pharmaceutical distribution centre", destinationSiteId: "SITE-TAMPINES-RETAIL", baseEtaMinutes: 39, distanceKm: 34.6, expectedSkus: ["PH-CRT-PARA500-TAB", "PH-CRT-OMEP20-CAP"], coldChainRequired: false, riskLevel: "low", riskNote: "Cross-island traffic can compress the booked retail receiving window.", receivingImpact: "Ambient and controlled-room-temperature retail replenishment.", mitigationSuggestion: "Stage by stop sequence and confirm pallet labels before loading.", carrierId: "CARRIER-SIM-GDP", carrierName: "Simulated GDP Ground Transport", vehicleId: "VEH-CRT-20", vehicleType: "Insulated box truck", licensePlate: "SIM-2004", plannedDepartureOffsetMinutes: 430, plannedArrivalOffsetMinutes: 469, deliveryWindowStartOffsetMinutes: 460, deliveryWindowEndOffsetMinutes: 535, dockAppointmentId: "APT-OUT-004", dockId: "D3", appointmentStartOffsetMinutes: 370, appointmentEndOffsetMinutes: 425, appointmentStatus: "booked", transportStatus: "planned", temperatureRequirement: "15-25C", temperatureMin: 15, temperatureMax: 25, temperatureLoggerId: "TL-OUT-004", sealNumber: null, lastKnownLocation: WAREHOUSE_LOCATION, via: [{ lat: 1.321, lng: 103.773 }, { lat: 1.337, lng: 103.855 }, { lat: 1.352, lng: 103.91 }] }),
  route({ ...outboundDefaults, id: "ROUTE-DISPATCH-NCC", transportLegId: "LEG-OUT-005", shipmentId: "SHIP-005", name: "Western DC to National Cancer Centre Singapore", originType: "Pharmaceutical distribution centre", destinationSiteId: "SITE-NCCS", baseEtaMinutes: 30, distanceKm: 18.1, expectedSkus: ["PH-COLD-ADAL40-PEN"], coldChainRequired: true, riskLevel: "high", riskNote: "Shipment remains blocked until quality-released stock is allocated.", receivingImpact: "Medical-priority oncology-support delivery is at risk.", mitigationSuggestion: "Do not load held stock; complete QMS disposition or allocate the next FEFO-released batch.", carrierId: "CARRIER-SIM-COLD", carrierName: "Simulated GDP Cold Logistics", vehicleId: "VEH-COLD-45", vehicleType: "Refrigerated van", licensePlate: "SIM-4505", plannedDepartureOffsetMinutes: 155, plannedArrivalOffsetMinutes: 185, deliveryWindowStartOffsetMinutes: 180, deliveryWindowEndOffsetMinutes: 240, dockAppointmentId: "APT-OUT-005", dockId: "D5", appointmentStartOffsetMinutes: 95, appointmentEndOffsetMinutes: 150, appointmentStatus: "exception", transportStatus: "exception", temperatureRequirement: "2-8C", temperatureMin: 2, temperatureMax: 8, temperatureLoggerId: "TL-OUT-005", sealNumber: null, lastKnownLocation: WAREHOUSE_LOCATION, via: [{ lat: 1.302, lng: 103.737 }, { lat: 1.286, lng: 103.793 }] }),
  route({ ...outboundDefaults, id: "ROUTE-DISPATCH-CGH", transportLegId: "LEG-OUT-006", shipmentId: "SHIP-006", name: "Western DC to Changi General Hospital", originType: "Pharmaceutical distribution centre", destinationSiteId: "SITE-CGH", baseEtaMinutes: 43, distanceKm: 40.3, expectedSkus: ["PH-COLD-INSHUM-VIAL", "PH-COLD-ADAL40-PEN"], coldChainRequired: true, riskLevel: "medium", riskNote: "Long cross-island cold-chain lane requires protected vehicle and receiving windows.", receivingImpact: "Hospital cold-chain replenishment.", mitigationSuggestion: "Delay goods issue if receiving confirmation or temperature telemetry is unavailable.", carrierId: "CARRIER-SIM-COLD", carrierName: "Simulated GDP Cold Logistics", vehicleId: "VEH-COLD-46", vehicleType: "Refrigerated van", licensePlate: "SIM-4606", plannedDepartureOffsetMinutes: 265, plannedArrivalOffsetMinutes: 308, deliveryWindowStartOffsetMinutes: 300, deliveryWindowEndOffsetMinutes: 365, dockAppointmentId: "APT-OUT-006", dockId: "D6", appointmentStartOffsetMinutes: 205, appointmentEndOffsetMinutes: 260, appointmentStatus: "booked", transportStatus: "vehicle_assigned", temperatureRequirement: "2-8C", temperatureMin: 2, temperatureMax: 8, temperatureLoggerId: "TL-OUT-006", sealNumber: null, lastKnownLocation: WAREHOUSE_LOCATION, via: [{ lat: 1.318, lng: 103.786 }, { lat: 1.333, lng: 103.866 }, { lat: 1.344, lng: 103.925 }] }),
  route({ ...outboundDefaults, id: "ROUTE-DISPATCH-NUH", transportLegId: "LEG-OUT-007", shipmentId: "SHIP-007", name: "Western DC to National University Hospital", originType: "Pharmaceutical distribution centre", destinationSiteId: "SITE-NUH", baseEtaMinutes: 18, distanceKm: 10.2, expectedSkus: ["PH-CRT-AMOX500-CAP", "PH-CRT-AMLO5-TAB"], coldChainRequired: false, riskLevel: "low", riskNote: "Hospital delivery timing depends on dock availability and urban traffic.", receivingImpact: "Controlled-room-temperature hospital replenishment.", mitigationSuggestion: "Complete pick confirmation and hospital bay validation before goods issue.", carrierId: "CARRIER-SIM-GDP", carrierName: "Simulated GDP Ground Transport", vehicleId: "VEH-CRT-24", vehicleType: "Insulated box van", licensePlate: "SIM-2407", plannedDepartureOffsetMinutes: 375, plannedArrivalOffsetMinutes: 393, deliveryWindowStartOffsetMinutes: 390, deliveryWindowEndOffsetMinutes: 450, dockAppointmentId: "APT-OUT-007", dockId: "D1", appointmentStartOffsetMinutes: 315, appointmentEndOffsetMinutes: 370, appointmentStatus: "booked", transportStatus: "planned", temperatureRequirement: "15-25C", temperatureMin: 15, temperatureMax: 25, temperatureLoggerId: "TL-OUT-007", sealNumber: null, lastKnownLocation: WAREHOUSE_LOCATION, via: [{ lat: 1.305, lng: 103.739 }, { lat: 1.296, lng: 103.765 }] }),
  route({ ...outboundDefaults, id: "ROUTE-DISPATCH-POLY", transportLegId: "LEG-OUT-008", shipmentId: "SHIP-008", name: "Western DC to Choa Chu Kang Polyclinic", originType: "Pharmaceutical distribution centre", destinationSiteId: "SITE-CCK-POLY", baseEtaMinutes: 25, distanceKm: 17.5, expectedSkus: ["PH-CRT-PARA500-TAB", "PH-AMB-ORS20-SACH"], coldChainRequired: false, riskLevel: "low", riskNote: "The smaller receiving point requires the correct vehicle profile and appointment adherence.", receivingImpact: "Primary-care network replenishment.", mitigationSuggestion: "Use a small rigid truck or van and retain signed POD.", carrierId: "CARRIER-SIM-AMBIENT", carrierName: "Simulated Singapore Distribution", vehicleId: "VEH-AMB-28", vehicleType: "Box van", licensePlate: "SIM-2808", plannedDepartureOffsetMinutes: 510, plannedArrivalOffsetMinutes: 535, deliveryWindowStartOffsetMinutes: 530, deliveryWindowEndOffsetMinutes: 590, dockAppointmentId: "APT-OUT-008", dockId: "D4", appointmentStartOffsetMinutes: 450, appointmentEndOffsetMinutes: 505, appointmentStatus: "booked", transportStatus: "planned", temperatureRequirement: "ambient", temperatureMin: null, temperatureMax: 30, temperatureLoggerId: null, sealNumber: null, lastKnownLocation: WAREHOUSE_LOCATION, via: [{ lat: 1.33, lng: 103.723 }, { lat: 1.36, lng: 103.733 }] })
];

// Route metadata must describe the same products as the WMS document lines. Keeping this mapping
// explicit prevents the transport projection from drifting when the academic inventory fixture changes.
const documentSkusByRoute: Record<string, string[]> = {
  "ROUTE-CHANGI": ["PH-COLD-FLUVAX-PFS", "PH-COLD-ADAL40-PEN"],
  "ROUTE-JURONG": ["PH-CRT-SALB100-INH", "PH-CRT-AMOX500-CAP"],
  "ROUTE-TUAS": ["PH-COLD-FLUVAX-PFS", "PH-COLD-INSHUM-VIAL"],
  "ROUTE-SUPPLIER-COLD": ["PH-COLD-INSGLA-PEN", "PH-COLD-ADAL40-PEN"],
  "ROUTE-PACKAGING": ["PH-AMB-ORS20-SACH", "PH-AMB-POVI10-SOL"],
  "ROUTE-QA-RETURN": ["PH-AMB-POVI10-SOL"],
  "ROUTE-DISPATCH-SGH": ["PH-COLD-INSGLA-PEN"],
  "ROUTE-DISPATCH-NICH": ["PH-COLD-FLUVAX-PFS"],
  "ROUTE-DISPATCH-TTSH": ["PH-CRT-SALB100-INH"],
  "ROUTE-DISPATCH-GUARDIAN": ["PH-CRT-PARA500-TAB"],
  "ROUTE-DISPATCH-NCC": ["PH-CRT-OMEP20-CAP"],
  "ROUTE-DISPATCH-CGH": ["PH-COLD-ADAL40-PEN"],
  "ROUTE-DISPATCH-NUH": ["PH-CRT-AMOX500-CAP"],
  "ROUTE-DISPATCH-POLY": ["PH-AMB-ORS20-SACH"]
};

// Keep the academic fixture operationally varied when it is seeded: some work is overdue,
// some is still within its window, and completed receipts include both early and late arrivals.
const scheduleVarianceOverrides: Record<string, Partial<RouteSeedConfig>> = {
  "ROUTE-CHANGI": { plannedDepartureOffsetMinutes: -100, actualDepartureOffsetMinutes: -90, plannedArrivalOffsetMinutes: -48, appointmentStartOffsetMinutes: -90, appointmentEndOffsetMinutes: -30 },
  "ROUTE-SUPPLIER-COLD": { plannedDepartureOffsetMinutes: -35, actualDepartureOffsetMinutes: -28, plannedArrivalOffsetMinutes: 18, appointmentStartOffsetMinutes: 12, appointmentEndOffsetMinutes: 72 },
  "ROUTE-PACKAGING": { plannedDepartureOffsetMinutes: -190, actualDepartureOffsetMinutes: -198, plannedArrivalOffsetMinutes: -147, actualArrivalOffsetMinutes: -155 },
  "ROUTE-QA-RETURN": { plannedDepartureOffsetMinutes: -90, actualDepartureOffsetMinutes: -93, plannedArrivalOffsetMinutes: -72, actualArrivalOffsetMinutes: -75 },
  "ROUTE-DISPATCH-SGH": { plannedDepartureOffsetMinutes: 35, plannedArrivalOffsetMinutes: 64, deliveryWindowStartOffsetMinutes: 55, deliveryWindowEndOffsetMinutes: 115, appointmentStartOffsetMinutes: -25, appointmentEndOffsetMinutes: 30 },
  "ROUTE-DISPATCH-NICH": { plannedDepartureOffsetMinutes: -100, plannedArrivalOffsetMinutes: -78, deliveryWindowStartOffsetMinutes: -75, deliveryWindowEndOffsetMinutes: -30, appointmentStartOffsetMinutes: -160, appointmentEndOffsetMinutes: -105 },
  "ROUTE-DISPATCH-NCC": { plannedDepartureOffsetMinutes: -120, plannedArrivalOffsetMinutes: -90, deliveryWindowStartOffsetMinutes: -85, deliveryWindowEndOffsetMinutes: -45, appointmentStartOffsetMinutes: -180, appointmentEndOffsetMinutes: -125 },
  "ROUTE-DISPATCH-NUH": { plannedDepartureOffsetMinutes: -80, plannedArrivalOffsetMinutes: -62, deliveryWindowStartOffsetMinutes: -60, deliveryWindowEndOffsetMinutes: -15, appointmentStartOffsetMinutes: -140, appointmentEndOffsetMinutes: -85 }
};

// Transport handling metadata follows the products on the WMS document, not an older route
// fixture. These two routes changed product lines during the inventory-model reconciliation.
const cargoHandlingOverrides: Record<string, Partial<RouteSeedConfig>> = {
  "ROUTE-QA-RETURN": {
    coldChainRequired: false,
    temperatureRequirement: "ambient",
    temperatureMin: null,
    temperatureMax: 30,
    temperatureStatus: "not_required",
    temperatureLoggerId: null
  },
  "ROUTE-DISPATCH-NCC": {
    coldChainRequired: false,
    carrierId: "CARRIER-SIM-GDP",
    carrierName: "Simulated GDP Ground Transport",
    vehicleId: "VEH-CRT-45",
    vehicleType: "Insulated box van",
    licensePlate: "SIM-4545",
    temperatureRequirement: "15-25C",
    temperatureMin: 15,
    temperatureMax: 25,
    temperatureStatus: "compliant",
    temperatureLoggerId: "TL-CRT-005"
  }
};

TRANSPORT_ROUTE_CONFIGS.forEach((routeConfig) => {
  routeConfig.expectedSkus = documentSkusByRoute[routeConfig.id] ?? routeConfig.expectedSkus;
  Object.assign(routeConfig, scheduleVarianceOverrides[routeConfig.id]);
  Object.assign(routeConfig, cargoHandlingOverrides[routeConfig.id]);
});

export const INBOUND_ROUTE_CONFIGS = TRANSPORT_ROUTE_CONFIGS.filter((item) => item.direction === "inbound");
export const OUTBOUND_ROUTE_CONFIGS = TRANSPORT_ROUTE_CONFIGS.filter((item) => item.direction === "outbound");

export function getRouteConfig(routeId: string) {
  return TRANSPORT_ROUTE_CONFIGS.find((item) => item.id === routeId || item.transportLegId === routeId);
}

export function getPartnerSiteConfig(siteId: string) {
  return PARTNER_SITE_CONFIGS.find((item) => item.siteId === siteId);
}
