import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite-async.mjs";
import { Factory } from "wa-sqlite/src/sqlite-api.js";
import { IDBBatchAtomicVFS } from "wa-sqlite/src/examples/IDBBatchAtomicVFS.js";
import { OPFSCoopSyncVFS } from "wa-sqlite/src/examples/OPFSCoopSyncVFS.js";
import { CREATE_TABLES, SCHEMA_VERSION, MIGRATIONS, BACKUP_TABLES } from "../src/db/schema.ts";
import { getSeedSQL } from "../src/db/seed.ts";
import { WORKER_INIT_ID } from "../src/db/client.ts";
import type { DbWorkerRequest, DbWorkerResponse } from "../src/types/worker.ts";

let sqlite3: any;
let db: number;
let storageType = "unknown";

async function initialize() {
  const module = await SQLiteESMFactory();
  sqlite3 = Factory(module);

  // Try OPFS first, fall back to IDB
  try {
    const vfs = await OPFSCoopSyncVFS.create("budget-opfs", module);
    sqlite3.vfs_register(vfs, true);
    db = await sqlite3.open_v2("budget.db");
    storageType = "opfs";
  } catch {
    try {
      const vfs = await IDBBatchAtomicVFS.create("budget-idb", module);
      sqlite3.vfs_register(vfs, true);
      db = await sqlite3.open_v2("budget.db");
      storageType = "idb";
    } catch (e) {
      throw new Error(`Failed to initialize database: ${e}`);
    }
  }

  // Enable WAL mode and foreign keys
  await exec("PRAGMA journal_mode=WAL;");
  await exec("PRAGMA foreign_keys=ON;");

  // Run migrations
  await migrate();

  return storageType;
}

async function execMulti(sql: string) {
  const statements = sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  for (const stmt of statements) {
    await exec(stmt + ";");
  }
}

async function migrate() {
  const result = await exec("PRAGMA user_version;");
  const currentVersion = (result.rows[0] as any)?.user_version ?? 0;

  if (currentVersion === 0) {
    // Fresh install: create tables + seed default categories only
    await execMulti(CREATE_TABLES);
    await execMulti(getSeedSQL());
    await exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  } else if (currentVersion < SCHEMA_VERSION) {
    // Pre-migration backup: stash current data in settings table
    try {
      const backup: Record<string, unknown[]> = {};
      for (const table of BACKUP_TABLES) {
        const sql = table === "settings"
          ? `SELECT * FROM ${table} WHERE key != '_pre_migration_backup'`
          : `SELECT * FROM ${table}`;
        const result = await exec(sql);
        backup[table] = result.rows;
      }
      const json = JSON.stringify({ version: currentVersion, backup_at: new Date().toISOString(), ...backup });
      await exec(
        `INSERT OR REPLACE INTO settings (key, value) VALUES ('_pre_migration_backup', ?)`,
        [json]
      );
    } catch {
      // Non-fatal: best-effort backup
    }

    // Incremental migrations
    for (let v = currentVersion; v < SCHEMA_VERSION; v++) {
      const migration = MIGRATIONS[v];
      if (migration) {
        await execMulti(migration);
      }
    }

    await exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }
}

async function exec(
  sql: string,
  params?: unknown[]
): Promise<{ rows: Record<string, unknown>[]; changes: number }> {
  const rows: Record<string, unknown>[] = [];

  for await (const stmt of sqlite3.statements(db, sql)) {
    if (params?.length) {
      sqlite3.bind_collection(stmt, params);
    }

    const columns: string[] = [];
    const nCols = sqlite3.column_count(stmt);
    for (let i = 0; i < nCols; i++) {
      columns.push(sqlite3.column_name(stmt, i));
    }

    while ((await sqlite3.step(stmt)) === 100) {
      // SQLITE_ROW = 100
      const row: Record<string, unknown> = {};
      for (let i = 0; i < nCols; i++) {
        row[columns[i]!] = sqlite3.column(stmt, i);
      }
      rows.push(row);
    }
  }

  const changes = sqlite3.changes(db);
  return { rows, changes };
}

// Message handler
const initPromise = initialize();
let ready = false;

self.addEventListener("message", async (event: MessageEvent<DbWorkerRequest>) => {
  const { id, type, sql, params } = event.data;

  if (!ready) {
    try {
      await initPromise;
    } catch (e: any) {
      self.postMessage({
        id,
        type: "error",
        error: e.message,
      } satisfies DbWorkerResponse);
      return;
    }
  }

  if (type === "exec") {
    try {
      const result = await exec(sql, params);
      self.postMessage({
        id,
        type: "result",
        rows: result.rows,
        changes: result.changes,
      } satisfies DbWorkerResponse);
    } catch (e: any) {
      self.postMessage({
        id,
        type: "error",
        error: e.message,
      } satisfies DbWorkerResponse);
    }
  }
});

// Signal that worker is loaded, trigger init
initPromise
  .then((st) => {
    ready = true;
    self.postMessage({ id: WORKER_INIT_ID, type: "ready", storageType: st } satisfies DbWorkerResponse);
  })
  .catch((e) => {
    self.postMessage({
      id: WORKER_INIT_ID,
      type: "error",
      error: e.message,
    } satisfies DbWorkerResponse);
  });
