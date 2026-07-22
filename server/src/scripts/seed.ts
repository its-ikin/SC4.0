import { seedIfEmpty } from "../db/seed";

const seeded = seedIfEmpty();
console.log(seeded ? "Seeded TwinOps warehouse database." : "Database already contains seed data.");
