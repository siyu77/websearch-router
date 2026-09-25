import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createSqlJsAdapter } from './sqljsAdapter.js';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';

// Pinned directly against the sql.js adapter (not the driver chain): sql.js is
// the guaranteed pure-JS fallback, so its param/transaction semantics must hold
// even when a native driver (better-sqlite3/node:sqlite) is present on the box.

let SQL: any;
beforeAll(async () => { SQL = await initSqlJs(); });

// Count rows in the on-disk file via a throwaway instance (the live adapter holds
// the file in memory; sql.js does not lock it, so we can read the persisted bytes).
function fileRowCount(path: string, table = 't'): number {
  if (!existsSync(path)) return 0;
  const db = new SQL.Database(readFileSync(path));
  const res = db.exec(`SELECT count(*) AS c FROM ${table}`);
  const n = res[0]?.values?.[0]?.[0] ?? 0;
  db.close();
  return Number(n);
}

describe('sql.js adapter (direct)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wsr-sqljs-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('(a) parameterized exec binds and persists across reopen', async () => {
    const path = join(dir, 'a.sqlite');
    const a = await createSqlJsAdapter(path);
    a.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    a.exec('INSERT INTO t (v) VALUES (?)', ['hello']);
    a.close();
    // reopen the same file
    const b = await createSqlJsAdapter(path);
    const row = b.get('SELECT v FROM t WHERE id = 1') as { v: string };
    expect(row.v).toBe('hello');
    // F2: get must be self-contained (closure over the db), not bound to the
    // adapter object via `this` — so destructured use still works.
    const { get } = b;
    const row2 = get('SELECT v FROM t WHERE id = 1') as { v: string };
    expect(row2.v).toBe('hello');
    b.close();
  });

  it('(b) a transaction whose fn throws rolls back and does not throw a masking error', async () => {
    const path = join(dir, 'b.sqlite');
    const a = await createSqlJsAdapter(path);
    a.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const sentinel = new Error('boom-sentinel');
    let thrown: unknown;
    try {
      a.transaction(() => {
        a.exec('INSERT INTO t (v) VALUES (?)', ['x']);
        throw sentinel;
      });
    } catch (e) { thrown = e; }
    // The ORIGINAL error must propagate — not a masking "no transaction is active".
    expect(thrown).toBe(sentinel);
    expect(String((thrown as Error).message)).toBe('boom-sentinel');
    // Rolled back in memory...
    expect(a.all('SELECT * FROM t').length).toBe(0);
    a.close();
    // ...and on disk.
    expect(fileRowCount(path)).toBe(0);
  });

  it('(c) writes inside a transaction are not committed prematurely', async () => {
    const path = join(dir, 'c.sqlite');
    const a = await createSqlJsAdapter(path);
    a.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');

    // Successful txn: its writes reach the file exactly once (at COMMIT) and the
    // transaction does not throw. (The old bug exported per-statement, ending the
    // transaction early and making the trailing COMMIT throw a masking error.)
    a.transaction(() => {
      a.exec('INSERT INTO t (v) VALUES (?)', ['x']);
      a.exec('INSERT INTO t (v) VALUES (?)', ['y']);
    });
    a.close();
    expect(fileRowCount(path)).toBe(2);

    // Failed txn: a statement inside the txn followed by a thrown fn leaves
    // nothing persisted.
    const a2 = await createSqlJsAdapter(path);
    const sentinel = new Error('boom');
    let threw = false;
    try {
      a2.transaction(() => {
        a2.exec('INSERT INTO t (v) VALUES (?)', ['z']);
        throw sentinel;
      });
    } catch { threw = true; }
    expect(threw).toBe(true);
    a2.close();
    expect(fileRowCount(path)).toBe(2); // the rolled-back 'z' was not persisted
  });
});
