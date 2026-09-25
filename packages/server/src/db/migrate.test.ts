import { describe, it, expect } from 'vitest';
import { initAdapterForPath } from './driver.js';
import { runMigrationOnce, registerMigration, seedBuiltinCombos, type Migration } from './migrate.js';
import { TABLES } from './schema.js';
import { BUILTIN_COMBOS } from '../routing/builtinCombos.js';
import * as combosRepo from './repos/combosRepo.js';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('migration engine', () => {
  it('creates all tables on fresh db', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-'));
    const adapter = await initAdapterForPath(join(dir, 'data.sqlite'));
    await runMigrationOnce(adapter);
    for (const t of Object.keys(TABLES)) {
      if (t.startsWith('_')) continue;
      const row = adapter.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='${t}'`);
      expect(row).not.toBeNull();
    }
    adapter.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('seeds the built-in category combos (WEB) on a fresh db', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-'));
    const adapter = await initAdapterForPath(join(dir, 'data.sqlite'));
    await runMigrationOnce(adapter);
    for (const builtin of BUILTIN_COMBOS) {
      const row = combosRepo.get(adapter, builtin.id);
      expect(row).not.toBeNull();
      expect(row!.name).toBe(builtin.name);
      expect(row!.mode).toBe(builtin.mode);
      expect(row!.data.sources).toEqual(builtin.sources);
    }
    adapter.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('seed does not overwrite user edits to a built-in combo (idempotent, non-destructive)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-'));
    const adapter = await initAdapterForPath(join(dir, 'data.sqlite'));
    await runMigrationOnce(adapter);
    // User edits WEB's editable fields (decision A).
    combosRepo.upsert(adapter, {
      id: 'web', name: 'WEB', mode: 'sequential',
      data: { sources: [{ provider: 'google' }], merge: { dedupe: 'url', rank: 'rrf', cap: 5 }, fallback: { on: ['timeout'], min_results: 2 } },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    seedBuiltinCombos(adapter); // re-run (e.g. next boot)
    const row = combosRepo.get(adapter, 'web');
    expect(row!.data.sources).toEqual([{ provider: 'google' }]); // user edit survives
    expect(row!.mode).toBe('sequential');
    adapter.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('additively adds a missing column without data loss', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-'));
    const adapter = await initAdapterForPath(join(dir, 'data.sqlite'));
    adapter.exec('CREATE TABLE kv (key TEXT PRIMARY KEY)');
    adapter.exec("INSERT INTO kv (key) VALUES ('kept')");
    await runMigrationOnce(adapter, join(dir, 'data.sqlite')); // sync should ADD COLUMN value
    const row = adapter.get("SELECT key, value FROM kv WHERE key='kept'") as { key: string; value: string };
    expect(row.key).toBe('kept');
    adapter.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('backups the db file before a destructive migration step (W6)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-'));
    const dbPath = join(dir, 'data.sqlite');
    const adapter = await initAdapterForPath(dbPath);
    await runMigrationOnce(adapter, dbPath);

    // Register a destructive v2 step and assert: (a) a .bak file appears, (b) the step ran.
    let ran = false;
    const destructiveV2: Migration = {
      version: 2,
      destructive: true,
      up: (a) => { ran = true; a.exec('CREATE TABLE IF NOT EXISTS v2table (x TEXT)'); },
    };
    registerMigration(destructiveV2);
    try {
      await runMigrationOnce(adapter, dbPath);
      const baks = readdirSync(dir).filter((f) => f.startsWith('data.sqlite.bak.'));
      expect(baks.length).toBe(1);
      expect(baks[0]).toBe('data.sqlite.bak.2');
      expect(ran).toBe(true);
      // idempotent: re-running does not re-backup or re-run
      ran = false;
      await runMigrationOnce(adapter, dbPath);
      expect(ran).toBe(false);
      expect(readdirSync(dir).filter((f) => f.startsWith('data.sqlite.bak.')).length).toBe(1);
    } finally {
      adapter.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
