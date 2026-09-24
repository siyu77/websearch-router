export async function createBetterSqliteAdapter(dbPath: string) {
  // better-sqlite3 is CJS with no named exports; in Node ESM the ctor lands on
  // `.default`, under bun it may be the namespace itself.
  const loaded = await import('better-sqlite3');
  const ctor: any = loaded.default ?? loaded;
  const db = new ctor(dbPath);
  return {
    driver: 'better-sqlite3',
    exec(sql: string, params: unknown[] = []) { if (params.length > 0) db.prepare(sql).run(...params); else db.exec(sql); },
    all(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...params); },
    get(sql: string, params: unknown[] = []) { return db.prepare(sql).get(...params) ?? null; },
    transaction(fn: () => void) { const t = db.transaction(fn); t(); },
    close() { db.close(); },
  };
}
