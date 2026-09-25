import type { DbAdapter } from '../driver.js';
import { parseJson, stringifyJson } from '../helpers/jsonCol.js';

export interface ProviderConnection {
  id: string; provider: string; authType: string; priority: number;
  isActive: boolean; data: Record<string, unknown>;
  createdAt: string; updatedAt: string;
}

function rowToConn(row: any): ProviderConnection {
  return {
    id: row.id, provider: row.provider, authType: row.authType,
    priority: row.priority, isActive: row.isActive === 1 || row.isActive === true,
    data: parseJson(row.data, {}),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function connToRow(c: ProviderConnection) {
  return {
    id: c.id, provider: c.provider, authType: c.authType, priority: c.priority,
    isActive: c.isActive ? 1 : 0, data: stringifyJson(c.data),
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

export function listAll(adapter: DbAdapter): ProviderConnection[] {
  return (adapter.all('SELECT * FROM providerConnections ORDER BY provider, priority ASC') as any[]).map(rowToConn);
}

export function listByProvider(adapter: DbAdapter, provider: string): ProviderConnection[] {
  return (adapter.all('SELECT * FROM providerConnections WHERE provider = ? ORDER BY priority ASC', [provider]) as any[]).map(rowToConn);
}

export function getById(adapter: DbAdapter, id: string): ProviderConnection | null {
  const row = adapter.get('SELECT * FROM providerConnections WHERE id = ?', [id]) as any;
  return row ? rowToConn(row) : null;
}

export function remove(adapter: DbAdapter, id: string) {
  adapter.exec('DELETE FROM providerConnections WHERE id = ?', [id]);
}

export function getActiveByPriority(adapter: DbAdapter, provider: string): ProviderConnection[] {
  return (adapter.all('SELECT * FROM providerConnections WHERE provider = ? AND isActive = 1 ORDER BY priority ASC', [provider]) as any[]).map(rowToConn);
}

export function upsert(adapter: DbAdapter, c: ProviderConnection) {
  const r = connToRow(c);
  adapter.exec(`INSERT INTO providerConnections (id, provider, authType, priority, isActive, data, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, authType=excluded.authType,
      priority=excluded.priority, isActive=excluded.isActive, data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.provider, r.authType, r.priority, r.isActive, r.data, r.createdAt, r.updatedAt]);
}

export function setIsActive(adapter: DbAdapter, id: string, active: boolean) {
  adapter.exec('UPDATE providerConnections SET isActive = ?, updatedAt = ? WHERE id = ?', [active ? 1 : 0, new Date().toISOString(), id]);
}

export function updateData(adapter: DbAdapter, id: string, dataPatch: Record<string, unknown>) {
  const existing = adapter.get('SELECT data FROM providerConnections WHERE id = ?', [id]) as { data?: string } | null;
  const merged = { ...parseJson(existing?.data, {}), ...dataPatch };
  adapter.exec('UPDATE providerConnections SET data = ?, updatedAt = ? WHERE id = ?', [stringifyJson(merged), new Date().toISOString(), id]);
}