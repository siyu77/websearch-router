export async function createNodeSqliteAdapter(dbPath: string) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  return {
    driver: 'node:sqlite',
    exec(sql: string, params: unknown[] = []) { if (params.length > 0) db.prepare(sql).run(...(params as any[])); else db.exec(sql); },
    all(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...(params as any[])); },
    get(sql: string, params: unknown[] = []) { return db.prepare(sql).get(...(params as any[])) ?? null; },
    transaction(fn: () => void) {
      db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    close() { db.close(); },
  };
}
