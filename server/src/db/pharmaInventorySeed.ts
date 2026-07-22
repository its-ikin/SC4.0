import type { DatabaseSync } from "node:sqlite";

type CatalogItem = {
  id: string;
  code: string;
  name: string;
  family: string;
  tempBand: string;
  storageClass: "Cold Storage" | "Pharmaceutical Storage" | "Ambient Storage";
  unit: string;
  gtin: string;
  manufacturer: string;
  dosageForm: string;
  strength: string;
  packSize: string;
  origin: string;
};

const catalog: CatalogItem[] = [
  { id: "MAT-100001", code: "PH-COLD-INSGLA-PEN", name: "Insulin glargine injection", family: "Diabetes", tempBand: "2-8 C", storageClass: "Cold Storage", unit: "packs", gtin: "05000456010018", manufacturer: "Sanofi", dosageForm: "Pre-filled pen", strength: "100 units/mL", packSize: "5 x 3 mL pens", origin: "Germany" },
  { id: "MAT-100002", code: "PH-COLD-INSHUM-VIAL", name: "Human insulin soluble injection", family: "Diabetes", tempBand: "2-8 C", storageClass: "Cold Storage", unit: "vials", gtin: "05000456010025", manufacturer: "Novo Nordisk", dosageForm: "Injection vial", strength: "100 IU/mL", packSize: "10 mL vial", origin: "Denmark" },
  { id: "MAT-100003", code: "PH-COLD-FLUVAX-PFS", name: "Quadrivalent influenza vaccine", family: "Vaccine", tempBand: "2-8 C", storageClass: "Cold Storage", unit: "syringes", gtin: "05000456010032", manufacturer: "Sanofi Pasteur", dosageForm: "Pre-filled syringe", strength: "0.5 mL dose", packSize: "10 syringes", origin: "France" },
  { id: "MAT-100004", code: "PH-COLD-ADAL40-PEN", name: "Adalimumab injection", family: "Biologic", tempBand: "2-8 C", storageClass: "Cold Storage", unit: "packs", gtin: "05000456010049", manufacturer: "AbbVie", dosageForm: "Pre-filled pen", strength: "40 mg/0.4 mL", packSize: "2 pens", origin: "Ireland" },
  { id: "MAT-200001", code: "PH-CRT-PARA500-TAB", name: "Paracetamol tablets", family: "Analgesic", tempBand: "15-25 C", storageClass: "Pharmaceutical Storage", unit: "cartons", gtin: "05000456020017", manufacturer: "Haleon", dosageForm: "Tablet", strength: "500 mg", packSize: "100 tablets", origin: "United Kingdom" },
  { id: "MAT-200002", code: "PH-CRT-AMOX500-CAP", name: "Amoxicillin capsules", family: "Antibiotic", tempBand: "15-25 C", storageClass: "Pharmaceutical Storage", unit: "cartons", gtin: "05000456020024", manufacturer: "Sandoz", dosageForm: "Hard capsule", strength: "500 mg", packSize: "100 capsules", origin: "Austria" },
  { id: "MAT-200003", code: "PH-CRT-METF500-TAB", name: "Metformin hydrochloride tablets", family: "Diabetes", tempBand: "15-25 C", storageClass: "Pharmaceutical Storage", unit: "cartons", gtin: "05000456020031", manufacturer: "Merck", dosageForm: "Film-coated tablet", strength: "500 mg", packSize: "100 tablets", origin: "Germany" },
  { id: "MAT-200004", code: "PH-CRT-AMLO5-TAB", name: "Amlodipine tablets", family: "Cardiovascular", tempBand: "15-25 C", storageClass: "Pharmaceutical Storage", unit: "cartons", gtin: "05000456020048", manufacturer: "Viatris", dosageForm: "Tablet", strength: "5 mg", packSize: "100 tablets", origin: "India" },
  { id: "MAT-200005", code: "PH-CRT-SALB100-INH", name: "Salbutamol pressurised inhaler", family: "Respiratory", tempBand: "15-25 C", storageClass: "Pharmaceutical Storage", unit: "inhalers", gtin: "05000456020055", manufacturer: "GSK", dosageForm: "Metered-dose inhaler", strength: "100 micrograms/dose", packSize: "200 doses", origin: "United Kingdom" },
  { id: "MAT-200006", code: "PH-CRT-OMEP20-CAP", name: "Omeprazole gastro-resistant capsules", family: "Gastrointestinal", tempBand: "15-25 C", storageClass: "Pharmaceutical Storage", unit: "cartons", gtin: "05000456020062", manufacturer: "AstraZeneca", dosageForm: "Gastro-resistant capsule", strength: "20 mg", packSize: "28 capsules", origin: "Sweden" },
  { id: "MAT-300001", code: "PH-AMB-ORS20-SACH", name: "Oral rehydration salts", family: "Electrolyte", tempBand: "Below 30 C", storageClass: "Ambient Storage", unit: "cartons", gtin: "05000456030016", manufacturer: "UNICEF-approved supplier", dosageForm: "Powder sachet", strength: "WHO reduced-osmolarity formula", packSize: "20 sachets", origin: "Singapore" },
  { id: "MAT-300002", code: "PH-AMB-POVI10-SOL", name: "Povidone-iodine topical solution", family: "Antiseptic", tempBand: "Below 30 C", storageClass: "Ambient Storage", unit: "bottles", gtin: "05000456030023", manufacturer: "Mundipharma", dosageForm: "Topical solution", strength: "10% w/v", packSize: "500 mL bottle", origin: "Singapore" }
];

const isoDaysAgo = (days: number, hours = 0) => new Date(Date.now() - (days * 24 - hours) * 60 * 60_000).toISOString();
const isoDaysAhead = (days: number) => new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();

export function seedPharmaInventory(db: DatabaseSync) {
  const insertProduct = db.prepare(`
    INSERT INTO products
    (product_id, product_code, product_name, product_family, default_temp_band, storage_class, unit_type,
     safety_stock, reorder_point, target_stock, lead_time_days, average_daily_demand,
     gtin, manufacturer, dosage_form, strength, pack_size)
    VALUES (@id, @code, @name, @family, @tempBand, @storageClass, @unit,
     @safetyStock, @reorderPoint, @targetStock, @leadTimeDays, @averageDailyDemand,
     @gtin, @manufacturer, @dosageForm, @strength, @packSize)`);
  const insertBatch = db.prepare(`
    INSERT INTO batches
    (batch_id, product_id, lot_code, expiry_date, manufacture_date, quality_status, temp_band,
     serialization_status, notes, sto_number, goods_receipt_number, arrival_at, putaway_at,
     handling_unit, inspection_lot, country_of_origin, last_cycle_count_at)
    VALUES (@batchId, @productId, @lotCode, @expiryDate, @manufactureDate, @qualityStatus, @tempBand,
     @serializationStatus, @notes, @stoNumber, @goodsReceiptNumber, @arrivalAt, @putawayAt,
     @handlingUnit, @inspectionLot, @countryOfOrigin, @lastCycleCountAt)`);
  const insertLocation = db.prepare(`
    INSERT INTO warehouse_locations (location_id, zone, rack, bin, temp_band, capacity, current_fill)
    VALUES (@locationId, @zone, @rack, @bin, @tempBand, @capacity, @currentFill)`);
  const insertBalance = db.prepare(`
    INSERT INTO stock_balances
    (stock_balance_id, batch_id, location_id, qty_on_hand, qty_available, qty_reserved, qty_picked,
     qty_packed, qty_staged, qty_dispatched, qty_on_hold, last_updated)
    VALUES (@stockBalanceId, @batchId, @locationId, @qtyOnHand, @qtyAvailable, 0, 0, 0, 0, 0, @qtyOnHold, @lastUpdated)`);
  const insertMovement = db.prepare(`
    INSERT INTO inventory_movements
    (movement_id, timestamp, movement_type, product_id, batch_id, from_location_id, to_location_id,
     qty, reference_type, reference_id, user_or_system, note)
    VALUES (@movementId, @timestamp, @movementType, @productId, @batchId, @fromLocationId,
     @toLocationId, @qty, @referenceType, @referenceId, @userOrSystem, @note)`);

  // Execution locations are valid WMS references but do not add storage capacity. Keeping them
  // in the location master makes receiving, picking, packing, staging and dispatch movements
  // traceable without distorting warehouse utilisation.
  [
    ["RCV-D1", "Receiving", "RCV", "D1", "15-25 C"],
    ["RCV-D2", "Receiving", "RCV", "D2", "2-8 C"],
    ["PK-BENCH", "Packing", "PK", "BENCH", "15-25 C"],
    ...["D1", "D2", "D3", "D4", "D5", "D6"].map((dock) => [`DS-${dock}`, "Dispatch", "DS", dock, "15-30 C"])
  ].forEach(([locationId, zone, rack, bin, tempBand]) => insertLocation.run({
    locationId,
    zone,
    rack,
    bin,
    tempBand,
    capacity: 0,
    currentFill: 0
  }));

  let skuSequence = 1;
  let qaLocationSequence = 1;
  let qaColdLocationSequence = 1;
  let quarantineLocationSequence = 1;
  catalog.forEach((product, productIndex) => {
    const cold = product.storageClass === "Cold Storage";
    const ambient = product.storageClass === "Ambient Storage";
    insertProduct.run({
      id: product.id,
      code: product.code,
      name: product.name,
      family: product.family,
      tempBand: product.tempBand,
      storageClass: product.storageClass,
      unit: product.unit,
      gtin: product.gtin,
      manufacturer: product.manufacturer,
      dosageForm: product.dosageForm,
      strength: product.strength,
      packSize: product.packSize,
      safetyStock: cold ? 80 : ambient ? 180 : 120,
      reorderPoint: cold ? 130 : ambient ? 300 : 220,
      targetStock: cold ? 300 : ambient ? 700 : 520,
      leadTimeDays: cold ? 7 : ambient ? 4 : 5,
      averageDailyDemand: cold ? 8 : ambient ? 30 : 18
    });

    for (let lotIndex = 0; lotIndex < 3; lotIndex += 1) {
      const sequence = skuSequence++;
      const storageZoneCode = cold ? "CS" : ambient ? "AM" : "PH";
      const rack = String((productIndex % (cold ? 4 : 6)) + 1).padStart(2, "0");
      const level = String(lotIndex + 1).padStart(2, "0");
      const bin = `A${String(sequence).padStart(2, "0")}`;
      const lotCode = `L26${String(productIndex + 1).padStart(2, "0")}-${product.code.split("-").at(-2)}-${String(lotIndex + 1).padStart(2, "0")}`;
      const batchId = `B-${lotCode}`;
      const arrivalDaysAgo = 3 + ((sequence * 7) % 42);
      const qualityStatus = sequence === 11 || sequence === 28 ? "QA Hold" : sequence === 19 ? "Pending QA" : sequence === 34 ? "Quarantine" : "Released";
      const controlledLocation = qualityStatus === "QA Hold" || qualityStatus === "Pending QA"
        ? cold
          ? { locationId: `QA-COLD-${String(qaColdLocationSequence++).padStart(2, "0")}`, zone: "QA Cold Hold", rack: "QAC", bin: `C${String(qaColdLocationSequence - 1).padStart(2, "0")}` }
          : { locationId: `QA-HOLD-${String(qaLocationSequence++).padStart(2, "0")}`, zone: "QA Hold", rack: "QA", bin: `H${String(qaLocationSequence - 1).padStart(2, "0")}` }
        : qualityStatus === "Quarantine"
          ? { locationId: `QT-${String(quarantineLocationSequence++).padStart(2, "0")}`, zone: "Quarantine", rack: "QT", bin: `Q${String(quarantineLocationSequence - 1).padStart(2, "0")}` }
          : null;
      const locationId = controlledLocation?.locationId ?? `${storageZoneCode}-${rack}-${level}-${bin}`;
      const qtyOnHand = cold ? 84 + ((sequence * 13) % 92) : ambient ? 320 + ((sequence * 31) % 260) : 170 + ((sequence * 23) % 190);
      const capacity = cold ? 220 : ambient ? 720 : 480;
      const onHold = qualityStatus === "Released" ? 0 : qtyOnHand;
      const arrivalAt = isoDaysAgo(arrivalDaysAgo);
      const putawayAt = isoDaysAgo(arrivalDaysAgo, 2 + (sequence % 5));
      const stoNumber = `STO-4500${String(7300 + sequence).padStart(6, "0")}`;
      const handlingUnit = `HU-0035${String(900000 + sequence).padStart(8, "0")}`;
      const stockBalanceId = `STK-${product.id.replace("MAT-", "")}-${String(lotIndex + 1).padStart(2, "0")}`;

      insertBatch.run({
        batchId,
        productId: product.id,
        lotCode,
        expiryDate: isoDaysAhead(150 + productIndex * 32 + lotIndex * 95),
        manufactureDate: isoDaysAgo(70 + productIndex * 9 + lotIndex * 18),
        qualityStatus,
        tempBand: product.tempBand,
        serializationStatus: product.dosageForm.includes("Tablet") || product.dosageForm.includes("capsule") ? "Batch tracked" : "Serialized",
        notes: qualityStatus === "Released" ? "Released for saleable stock" : `${qualityStatus} - quality disposition pending`,
        stoNumber,
        goodsReceiptNumber: `GR-5000${String(8400 + sequence).padStart(6, "0")}`,
        arrivalAt,
        putawayAt,
        handlingUnit,
        inspectionLot: `IL-8900${String(1200 + sequence).padStart(6, "0")}`,
        countryOfOrigin: product.origin,
        lastCycleCountAt: isoDaysAgo(sequence % 14)
      });
      insertLocation.run({
        locationId,
        zone: controlledLocation?.zone ?? product.storageClass,
        rack: controlledLocation?.rack ?? `${storageZoneCode}-${rack}`,
        bin: controlledLocation?.bin ?? `${level}-${bin}`,
        tempBand: product.tempBand,
        capacity,
        currentFill: qtyOnHand
      });
      insertBalance.run({ stockBalanceId, batchId, locationId, qtyOnHand, qtyAvailable: qtyOnHand - onHold, qtyOnHold: onHold, lastUpdated: new Date().toISOString() });
      insertMovement.run({
        movementId: `MOV-NEW-${String(sequence).padStart(4, "0")}`,
        timestamp: putawayAt,
        movementType: "Putaway",
        productId: product.id,
        batchId,
        fromLocationId: cold ? "RCV-D2" : "RCV-D1",
        toLocationId: locationId,
        qty: qtyOnHand,
        referenceType: "Stock Transport Order",
        referenceId: stoNumber,
        userOrSystem: "WMS Putaway",
        note: `Put away ${handlingUnit} after goods receipt and quality status assignment.`
      });
    }
  });
}
