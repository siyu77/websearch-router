export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function stringifyJson(obj: unknown): string {
  return JSON.stringify(obj ?? {});
}
