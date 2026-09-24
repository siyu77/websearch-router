import type { DbAdapter } from '../driver.js';
import { parseJson, stringifyJson } from '../helpers/jsonCol.js';
export interface DetailRecord { id: string; ts: string; usageId: string; source: string; data: Record<string, unknown>; }
export function insert(adapter: DbAdapter, r: DetailRecord) {
  adapter.exec('INSERT INTO requestDetails (id, ts, usageId, source, data) VALUES (?, ?, ?, ?, ?)', [r.id, r.ts, r.usageId, r.source, stringifyJson(r.data)]);
}
export function byUsage(adapter: DbAdapter, usageId: string): DetailRecord[] {
  return (adapter.all('SELECT * FROM requestDetails WHERE usageId = ? ORDER BY source', [usageId]) as any[])
    .map((r) => ({ id: r.id, ts: r.ts, usageId: r.usageId, source: r.source, data: parseJson(r.data, {}) }));
}
export function byUsageIds(adapter: DbAdapter, usageIds: string[]): Record<string, DetailRecord[]> {
  if (usageIds.length === 0) return {};
  const placeholders = usageIds.map(() => '?').join(',');
  const rows = adapter.all(`SELECT * FROM requestDetails WHERE usageId IN (${placeholders}) ORDER BY source`, usageIds) as any[];
  const grouped: Record<string, DetailRecord[]> = {};
  for (const r of rows) {
    (grouped[r.usageId] ??= []).push({ id: r.id, ts: r.ts, usageId: r.usageId, source: r.source, data: parseJson(r.data, {}) });
  }
  return grouped;
}