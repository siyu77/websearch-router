import { describe, it, expect } from 'vitest';
import { initAdapterForPath } from './driver.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('driver fallback chain', () => {
  it('returns a working adapter that can create + read a table', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-'));
    const adapter = await initAdapterForPath(join(dir, 'data.sqlite'));
    adapter.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    adapter.exec("INSERT INTO t (v) VALUES ('hello')");
    const row = adapter.get('SELECT v FROM t WHERE id = 1') as { v: string };
    expect(row.v).toBe('hello');
    adapter.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('transaction commits on success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-'));
    const adapter = await initAdapterForPath(join(dir, 'data.sqlite'));
    adapter.exec('CREATE TABLE t2 (id INTEGER PRIMARY KEY)');
    adapter.transaction(() => {
      adapter.exec('INSERT INTO t2 (id) VALUES (1)');
      adapter.exec('INSERT INTO t2 (id) VALUES (2)');
    });
    const rows = adapter.all('SELECT * FROM t2') as unknown[];
    expect(rows.length).toBe(2);
    adapter.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
