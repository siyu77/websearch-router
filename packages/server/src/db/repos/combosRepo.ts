import type { DbAdapter } from '../driver.js';
import { parseJson, stringifyJson } from '../helpers/jsonCol.js';

export interface ComboRecord { id: string; name: string; mode: string; data: Record<string, unknown>; createdAt: string; updatedAt: string; }

export function get(adapter: DbAdapter, id: string): ComboRecord | null {
  const row = adapter.get('SELECT * FROM combos WHERE id = ?', [id]) as any;
  if (!row) return null;
  return { id: row.id, name: row.name, mode: row.mode, data: parseJson(row.data, {}), createdAt: row.createdAt, updatedAt: row.updatedAt };
}
export function list(adapter: DbAdapter): ComboRecord[] {
  return (adapter.all('SELECT * FROM combos ORDER BY updatedAt DESC') as any[])
    .map((r) => ({ id: r.id, name: r.name, mode: r.mode, data: parseJson(r.data, {}), createdAt: r.createdAt, updatedAt: r.updatedAt }));
}
export function upsert(adapter: DbAdapter, c: ComboRecord) {
  adapter.exec(`INSERT INTO combos (id, name, mode, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, mode=excluded.mode, data=excluded.data, updatedAt=excluded.updatedAt`,
    [c.id, c.name, c.mode, stringifyJson(c.data), c.createdAt, c.updatedAt]);
}
export function remove(adapter: DbAdapter, id: string) { adapter.exec('DELETE FROM combos WHERE id = ?', [id]); }