export async function createBunSqliteAdapter(dbPath: string) {
  const { Database } = await import('bun:sqlite');
  const db = new Database(dbPath);
  return {
    driver: 'bun:sqlite',
    exec(sql: string, params: unknown[] = []) { if (params.length > 0) db.query(sql).run(...(params as any[])); else db.run(sql); },
    all(sql: string, params: unknown[] = []) {
      const rows = db.query(sql).all(...(params as any[]));
      return (rows as unknown[]) ?? [];
    },
    get(sql: string, params: unknown[] = []) { return db.query(sql).get(...(params as any[])) ?? null; },
    transaction(fn: () => void) {
      db.run('BEGIN'); try { fn(); db.run('COMMIT'); } catch (e) { db.run('ROLLBACK'); throw e; }
    },
    close() { db.close(); },
  };
}
