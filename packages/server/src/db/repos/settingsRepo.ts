import type { DbAdapter } from '../driver.js';
export function get(adapter: DbAdapter, key: string): string | null {
  return (adapter.get('SELECT value FROM settings WHERE key = ?', [key]) as { value?: string } | null)?.value ?? null;
}
export function set(adapter: DbAdapter, key: string, value: string) {
  const now = new Date().toISOString();
  adapter.exec(`INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt`, [key, value, now]);
}