import type { DbAdapter } from '../driver.js';
export function get(adapter: DbAdapter, key: string): string | null {
  return (adapter.get('SELECT value FROM kv WHERE key = ?', [key]) as { value?: string } | null)?.value ?? null;
}
export function set(adapter: DbAdapter, key: string, value: string) {
  adapter.exec('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
}
export function remove(adapter: DbAdapter, key: string) { adapter.exec('DELETE FROM kv WHERE key = ?', [key]); }