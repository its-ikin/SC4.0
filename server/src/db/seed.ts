import { addDays, addHours, addMinutes, db, nowIso } from "./database";
import {
  INBOUND_ROUTE_CONFIGS,
  PARTNER_SITE_CONFIGS,
  SIMULATION_DISCLOSURE,
  TRANSPORT_ROUTE_CONFIGS,
  WAREHOUSE_SITE_ID,
  type RouteSeedConfig
} from "../routeData";
import { seedPharmaInventory } from "./pharmaInventorySeed";

type ProductSeed = {
  productId: string;
  productCode: string;
  productName: string;
  productFamily: string;
  defaultTempBand: string;
  storageClass: string;
  unitType: string;
  safetyStock: number;
  reorderPoint: number;
  targetStock: number;
  leadTimeDays: number;
  averageDailyDemand: number;
};

type LotSeed = {
  productCode: string;
  lotCode: string;
  expiryDays: number;
  manufactureDaysAgo: number;
  qualityStatus: "Released" | "QA Hold" | "Quarantine" | "Pending QA" | "Expired";
  serializationStatus?: string;
  notes?: string | null;
  locationId: string;
  qtyOnHand: number;
  qtyReserved?: number;
  qtyPicked?: number;
  qtyPacked?: number;
  qtyStaged?: number;
  qtyOnHold?: number;
};

type LocationSeed = {
  locationId: string;
  zone: string;
  rack: string;
  bin: string;
  tempBand: string;
  capacity: number;
  currentFill: number;
};

type ZoneSeed = {
  id: string;
  name: string;
  code: string;
  temperatureMin: number;
  temperatureMax: number;
  capacityUnits: number;
  currentTemperature: number;
  fillPercent: number;
  status: "normal" | "warn" | "critical";
  productTypes: string[];
};

type OutboundLineSeed = {
  outboundLineId: string;
  shipmentId: string;
  productCode: string;
  batchId: string;
  qtyRequired: number;
  qtyAllocated: number;
  qtyPicked: number;
  qtyPacked: number;
  qtyDispatched: number;
  allocationStatus: string;
};

const stringify = (value: unknown) => JSON.stringify(value);

const productSeeds: ProductSeed[] = [
  ["PROD-VAX-RSV", "GSK-VAX-RSV", "Simulated RSV vaccine", "Vaccine", "2-8 C", "Cold Storage", "vials"],
  ["PROD-VAX-FLU", "GSK-VAX-FLU", "Simulated influenza vaccine", "Vaccine", "2-8 C", "Cold Storage", "vials"],
  ["PROD-BIO-MAB", "GSK-BIO-MAB", "Simulated monoclonal biologic", "Biologic", "2-8 C", "Cold Storage", "vials"],
  ["PROD-BIO-INS", "GSK-BIO-INS", "Simulated insulin cold-chain batch", "Biologic", "2-8 C", "Cold Storage", "pens"],
  ["PROD-BIO-PLS", "GSK-BIO-PLS", "Simulated plasma-derived biologic", "Biologic", "2-8 C", "Cold Storage", "vials"],
  ["PROD-HIV-ART", "GSK-HIV-ART", "Simulated HIV therapy", "HIV", "15-25 C", "Pharmaceutical Storage", "cartons"],
  ["PROD-RESP-INH", "GSK-RESP-INH", "Simulated respiratory inhaler", "Respiratory", "15-25 C", "Pharmaceutical Storage", "inhalers"],
  ["PROD-ONC-SUP", "GSK-ONC-SUP", "Simulated oncology-support medicine", "Oncology Support", "15-25 C", "Pharmaceutical Storage", "cartons"],
  ["PROD-INF-ABX", "GSK-INF-ABX", "Simulated anti-infective tablets", "Anti-infective", "15-25 C", "Pharmaceutical Storage", "cartons"],
  ["PROD-GEN-TAB", "GSK-GEN-TAB", "Simulated general medicine tablets", "General Medicine", "15-25 C", "Pharmaceutical Storage", "cartons"],
  ["PROD-PKG-CRT", "GSK-PKG-CRT", "Cold-chain carton pack", "Packaging", "18-28 C", "Ambient Storage", "cartons"],
  ["PROD-PKG-LBL", "GSK-PKG-LBL", "Serialized label stock", "Packaging", "18-28 C", "Ambient Storage", "rolls"],
  ["PROD-PKG-GEL", "GSK-PKG-GEL", "Gel-pack kit", "Packaging", "18-28 C", "Ambient Storage", "kits"],
  ["PROD-DOC-IFU", "GSK-DOC-IFU", "Patient leaflet insert", "Packaging", "18-28 C", "Ambient Storage", "bundles"],
  ["PROD-GEN-SUP", "GSK-GEN-SUP", "General support material", "General Medicine", "18-28 C", "Ambient Storage", "cases"]
].map(([productId, productCode, productName, productFamily, defaultTempBand, storageClass, unitType]) => {
  const policy = productFamily === "Vaccine"
    ? { safetyStock: 100, reorderPoint: 180, targetStock: 420, leadTimeDays: 5, averageDailyDemand: 16 }
    : productFamily === "Biologic"
      ? { safetyStock: 80, reorderPoint: 150, targetStock: 360, leadTimeDays: 7, averageDailyDemand: 10 }
      : productFamily === "Packaging"
        ? { safetyStock: 180, reorderPoint: 320, targetStock: 800, leadTimeDays: 3, averageDailyDemand: 45 }
        : { safetyStock: 120, reorderPoint: 220, targetStock: 520, leadTimeDays: 4, averageDailyDemand: 25 };
  return { productId, productCode, productName, productFamily, defaultTempBand, storageClass, unitType, ...policy };
});

const productByCode = new Map(productSeeds.map((product) => [product.productCode, product]));

const lotSeeds: LotSeed[] = [
  { productCode: "GSK-VAX-RSV", lotCode: "LOT-RSV-0702-A", expiryDays: 2, manufactureDaysAgo: 120, qualityStatus: "Released", locationId: "CS-R04-B17", qtyOnHand: 90, qtyStaged: 40 },
  { productCode: "GSK-VAX-RSV", lotCode: "LOT-RSV-0703-B", expiryDays: 3, manufactureDaysAgo: 118, qualityStatus: "Released", locationId: "CS-R04-B03", qtyOnHand: 150, qtyReserved: 20, qtyPicked: 60 },
  { productCode: "GSK-VAX-RSV", lotCode: "LOT-RSV-0718-C", expiryDays: 16, manufactureDaysAgo: 96, qualityStatus: "Released", locationId: "CS-R01-A08", qtyOnHand: 120 },
  { productCode: "GSK-VAX-RSV", lotCode: "LOT-RSV-0730-D", expiryDays: 28, manufactureDaysAgo: 80, qualityStatus: "QA Hold", locationId: "QA-HOLD-01", qtyOnHand: 40 },
  { productCode: "GSK-VAX-FLU", lotCode: "LOT-FLU-0707-A", expiryDays: 5, manufactureDaysAgo: 95, qualityStatus: "Released", locationId: "CS-R02-B11", qtyOnHand: 130, qtyReserved: 20, qtyPicked: 40 },
  { productCode: "GSK-VAX-FLU", lotCode: "LOT-FLU-0716-B", expiryDays: 14, manufactureDaysAgo: 88, qualityStatus: "Released", locationId: "CS-R03-C02", qtyOnHand: 160 },
  { productCode: "GSK-VAX-FLU", lotCode: "LOT-FLU-0816-C", expiryDays: 45, manufactureDaysAgo: 60, qualityStatus: "Pending QA", locationId: "QA-HOLD-02", qtyOnHand: 70 },
  { productCode: "GSK-BIO-MAB", lotCode: "LOT-MAB-0711-A", expiryDays: 9, manufactureDaysAgo: 140, qualityStatus: "Released", locationId: "CS-R01-A11", qtyOnHand: 75, qtyReserved: 25, qtyStaged: 20 },
  { productCode: "GSK-BIO-MAB", lotCode: "LOT-MAB-0726-B", expiryDays: 24, manufactureDaysAgo: 121, qualityStatus: "QA Hold", locationId: "QA-HOLD-03", qtyOnHand: 35 },
  { productCode: "GSK-BIO-MAB", lotCode: "LOT-MAB-0901-C", expiryDays: 60, manufactureDaysAgo: 75, qualityStatus: "Released", locationId: "CS-R02-B18", qtyOnHand: 110 },
  { productCode: "GSK-BIO-INS", lotCode: "LOT-INS-0706-A", expiryDays: 4, manufactureDaysAgo: 90, qualityStatus: "Released", locationId: "CS-R03-C13", qtyOnHand: 95 },
  { productCode: "GSK-BIO-INS", lotCode: "LOT-INS-0720-B", expiryDays: 18, manufactureDaysAgo: 82, qualityStatus: "Released", locationId: "CS-R04-D07", qtyOnHand: 125 },
  { productCode: "GSK-BIO-INS", lotCode: "LOT-INS-0806-C", expiryDays: 35, manufactureDaysAgo: 62, qualityStatus: "Quarantine", locationId: "QT-01", qtyOnHand: 45 },
  { productCode: "GSK-BIO-PLS", lotCode: "LOT-PLS-0715-A", expiryDays: 12, manufactureDaysAgo: 105, qualityStatus: "Released", locationId: "CS-R01-D04", qtyOnHand: 90, qtyReserved: 30 },
  { productCode: "GSK-BIO-PLS", lotCode: "LOT-PLS-0730-B", expiryDays: 26, manufactureDaysAgo: 86, qualityStatus: "Pending QA", locationId: "QA-HOLD-04", qtyOnHand: 55 },
  { productCode: "GSK-BIO-PLS", lotCode: "LOT-PLS-0828-C", expiryDays: 55, manufactureDaysAgo: 63, qualityStatus: "Released", locationId: "CS-R02-C20", qtyOnHand: 100 },
  { productCode: "GSK-HIV-ART", lotCode: "LOT-HIV-0709-A", expiryDays: 7, manufactureDaysAgo: 180, qualityStatus: "Released", locationId: "PH-R03-A15", qtyOnHand: 140, qtyReserved: 60 },
  { productCode: "GSK-HIV-ART", lotCode: "LOT-HIV-0723-B", expiryDays: 21, manufactureDaysAgo: 150, qualityStatus: "Released", locationId: "PH-R04-B06", qtyOnHand: 120, qtyReserved: 20, qtyPicked: 20 },
  { productCode: "GSK-HIV-ART", lotCode: "LOT-HIV-0910-C", expiryDays: 70, manufactureDaysAgo: 70, qualityStatus: "Pending QA", locationId: "QA-HOLD-05", qtyOnHand: 80 },
  { productCode: "GSK-RESP-INH", lotCode: "LOT-RESP-0708-A", expiryDays: 6, manufactureDaysAgo: 135, qualityStatus: "Released", locationId: "PH-R05-C11", qtyOnHand: 160, qtyReserved: 70 },
  { productCode: "GSK-RESP-INH", lotCode: "LOT-RESP-0729-B", expiryDays: 27, manufactureDaysAgo: 104, qualityStatus: "Released", locationId: "PH-R02-D09", qtyOnHand: 210 },
  { productCode: "GSK-RESP-INH", lotCode: "LOT-RESP-0831-C", expiryDays: 59, manufactureDaysAgo: 55, qualityStatus: "Released", locationId: "PH-R01-A03", qtyOnHand: 150 },
  { productCode: "GSK-ONC-SUP", lotCode: "LOT-ONC-0709-A", expiryDays: 8, manufactureDaysAgo: 170, qualityStatus: "Released", locationId: "PH-R07-E03", qtyOnHand: 90 },
  { productCode: "GSK-ONC-SUP", lotCode: "LOT-ONC-0709-B", expiryDays: 8, manufactureDaysAgo: 168, qualityStatus: "QA Hold", locationId: "QA-HOLD-06", qtyOnHand: 40, notes: "QA assay exception under review" },
  { productCode: "GSK-ONC-SUP", lotCode: "LOT-ONC-0818-C", expiryDays: 47, manufactureDaysAgo: 92, qualityStatus: "Released", locationId: "PH-R06-D12", qtyOnHand: 130 },
  { productCode: "GSK-INF-ABX", lotCode: "LOT-INF-0710-A", expiryDays: 9, manufactureDaysAgo: 160, qualityStatus: "Released", locationId: "PH-R02-B08", qtyOnHand: 180, qtyPacked: 80 },
  { productCode: "GSK-INF-ABX", lotCode: "LOT-INF-0726-B", expiryDays: 24, manufactureDaysAgo: 126, qualityStatus: "Released", locationId: "PH-R03-C19", qtyOnHand: 160, qtyReserved: 30, qtyPicked: 30 },
  { productCode: "GSK-INF-ABX", lotCode: "LOT-INF-0831-C", expiryDays: 60, manufactureDaysAgo: 66, qualityStatus: "Released", locationId: "PH-R04-D14", qtyOnHand: 200 },
  { productCode: "GSK-GEN-TAB", lotCode: "LOT-GEN-0712-A", expiryDays: 10, manufactureDaysAgo: 170, qualityStatus: "Released", locationId: "PH-R01-E05", qtyOnHand: 210, qtyPacked: 100 },
  { productCode: "GSK-GEN-TAB", lotCode: "LOT-GEN-0730-B", expiryDays: 28, manufactureDaysAgo: 110, qualityStatus: "Released", locationId: "PH-R02-A16", qtyOnHand: 190 },
  { productCode: "GSK-GEN-TAB", lotCode: "LOT-GEN-0620-X", expiryDays: -12, manufactureDaysAgo: 360, qualityStatus: "Expired", locationId: "QT-02", qtyOnHand: 30 },
  { productCode: "GSK-PKG-CRT", lotCode: "LOT-CRT-0714-A", expiryDays: 12, manufactureDaysAgo: 60, qualityStatus: "Released", locationId: "AM-R01-A01", qtyOnHand: 340 },
  { productCode: "GSK-PKG-CRT", lotCode: "LOT-CRT-0801-B", expiryDays: 30, manufactureDaysAgo: 45, qualityStatus: "Released", locationId: "AM-R02-B10", qtyOnHand: 400 },
  { productCode: "GSK-PKG-CRT", lotCode: "LOT-CRT-0910-C", expiryDays: 70, manufactureDaysAgo: 20, qualityStatus: "Released", locationId: "AM-R03-C05", qtyOnHand: 280 },
  { productCode: "GSK-PKG-LBL", lotCode: "LOT-LBL-0719-A", expiryDays: 17, manufactureDaysAgo: 80, qualityStatus: "Released", locationId: "AM-R01-D08", qtyOnHand: 520 },
  { productCode: "GSK-PKG-LBL", lotCode: "LOT-LBL-0808-B", expiryDays: 37, manufactureDaysAgo: 55, qualityStatus: "Pending QA", locationId: "QA-HOLD-07", qtyOnHand: 210 },
  { productCode: "GSK-PKG-LBL", lotCode: "LOT-LBL-0920-C", expiryDays: 80, manufactureDaysAgo: 25, qualityStatus: "Released", locationId: "AM-R02-E02", qtyOnHand: 480 },
  { productCode: "GSK-PKG-GEL", lotCode: "LOT-GEL-0716-A", expiryDays: 14, manufactureDaysAgo: 90, qualityStatus: "Released", locationId: "AM-R03-A18", qtyOnHand: 260 },
  { productCode: "GSK-PKG-GEL", lotCode: "LOT-GEL-0810-B", expiryDays: 39, manufactureDaysAgo: 50, qualityStatus: "Released", locationId: "AM-R01-B13", qtyOnHand: 300 },
  { productCode: "GSK-PKG-GEL", lotCode: "LOT-GEL-0925-C", expiryDays: 85, manufactureDaysAgo: 30, qualityStatus: "Released", locationId: "AM-R02-C21", qtyOnHand: 240 },
  { productCode: "GSK-DOC-IFU", lotCode: "LOT-IFU-0715-A", expiryDays: 13, manufactureDaysAgo: 100, qualityStatus: "Released", locationId: "AM-R03-D12", qtyOnHand: 800 },
  { productCode: "GSK-DOC-IFU", lotCode: "LOT-IFU-0820-B", expiryDays: 49, manufactureDaysAgo: 40, qualityStatus: "Released", locationId: "AM-R01-E07", qtyOnHand: 620 },
  { productCode: "GSK-DOC-IFU", lotCode: "LOT-IFU-1001-C", expiryDays: 100, manufactureDaysAgo: 10, qualityStatus: "Released", locationId: "AM-R02-A14", qtyOnHand: 700 },
  { productCode: "GSK-GEN-SUP", lotCode: "LOT-SUP-0718-A", expiryDays: 16, manufactureDaysAgo: 70, qualityStatus: "Released", locationId: "AM-R03-B16", qtyOnHand: 220 },
  { productCode: "GSK-GEN-SUP", lotCode: "LOT-SUP-0830-B", expiryDays: 58, manufactureDaysAgo: 30, qualityStatus: "Released", locationId: "AM-R01-C20", qtyOnHand: 260 },
  { productCode: "GSK-GEN-SUP", lotCode: "LOT-SUP-1015-C", expiryDays: 114, manufactureDaysAgo: 12, qualityStatus: "Released", locationId: "AM-R02-D04", qtyOnHand: 240 }
];

function locationParts(locationId: string) {
  if (locationId.startsWith("QA-HOLD")) return { zone: "QA Hold", rack: "QA", bin: locationId.replace("QA-HOLD-", "H") };
  if (locationId.startsWith("QT")) return { zone: "Quarantine", rack: "QT", bin: locationId.replace("QT-", "Q") };
  if (locationId.startsWith("RCV")) return { zone: "Receiving", rack: "RCV", bin: locationId.replace("RCV-", "") };
  if (locationId.startsWith("DS")) return { zone: "Dispatch", rack: "DS", bin: locationId.replace("DS-", "") };
  const [zoneCode, rackNo, bin] = locationId.split("-");
  const zone = zoneCode === "CS" ? "Cold Storage" : zoneCode === "PH" ? "Pharmaceutical Storage" : "Ambient Storage";
  return { zone, rack: `${zoneCode}-${rackNo}`, bin };
}

function availableQty(lot: LotSeed) {
  const onHold =
    lot.qtyOnHold ??
    (lot.qualityStatus === "Released" ? 0 : lot.qtyOnHand);
  if (lot.qualityStatus !== "Released" || lot.expiryDays <= 0) return 0;
  return Math.max(
    0,
    lot.qtyOnHand -
      (lot.qtyReserved ?? 0) -
      (lot.qtyPicked ?? 0) -
      (lot.qtyPacked ?? 0) -
      (lot.qtyStaged ?? 0) -
      onHold
  );
}

function balanceForLot(lot: LotSeed) {
  return {
    stockBalanceId: `SB-${lot.lotCode}`,
    batchId: lot.lotCode,
    locationId: lot.locationId,
    qtyOnHand: lot.qtyOnHand,
    qtyAvailable: availableQty(lot),
    qtyReserved: lot.qtyReserved ?? 0,
    qtyPicked: lot.qtyPicked ?? 0,
    qtyPacked: lot.qtyPacked ?? 0,
    qtyStaged: lot.qtyStaged ?? 0,
    qtyDispatched: 0,
    qtyOnHold: lot.qtyOnHold ?? (lot.qualityStatus === "Released" ? 0 : lot.qtyOnHand),
    lastUpdated: nowIso()
  };
}

function priorityFor(status: string, priority: string | null) {
  if (priority === "Medical Priority") return "HIGH";
  if (status === "Staged" || status === "Picking" || status === "Blocked") return "HIGH";
  return "NORMAL";
}

const inboundShipments = [
  ["ASN-1001", "Changi Air Cargo", "Changi Air Cargo Gateway", addHours(-0.8), "D2", "In Transit", "In Band", "ROUTE-CHANGI"],
  ["ASN-1002", "Jurong Manufacturing", "Jurong Manufacturing Lane", addHours(1), "D1", "At Receiving", "In Band", "ROUTE-JURONG"],
  ["ASN-1003", "Tuas Vaccines Node", "Tuas Vaccines Lane", addHours(8), "D4", "Scheduled", "In Band", "ROUTE-TUAS"],
  ["ASN-1004", "Supplier Cold Hub", "Supplier Cold Hub North Route", addHours(5), "D6", "In Transit", "In Band", "ROUTE-SUPPLIER-COLD"],
  ["ASN-1005", "Packaging Supplier", "Packaging Supplier Ambient Route", addHours(-2), "D3", "Received", "Not Required", "ROUTE-PACKAGING"],
  ["ASN-1006", "QA Return", "Internal Return Route", addHours(-1), "D5", "QA Pending", "In Band", "ROUTE-QA-RETURN"]
].map(([asnId, source, routeName, eta, receivingDock, inboundStatus, coldChainStatus, linkedRouteId]) => ({
  asnId,
  source,
  routeName,
  eta,
  receivingDock,
  inboundStatus,
  coldChainStatus,
  linkedRouteId
}));

const inboundLines = [
  ["INL-1001-1", "ASN-1001", "GSK-VAX-RSV", "LOT-RSV-0730-D", 120, 0, "2-8 C", "Expected", "Pending QA"],
  ["INL-1001-2", "ASN-1001", "GSK-BIO-MAB", "LOT-MAB-0901-C", 70, 0, "2-8 C", "Expected", "Pending QA"],
  ["INL-1002-1", "ASN-1002", "GSK-HIV-ART", "LOT-HIV-0910-C", 80, 60, "15-25 C", "Dock Check", "Pending QA"],
  ["INL-1002-2", "ASN-1002", "GSK-RESP-INH", "LOT-RESP-0831-C", 90, 40, "15-25 C", "Receiving", "Released"],
  ["INL-1003-1", "ASN-1003", "GSK-VAX-FLU", "LOT-FLU-0816-C", 140, 0, "2-8 C", "Expected", "Pending QA"],
  ["INL-1003-2", "ASN-1003", "GSK-VAX-RSV", "LOT-RSV-0718-C", 90, 0, "2-8 C", "Expected", "Released"],
  ["INL-1004-1", "ASN-1004", "GSK-BIO-PLS", "LOT-PLS-0828-C", 75, 0, "2-8 C", "Expected", "Released"],
  ["INL-1004-2", "ASN-1004", "GSK-BIO-INS", "LOT-INS-0806-C", 60, 0, "2-8 C", "Expected", "Quarantine"],
  ["INL-1005-1", "ASN-1005", "GSK-PKG-LBL", "LOT-LBL-0920-C", 500, 500, "18-28 C", "Received", "Released"],
  ["INL-1005-2", "ASN-1005", "GSK-PKG-CRT", "LOT-CRT-0910-C", 320, 320, "18-28 C", "Received", "Released"],
  ["INL-1006-1", "ASN-1006", "GSK-ONC-SUP", "LOT-ONC-0709-B", 40, 40, "15-25 C", "Exception", "QA Hold"],
  ["INL-1006-2", "ASN-1006", "GSK-GEN-TAB", "LOT-GEN-0620-X", 30, 30, "15-25 C", "Exception", "Expired"]
].map(([inboundLineId, asnId, productCode, batchId, qtyExpected, qtyReceived, tempBand, receivingStatus, qaStatus]) => ({
  inboundLineId,
  asnId,
  productId: productByCode.get(String(productCode))!.productId,
  batchId,
  qtyExpected,
  qtyReceived,
  tempBand,
  receivingStatus,
  qaStatus
}));

const outboundShipments = [
  ["SHIP-001", "Singapore General Hospital Pharmacy", addHours(2), "D2", "Staged", "Medical Priority", "ROUTE-DISPATCH-SGH"],
  ["SHIP-002", "National Immunisation Cold Hub", addHours(-0.5), "D4", "Picking", "Medical Priority", "ROUTE-DISPATCH-NICH"],
  ["SHIP-003", "Tan Tock Seng Hospital Pharmacy", addHours(6), "D1", "Allocated", "Normal", "ROUTE-DISPATCH-TTSH"],
  ["SHIP-004", "Guardian Pharmacy Network", addHours(8), "D3", "Packed", "Normal", "ROUTE-DISPATCH-GUARDIAN"],
  ["SHIP-005", "National Cancer Centre Pharmacy", addHours(-0.75), "D5", "Blocked", "Medical Priority", "ROUTE-DISPATCH-NCC"],
  ["SHIP-006", "Changi General Hospital Pharmacy", addHours(5), "D6", "Allocated", "Normal", "ROUTE-DISPATCH-CGH"],
  ["SHIP-007", "NUH Pharmacy", addHours(-0.25), "D1", "Picking", "Normal", "ROUTE-DISPATCH-NUH"],
  ["SHIP-008", "Polyclinic Network", addHours(10), "D4", "Scheduled", "Normal", "ROUTE-DISPATCH-POLY"]
].map(([shipmentId, destination, requiredBy, dock, outboundStatus, priorityLevel, routeId]) => ({
  shipmentId,
  destination,
  requiredBy,
  dock,
  outboundStatus,
  priorityLevel,
  routeId
}));

const outboundLines: OutboundLineSeed[] = [
  ["OUT-001-1", "SHIP-001", "GSK-VAX-RSV", "LOT-RSV-0702-A", 40, 40, 40, 40, 0, "Staged"],
  ["OUT-001-2", "SHIP-001", "GSK-BIO-MAB", "LOT-MAB-0711-A", 20, 20, 20, 20, 0, "Staged"],
  ["OUT-002-1", "SHIP-002", "GSK-VAX-RSV", "LOT-RSV-0703-B", 80, 80, 60, 0, 0, "Picking"],
  ["OUT-002-2", "SHIP-002", "GSK-VAX-FLU", "LOT-FLU-0707-A", 60, 60, 40, 0, 0, "Picking"],
  ["OUT-003-1", "SHIP-003", "GSK-RESP-INH", "LOT-RESP-0708-A", 70, 70, 0, 0, 0, "Allocated"],
  ["OUT-003-2", "SHIP-003", "GSK-HIV-ART", "LOT-HIV-0709-A", 60, 60, 0, 0, 0, "Allocated"],
  ["OUT-004-1", "SHIP-004", "GSK-GEN-TAB", "LOT-GEN-0712-A", 100, 100, 100, 100, 0, "Packed"],
  ["OUT-004-2", "SHIP-004", "GSK-INF-ABX", "LOT-INF-0710-A", 80, 80, 80, 80, 0, "Packed"],
  ["OUT-005-1", "SHIP-005", "GSK-ONC-SUP", "LOT-ONC-0709-B", 40, 0, 0, 0, 0, "Blocked: QA Hold"],
  ["OUT-006-1", "SHIP-006", "GSK-BIO-MAB", "LOT-MAB-0711-A", 25, 25, 0, 0, 0, "Allocated"],
  ["OUT-006-2", "SHIP-006", "GSK-BIO-PLS", "LOT-PLS-0715-A", 30, 30, 0, 0, 0, "Allocated"],
  ["OUT-007-1", "SHIP-007", "GSK-HIV-ART", "LOT-HIV-0723-B", 40, 40, 20, 0, 0, "Picking"],
  ["OUT-007-2", "SHIP-007", "GSK-INF-ABX", "LOT-INF-0726-B", 60, 60, 30, 0, 0, "Picking"],
  ["OUT-008-1", "SHIP-008", "GSK-GEN-TAB", "LOT-GEN-0730-B", 80, 0, 0, 0, 0, "Scheduled"]
].map(([outboundLineId, shipmentId, productCode, batchId, qtyRequired, qtyAllocated, qtyPicked, qtyPacked, qtyDispatched, allocationStatus]) => ({
  outboundLineId: String(outboundLineId),
  shipmentId: String(shipmentId),
  productCode: String(productCode),
  batchId: String(batchId),
  qtyRequired: Number(qtyRequired),
  qtyAllocated: Number(qtyAllocated),
  qtyPicked: Number(qtyPicked),
  qtyPacked: Number(qtyPacked),
  qtyDispatched: Number(qtyDispatched),
  allocationStatus: String(allocationStatus)
}));

function buildLocations() {
  const locations = new Map<string, LocationSeed>();
  lotSeeds.forEach((lot) => {
    const product = productByCode.get(lot.productCode)!;
    const parts = locationParts(lot.locationId);
    const current = locations.get(lot.locationId);
    if (current) {
      current.currentFill += lot.qtyOnHand;
      return;
    }
    locations.set(lot.locationId, {
      locationId: lot.locationId,
      zone: parts.zone,
      rack: parts.rack,
      bin: parts.bin,
      tempBand: product.defaultTempBand,
      capacity: parts.zone === "Ambient Storage" ? 900 : parts.zone === "Pharmaceutical Storage" ? 360 : 220,
      currentFill: lot.qtyOnHand
    });
  });

  [
    ["RCV-D1", "Receiving", "RCV", "D1", "15-25 C", 500, 0],
    ["RCV-D2", "Receiving", "RCV", "D2", "2-8 C", 240, 0],
    ["DS-D1", "Dispatch", "DS", "D1", "15-30 C", 260, 0],
    ["DS-D2", "Dispatch", "DS", "D2", "2-8 C", 220, 0],
    ["DS-D4", "Dispatch", "DS", "D4", "2-8 C", 220, 0]
  ].forEach(([locationId, zone, rack, bin, tempBand, capacity, currentFill]) => {
    if (!locations.has(String(locationId))) {
      locations.set(String(locationId), {
        locationId: String(locationId),
        zone: String(zone),
        rack: String(rack),
        bin: String(bin),
        tempBand: String(tempBand),
        capacity: Number(capacity),
        currentFill: Number(currentFill)
      });
    }
  });

  return [...locations.values()];
}

function createMovementFactory() {
  let sequence = 1;
  return (movement: {
    timestamp: string;
    movementType: string;
    productId: string;
    batchId: string;
    fromLocationId?: string | null;
    toLocationId?: string | null;
    qty: number;
    referenceType: string;
    referenceId: string;
    userOrSystem: string;
    note: string;
  }) => ({
    movementId: `MOV-${String(sequence++).padStart(4, "0")}`,
    ...movement
  });
}

function buildMovements() {
  const movement = createMovementFactory();
  const records: ReturnType<ReturnType<typeof createMovementFactory>>[] = [];
  lotSeeds.forEach((lot, index) => {
    const product = productByCode.get(lot.productCode)!;
    records.push(
      movement({
        timestamp: addMinutes(-720 + index * 6),
        movementType: "Putaway",
        productId: product.productId,
        batchId: lot.lotCode,
        fromLocationId: "RCV-D1",
        toLocationId: lot.locationId,
        qty: lot.qtyOnHand,
        referenceType: "Opening Balance",
        referenceId: "SEED-STOCK",
        userOrSystem: "Warehouse System",
        note: `Putaway ${lot.lotCode} to ${lot.locationId}`
      })
    );
    if (index < 30) {
      records.push(
        movement({
          timestamp: addMinutes(-900 + index * 5),
          movementType: "Receive",
          productId: product.productId,
          batchId: lot.lotCode,
          fromLocationId: null,
          toLocationId: "RCV-D1",
          qty: lot.qtyOnHand,
          referenceType: "Opening Balance",
          referenceId: "SEED-STOCK",
          userOrSystem: "Receiving System",
          note: `Received ${lot.lotCode}`
        })
      );
    }
    if (lot.qualityStatus === "QA Hold" || lot.qualityStatus === "Pending QA") {
      records.push(
        movement({
          timestamp: addMinutes(-250 + index),
          movementType: "QA Hold",
          productId: product.productId,
          batchId: lot.lotCode,
          fromLocationId: lot.locationId,
          toLocationId: lot.locationId,
          qty: lot.qtyOnHand,
          referenceType: "Quality",
          referenceId: `QA-${lot.lotCode}`,
          userOrSystem: "QA System",
          note: `${lot.qualityStatus} stock is not allocatable`
        })
      );
    }
    if (lot.qualityStatus === "Quarantine" || lot.qualityStatus === "Expired") {
      records.push(
        movement({
          timestamp: addMinutes(-220 + index),
          movementType: lot.qualityStatus === "Quarantine" ? "Quarantine" : "Adjustment",
          productId: product.productId,
          batchId: lot.lotCode,
          fromLocationId: lot.locationId,
          toLocationId: lot.locationId,
          qty: lot.qtyOnHand,
          referenceType: "Quality",
          referenceId: `QA-${lot.lotCode}`,
          userOrSystem: "QA System",
          note: `${lot.qualityStatus} stock is blocked`
        })
      );
    }
  });

  outboundLines.forEach((line, index) => {
    const product = productByCode.get(line.productCode)!;
    if (line.qtyAllocated > 0) {
      records.push(movement({
        timestamp: addMinutes(-180 + index * 4),
        movementType: "Reserve",
        productId: product.productId,
        batchId: line.batchId,
        fromLocationId: null,
        toLocationId: null,
        qty: line.qtyAllocated,
        referenceType: "Outbound Shipment",
        referenceId: line.shipmentId,
        userOrSystem: "Allocation Engine",
        note: `Reserved for ${line.shipmentId}`
      }));
    }
    if (line.qtyPicked > 0) {
      records.push(movement({
        timestamp: addMinutes(-145 + index * 4),
        movementType: "Pick",
        productId: product.productId,
        batchId: line.batchId,
        fromLocationId: null,
        toLocationId: "DS-D1",
        qty: line.qtyPicked,
        referenceType: "Outbound Shipment",
        referenceId: line.shipmentId,
        userOrSystem: "Picking System",
        note: `Picked for ${line.shipmentId}`
      }));
    }
    if (line.qtyPacked > 0) {
      records.push(movement({
        timestamp: addMinutes(-105 + index * 3),
        movementType: "Pack",
        productId: product.productId,
        batchId: line.batchId,
        fromLocationId: "DS-D1",
        toLocationId: "DS-D1",
        qty: line.qtyPacked,
        referenceType: "Outbound Shipment",
        referenceId: line.shipmentId,
        userOrSystem: "Packing System",
        note: `Packed for ${line.shipmentId}`
      }));
    }
    if (line.allocationStatus === "Staged") {
      records.push(movement({
        timestamp: addMinutes(-60 + index),
        movementType: "Stage",
        productId: product.productId,
        batchId: line.batchId,
        fromLocationId: "DS-D1",
        toLocationId: "DS-D2",
        qty: line.qtyPacked,
        referenceType: "Outbound Shipment",
        referenceId: line.shipmentId,
        userOrSystem: "Dispatch System",
        note: `Staged for ${line.shipmentId}`
      }));
    }
  });

  inboundLines
    .filter((line) => Number(line.qtyReceived) > 0)
    .forEach((line, index) => {
      records.push(movement({
        timestamp: addMinutes(-50 + index * 3),
        movementType: "Receive",
        productId: String(line.productId),
        batchId: String(line.batchId),
        fromLocationId: null,
        toLocationId: "RCV-D1",
        qty: Number(line.qtyReceived),
        referenceType: "Inbound ASN",
        referenceId: String(line.asnId),
        userOrSystem: "Receiving System",
        note: `Received against ${line.asnId}`
      }));
    });

  return records.slice(-115);
}

const zoneSeeds: ZoneSeed[] = [
  { id: "CS", name: "Cold Storage", code: "CS", temperatureMin: 2, temperatureMax: 8, capacityUnits: 1200, currentTemperature: 5.1, fillPercent: 78, status: "normal", productTypes: ["vaccines", "biologics", "cold-chain stock"] },
  { id: "PH", name: "Pharmaceutical Storage", code: "PH", temperatureMin: 15, temperatureMax: 25, capacityUnits: 1400, currentTemperature: 20.8, fillPercent: 73, status: "normal", productTypes: ["HIV", "respiratory", "anti-infective", "general medicine"] },
  { id: "AM", name: "Ambient Storage", code: "AM", temperatureMin: 18, temperatureMax: 28, capacityUnits: 2600, currentTemperature: 22.8, fillPercent: 66, status: "normal", productTypes: ["packaging", "leaflets", "support materials"] },
  { id: "QA", name: "QA Hold", code: "QA", temperatureMin: 15, temperatureMax: 25, capacityUnits: 420, currentTemperature: 20.7, fillPercent: 58, status: "normal", productTypes: ["pending release", "QA hold"] },
  { id: "QAC", name: "QA Cold Hold", code: "QAC", temperatureMin: 2, temperatureMax: 8, capacityUnits: 220, currentTemperature: 5.2, fillPercent: 0, status: "normal", productTypes: ["cold-chain pending release", "cold-chain QA hold"] },
  { id: "QT", name: "Quarantine", code: "QT", temperatureMin: 15, temperatureMax: 25, capacityUnits: 260, currentTemperature: 20.4, fillPercent: 42, status: "normal", productTypes: ["quarantine", "expired"] },
  { id: "RCV", name: "Receiving", code: "RCV", temperatureMin: 15, temperatureMax: 30, capacityUnits: 600, currentTemperature: 23.1, fillPercent: 31, status: "normal", productTypes: ["inbound ASNs"] },
  { id: "DS", name: "Dispatch", code: "DS", temperatureMin: 15, temperatureMax: 30, capacityUnits: 700, currentTemperature: 23.4, fillPercent: 52, status: "normal", productTypes: ["packed", "staged", "dispatch"] }
];

type TemperatureProfile = {
  base: number;
  amplitude: number;
  secondaryAmplitude: number;
  phase: number;
};

type SeedTemperatureReading = {
  zoneId: string;
  temperature: number;
  timestamp: string;
  withinBand: number;
  allowedMin: number;
  allowedMax: number;
  sensorId: string;
  relatedSkuIds: string[];
  relatedBatchIds: string[];
};

const temperatureProfiles: Record<string, TemperatureProfile> = {
  CS: { base: 5.1, amplitude: 0.32, secondaryAmplitude: 0.12, phase: 0.2 },
  PH: { base: 20.8, amplitude: 0.45, secondaryAmplitude: 0.18, phase: 1.1 },
  AM: { base: 22.8, amplitude: 0.58, secondaryAmplitude: 0.24, phase: 2.4 },
  QA: { base: 20.7, amplitude: 0.28, secondaryAmplitude: 0.1, phase: 1.8 },
  QAC: { base: 5.2, amplitude: 0.22, secondaryAmplitude: 0.08, phase: 2.2 },
  QT: { base: 20.4, amplitude: 0.26, secondaryAmplitude: 0.09, phase: 2.9 },
  RCV: { base: 23.1, amplitude: 0.72, secondaryAmplitude: 0.34, phase: 0.7 },
  DS: { base: 23.4, amplitude: 0.82, secondaryAmplitude: 0.32, phase: 1.5 }
};

function baselineTemperature(zoneId: string, index: number) {
  const profile = temperatureProfiles[zoneId] ?? { base: 21, amplitude: 0.4, secondaryAmplitude: 0.12, phase: 0 };
  const smoothWalk = Math.sin(index / 6 + profile.phase) * profile.amplitude;
  const slowDrift = Math.sin(index / 17 + profile.phase * 0.7) * profile.secondaryAmplitude;
  return Number((profile.base + smoothWalk + slowDrift).toFixed(1));
}

function temperatureEventOverride(zoneId: string, index: number, total: number): Partial<SeedTemperatureReading> {
  if (zoneId === "CS" && (index === total - 31 || index === total - 30)) {
    return {
      temperature: index === total - 31 ? 8.4 : 8.3,
      relatedSkuIds: ["STK-100003-01"],
      relatedBatchIds: ["B-L2603-FLUVAX-01"]
    };
  }
  if (zoneId === "PH" && index === total - 44) {
    return {
      temperature: 25.4,
      relatedSkuIds: ["STK-200002-01"],
      relatedBatchIds: ["B-L2606-AMOX500-01"]
    };
  }
  if (zoneId === "AM" && index === total - 52) {
    return {
      temperature: 28.3,
      relatedSkuIds: ["STK-300001-01"],
      relatedBatchIds: ["B-L2611-ORS20-01"]
    };
  }
  if (zoneId === "RCV" && index >= total - 6) {
    const spike = [30.6, 31.2, 31.8, 31.6, 31.4, 31.1][index - (total - 6)];
    return {
      temperature: spike,
      relatedSkuIds: ["STK-200005-03", "STK-200002-03"],
      relatedBatchIds: ["B-L2609-SALB100-03", "B-L2606-AMOX500-03"]
    };
  }
  return {};
}

function buildTemperatureHistory(zone: ZoneSeed, total = 72): SeedTemperatureReading[] {
  return Array.from({ length: total }, (_, index) => {
    const timestamp = new Date(Date.now() - (total - 1 - index) * 5 * 60_000).toISOString();
    const override = temperatureEventOverride(zone.id, index, total);
    const temperature = Number((override.temperature ?? baselineTemperature(zone.id, index)).toFixed(1));
    return {
      zoneId: zone.id,
      temperature,
      timestamp,
      withinBand: temperature >= zone.temperatureMin && temperature <= zone.temperatureMax ? 1 : 0,
      allowedMin: zone.temperatureMin,
      allowedMax: zone.temperatureMax,
      sensorId: `${zone.id}-TEMP-01`,
      relatedSkuIds: override.relatedSkuIds ?? [],
      relatedBatchIds: override.relatedBatchIds ?? []
    };
  });
}

function temperatureStatus(reading: SeedTemperatureReading): ZoneSeed["status"] {
  if (reading.withinBand) return "normal";
  const variance = reading.temperature > reading.allowedMax ? reading.temperature - reading.allowedMax : reading.allowedMin - reading.temperature;
  return variance > 1 ? "critical" : "warn";
}

function enrichedTemperatureSeeded() {
  const result = db
    .prepare("SELECT COUNT(*) AS count FROM temperature_readings WHERE allowed_min IS NOT NULL AND allowed_max IS NOT NULL AND sensor_id IS NOT NULL")
    .get() as { count: number };
  return result.count >= zoneSeeds.length * 24;
}

function seedTemperatureReadings() {
  const insertTemp = db.prepare(`
    INSERT INTO temperature_readings
    (zone_id, temperature, timestamp, within_band, allowed_min, allowed_max, sensor_id, related_sku_ids_json, related_batch_ids_json)
    VALUES (@zoneId, @temperature, @timestamp, @withinBand, @allowedMin, @allowedMax, @sensorId, @relatedSkuIdsJson, @relatedBatchIdsJson)
  `);
  const updateZone = db.prepare(`
    UPDATE zones
    SET temperature_min = @temperatureMin,
        temperature_max = @temperatureMax,
        current_temperature = @currentTemperature,
        status = @status,
        product_types = @productTypes
    WHERE id = @id
  `);

  db.prepare("DELETE FROM temperature_readings").run();
  zoneSeeds.forEach((zone) => {
    const history = buildTemperatureHistory(zone);
    history.forEach((reading) => {
      insertTemp.run({
        zoneId: reading.zoneId,
        temperature: reading.temperature,
        timestamp: reading.timestamp,
        withinBand: reading.withinBand,
        allowedMin: reading.allowedMin,
        allowedMax: reading.allowedMax,
        sensorId: reading.sensorId,
        relatedSkuIdsJson: stringify(reading.relatedSkuIds),
        relatedBatchIdsJson: stringify(reading.relatedBatchIds)
      });
    });
    const latest = history[history.length - 1];
    updateZone.run({
      id: zone.id,
      temperatureMin: zone.temperatureMin,
      temperatureMax: zone.temperatureMax,
      currentTemperature: latest.temperature,
      status: temperatureStatus(latest),
      productTypes: stringify(zone.productTypes)
    });
  });
}

function pruneSeededTemperatureAlerts() {
  db.prepare("DELETE FROM alerts WHERE message = ?").run("Receiving temperature Non-Conformance is open: temperature exceeded 30 C for 30 minutes.");
  db.prepare("DELETE FROM alerts WHERE message LIKE ?").run("%temperature has moved outside its academic cold-chain band%");
}

const inboundStatusByAsn: Record<string, string> = {
  "ASN-1001": "In Transit",
  "ASN-1002": "At Receiving",
  "ASN-1003": "Scheduled",
  "ASN-1004": "In Transit",
  "ASN-1005": "Received",
  "ASN-1006": "QA Pending"
};

const outboundStatusByShipment: Record<string, string> = {
  "SHIP-001": "Loading",
  "SHIP-002": "Picking",
  "SHIP-003": "Allocated",
  "SHIP-004": "Packed",
  "SHIP-005": "Blocked",
  "SHIP-006": "Allocated",
  "SHIP-007": "Picking",
  "SHIP-008": "Scheduled"
};

function offsetIso(minutes: number) {
  return addMinutes(minutes);
}

function appointmentActuals(route: RouteSeedConfig) {
  const reachedWarehouse = route.direction === "inbound" && route.actualArrivalOffsetMinutes != null;
  const activeAtDock = ["at_dock", "loading", "unloading", "completed"].includes(route.appointmentStatus);
  const completed = route.appointmentStatus === "completed";
  const outboundDockIn = route.direction === "outbound" && activeAtDock
    ? Math.min(route.appointmentStartOffsetMinutes + 5, -5)
    : null;
  return {
    actualGateIn: reachedWarehouse
      ? offsetIso(route.actualArrivalOffsetMinutes! - 5)
      : outboundDockIn == null ? null : offsetIso(outboundDockIn - 5),
    actualDockIn: reachedWarehouse && activeAtDock
      ? offsetIso(route.actualArrivalOffsetMinutes!)
      : outboundDockIn == null ? null : offsetIso(outboundDockIn),
    actualDockOut: completed ? offsetIso(route.appointmentEndOffsetMinutes - 15) : null,
    actualGateOut: completed ? offsetIso(route.appointmentEndOffsetMinutes - 5) : null
  };
}

export function refreshProofOfConceptTimeline() {
  const marker = "EVT-SYSTEM-SEED-SCHEDULE-VARIANCE-V1";
  const base = Date.now();
  const at = (minutes: number | null) => minutes == null ? null : new Date(base + minutes * 60_000).toISOString();
  const updatedAt = new Date(base).toISOString();
  TRANSPORT_ROUTE_CONFIGS.forEach((route) => {
    const plannedDeparture = at(route.plannedDepartureOffsetMinutes)!;
    const actualDeparture = at(route.actualDepartureOffsetMinutes);
    const plannedArrival = at(route.plannedArrivalOffsetMinutes)!;
    const actualArrival = at(route.actualArrivalOffsetMinutes);
    const estimatedArrival = actualArrival ?? plannedArrival;
    const windowStart = at(route.deliveryWindowStartOffsetMinutes);
    const windowEnd = at(route.deliveryWindowEndOffsetMinutes);
    const scheduledStart = at(route.appointmentStartOffsetMinutes)!;
    const scheduledEnd = at(route.appointmentEndOffsetMinutes)!;
    const reachedWarehouse = route.actualArrivalOffsetMinutes != null;
    const activeAtDock = ["at_dock", "loading", "unloading", "completed"].includes(route.appointmentStatus);
    const appointmentCompleted = route.appointmentStatus === "completed";

    db.prepare(`
      UPDATE transport_legs
      SET planned_departure = ?, actual_departure = ?, planned_arrival = ?, actual_arrival = ?,
          estimated_arrival = ?, delivery_window_start = ?, delivery_window_end = ?,
          route_status = ?, last_updated_at = ?
      WHERE transport_leg_id = ?
    `).run(
      plannedDeparture,
      actualDeparture,
      plannedArrival,
      actualArrival,
      estimatedArrival,
      windowStart,
      windowEnd,
      route.transportStatus === "exception" ? "disrupted" : "on-time",
      updatedAt,
      route.transportLegId
    );

    db.prepare(`
      UPDATE dock_appointments
      SET scheduled_start = ?, scheduled_end = ?, actual_gate_in = ?, actual_dock_in = ?,
          actual_dock_out = ?, actual_gate_out = ?, last_updated_at = ?
      WHERE dock_appointment_id = ?
    `).run(
      scheduledStart,
      scheduledEnd,
      reachedWarehouse ? at(route.actualArrivalOffsetMinutes! - 5) : null,
      reachedWarehouse && activeAtDock ? actualArrival : null,
      appointmentCompleted ? at(route.appointmentEndOffsetMinutes - 15) : null,
      appointmentCompleted ? at(route.appointmentEndOffsetMinutes - 5) : null,
      updatedAt,
      route.dockAppointmentId
    );

    if (route.direction === "inbound") {
      db.prepare(`
        UPDATE inbound_shipments
        SET eta = ?, planned_arrival = ?, actual_arrival = ?
        WHERE asn_id = ?
      `).run(estimatedArrival, plannedArrival, actualArrival, route.asnId);
    } else {
      const requiredBy = windowEnd ?? plannedArrival;
      db.prepare(`
        UPDATE outbound_shipments
        SET required_by = ?, planned_departure = ?, delivery_window_start = ?, delivery_window_end = ?
        WHERE shipment_id = ? AND actual_departure IS NULL
      `).run(requiredBy, plannedDeparture, windowStart, windowEnd, route.shipmentId);
      db.prepare(`
        UPDATE dock_schedule SET start_time = ?, end_time = ? WHERE shipment_id = ?
      `).run(scheduledStart, scheduledEnd, route.shipmentId);
      db.prepare(`
        UPDATE shipments SET dispatch_time = ?, sla_deadline = ? WHERE id = ?
      `).run(plannedDeparture, requiredBy, route.shipmentId);
    }
  });

  // Treat the rebase itself as the latest timing-layer refresh for every static transport and
  // appointment record. The records' operational content is unchanged.
  db.prepare("UPDATE transport_legs SET last_updated_at = ?").run(updatedAt);
  db.prepare("UPDATE dock_appointments SET last_updated_at = ?").run(updatedAt);

  db.prepare(`
    INSERT INTO warehouse_operational_events
    (event_id, timestamp, process, direction, step, status, source_system, actor, reference_type,
     reference_id, asn_id, shipment_id, transport_leg_id, dock_appointment_id, site_id, dock_id,
     location_id, description, exception_code, metadata_json)
    VALUES (?, ?, 'transport', NULL, 'APPOINTMENT_BOOKED', 'completed', 'TwinOps', 'TwinOps POC clock',
      'Simulation fixture', 'SEED-SCHEDULE-VARIANCE-V1', NULL, NULL, NULL, NULL, ?, NULL, NULL,
      'Rebased the static proof-of-concept schedule to the current runtime clock.', NULL, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      timestamp=excluded.timestamp,
      actor=excluded.actor,
      description=excluded.description,
      metadata_json=excluded.metadata_json
  `).run(marker, updatedAt, WAREHOUSE_SITE_ID, stringify({
    mode: "static-operations-dynamic-clock",
    refreshedAt: updatedAt
  }));
}

type SeedOperationalEvent = {
  eventId: string;
  timestamp: string;
  process: string;
  direction: string | null;
  step: string;
  status: string;
  sourceSystem: string;
  actor: string;
  referenceType: string;
  referenceId: string;
  asnId: string | null;
  shipmentId: string | null;
  transportLegId: string | null;
  dockAppointmentId: string | null;
  siteId: string | null;
  dockId: string | null;
  locationId: string | null;
  description: string;
  exceptionCode: string | null;
  metadata: Record<string, unknown>;
};

function buildOperationalEvents(route: RouteSeedConfig): SeedOperationalEvent[] {
  const referenceType = route.direction === "inbound" ? "ASN" : "Outbound Shipment";
  const referenceId = route.asnId ?? route.shipmentId!;
  let sequence = 1;
  const event = (
    step: string,
    process: string,
    sourceSystem: string,
    description: string,
    timestamp: string,
    status = "completed",
    exceptionCode: string | null = null
  ): SeedOperationalEvent => ({
    eventId: `${route.transportLegId}-EVT-${String(sequence++).padStart(2, "0")}`,
    timestamp,
    process,
    direction: route.direction,
    step,
    status,
    sourceSystem,
    actor: `${sourceSystem} integration`,
    referenceType,
    referenceId,
    asnId: route.asnId,
    shipmentId: route.shipmentId,
    transportLegId: route.transportLegId,
    dockAppointmentId: route.dockAppointmentId,
    siteId: process === "transport" ? route.originSiteId : null,
    dockId: process === "yard" || process === "inbound" || process === "outbound" ? route.dockId : null,
    locationId: null,
    description,
    exceptionCode,
    metadata: { simulated: true, routeId: route.id, dataNotice: SIMULATION_DISCLOSURE }
  });

  const events: SeedOperationalEvent[] = [];
  if (route.direction === "inbound") {
    events.push(
      event("PURCHASE_ORDER_CREATED", "inbound", "ERP", `Purchase order created for ${referenceId}.`, offsetIso(-2880)),
      event("ASN_RECEIVED", "inbound", "WMS", `${referenceId} validated against the purchase order.`, offsetIso(-1440)),
      event("APPOINTMENT_BOOKED", "yard", "YMS", `${route.dockAppointmentId} booked at ${route.dockId}.`, offsetIso(-720)),
      event("VEHICLE_ASSIGNED", "transport", "TMS", `${route.vehicleId} assigned to ${referenceId}.`, offsetIso(Math.min(-15, route.plannedDepartureOffsetMinutes - 180)))
    );
    if (route.actualDepartureOffsetMinutes != null) {
      events.push(event("DEPARTED_ORIGIN", "transport", "TMS", `${route.vehicleId} departed the origin site.`, offsetIso(route.actualDepartureOffsetMinutes)));
    }
    if (route.actualArrivalOffsetMinutes != null) {
      events.push(
        event("GATE_IN", "yard", "YMS", `${route.vehicleId} passed gate, seal, and appointment checks.`, offsetIso(route.actualArrivalOffsetMinutes - 5)),
        event("DOCK_ASSIGNED", "yard", "YMS", `${route.dockId} confirmed for ${referenceId}.`, offsetIso(route.actualArrivalOffsetMinutes))
      );
    }
    if (route.appointmentStatus === "unloading" || route.appointmentStatus === "completed") {
      events.push(event("UNLOADING_STARTED", "inbound", "WMS", `Controlled unloading started at ${route.dockId}.`, offsetIso(route.appointmentStartOffsetMinutes + 10), route.appointmentStatus === "unloading" ? "in_progress" : "completed"));
    }
    if (route.appointmentStatus === "completed") {
      events.push(
        event("HANDLING_UNIT_SCANNED", "inbound", "WMS", `Inbound handling units scanned against ${referenceId}.`, offsetIso(route.appointmentEndOffsetMinutes - 30)),
        event("GOODS_RECEIPT_POSTED", "inventory", "WMS", `Goods receipt posted; stock remains subject to quality and putaway controls.`, offsetIso(route.appointmentEndOffsetMinutes - 20))
      );
    }
    if (route.asnId === "ASN-1006") {
      events.push(event("QA_INSPECTION_STARTED", "quality", "QMS", `Returned stock routed to segregated quality inspection.`, offsetIso(route.appointmentStartOffsetMinutes + 20), "in_progress"));
    }
  } else {
    events.push(
      event("CUSTOMER_ORDER_RECEIVED", "outbound", "ERP", `Customer order received for ${referenceId}.`, offsetIso(-2880)),
      event("DELIVERY_CREATED", "outbound", "ERP", `Delivery document created for ${referenceId}.`, offsetIso(-1440)),
      event("APPOINTMENT_BOOKED", "yard", "YMS", `${route.dockAppointmentId} booked at ${route.dockId}.`, offsetIso(-720))
    );
    const progress = outboundStatusByShipment[route.shipmentId!] ?? "Scheduled";
    const progressRank: Record<string, number> = { Scheduled: 1, Allocated: 3, Picking: 4, Packed: 6, Staged: 8, Loading: 9, Blocked: 1 };
    const rank = progressRank[progress] ?? 1;
    const steps = [
      [2, "WAVE_RELEASED", "outbound", "WMS", "Warehouse wave released."],
      [3, "FEFO_ALLOCATED", "inventory", "WMS", "Quality-released inventory allocated using FEFO."],
      [4, "PICKING_STARTED", "outbound", "WMS", "Picking tasks released to warehouse operators."],
      [5, "PICK_CONFIRMED", "outbound", "WMS", "Picking confirmed by handling-unit scan."],
      [6, "PACK_CONFIRMED", "outbound", "WMS", "Packing and label checks confirmed."],
      [7, "RELEASE_CHECK_PASSED", "quality", "QMS", "Outbound release check passed."],
      [8, "STAGED", "outbound", "WMS", "Shipment staged in the assigned dispatch lane."],
      [9, "LOADING_STARTED", "outbound", "WMS", `Loading started at ${route.dockId}.`]
    ] as const;
    steps.filter(([requiredRank]) => rank >= requiredRank).forEach(([requiredRank, step, process, sourceSystem, description]) => {
      // Warehouse execution may be complete before a future dock appointment. Record the
      // milestones as elapsed work relative to now; a future plan must never appear as completed
      // history in Audit.
      const minutesAgo = Math.max(5, (rank - requiredRank + 1) * 15);
      events.push(event(step, process, sourceSystem, description, offsetIso(-minutesAgo), requiredRank === rank && rank < 9 ? "in_progress" : "completed"));
    });
    if (progress === "Blocked") {
      events.push(event("EXCEPTION_RECORDED", "quality", "QMS", `Allocation blocked because no eligible quality-released FEFO stock is available.`, offsetIso(-45), "exception", "QA_HOLD_ALLOCATION"));
    }
  }
  return events;
}

/**
 * Idempotently backfills the unified WMS/TMS/YMS network. This is run for existing non-empty
 * databases as well as fresh resets, so upgrading never requires destructive reseeding.
 */
export function ensureUnifiedOperationalNetwork() {
  const insertSite = db.prepare(`
    INSERT INTO partner_sites
    (site_id, partner_id, partner_name, site_code, role, display_name, address, postal_code, country_code,
     timezone, latitude, longitude, receiving_window, temperature_capabilities_json, vehicle_restrictions_json,
     simulated, public_location_reference, data_notice)
    VALUES (@siteId, @partnerId, @partnerName, @siteCode, @role, @displayName, @address, @postalCode, @countryCode,
     @timezone, @latitude, @longitude, @receivingWindow, @temperatureCapabilitiesJson, @vehicleRestrictionsJson,
     @simulated, @publicLocationReference, @dataNotice)
    ON CONFLICT(site_id) DO UPDATE SET
      partner_id=excluded.partner_id, partner_name=excluded.partner_name, site_code=excluded.site_code,
      role=excluded.role, display_name=excluded.display_name, address=excluded.address, postal_code=excluded.postal_code,
      country_code=excluded.country_code, timezone=excluded.timezone, latitude=excluded.latitude, longitude=excluded.longitude,
      receiving_window=excluded.receiving_window, temperature_capabilities_json=excluded.temperature_capabilities_json,
      vehicle_restrictions_json=excluded.vehicle_restrictions_json, simulated=excluded.simulated,
      public_location_reference=excluded.public_location_reference, data_notice=excluded.data_notice
  `);
  PARTNER_SITE_CONFIGS.forEach((item) => insertSite.run({
    siteId: item.siteId,
    partnerId: item.partnerId,
    partnerName: item.partnerName,
    siteCode: item.siteCode,
    role: item.role,
    displayName: item.displayName,
    address: item.address,
    postalCode: item.postalCode,
    countryCode: item.countryCode,
    timezone: item.timezone,
    latitude: item.location.lat,
    longitude: item.location.lng,
    receivingWindow: item.receivingWindow,
    temperatureCapabilitiesJson: stringify(item.temperatureCapabilities),
    vehicleRestrictionsJson: stringify(item.vehicleRestrictions),
    simulated: item.simulated ? 1 : 0,
    publicLocationReference: item.publicLocationReference,
    dataNotice: item.dataNotice
  }));

  const insertLeg = db.prepare(`
    INSERT INTO transport_legs
    (transport_leg_id, route_id, direction, asn_id, shipment_id, origin_site_id, destination_site_id, name,
     origin_type, expected_skus_json, carrier_id, carrier_name, vehicle_id, vehicle_type, license_plate, driver_id,
     planned_departure, actual_departure, planned_arrival, actual_arrival, estimated_arrival, delivery_window_start,
     delivery_window_end, dock_appointment_id, temperature_requirement, temperature_min, temperature_max,
     temperature_status, temperature_logger_id, transport_status, route_status, distance_km, base_duration_minutes,
     duration_minutes, disruption_type, risk_level, risk_note, receiving_impact, mitigation_suggestion,
     encoded_polyline, polyline_json, last_known_location_json, last_computed_at, cache_source, seal_number,
     proof_of_delivery_id, last_updated_at)
    VALUES
    (@transportLegId, @routeId, @direction, @asnId, @shipmentId, @originSiteId, @destinationSiteId, @name,
     @originType, @expectedSkusJson, @carrierId, @carrierName, @vehicleId, @vehicleType, @licensePlate, @driverId,
     @plannedDeparture, @actualDeparture, @plannedArrival, @actualArrival, @estimatedArrival, @deliveryWindowStart,
     @deliveryWindowEnd, @dockAppointmentId, @temperatureRequirement, @temperatureMin, @temperatureMax,
     @temperatureStatus, @temperatureLoggerId, @transportStatus, @routeStatus, @distanceKm, @baseDurationMinutes,
     @durationMinutes, @disruptionType, @riskLevel, @riskNote, @receivingImpact, @mitigationSuggestion,
     @encodedPolyline, @polylineJson, @lastKnownLocationJson, @lastComputedAt, @cacheSource, @sealNumber,
     @proofOfDeliveryId, @lastUpdatedAt)
    ON CONFLICT(transport_leg_id) DO UPDATE SET
      route_id=excluded.route_id, direction=excluded.direction, asn_id=excluded.asn_id, shipment_id=excluded.shipment_id,
      origin_site_id=excluded.origin_site_id, destination_site_id=excluded.destination_site_id, name=excluded.name,
      origin_type=excluded.origin_type, expected_skus_json=excluded.expected_skus_json, carrier_id=excluded.carrier_id,
      carrier_name=excluded.carrier_name, vehicle_id=excluded.vehicle_id, vehicle_type=excluded.vehicle_type,
      license_plate=excluded.license_plate, temperature_requirement=excluded.temperature_requirement,
      temperature_min=excluded.temperature_min, temperature_max=excluded.temperature_max,
      temperature_status=excluded.temperature_status, temperature_logger_id=excluded.temperature_logger_id,
      risk_note=excluded.risk_note,
      receiving_impact=excluded.receiving_impact, mitigation_suggestion=excluded.mitigation_suggestion
  `);

  const insertAppointment = db.prepare(`
    INSERT OR IGNORE INTO dock_appointments
    (dock_appointment_id, dock_id, direction, transport_leg_id, reference_type, reference_id, scheduled_start,
     scheduled_end, actual_gate_in, actual_dock_in, actual_dock_out, actual_gate_out, status, carrier_id,
     carrier_name, vehicle_id, license_plate, temperature_requirement, conflict_flag, notes, last_updated_at)
    VALUES (@dockAppointmentId, @dockId, @direction, @transportLegId, @referenceType, @referenceId, @scheduledStart,
     @scheduledEnd, @actualGateIn, @actualDockIn, @actualDockOut, @actualGateOut, @status, @carrierId,
     @carrierName, @vehicleId, @licensePlate, @temperatureRequirement, @conflictFlag, @notes, @lastUpdatedAt)
  `);
  const insertInboundOperational = db.prepare(`
    INSERT OR IGNORE INTO inbound_shipments
    (asn_id, source, route_name, eta, receiving_dock, inbound_status, cold_chain_status, linked_route_id,
     purchase_order_id, supplier_site_id, transport_leg_id, dock_appointment_id, planned_arrival, actual_arrival,
     goods_receipt_number, vehicle_id, seal_number)
    VALUES (@asnId, @source, @routeName, @eta, @receivingDock, @inboundStatus, @coldChainStatus, @linkedRouteId,
     @purchaseOrderId, @supplierSiteId, @transportLegId, @dockAppointmentId, @plannedArrival, @actualArrival,
     @goodsReceiptNumber, @vehicleId, @sealNumber)
  `);
  const updateInboundLinks = db.prepare(`
    UPDATE inbound_shipments SET linked_route_id=@linkedRouteId, supplier_site_id=@supplierSiteId,
      transport_leg_id=@transportLegId, dock_appointment_id=@dockAppointmentId,
      planned_arrival=COALESCE(planned_arrival, @plannedArrival), actual_arrival=COALESCE(actual_arrival, @actualArrival),
      purchase_order_id=COALESCE(purchase_order_id, @purchaseOrderId), vehicle_id=COALESCE(vehicle_id, @vehicleId),
      seal_number=COALESCE(seal_number, @sealNumber)
    WHERE asn_id=@asnId
  `);
  const insertOutboundOperational = db.prepare(`
    INSERT OR IGNORE INTO outbound_shipments
    (shipment_id, destination, required_by, dock, outbound_status, priority_level, route_id, customer_order_id,
     delivery_id, customer_site_id, transport_leg_id, dock_appointment_id, planned_departure, actual_departure,
     delivery_window_start, delivery_window_end, goods_issue_number, proof_of_delivery_id, vehicle_id, seal_number)
    VALUES (@shipmentId, @destination, @requiredBy, @dock, @outboundStatus, @priorityLevel, @routeId, @customerOrderId,
     @deliveryId, @customerSiteId, @transportLegId, @dockAppointmentId, @plannedDeparture, @actualDeparture,
     @deliveryWindowStart, @deliveryWindowEnd, @goodsIssueNumber, @proofOfDeliveryId, @vehicleId, @sealNumber)
  `);
  const updateOutboundLinks = db.prepare(`
    UPDATE outbound_shipments SET route_id=@routeId, customer_site_id=@customerSiteId,
      transport_leg_id=@transportLegId, dock_appointment_id=@dockAppointmentId,
      planned_departure=COALESCE(planned_departure, @plannedDeparture), actual_departure=COALESCE(actual_departure, @actualDeparture),
      delivery_window_start=COALESCE(delivery_window_start, @deliveryWindowStart),
      delivery_window_end=COALESCE(delivery_window_end, @deliveryWindowEnd),
      customer_order_id=COALESCE(customer_order_id, @customerOrderId), delivery_id=COALESCE(delivery_id, @deliveryId),
      proof_of_delivery_id=COALESCE(proof_of_delivery_id, @proofOfDeliveryId), vehicle_id=COALESCE(vehicle_id, @vehicleId),
      seal_number=COALESCE(seal_number, @sealNumber)
    WHERE shipment_id=@shipmentId
  `);
  const insertLegacyShipment = db.prepare(`
    INSERT OR IGNORE INTO shipments
    (id, destination, priority, dock_id, dispatch_time, status, sku_ids_json, cold_chain_required, sla_deadline, quality_flags_json)
    VALUES (@id, @destination, @priority, @dockId, @dispatchTime, @status, '[]', @coldChainRequired, @slaDeadline, @qualityFlagsJson)
  `);
  const insertLegacyDock = db.prepare(`
    INSERT OR IGNORE INTO docks (id, name, status, current_shipment_id, next_available_at)
    VALUES (@id, @name, 'available', NULL, @nextAvailableAt)
  `);
  const insertLegacySchedule = db.prepare(`
    INSERT OR IGNORE INTO dock_schedule (id, dock_id, shipment_id, start_time, end_time, status, conflict_flag)
    VALUES (@id, @dockId, @shipmentId, @startTime, @endTime, @status, @conflictFlag)
  `);
  const insertLegacyRoute = db.prepare(`
    INSERT OR IGNORE INTO inbound_routes
    (id, name, origin, origin_type, origin_lat, origin_lng, destination, destination_lat, destination_lng,
     eta_minutes, base_eta_minutes, status, expected_skus_json, cold_chain_required, disruption_type, risk_level,
     risk_note, receiving_impact, mitigation_suggestion, encoded_polyline, polyline_json, distance_km, last_computed_at, cache_source)
    VALUES (@id, @name, @origin, @originType, @originLat, @originLng, @destination, @destinationLat, @destinationLng,
     @etaMinutes, @baseEtaMinutes, @status, @expectedSkusJson, @coldChainRequired, @disruptionType, @riskLevel,
     @riskNote, @receivingImpact, @mitigationSuggestion, NULL, @polylineJson, @distanceKm, NULL, @cacheSource)
  `);
  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO warehouse_operational_events
    (event_id, timestamp, process, direction, step, status, source_system, actor, reference_type, reference_id,
     asn_id, shipment_id, transport_leg_id, dock_appointment_id, site_id, dock_id, location_id, description,
     exception_code, metadata_json)
    VALUES (@eventId, @timestamp, @process, @direction, @step, @status, @sourceSystem, @actor, @referenceType,
     @referenceId, @asnId, @shipmentId, @transportLegId, @dockAppointmentId, @siteId, @dockId, @locationId,
     @description, @exceptionCode, @metadataJson)
  `);

  ["D1", "D2", "D3", "D4", "D5", "D6"].forEach((dockId, index) => insertLegacyDock.run({
    id: dockId,
    name: `Dock ${dockId.slice(1)}`,
    nextAvailableAt: offsetIso(2 * 60 + index * 30)
  }));

  TRANSPORT_ROUTE_CONFIGS.forEach((route) => {
    const legacy = db.prepare("SELECT * FROM inbound_routes WHERE id = ?").get(route.id) as any;
    const plannedDeparture = offsetIso(route.plannedDepartureOffsetMinutes);
    const actualDeparture = route.actualDepartureOffsetMinutes == null ? null : offsetIso(route.actualDepartureOffsetMinutes);
    const plannedArrival = offsetIso(route.plannedArrivalOffsetMinutes);
    const actualArrival = route.actualArrivalOffsetMinutes == null ? null : offsetIso(route.actualArrivalOffsetMinutes);
    const durationMinutes = Number(legacy?.eta_minutes ?? route.baseEtaMinutes);
    const delayMinutes = Math.max(0, durationMinutes - route.baseEtaMinutes);
    const estimatedArrival = actualArrival ?? new Date(new Date(plannedArrival).getTime() + delayMinutes * 60_000).toISOString();
    const deliveryWindowStart = route.deliveryWindowStartOffsetMinutes == null ? null : offsetIso(route.deliveryWindowStartOffsetMinutes);
    const deliveryWindowEnd = route.deliveryWindowEndOffsetMinutes == null ? null : offsetIso(route.deliveryWindowEndOffsetMinutes);
    const routeStatus = route.transportStatus === "exception" ? "disrupted" : String(legacy?.status ?? "on-time").toLowerCase();
    const lastUpdatedAt = nowIso();
    insertLeg.run({
      transportLegId: route.transportLegId,
      routeId: route.id,
      direction: route.direction,
      asnId: route.asnId,
      shipmentId: route.shipmentId,
      originSiteId: route.originSiteId,
      destinationSiteId: route.destinationSiteId,
      name: route.name,
      originType: route.originType,
      expectedSkusJson: stringify(route.expectedSkus),
      carrierId: route.carrierId,
      carrierName: route.carrierName,
      vehicleId: route.vehicleId,
      vehicleType: route.vehicleType,
      licensePlate: route.licensePlate,
      driverId: route.driverId,
      plannedDeparture,
      actualDeparture,
      plannedArrival,
      actualArrival,
      estimatedArrival,
      deliveryWindowStart,
      deliveryWindowEnd,
      dockAppointmentId: route.dockAppointmentId,
      temperatureRequirement: route.temperatureRequirement,
      temperatureMin: route.temperatureMin,
      temperatureMax: route.temperatureMax,
      temperatureStatus: route.temperatureStatus,
      temperatureLoggerId: route.temperatureLoggerId,
      transportStatus: route.transportStatus,
      routeStatus,
      distanceKm: Number(legacy?.distance_km || route.distanceKm),
      baseDurationMinutes: route.baseEtaMinutes,
      durationMinutes,
      disruptionType: legacy?.disruption_type ?? (route.transportStatus === "exception" ? "warehouse_release_block" : null),
      riskLevel: route.transportStatus === "exception" ? "high" : (legacy?.risk_level ?? route.riskLevel),
      riskNote: route.riskNote,
      receivingImpact: route.receivingImpact,
      mitigationSuggestion: route.mitigationSuggestion,
      encodedPolyline: legacy?.encoded_polyline ?? null,
      polylineJson: legacy?.polyline_json || stringify(route.fallbackPolyline),
      lastKnownLocationJson: route.lastKnownLocation ? stringify(route.lastKnownLocation) : null,
      lastComputedAt: legacy?.last_computed_at ?? null,
      cacheSource: legacy?.cache_source ?? "fallback",
      sealNumber: route.sealNumber,
      proofOfDeliveryId: route.proofOfDeliveryId,
      lastUpdatedAt
    });

    const actuals = appointmentActuals(route);
    // Conflict flags are derived from actual overlapping windows by getDockAppointments(). Do
    // not seed a fabricated conflict on a non-overlapping appointment.
    const conflictFlag = 0;
    insertAppointment.run({
      dockAppointmentId: route.dockAppointmentId,
      dockId: route.dockId,
      direction: route.direction,
      transportLegId: route.transportLegId,
      referenceType: route.direction === "inbound" ? (route.asnId === "ASN-1006" ? "Return" : "ASN") : "Outbound Shipment",
      referenceId: route.asnId ?? route.shipmentId,
      scheduledStart: offsetIso(route.appointmentStartOffsetMinutes),
      scheduledEnd: offsetIso(route.appointmentEndOffsetMinutes),
      ...actuals,
      status: route.appointmentStatus,
      carrierId: route.carrierId,
      carrierName: route.carrierName,
      vehicleId: route.vehicleId,
      licensePlate: route.licensePlate,
      temperatureRequirement: route.temperatureRequirement,
      conflictFlag,
      notes: conflictFlag ? "Simulated overlap requires yard-control review and resequencing." : "Pre-booked simulated GDP dock appointment.",
      lastUpdatedAt
    });

    insertLegacyRoute.run({
      id: route.id,
      name: route.name,
      origin: route.origin,
      originType: route.originType,
      originLat: route.originLocation.lat,
      originLng: route.originLocation.lng,
      destination: route.destination,
      destinationLat: route.destinationLocation.lat,
      destinationLng: route.destinationLocation.lng,
      etaMinutes: durationMinutes,
      baseEtaMinutes: route.baseEtaMinutes,
      status: routeStatus,
      expectedSkusJson: stringify(route.expectedSkus),
      coldChainRequired: route.coldChainRequired ? 1 : 0,
      disruptionType: route.transportStatus === "exception" ? "warehouse_release_block" : null,
      riskLevel: route.transportStatus === "exception" ? "high" : route.riskLevel,
      riskNote: route.riskNote,
      receivingImpact: route.receivingImpact,
      mitigationSuggestion: route.mitigationSuggestion,
      polylineJson: stringify(route.fallbackPolyline),
      distanceKm: route.distanceKm,
      cacheSource: "fallback"
    });

    if (route.direction === "inbound") {
      const values = {
        asnId: route.asnId,
        source: route.origin,
        routeName: route.name,
        eta: estimatedArrival,
        receivingDock: route.dockId,
        inboundStatus: inboundStatusByAsn[route.asnId!] ?? "Scheduled",
        coldChainStatus: route.temperatureStatus === "not_required" ? "Not Required" : route.temperatureStatus === "compliant" ? "In Band" : "Pending Logger",
        linkedRouteId: route.id,
        purchaseOrderId: `PO-45${route.asnId!.replace(/\D/g, "")}`,
        supplierSiteId: route.originSiteId,
        plannedArrival,
        actualArrival,
        goodsReceiptNumber: ["Received", "QA Pending", "QA Hold", "Released", "Putaway", "Putaway Complete", "Closed"].includes(inboundStatusByAsn[route.asnId!] ?? "")
          ? `GR-${route.asnId!.replace("ASN-", "")}`
          : null,
        vehicleId: route.vehicleId,
        sealNumber: route.sealNumber,
        transportLegId: route.transportLegId,
        dockAppointmentId: route.dockAppointmentId
      };
      insertInboundOperational.run(values);
      updateInboundLinks.run({
        asnId: values.asnId,
        linkedRouteId: values.linkedRouteId,
        supplierSiteId: values.supplierSiteId,
        transportLegId: values.transportLegId,
        dockAppointmentId: values.dockAppointmentId,
        plannedArrival: values.plannedArrival,
        actualArrival: values.actualArrival,
        purchaseOrderId: values.purchaseOrderId,
        vehicleId: values.vehicleId,
        sealNumber: values.sealNumber
      });
    } else {
      const values = {
        shipmentId: route.shipmentId,
        destination: route.destination,
        requiredBy: deliveryWindowEnd ?? plannedArrival,
        dock: route.dockId,
        outboundStatus: outboundStatusByShipment[route.shipmentId!] ?? "Scheduled",
        priorityLevel: ["SHIP-001", "SHIP-002", "SHIP-005"].includes(route.shipmentId!) ? "Medical Priority" : "Normal",
        routeId: route.id,
        customerOrderId: `SO-50${route.shipmentId!.replace(/\D/g, "")}`,
        deliveryId: `DLV-${route.shipmentId!.replace("SHIP-", "")}`,
        customerSiteId: route.destinationSiteId,
        plannedDeparture,
        actualDeparture,
        deliveryWindowStart,
        deliveryWindowEnd,
        goodsIssueNumber: null,
        proofOfDeliveryId: route.proofOfDeliveryId,
        vehicleId: route.vehicleId,
        sealNumber: route.sealNumber,
        transportLegId: route.transportLegId,
        dockAppointmentId: route.dockAppointmentId
      };
      insertOutboundOperational.run(values);
      updateOutboundLinks.run({
        shipmentId: values.shipmentId,
        routeId: values.routeId,
        customerSiteId: values.customerSiteId,
        transportLegId: values.transportLegId,
        dockAppointmentId: values.dockAppointmentId,
        plannedDeparture: values.plannedDeparture,
        actualDeparture: values.actualDeparture,
        deliveryWindowStart: values.deliveryWindowStart,
        deliveryWindowEnd: values.deliveryWindowEnd,
        customerOrderId: values.customerOrderId,
        deliveryId: values.deliveryId,
        proofOfDeliveryId: values.proofOfDeliveryId,
        vehicleId: values.vehicleId,
        sealNumber: values.sealNumber
      });
      insertLegacyShipment.run({
        id: route.shipmentId,
        destination: route.destination,
        priority: values.priorityLevel === "Medical Priority" ? "URGENT" : "NORMAL",
        dockId: route.dockId,
        dispatchTime: plannedDeparture,
        status: values.outboundStatus,
        coldChainRequired: route.coldChainRequired ? 1 : 0,
        slaDeadline: values.requiredBy,
        qualityFlagsJson: stringify(values.outboundStatus === "Blocked" ? ["Quality-released FEFO stock required"] : [])
      });
      insertLegacySchedule.run({
        id: `SCH-${route.shipmentId}`,
        dockId: route.dockId,
        shipmentId: route.shipmentId,
        startTime: offsetIso(route.appointmentStartOffsetMinutes),
        endTime: offsetIso(route.appointmentEndOffsetMinutes),
        status: route.appointmentStatus === "completed" ? "complete" : route.appointmentStatus,
        conflictFlag
      });
    }

    buildOperationalEvents(route).forEach((record) => insertEvent.run({
      eventId: record.eventId,
      timestamp: record.timestamp,
      process: record.process,
      direction: record.direction,
      step: record.step,
      status: record.status,
      sourceSystem: record.sourceSystem,
      actor: record.actor,
      referenceType: record.referenceType,
      referenceId: record.referenceId,
      asnId: record.asnId,
      shipmentId: record.shipmentId,
      transportLegId: record.transportLegId,
      dockAppointmentId: record.dockAppointmentId,
      siteId: record.siteId,
      dockId: record.dockId,
      locationId: record.locationId,
      description: record.description,
      exceptionCode: record.exceptionCode,
      metadataJson: stringify(record.metadata)
    }));
  });

  // Older databases can contain the pharmaceutical stock master without the WMS document lines.
  // Backfill them once so quantity progress, stock disposition, and transport execution all resolve
  // to the same product/batch records. Re-running this migration is intentionally a no-op.
  const insertInboundLine = db.prepare(`
    INSERT OR IGNORE INTO inbound_lines
    (inbound_line_id, asn_id, product_id, batch_id, qty_expected, qty_received, temp_band, receiving_status, qa_status)
    VALUES (@id, @asnId, @productId, @batchId, @expected, @received, @tempBand, @receivingStatus, @qaStatus)
  `);
  const inboundLineCount = db.prepare("SELECT COUNT(*) AS count FROM inbound_lines").get() as { count: number };
  if (inboundLineCount.count === 0) {
    [
      ["INL-1001-1", "ASN-1001", "MAT-100003", "B-L2603-FLUVAX-03", 120, 0, "2-8 C", "Expected", "Pending QA"],
      ["INL-1001-2", "ASN-1001", "MAT-100004", "B-L2604-ADAL40-03", 60, 0, "2-8 C", "Expected", "Pending QA"],
      ["INL-1002-1", "ASN-1002", "MAT-200005", "B-L2609-SALB100-03", 90, 40, "15-25 C", "Receiving", "Released"],
      ["INL-1002-2", "ASN-1002", "MAT-200002", "B-L2606-AMOX500-03", 120, 70, "15-25 C", "Dock Check", "Pending QA"],
      ["INL-1003-1", "ASN-1003", "MAT-100003", "B-L2603-FLUVAX-02", 140, 0, "2-8 C", "Expected", "Pending QA"],
      ["INL-1003-2", "ASN-1003", "MAT-100002", "B-L2602-INSHUM-03", 100, 0, "2-8 C", "Expected", "Pending QA"],
      ["INL-1004-1", "ASN-1004", "MAT-100001", "B-L2601-INSGLA-03", 80, 0, "2-8 C", "Expected", "Pending QA"],
      ["INL-1004-2", "ASN-1004", "MAT-100004", "B-L2604-ADAL40-02", 50, 0, "2-8 C", "Expected", "QA Hold"],
      ["INL-1005-1", "ASN-1005", "MAT-300001", "B-L2611-ORS20-02", 532, 532, "Below 30 C", "Received", "Released"],
      ["INL-1005-2", "ASN-1005", "MAT-300002", "B-L2612-POVI10-02", 365, 365, "Below 30 C", "Received", "Released"],
      ["INL-1006-1", "ASN-1006", "MAT-300002", "B-L2612-POVI10-01", 30, 30, "Below 30 C", "Return Received", "Quarantine"]
    ].forEach(([id, asnId, productId, batchId, expected, received, tempBand, receivingStatus, qaStatus]) => insertInboundLine.run({
      id: String(id),
      asnId: String(asnId),
      productId: String(productId),
      batchId: String(batchId),
      expected: Number(expected),
      received: Number(received),
      tempBand: String(tempBand),
      receivingStatus: String(receivingStatus),
      qaStatus: String(qaStatus)
    }));
  }

  // V5 repairs databases created by the earlier pharmaceutical backfill, where ASN-1005 had a
  // Received header and goods-receipt number but no current-catalogue document lines.
  const hasCurrentAmbientCatalog = (db.prepare("SELECT COUNT(*) AS count FROM products WHERE product_id IN ('MAT-300001', 'MAT-300002')").get() as { count: number }).count === 2;
  if (hasCurrentAmbientCatalog) {
    [
      ["INL-1005-1", "ASN-1005", "MAT-300001", "B-L2611-ORS20-02", 532, 532, "Below 30 C", "Received", "Released"],
      ["INL-1005-2", "ASN-1005", "MAT-300002", "B-L2612-POVI10-02", 365, 365, "Below 30 C", "Received", "Released"]
    ].forEach(([id, asnId, productId, batchId, expected, received, tempBand, receivingStatus, qaStatus]) => insertInboundLine.run({
      id: String(id),
      asnId: String(asnId),
      productId: String(productId),
      batchId: String(batchId),
      expected: Number(expected),
      received: Number(received),
      tempBand: String(tempBand),
      receivingStatus: String(receivingStatus),
      qaStatus: String(qaStatus)
    }));
  }

  const outboundExecutionLines = [
    { id: "OUT-001-1", shipmentId: "SHIP-001", productId: "MAT-100001", batchId: "B-L2601-INSGLA-01", required: 30, allocated: 30, picked: 30, packed: 30, dispatched: 0, reserved: 0, staged: 30, status: "Loading" },
    { id: "OUT-002-1", shipmentId: "SHIP-002", productId: "MAT-100003", batchId: "B-L2603-FLUVAX-01", required: 165, allocated: 165, picked: 30, packed: 0, dispatched: 0, reserved: 135, staged: 0, status: "Picking" },
    { id: "OUT-002-2", shipmentId: "SHIP-002", productId: "MAT-100003", batchId: "B-L2603-FLUVAX-02", required: 96, allocated: 96, picked: 0, packed: 0, dispatched: 0, reserved: 96, staged: 0, status: "Allocated" },
    { id: "OUT-002-3", shipmentId: "SHIP-002", productId: "MAT-100003", batchId: "B-L2603-FLUVAX-03", required: 9, allocated: 9, picked: 0, packed: 0, dispatched: 0, reserved: 9, staged: 0, status: "Allocated" },
    { id: "OUT-003-1", shipmentId: "SHIP-003", productId: "MAT-200005", batchId: "B-L2609-SALB100-01", required: 40, allocated: 40, picked: 0, packed: 0, dispatched: 0, reserved: 40, staged: 0, status: "Allocated" },
    { id: "OUT-004-1", shipmentId: "SHIP-004", productId: "MAT-200001", batchId: "B-L2605-PARA500-01", required: 60, allocated: 60, picked: 60, packed: 60, dispatched: 0, reserved: 0, staged: 0, status: "Packed" },
    { id: "OUT-005-1", shipmentId: "SHIP-005", productId: "MAT-200006", batchId: "B-L2610-OMEP20-01", required: 20, allocated: 0, picked: 0, packed: 0, dispatched: 0, reserved: 0, staged: 0, status: "Blocked: QA Hold" },
    { id: "OUT-006-1", shipmentId: "SHIP-006", productId: "MAT-100004", batchId: "B-L2604-ADAL40-01", required: 122, allocated: 122, picked: 0, packed: 0, dispatched: 0, reserved: 122, staged: 0, status: "Allocated" },
    { id: "OUT-006-2", shipmentId: "SHIP-006", productId: "MAT-100004", batchId: "B-L2604-ADAL40-03", required: 108, allocated: 108, picked: 0, packed: 0, dispatched: 0, reserved: 108, staged: 0, status: "Allocated" },
    { id: "OUT-007-1", shipmentId: "SHIP-007", productId: "MAT-200002", batchId: "B-L2606-AMOX500-01", required: 60, allocated: 60, picked: 30, packed: 0, dispatched: 0, reserved: 30, staged: 0, status: "Picking" },
    { id: "OUT-008-1", shipmentId: "SHIP-008", productId: "MAT-300001", batchId: "B-L2611-ORS20-01", required: 80, allocated: 0, picked: 0, packed: 0, dispatched: 0, reserved: 0, staged: 0, status: "Scheduled" }
  ];
  const outboundLineCount = db.prepare("SELECT COUNT(*) AS count FROM outbound_lines").get() as { count: number };
  if (outboundLineCount.count === 0) {
    const insertOutboundLine = db.prepare(`
      INSERT OR IGNORE INTO outbound_lines
      (outbound_line_id, shipment_id, product_id, batch_id, qty_required, qty_allocated, qty_picked, qty_packed, qty_dispatched, allocation_status)
      VALUES (@id, @shipmentId, @productId, @batchId, @required, @allocated, @picked, @packed, @dispatched, @status)
    `);
    const updateBalance = db.prepare(`
      UPDATE stock_balances
      SET qty_available = MAX(qty_on_hand - qty_on_hold - @reserved - @picked - @packed - @staged, 0),
          qty_reserved = @reserved,
          qty_picked = @picked,
          qty_packed = @packed,
          qty_staged = @staged,
          last_updated = @updatedAt
      WHERE batch_id = @batchId
    `);
    outboundExecutionLines.forEach((line) => {
      insertOutboundLine.run({
        id: line.id,
        shipmentId: line.shipmentId,
        productId: line.productId,
        batchId: line.batchId,
        required: line.required,
        allocated: line.allocated,
        picked: line.picked,
        packed: line.packed,
        dispatched: line.dispatched,
        status: line.status
      });
      updateBalance.run({
        batchId: line.batchId,
        reserved: line.reserved,
        picked: Math.max(0, line.picked - line.packed),
        packed: Math.max(0, line.packed - line.staged),
        staged: line.staged,
        updatedAt: nowIso()
      });
      db.prepare("UPDATE outbound_shipments SET outbound_status = ? WHERE shipment_id = ?").run(outboundStatusByShipment[line.shipmentId], line.shipmentId);
    });
  }

  const executionBackfillMarker = "EVT-SYSTEM-WMS-LINE-BACKFILL-V4";
  const executionBackfillDone = db.prepare("SELECT COUNT(*) AS count FROM warehouse_operational_events WHERE event_id = ?").get(executionBackfillMarker) as { count: number };
  if (executionBackfillDone.count === 0 && (db.prepare("SELECT COUNT(*) AS count FROM outbound_lines").get() as { count: number }).count > 0) {
    db.prepare("DELETE FROM warehouse_operational_events WHERE event_id IN ('EVT-SYSTEM-WMS-LINE-BACKFILL-V1', 'EVT-SYSTEM-WMS-LINE-BACKFILL-V2', 'EVT-SYSTEM-WMS-LINE-BACKFILL-V3')").run();
    const updateExecutionBalance = db.prepare(`
      UPDATE stock_balances
      SET qty_available = MAX(qty_on_hand - qty_on_hold - @reserved - @picked - @packed - @staged, 0),
          qty_reserved = @reserved,
          qty_picked = @picked,
          qty_packed = @packed,
          qty_staged = @staged,
          last_updated = @updatedAt
      WHERE batch_id = @batchId
    `);
    const updateExecutionLine = db.prepare(`
      UPDATE outbound_lines
      SET qty_required = @required, qty_allocated = @allocated, qty_picked = @picked,
          qty_packed = @packed, qty_dispatched = @dispatched, allocation_status = @status
      WHERE outbound_line_id = @id
    `);
    outboundExecutionLines.forEach((line) => {
      updateExecutionLine.run({
        id: line.id,
        required: line.required,
        allocated: line.allocated,
        picked: line.picked,
        packed: line.packed,
        dispatched: line.dispatched,
        status: line.status
      });
      db.prepare(`
        UPDATE outbound_shipments
        SET outbound_status = ?, actual_departure = NULL, goods_issue_number = NULL,
            proof_of_delivery_id = NULL, seal_number = NULL
        WHERE shipment_id = ?
      `).run(outboundStatusByShipment[line.shipmentId], line.shipmentId);
      const route = TRANSPORT_ROUTE_CONFIGS.find((item) => item.shipmentId === line.shipmentId);
      if (route) {
        db.prepare(`
          UPDATE transport_legs
          SET actual_departure = NULL, actual_arrival = NULL, transport_status = ?, route_status = ?,
              seal_number = ?, proof_of_delivery_id = NULL, last_updated_at = ?
          WHERE transport_leg_id = ?
        `).run(
          route.transportStatus,
          route.transportStatus === "exception" ? "disrupted" : "on-time",
          route.sealNumber,
          nowIso(),
          route.transportLegId
        );
        db.prepare(`
          UPDATE dock_appointments
          SET actual_gate_in = NULL, actual_dock_in = NULL, actual_dock_out = NULL,
              actual_gate_out = NULL, status = ?, last_updated_at = ?
          WHERE dock_appointment_id = ?
        `).run(route.appointmentStatus, nowIso(), route.dockAppointmentId);
      }
      updateExecutionBalance.run({
        batchId: line.batchId,
        reserved: Math.max(0, line.allocated - line.picked),
        picked: Math.max(0, line.picked - line.packed),
        packed: Math.max(0, line.packed - line.staged),
        staged: line.staged,
        updatedAt: nowIso()
      });
    });
    insertEvent.run({
      eventId: executionBackfillMarker,
      timestamp: nowIso(),
      process: "inventory",
      direction: null,
      step: "DELIVERY_CREATED",
      status: "completed",
      sourceSystem: "WMS",
      actor: "TwinOps migration",
      referenceType: "WMS integration",
      referenceId: "WMS-LINE-BACKFILL-V4",
      asnId: null,
      shipmentId: null,
      transportLegId: null,
      dockAppointmentId: null,
      siteId: WAREHOUSE_SITE_ID,
      dockId: null,
      locationId: null,
      description: "WMS document lines reconciled with current stock execution buckets.",
      exceptionCode: null,
      metadataJson: stringify({ migration: "WMS-LINE-BACKFILL-V4", idempotent: true })
    });
  }
  // V2 reconciles databases created before transport timing, handling metadata, execution
  // movements and the cold QA area were unified. It deliberately runs once: the application may
  // later receive genuine live updates, which a startup migration must not overwrite.
  const consistencyMarker = "EVT-SYSTEM-OPERATIONAL-CONSISTENCY-V2";
  const consistencyApplied = db.prepare("SELECT COUNT(*) AS count FROM warehouse_operational_events WHERE event_id = ?").get(consistencyMarker) as { count: number };
  if (consistencyApplied.count === 0) {
    const base = Date.now();
    const at = (minutes: number | null) => minutes == null ? null : new Date(base + minutes * 60_000).toISOString();
    const migrationTimestamp = new Date(base).toISOString();
    const upsertProcessLocation = db.prepare(`
      INSERT INTO warehouse_locations (location_id, zone, rack, bin, temp_band, capacity, current_fill)
      VALUES (?, ?, ?, ?, ?, 0, 0)
      ON CONFLICT(location_id) DO UPDATE SET
        zone=excluded.zone, rack=excluded.rack, bin=excluded.bin, temp_band=excluded.temp_band
    `);
    [
      ["RCV-D1", "Receiving", "RCV", "D1", "15-25 C"],
      ["RCV-D2", "Receiving", "RCV", "D2", "2-8 C"],
      ["PK-BENCH", "Packing", "PK", "BENCH", "15-25 C"],
      ...["D1", "D2", "D3", "D4", "D5", "D6"].map((dock) => [`DS-${dock}`, "Dispatch", "DS", dock, "15-30 C"])
    ].forEach((location) => upsertProcessLocation.run(...location));

    TRANSPORT_ROUTE_CONFIGS.forEach((route) => {
      const plannedDeparture = at(route.plannedDepartureOffsetMinutes)!;
      const actualDeparture = at(route.actualDepartureOffsetMinutes);
      const plannedArrival = at(route.plannedArrivalOffsetMinutes)!;
      const actualArrival = at(route.actualArrivalOffsetMinutes);
      const storedDuration = db.prepare("SELECT duration_minutes FROM transport_legs WHERE transport_leg_id = ?").get(route.transportLegId) as { duration_minutes?: number } | undefined;
      const routeDelayMinutes = Math.max(0, Number(storedDuration?.duration_minutes ?? route.baseEtaMinutes) - route.baseEtaMinutes);
      const estimatedArrival = actualArrival ?? new Date(new Date(plannedArrival).getTime() + routeDelayMinutes * 60_000).toISOString();
      const windowStart = at(route.deliveryWindowStartOffsetMinutes);
      const windowEnd = at(route.deliveryWindowEndOffsetMinutes);
      const scheduledStart = at(route.appointmentStartOffsetMinutes)!;
      const scheduledEnd = at(route.appointmentEndOffsetMinutes)!;
      const activeAtDock = ["at_dock", "loading", "unloading", "completed"].includes(route.appointmentStatus);
      const reachedInboundWarehouse = route.direction === "inbound" && route.actualArrivalOffsetMinutes != null;
      const outboundDockInOffset = route.direction === "outbound" && activeAtDock
        ? Math.min(route.appointmentStartOffsetMinutes + 5, -5)
        : null;
      const actualGateIn = reachedInboundWarehouse
        ? at(route.actualArrivalOffsetMinutes! - 5)
        : outboundDockInOffset == null ? null : at(outboundDockInOffset - 5);
      const actualDockIn = reachedInboundWarehouse && activeAtDock
        ? actualArrival
        : outboundDockInOffset == null ? null : at(outboundDockInOffset);
      const completed = route.appointmentStatus === "completed";

      db.prepare(`
        UPDATE transport_legs
        SET route_id=?, direction=?, asn_id=?, shipment_id=?, expected_skus_json=?,
            carrier_id=?, carrier_name=?, vehicle_id=?, vehicle_type=?, license_plate=?,
            planned_departure=?, actual_departure=?, planned_arrival=?, actual_arrival=?, estimated_arrival=?,
            delivery_window_start=?, delivery_window_end=?, temperature_requirement=?, temperature_min=?,
            temperature_max=?, temperature_status=?, temperature_logger_id=?, transport_status=?, route_status=?,
            risk_level=?, risk_note=?, receiving_impact=?, mitigation_suggestion=?, seal_number=?,
            proof_of_delivery_id=?, last_updated_at=?
        WHERE transport_leg_id=?
      `).run(
        route.id, route.direction, route.asnId, route.shipmentId, stringify(route.expectedSkus),
        route.carrierId, route.carrierName, route.vehicleId, route.vehicleType, route.licensePlate,
        plannedDeparture, actualDeparture, plannedArrival, actualArrival, estimatedArrival,
        windowStart, windowEnd, route.temperatureRequirement, route.temperatureMin,
        route.temperatureMax, route.temperatureStatus, route.temperatureLoggerId, route.transportStatus,
        route.transportStatus === "exception" ? "disrupted" : "on-time",
        route.riskLevel, route.riskNote, route.receivingImpact, route.mitigationSuggestion,
        route.sealNumber, route.proofOfDeliveryId, migrationTimestamp, route.transportLegId
      );

      db.prepare(`
        UPDATE dock_appointments
        SET dock_id=?, scheduled_start=?, scheduled_end=?, actual_gate_in=?, actual_dock_in=?,
            actual_dock_out=?, actual_gate_out=?, status=?, carrier_id=?, carrier_name=?, vehicle_id=?,
            license_plate=?, temperature_requirement=?, conflict_flag=0,
            notes='Pre-booked simulated GDP dock appointment.', last_updated_at=?
        WHERE dock_appointment_id=?
      `).run(
        route.dockId, scheduledStart, scheduledEnd, actualGateIn, actualDockIn,
        completed ? at(route.appointmentEndOffsetMinutes - 15) : null,
        completed ? at(route.appointmentEndOffsetMinutes - 5) : null,
        route.appointmentStatus, route.carrierId, route.carrierName, route.vehicleId,
        route.licensePlate, route.temperatureRequirement, migrationTimestamp, route.dockAppointmentId
      );

      db.prepare(`
        UPDATE inbound_routes
        SET expected_skus_json=?, cold_chain_required=?, status=?, risk_level=?, risk_note=?,
            receiving_impact=?, mitigation_suggestion=?
        WHERE id=?
      `).run(
        stringify(route.expectedSkus), route.coldChainRequired ? 1 : 0,
        route.transportStatus === "exception" ? "disrupted" : "on-time",
        route.riskLevel, route.riskNote, route.receivingImpact, route.mitigationSuggestion, route.id
      );

      if (route.direction === "inbound") {
        db.prepare(`
          UPDATE inbound_shipments
          SET eta=?, receiving_dock=?, inbound_status=?, cold_chain_status=?, linked_route_id=?,
              supplier_site_id=?, transport_leg_id=?, dock_appointment_id=?, planned_arrival=?,
              actual_arrival=?, vehicle_id=?, seal_number=?,
              goods_receipt_number=CASE WHEN ? THEN COALESCE(goods_receipt_number, ?) ELSE goods_receipt_number END
          WHERE asn_id=?
        `).run(
          estimatedArrival, route.dockId, inboundStatusByAsn[route.asnId!] ?? "Scheduled",
          route.temperatureStatus === "not_required" ? "Not Required" : route.temperatureStatus === "compliant" ? "In Band" : "Pending Logger",
          route.id, route.originSiteId, route.transportLegId, route.dockAppointmentId,
          plannedArrival, actualArrival, route.vehicleId, route.sealNumber,
          ["Received", "QA Pending", "QA Hold", "Released", "Putaway", "Putaway Complete", "Closed"].includes(inboundStatusByAsn[route.asnId!] ?? "") ? 1 : 0,
          `GR-${route.asnId!.replace("ASN-", "")}`,
          route.asnId
        );
      } else {
        const requiredBy = windowEnd ?? plannedArrival;
        db.prepare(`
          UPDATE outbound_shipments
          SET destination=?, required_by=?, dock=?, outbound_status=?, route_id=?, customer_site_id=?,
              transport_leg_id=?, dock_appointment_id=?, planned_departure=?, actual_departure=?,
              delivery_window_start=?, delivery_window_end=?, vehicle_id=?, seal_number=?
          WHERE shipment_id=?
        `).run(
          route.destination, requiredBy, route.dockId, outboundStatusByShipment[route.shipmentId!] ?? "Scheduled",
          route.id, route.destinationSiteId, route.transportLegId, route.dockAppointmentId,
          plannedDeparture, actualDeparture, windowStart, windowEnd, route.vehicleId, route.sealNumber,
          route.shipmentId
        );
        db.prepare("UPDATE shipments SET dispatch_time=?, sla_deadline=?, status=?, cold_chain_required=? WHERE id=?")
          .run(plannedDeparture, requiredBy, outboundStatusByShipment[route.shipmentId!] ?? "Scheduled", route.coldChainRequired ? 1 : 0, route.shipmentId);
        db.prepare("UPDATE dock_schedule SET start_time=?, end_time=?, status=?, conflict_flag=0 WHERE shipment_id=?")
          .run(scheduledStart, scheduledEnd, route.appointmentStatus === "completed" ? "complete" : route.appointmentStatus, route.shipmentId);
      }

      db.prepare("DELETE FROM warehouse_operational_events WHERE transport_leg_id = ?").run(route.transportLegId);
      buildOperationalEvents(route).forEach((record) => insertEvent.run({
        eventId: record.eventId,
        timestamp: record.timestamp,
        process: record.process,
        direction: record.direction,
        step: record.step,
        status: record.status,
        sourceSystem: record.sourceSystem,
        actor: record.actor,
        referenceType: record.referenceType,
        referenceId: record.referenceId,
        asnId: record.asnId,
        shipmentId: record.shipmentId,
        transportLegId: record.transportLegId,
        dockAppointmentId: record.dockAppointmentId,
        siteId: record.siteId,
        dockId: record.dockId,
        locationId: record.locationId,
        description: record.description,
        exceptionCode: record.exceptionCode,
        metadataJson: stringify(record.metadata)
      }));
    });

    // Flag only genuine overlaps and mark the later appointment for yard-control review.
    const appointments = db.prepare(`
      SELECT dock_appointment_id, dock_id, scheduled_start, scheduled_end
      FROM dock_appointments ORDER BY scheduled_start
    `).all() as Array<{ dock_appointment_id: string; dock_id: string; scheduled_start: string; scheduled_end: string }>;
    appointments.forEach((appointment, index) => {
      const overlapsEarlier = appointments.slice(0, index).some((other) =>
        other.dock_id === appointment.dock_id
        && new Date(other.scheduled_start).getTime() < new Date(appointment.scheduled_end).getTime()
        && new Date(appointment.scheduled_start).getTime() < new Date(other.scheduled_end).getTime()
      );
      if (overlapsEarlier) {
        db.prepare("UPDATE dock_appointments SET conflict_flag=1, notes=? WHERE dock_appointment_id=?")
          .run("Overlapping appointment requires yard-control review and resequencing.", appointment.dock_appointment_id);
      }
    });

    const insertExecutionMovement = db.prepare(`
      INSERT OR IGNORE INTO inventory_movements
      (movement_id, timestamp, movement_type, product_id, batch_id, from_location_id, to_location_id,
       qty, reference_type, reference_id, user_or_system, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Outbound Shipment', ?, 'WMS execution backfill', ?)
    `);
    outboundExecutionLines.forEach((line) => {
      const balance = db.prepare("SELECT location_id FROM stock_balances WHERE batch_id=? ORDER BY stock_balance_id LIMIT 1").get(line.batchId) as { location_id: string } | undefined;
      if (!balance) return;
      const dockId = TRANSPORT_ROUTE_CONFIGS.find((route) => route.shipmentId === line.shipmentId)?.dockId ?? "D1";
      const stages: Array<{ suffix: string; type: string; qty: number; from: string; to: string; minutesAgo: number; note: string }> = [
        { suffix: "RESERVE", type: "Reserve", qty: line.allocated, from: balance.location_id, to: balance.location_id, minutesAgo: 80, note: "Reserved quality-eligible stock for the outbound delivery." },
        { suffix: "PICK", type: "Pick", qty: line.picked, from: balance.location_id, to: "PK-BENCH", minutesAgo: 55, note: "Confirmed picked quantity by warehouse scan." },
        { suffix: "PACK", type: "Pack", qty: line.packed, from: "PK-BENCH", to: "PK-BENCH", minutesAgo: 30, note: "Confirmed packed quantity and shipping label." },
        { suffix: "STAGE", type: "Stage", qty: line.staged, from: "PK-BENCH", to: `DS-${dockId}`, minutesAgo: 15, note: `Staged packed stock for dock ${dockId}.` }
      ];
      stages.filter((stage) => stage.qty > 0).forEach((stage) => insertExecutionMovement.run(
        `MOV-EXEC-${line.id}-${stage.suffix}`,
        at(-stage.minutesAgo),
        stage.type,
        line.productId,
        line.batchId,
        stage.from,
        stage.to,
        stage.qty,
        line.shipmentId,
        stage.note
      ));
    });

    // Repair historical temperature references from the superseded academic catalogue.
    const temperatureReferenceMap: Array<[string, string]> = [
      ["SB-LOT-RSV-0702-A", "STK-100003-01"], ["LOT-RSV-0702-A", "B-L2603-FLUVAX-01"],
      ["SB-LOT-HIV-0709-A", "STK-200002-01"], ["LOT-HIV-0709-A", "B-L2606-AMOX500-01"],
      ["SB-LOT-CRT-0910-C", "STK-300001-01"], ["LOT-CRT-0910-C", "B-L2611-ORS20-01"],
      ["SB-LOT-RESP-0831-C", "STK-200005-03"], ["LOT-RESP-0831-C", "B-L2609-SALB100-03"],
      ["SB-LOT-HIV-0910-C", "STK-200002-03"], ["LOT-HIV-0910-C", "B-L2606-AMOX500-03"]
    ];
    temperatureReferenceMap.forEach(([legacyId, canonicalId]) => {
      db.prepare(`
        UPDATE temperature_readings
        SET related_sku_ids_json=REPLACE(related_sku_ids_json, ?, ?),
            related_batch_ids_json=REPLACE(related_batch_ids_json, ?, ?)
        WHERE related_sku_ids_json LIKE '%' || ? || '%'
           OR related_batch_ids_json LIKE '%' || ? || '%'
      `).run(legacyId, canonicalId, legacyId, canonicalId, legacyId, legacyId);
    });

    insertEvent.run({
      eventId: consistencyMarker,
      timestamp: migrationTimestamp,
      process: "inventory",
      direction: null,
      step: "DELIVERY_CREATED",
      status: "completed",
      sourceSystem: "TwinOps",
      actor: "TwinOps migration",
      referenceType: "Simulation fixture",
      referenceId: "OPERATIONAL-CONSISTENCY-V2",
      asnId: null,
      shipmentId: null,
      transportLegId: null,
      dockAppointmentId: null,
      siteId: WAREHOUSE_SITE_ID,
      dockId: null,
      locationId: null,
      description: "Reconciled transport timing, dock state, execution history and canonical warehouse references.",
      exceptionCode: null,
      metadataJson: stringify({ migration: "OPERATIONAL-CONSISTENCY-V2", idempotent: true })
    });
  }

  // Older V2 runs may contain a vehicle-assignment milestone calculated from a future departure.
  // Clamp that historical action behind the current time without touching genuine live events.
  db.prepare(`
    UPDATE warehouse_operational_events
    SET timestamp=?
    WHERE step='VEHICLE_ASSIGNED' AND timestamp > ?
  `).run(offsetIso(-15), nowIso());
  db.prepare(`
    UPDATE inbound_shipments
    SET goods_receipt_number=COALESCE(goods_receipt_number, 'GR-' || REPLACE(asn_id, 'ASN-', ''))
    WHERE inbound_status IN ('Received', 'QA Pending', 'QA Hold', 'Released', 'Putaway', 'Putaway Complete', 'Closed')
  `).run();
}

const INVENTORY_PLANNING_RISK_MARKER = "EVT-SYSTEM-INVENTORY-PLANNING-RISK-V1";

/**
 * Adds three connected planning examples to the canonical pharmaceutical dataset exactly once.
 * The risks are produced by real WMS relationships rather than UI-only flags: outbound allocation
 * drives critical/warning availability, while a released FEFO lot drives expiry exposure.
 */
export function ensureInventoryPlanningRiskExamples() {
  const markerExists = (db.prepare(
    "SELECT COUNT(*) AS count FROM warehouse_operational_events WHERE event_id = ?"
  ).get(INVENTORY_PLANNING_RISK_MARKER) as { count: number }).count > 0;
  if (markerExists) return false;

  const requiredBatches = [
    "B-L2603-FLUVAX-01",
    "B-L2603-FLUVAX-02",
    "B-L2603-FLUVAX-03",
    "B-L2604-ADAL40-01",
    "B-L2604-ADAL40-03",
    "B-L2610-OMEP20-02"
  ];
  const availableBatchCount = (db.prepare(
    `SELECT COUNT(*) AS count FROM batches WHERE batch_id IN (${requiredBatches.map(() => "?").join(",")})`
  ).get(...requiredBatches) as { count: number }).count;
  if (availableBatchCount !== requiredBatches.length) return false;

  const updatedAt = nowIso();
  const allocations = [
    { id: "OUT-002-1", shipmentId: "SHIP-002", productId: "MAT-100003", batchId: "B-L2603-FLUVAX-01", required: 165, allocated: 165, picked: 30, status: "Picking", reserved: 135 },
    { id: "OUT-002-2", shipmentId: "SHIP-002", productId: "MAT-100003", batchId: "B-L2603-FLUVAX-02", required: 96, allocated: 96, picked: 0, status: "Allocated", reserved: 96 },
    { id: "OUT-002-3", shipmentId: "SHIP-002", productId: "MAT-100003", batchId: "B-L2603-FLUVAX-03", required: 9, allocated: 9, picked: 0, status: "Allocated", reserved: 9 },
    { id: "OUT-006-1", shipmentId: "SHIP-006", productId: "MAT-100004", batchId: "B-L2604-ADAL40-01", required: 122, allocated: 122, picked: 0, status: "Allocated", reserved: 122 },
    { id: "OUT-006-2", shipmentId: "SHIP-006", productId: "MAT-100004", batchId: "B-L2604-ADAL40-03", required: 108, allocated: 108, picked: 0, status: "Allocated", reserved: 108 }
  ];
  const upsertOutboundLine = db.prepare(`
    INSERT INTO outbound_lines
      (outbound_line_id, shipment_id, product_id, batch_id, qty_required, qty_allocated,
       qty_picked, qty_packed, qty_dispatched, allocation_status)
    VALUES (@id, @shipmentId, @productId, @batchId, @required, @allocated, @picked, 0, 0, @status)
    ON CONFLICT(outbound_line_id) DO UPDATE SET
      shipment_id=excluded.shipment_id, product_id=excluded.product_id, batch_id=excluded.batch_id,
      qty_required=excluded.qty_required, qty_allocated=excluded.qty_allocated,
      qty_picked=excluded.qty_picked, qty_packed=0, qty_dispatched=0,
      allocation_status=excluded.allocation_status
  `);
  const updateBalance = db.prepare(`
    UPDATE stock_balances
    SET qty_available = MAX(qty_on_hand - qty_on_hold - @reserved - @picked, 0),
        qty_reserved = @reserved,
        qty_picked = @picked,
        qty_packed = 0,
        qty_staged = 0,
        last_updated = @updatedAt
    WHERE batch_id = @batchId
  `);
  allocations.forEach((allocation) => {
    upsertOutboundLine.run({
      id: allocation.id,
      shipmentId: allocation.shipmentId,
      productId: allocation.productId,
      batchId: allocation.batchId,
      required: allocation.required,
      allocated: allocation.allocated,
      picked: allocation.picked,
      status: allocation.status
    });
    updateBalance.run({
      batchId: allocation.batchId,
      reserved: allocation.reserved,
      picked: allocation.picked,
      updatedAt
    });
  });

  db.prepare("UPDATE batches SET expiry_date = ? WHERE batch_id = ?").run(
    addDays(10),
    "B-L2610-OMEP20-02"
  );

  const insertMovement = db.prepare(`
    INSERT OR IGNORE INTO inventory_movements
      (movement_id, timestamp, movement_type, product_id, batch_id, from_location_id,
       to_location_id, qty, reference_type, reference_id, user_or_system, note)
    VALUES (@movementId, @timestamp, 'Reservation', @productId, @batchId, @locationId,
      NULL, @qty, 'Outbound Shipment', @shipmentId, 'WMS Allocation', @note)
  `);
  [
    { movementId: "MOV-PLAN-FLU-01", productId: "MAT-100003", batchId: "B-L2603-FLUVAX-01", locationId: "CS-03-01-A07", qty: 115, shipmentId: "SHIP-002", note: "Additional vaccine-campaign allocation creates a lead-time safety-stock warning." },
    { movementId: "MOV-PLAN-FLU-02", productId: "MAT-100003", batchId: "B-L2603-FLUVAX-02", locationId: "CS-03-02-A08", qty: 96, shipmentId: "SHIP-002", note: "Vaccine-campaign allocation reserved against the connected outbound shipment." },
    { movementId: "MOV-PLAN-FLU-03", productId: "MAT-100003", batchId: "B-L2603-FLUVAX-03", locationId: "CS-03-03-A09", qty: 9, shipmentId: "SHIP-002", note: "Vaccine-campaign allocation reserved against the connected outbound shipment." },
    { movementId: "MOV-PLAN-ADAL-01", productId: "MAT-100004", batchId: "B-L2604-ADAL40-01", locationId: "CS-04-01-A10", qty: 97, shipmentId: "SHIP-006", note: "Medical-priority allocation creates a projected stock-out before replenishment lead time." },
    { movementId: "MOV-PLAN-ADAL-02", productId: "MAT-100004", batchId: "B-L2604-ADAL40-03", locationId: "CS-04-03-A12", qty: 108, shipmentId: "SHIP-006", note: "Medical-priority allocation reserved against the connected outbound shipment." }
  ].forEach((movement) => insertMovement.run({ ...movement, timestamp: updatedAt }));

  db.prepare(`
    INSERT INTO warehouse_operational_events
      (event_id, timestamp, process, direction, step, status, source_system, actor,
       reference_type, reference_id, asn_id, shipment_id, transport_leg_id,
       dock_appointment_id, site_id, dock_id, location_id, description,
       exception_code, metadata_json)
    VALUES (?, ?, 'inventory', NULL, 'PLANNING_RISK_IDENTIFIED', 'completed', 'WMS',
      'TwinOps planning fixture', 'Inventory planning', 'RISK-EXAMPLES-V1', NULL, NULL,
      NULL, NULL, ?, NULL, NULL,
      'Created connected critical, replenishment-warning, and FEFO-expiry examples from canonical WMS records.',
      NULL, ?)
  `).run(
    INVENTORY_PLANNING_RISK_MARKER,
    updatedAt,
    WAREHOUSE_SITE_ID,
    stringify({
      critical: { productId: "MAT-100004", shipmentId: "SHIP-006" },
      warning: { productId: "MAT-100003", shipmentId: "SHIP-002" },
      expiry: { productId: "MAT-200006", batchId: "B-L2610-OMEP20-02", expiresInDays: 10 },
      simulated: true,
      idempotent: true
    })
  );

  return true;
}

export function seedIfEmpty() {
  // Default runtime mode deliberately has no inventory fixture. Tests or an explicitly requested
  // demo reset may opt in; in that mode an operational-only database is upgraded to the fixture.
  const seedDemoInventory = process.env.TWINOPS_SEED_DEMO_INVENTORY === "true";
  const zoneCount = db.prepare("SELECT COUNT(*) AS count FROM zones").get() as { count: number };
  const productCount = db.prepare("SELECT COUNT(*) AS count FROM products").get() as { count: number };
  if (zoneCount.count > 0 && (!seedDemoInventory || productCount.count > 0)) {
    try {
      db.exec("BEGIN");
      ensureUnifiedOperationalNetwork();
      ensureInventoryPlanningRiskExamples();
      if (!enrichedTemperatureSeeded()) {
        seedTemperatureReadings();
      }
      pruneSeededTemperatureAlerts();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return false;
  }

  const locations = buildLocations();
  const balances = lotSeeds.map(balanceForLot);
  const movements = buildMovements();
  // The application now starts with an empty inventory model by default. The former academic
  // dataset remains available only as an explicit test/demo fixture; it is never loaded into the
  // current operational database unless this environment flag is deliberately enabled.

  const insertZone = db.prepare(`
    INSERT INTO zones
    (id, name, code, temperature_min, temperature_max, capacity_units, current_temperature, fill_percent, status, product_types)
    VALUES (@id, @name, @code, @temperatureMin, @temperatureMax, @capacityUnits, @currentTemperature, @fillPercent, @status, @productTypes)
  `);
  const insertProduct = db.prepare(`
    INSERT INTO products
    (product_id, product_code, product_name, product_family, default_temp_band, storage_class, unit_type, safety_stock, reorder_point, target_stock, lead_time_days, average_daily_demand)
    VALUES (@productId, @productCode, @productName, @productFamily, @defaultTempBand, @storageClass, @unitType, @safetyStock, @reorderPoint, @targetStock, @leadTimeDays, @averageDailyDemand)
  `);
  const insertBatch = db.prepare(`
    INSERT INTO batches
    (batch_id, product_id, lot_code, expiry_date, manufacture_date, quality_status, temp_band, serialization_status, notes)
    VALUES (@batchId, @productId, @lotCode, @expiryDate, @manufactureDate, @qualityStatus, @tempBand, @serializationStatus, @notes)
  `);
  const insertLocation = db.prepare(`
    INSERT INTO warehouse_locations
    (location_id, zone, rack, bin, temp_band, capacity, current_fill)
    VALUES (@locationId, @zone, @rack, @bin, @tempBand, @capacity, @currentFill)
  `);
  const insertBalance = db.prepare(`
    INSERT INTO stock_balances
    (stock_balance_id, batch_id, location_id, qty_on_hand, qty_available, qty_reserved, qty_picked, qty_packed, qty_staged, qty_dispatched, qty_on_hold, last_updated)
    VALUES (@stockBalanceId, @batchId, @locationId, @qtyOnHand, @qtyAvailable, @qtyReserved, @qtyPicked, @qtyPacked, @qtyStaged, @qtyDispatched, @qtyOnHold, @lastUpdated)
  `);
  const insertInbound = db.prepare(`
    INSERT INTO inbound_shipments
    (asn_id, source, route_name, eta, receiving_dock, inbound_status, cold_chain_status, linked_route_id)
    VALUES (@asnId, @source, @routeName, @eta, @receivingDock, @inboundStatus, @coldChainStatus, @linkedRouteId)
  `);
  const insertInboundLine = db.prepare(`
    INSERT INTO inbound_lines
    (inbound_line_id, asn_id, product_id, batch_id, qty_expected, qty_received, temp_band, receiving_status, qa_status)
    VALUES (@inboundLineId, @asnId, @productId, @batchId, @qtyExpected, @qtyReceived, @tempBand, @receivingStatus, @qaStatus)
  `);
  const insertOutbound = db.prepare(`
    INSERT INTO outbound_shipments
    (shipment_id, destination, required_by, dock, outbound_status, priority_level, route_id)
    VALUES (@shipmentId, @destination, @requiredBy, @dock, @outboundStatus, @priorityLevel, @routeId)
  `);
  const insertOutboundLine = db.prepare(`
    INSERT INTO outbound_lines
    (outbound_line_id, shipment_id, product_id, batch_id, qty_required, qty_allocated, qty_picked, qty_packed, qty_dispatched, allocation_status)
    VALUES (@outboundLineId, @shipmentId, @productId, @batchId, @qtyRequired, @qtyAllocated, @qtyPicked, @qtyPacked, @qtyDispatched, @allocationStatus)
  `);
  const insertMovement = db.prepare(`
    INSERT INTO inventory_movements
    (movement_id, timestamp, movement_type, product_id, batch_id, from_location_id, to_location_id, qty, reference_type, reference_id, user_or_system, note)
    VALUES (@movementId, @timestamp, @movementType, @productId, @batchId, @fromLocationId, @toLocationId, @qty, @referenceType, @referenceId, @userOrSystem, @note)
  `);
  const insertShipment = db.prepare(`
    INSERT INTO shipments
    (id, destination, priority, dock_id, dispatch_time, status, sku_ids_json, cold_chain_required, sla_deadline, quality_flags_json)
    VALUES (@id, @destination, @priority, @dockId, @dispatchTime, @status, @skuIdsJson, @coldChainRequired, @slaDeadline, @qualityFlagsJson)
  `);
  const insertDock = db.prepare(`
    INSERT INTO docks (id, name, status, current_shipment_id, next_available_at)
    VALUES (@id, @name, @status, @currentShipmentId, @nextAvailableAt)
  `);
  const insertDockSchedule = db.prepare(`
    INSERT INTO dock_schedule (id, dock_id, shipment_id, start_time, end_time, status, conflict_flag)
    VALUES (@id, @dockId, @shipmentId, @startTime, @endTime, @status, @conflictFlag)
  `);
  const insertRoute = db.prepare(`
    INSERT INTO inbound_routes
    (
      id, name, origin, origin_type, origin_lat, origin_lng, destination, destination_lat, destination_lng,
      eta_minutes, base_eta_minutes, status, expected_skus_json, cold_chain_required, disruption_type, risk_level,
      risk_note, receiving_impact, mitigation_suggestion, encoded_polyline, polyline_json, distance_km, last_computed_at, cache_source
    )
    VALUES (
      @id, @name, @origin, @originType, @originLat, @originLng, @destination, @destinationLat, @destinationLng,
      @etaMinutes, @baseEtaMinutes, @status, @expectedSkusJson, @coldChainRequired, @disruptionType, @riskLevel,
      @riskNote, @receivingImpact, @mitigationSuggestion, @encodedPolyline, @polylineJson, @distanceKm, @lastComputedAt, @cacheSource
    )
  `);
  const insertRfid = db.prepare(`
    INSERT INTO rfid_events (sku_id, zone_id, action, timestamp, severity)
    VALUES (@skuId, @zoneId, @action, @timestamp, @severity)
  `);

  try {
    db.exec("BEGIN");
    [
      "warehouse_operational_events",
      "dock_appointments",
      "transport_legs",
      "partner_sites",
      "operational_issue_events",
      "operational_issues",
      "inventory_movements",
      "outbound_lines",
      "outbound_shipments",
      "inbound_lines",
      "inbound_shipments",
      "stock_balances",
      "batches",
      "products",
      "warehouse_locations",
      "rfid_events",
      "temperature_readings",
      "dock_schedule",
      "shipments",
      "docks",
      "skus",
      "inbound_routes",
      "alerts",
      "approval_actions",
      "scenario_snapshots",
      "ai_decisions",
      "zones"
    ].forEach((table) => db.prepare(`DELETE FROM ${table}`).run());

    zoneSeeds.forEach((zone) => {
      insertZone.run({
        id: zone.id,
        name: zone.name,
        code: zone.code,
        temperatureMin: zone.temperatureMin,
        temperatureMax: zone.temperatureMax,
        capacityUnits: zone.capacityUnits,
        currentTemperature: zone.currentTemperature,
        fillPercent: zone.fillPercent,
        status: zone.status,
        productTypes: stringify(zone.productTypes)
      });
    });

    if (!seedDemoInventory) seedPharmaInventory(db);

    if (seedDemoInventory) productSeeds.forEach((product) => insertProduct.run(product));
    if (seedDemoInventory) lotSeeds.forEach((lot) => {
      const product = productByCode.get(lot.productCode)!;
      insertBatch.run({
        batchId: lot.lotCode,
        productId: product.productId,
        lotCode: lot.lotCode,
        expiryDate: addDays(lot.expiryDays),
        manufactureDate: addDays(-lot.manufactureDaysAgo),
        qualityStatus: lot.qualityStatus,
        tempBand: product.defaultTempBand,
        serializationStatus: lot.serializationStatus ?? (product.productFamily === "Packaging" ? "Not serialized" : "Serialized"),
        notes: lot.notes ?? null
      });
    });
    if (seedDemoInventory) locations.forEach((location) => insertLocation.run(location));
    if (seedDemoInventory) balances.forEach((balance) => insertBalance.run(balance));
    if (seedDemoInventory) inboundShipments.forEach((shipment) => insertInbound.run(shipment));
    if (seedDemoInventory) inboundLines.forEach((line) => insertInboundLine.run(line));
    if (seedDemoInventory) outboundShipments.forEach((shipment) => insertOutbound.run(shipment));
    if (seedDemoInventory) outboundLines.forEach((line) => {
      insertOutboundLine.run({
        outboundLineId: line.outboundLineId,
        shipmentId: line.shipmentId,
        productId: productByCode.get(line.productCode)!.productId,
        batchId: line.batchId,
        qtyRequired: line.qtyRequired,
        qtyAllocated: line.qtyAllocated,
        qtyPicked: line.qtyPicked,
        qtyPacked: line.qtyPacked,
        qtyDispatched: line.qtyDispatched,
        allocationStatus: line.allocationStatus
      });
    });
    if (seedDemoInventory) movements.forEach((record) => insertMovement.run(record));

    ["D1", "D2", "D3", "D4", "D5", "D6"].forEach((dockId, index) => {
      const current = seedDemoInventory
        ? outboundShipments.find((shipment) => shipment.dock === dockId && shipment.outboundStatus !== "Scheduled")
        : undefined;
      insertDock.run({
        id: dockId,
        name: `Dock ${dockId.slice(1)}`,
        status: current ? "occupied" : "available",
        currentShipmentId: current?.shipmentId ?? null,
        nextAvailableAt: addHours(index + 2)
      });
    });

    if (seedDemoInventory) outboundShipments.forEach((shipment, index) => {
      const lines = outboundLines.filter((line) => line.shipmentId === shipment.shipmentId);
      const skuIds = lines.map((line) => `SB-${line.batchId}`);
      const coldChainRequired = lines.some((line) => productByCode.get(line.productCode)?.defaultTempBand === "2-8 C");
      insertShipment.run({
        id: shipment.shipmentId,
        destination: shipment.destination,
        priority: priorityFor(shipment.outboundStatus, shipment.priorityLevel),
        dockId: shipment.dock,
        dispatchTime: shipment.requiredBy,
        status: shipment.outboundStatus,
        skuIdsJson: stringify(skuIds),
        coldChainRequired: coldChainRequired ? 1 : 0,
        slaDeadline: addHours(index + 4),
        qualityFlagsJson: stringify(shipment.outboundStatus === "Blocked" ? ["QA Hold stock cannot be allocated"] : [])
      });
      insertDockSchedule.run({
        id: `SCH-${shipment.shipmentId}`,
        dockId: shipment.dock,
        shipmentId: shipment.shipmentId,
        startTime: addMinutes(70 + index * 45),
        endTime: addMinutes(125 + index * 45),
        status: shipment.outboundStatus === "Blocked" ? "blocked" : shipment.outboundStatus.toLowerCase(),
        conflictFlag: shipment.dock === "D1" && shipment.shipmentId === "SHIP-007" ? 1 : 0
      });
    });

    INBOUND_ROUTE_CONFIGS.forEach((route) => {
      insertRoute.run({
        id: route.id,
        name: route.name,
        origin: route.origin,
        originType: route.originType,
        originLat: route.originLocation.lat,
        originLng: route.originLocation.lng,
        destination: route.destination,
        destinationLat: route.destinationLocation.lat,
        destinationLng: route.destinationLocation.lng,
        etaMinutes: route.baseEtaMinutes,
        baseEtaMinutes: route.baseEtaMinutes,
        status: "on-time",
        expectedSkusJson: stringify(route.expectedSkus),
        coldChainRequired: route.coldChainRequired ? 1 : 0,
        disruptionType: null,
        riskLevel: route.riskLevel,
        riskNote: route.riskNote,
        receivingImpact: route.receivingImpact,
        mitigationSuggestion: route.mitigationSuggestion,
        encodedPolyline: null,
        polylineJson: stringify(route.fallbackPolyline),
        distanceKm: route.distanceKm,
        lastComputedAt: null,
        cacheSource: "fallback"
      });
    });

    seedTemperatureReadings();
    pruneSeededTemperatureAlerts();

    if (seedDemoInventory) {
      insertRfid.run({ skuId: "SB-LOT-RSV-0702-A", zoneId: "CS", action: "MOVE", timestamp: addMinutes(-8), severity: "info" });
      insertRfid.run({ skuId: "SB-LOT-HIV-0709-A", zoneId: "PH", action: "OUT", timestamp: addMinutes(-5), severity: "info" });
      insertRfid.run({ skuId: "SB-LOT-ONC-0709-B", zoneId: "QA", action: "MOVE", timestamp: addMinutes(-2), severity: "warn" });
    }
    ensureUnifiedOperationalNetwork();
    ensureInventoryPlanningRiskExamples();
    // Deliberately no seeded alert rows: the alerts table is populated entirely by the live
    // condition-checking loop in realtime.ts, which evaluates real current state (expiry risk,
    // open temperature events, dock overruns, FEFO compliance, QA-hold-linked shipments) every
    // 30s and both creates alerts when a condition becomes true and auto-resolves them when it
    // stops being true. A seeded static row would never participate in that resolve cycle and
    // would sit open forever, and duplicates the same underlying fact the live QA-hold check
    // already covers for this exact SKU/shipment pair.
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return true;
}
