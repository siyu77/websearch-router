import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export async function createSqlJsAdapter(dbPath: string) {
  const SQL = await initSqlJs();
  let db: any;
  if (existsSync(dbPath)) db = new SQL.Database(readFileSync(dbPath));
  else db = new SQL.Database();

  // sql.js ends an active transaction on db.export(); so we defer persist()
  // until commit rather than writing the file on every statement.
  let inTxn = false;
  function persist() { if (!inTxn) writeFileSync(dbPath, Buffer.from(db.export())); }

  function run(sql: string, params: unknown[] = []) {
    if (params.length > 0) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      stmt.step();
      stmt.free();
    } else {
      db.run(sql);
    }
    // #14: persist here only when NOT inside a transaction — a single standalone
    // statement (e.g. a CREATE TABLE at boot) writes the file immediately, same
    // as before. Statements inside transaction() skip this and are persisted
    // exactly once, after COMMIT.
    if (!inTxn) persist();
  }

  // Self-contained (closure over `db`, no `this`) so `const { get } = adapter`
  // still works after destructuring.
  function allFn(sql: string, params: unknown[] = []) {
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows: unknown[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  return {
    driver: 'sql.js',
    exec(sql: string, params: unknown[] = []) { run(sql, params); },
    all: allFn,
    get(sql: string, params: unknown[] = []) { return allFn(sql, params)[0] ?? null; },
    transaction(fn: () => void) {
      db.run('BEGIN');
      inTxn = true;
      try {
        fn();
        db.run('COMMIT');
      } catch (e) {
        try { db.run('ROLLBACK'); } catch { /* nothing to roll back */ }
        throw e;
      } finally {
        inTxn = false;
      }
      // #14: persist once, after the transaction fully commits.
      persist();
    },
    close() { inTxn = false; persist(); db.close(); },
  };
}
