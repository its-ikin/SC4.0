import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dbPath = resolve(here, "../../db/twinops.sqlite");
const walPath = `${dbPath}-wal`;
const shmPath = `${dbPath}-shm`;

for (const path of [dbPath, walPath, shmPath]) {
  if (existsSync(path)) rmSync(path, { force: true });
}

const { seedIfEmpty } = await import("../db/seed");
seedIfEmpty();
console.log("Reset and seeded TwinOps warehouse database.");
