import type { DbAdapter } from '../driver.js';
import { parseJson, stringifyJson } from '../helpers/jsonCol.js';
export interface UsageRecord { id: string; ts: string; query: string; comboId: string; data: Record<string, unknown>; }
export function insert(adapter: DbAdapter, r: UsageRecord) {
  adapter.exec('INSERT INTO usageHistory (id, ts, query, comboId, data) VALUES (?, ?, ?, ?, ?)', [r.id, r.ts, r.query, r.comboId, stringifyJson(r.data)]);
}
export function recent(adapter: DbAdapter, limit = 50): UsageRecord[] {
  return (adapter.all('SELECT * FROM usageHistory ORDER BY ts DESC LIMIT ?', [limit]) as any[])
    .map((r) => ({ id: r.id, ts: r.ts, query: r.query, comboId: r.comboId, data: parseJson(r.data, {}) }));
}