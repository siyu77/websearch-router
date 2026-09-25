import { dbFilePath } from './dataDir.js';

export interface DbAdapter {
  driver: string;
  exec(sql: string, params?: unknown[]): void;
  all(sql: string, params?: unknown[]): unknown[];
  get(sql: string, params?: unknown[]): unknown;
  transaction(fn: () => void): void;
  close(): void;
}

async function tryBunSqlite(path: string): Promise<DbAdapter | null> {
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import('./adapters/bunSqliteAdapter.js');
    return await createBunSqliteAdapter(path);
  } catch { return null; }
}
async function tryBetterSqlite(path: string): Promise<DbAdapter | null> {
  if (process.versions.bun) return null;
  try {
    const { createBetterSqliteAdapter } = await import('./adapters/betterSqliteAdapter.js');
    return createBetterSqliteAdapter(path);
  } catch (e) { console.warn(`[DB] better-sqlite3 unavailable: ${(e as Error).message}`); return null; }
}
async function tryNodeSqlite(path: string): Promise<DbAdapter | null> {
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  try {
    const { createNodeSqliteAdapter } = await import('./adapters/nodeSqliteAdapter.js');
    return await createNodeSqliteAdapter(path);
  } catch (e) { console.warn(`[DB] node:sqlite unavailable: ${(e as Error).message}`); return null; }
}
async function trySqlJs(path: string): Promise<DbAdapter | null> {
  try {
    const { createSqlJsAdapter } = await import('./adapters/sqljsAdapter.js');
    return await createSqlJsAdapter(path);
  } catch (e) { console.warn(`[DB] sql.js unavailable: ${(e as Error).message}`); return null; }
}

let cached: DbAdapter | null = null;

export async function initAdapter(path: string = dbFilePath()): Promise<DbAdapter> {
  if (cached) return cached;
  const adapter = await tryBunSqlite(path) ?? await tryBetterSqlite(path) ?? await tryNodeSqlite(path) ?? await trySqlJs(path);
  if (!adapter) throw new Error('[DB] No SQLite driver available (bun/better/node/sql.js all failed)');
  console.log(`[DB] Driver: ${adapter.driver} | file: ${path}`);
  cached = adapter;
  return adapter;
}

export async function initAdapterForPath(path: string): Promise<DbAdapter> {
  cached = null;
  const adapter = await tryBunSqlite(path) ?? await tryBetterSqlite(path) ?? await tryNodeSqlite(path) ?? await trySqlJs(path);
  if (!adapter) throw new Error('[DB] No SQLite driver available');
  return adapter;
}
