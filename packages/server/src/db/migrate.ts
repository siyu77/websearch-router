import { copyFileSync, existsSync } from 'node:fs';
import type { DbAdapter } from './driver.js';
import { TABLES, buildCreateTableSql, SCHEMA_VERSION } from './schema.js';
import { BUILTIN_COMBOS } from '../routing/builtinCombos.js';
import * as combosRepo from './repos/combosRepo.js';

function getMeta(adapter: DbAdapter, key: string, fallback = '0'): string {
  const row = adapter.get('SELECT value FROM _meta WHERE key = ?', [key]) as { value?: string } | null;
  return row?.value ?? fallback;
}
function setMeta(adapter: DbAdapter, key: string, value: string) {
  adapter.exec('INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

function syncSchema(adapter: DbAdapter) {
  for (const [tableName, def] of Object.entries(TABLES)) {
    adapter.exec(buildCreateTableSql(tableName, def));
    const existing = adapter.all(`PRAGMA table_info(${tableName})`) as { name: string }[];
    const existingNames = new Set(existing.map((r) => r.name));
    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!existingNames.has(colName)) {
        let safeDef = colDef.replace(/PRIMARY KEY( AUTOINCREMENT)?/i, '').replace(/UNIQUE/i, '').trim();
        // SQLite refuses ADD COLUMN NOT NULL with no DEFAULT on a non-empty table;
        // preserve the data and keep the column nullable there.
        const cnt = (adapter.get(`SELECT count(*) AS c FROM ${tableName}`) as { c: number | bigint }).c;
        if (Number(cnt) > 0) safeDef = safeDef.replace(/\s+NOT NULL/i, '');
        try { adapter.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${safeDef}`); }
        catch (e) { console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${(e as Error).message}`); }
      }
    }
    for (const idx of def.indexes ?? []) { try { adapter.exec(idx); } catch { /* ignore */ } }
  }
}

// OCP: migrations are an extensible list. Each step is a versioned `up(adapter)`
// with an optional `destructive` flag — destructive steps back the db file up
// before running (persistence spec Req4). v1 has a single non-destructive step,
// so the backup guard is dormant capability, not behavior.
export interface Migration {
  version: number;
  up(adapter: DbAdapter): void;
  destructive?: boolean;
}

// The v1 step: additive sync (ADD COLUMN / CREATE INDEX), never destructive.
const v1Step: Migration = { version: 1, up: syncSchema };

// The migration list. Future schema changes append here; `runMigrationOnce`
// applies every step with `version > current` in order, backing up the db file
// before any `destructive: true` step.
export const MIGRATIONS: Migration[] = [v1Step];

// Seed the built-in protected category combos (builtinCombos.ts) into the combos
// table so /search, /mcp and the dashboard all see them on a fresh db AND on an
// existing db upgraded to this version. Idempotent and non-destructive: an
// existing row is left untouched, so user edits to a built-in combo's editable
// fields (sources/mode/merge/fallback) survive every boot (decision A).
export function seedBuiltinCombos(adapter: DbAdapter) {
  for (const c of BUILTIN_COMBOS) {
    if (combosRepo.get(adapter, c.id)) continue;
    const now = new Date().toISOString();
    const { id, name, mode, sources, merge, fallback, hybrid } = c;
    combosRepo.upsert(adapter, {
      id, name: name ?? '', mode,
      data: { sources, merge, fallback, hybrid },
      createdAt: now, updatedAt: now,
    });
  }
}

// Append a step to the migration list. Exported so tests can register a
// destructive v2 step on a temp adapter and assert the backup guard fires.
export function registerMigration(m: Migration) {
  if (!MIGRATIONS.some((x) => x.version === m.version)) MIGRATIONS.push(m);
  MIGRATIONS.sort((a, b) => a.version - b.version);
}

export async function runMigrationOnce(adapter: DbAdapter, dbPath?: string): Promise<void> {
  adapter.exec(buildCreateTableSql('_meta', TABLES._meta));
  // Run the v1 additive sync once so a fresh/old db has the full schema before
  // the versioned chain records its state — keeps existing v1 boot behavior.
  syncSchema(adapter);

  let current = parseInt(getMeta(adapter, 'schemaVersion', '0'), 10) || 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    if (m.destructive) {
      // Back up the db file before a destructive step (persistence spec Req4).
      // Only possible when the caller supplied a file path (sql.js / better);
      // in-memory adapters have no file to copy and the guard is a no-op.
      if (dbPath && existsSync(dbPath)) {
        copyFileSync(dbPath, `${dbPath}.bak.${m.version}`);
      }
    }
    m.up(adapter);
    setMeta(adapter, 'schemaVersion', String(m.version));
    current = m.version;
  }

  if (current < SCHEMA_VERSION) setMeta(adapter, 'schemaVersion', String(SCHEMA_VERSION));

  // Seed built-in category combos after the versioned chain so a fresh db gets
  // the full schema first and an old db gets them on upgrade.
  seedBuiltinCombos(adapter);
}
