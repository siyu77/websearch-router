import { type Combo, type ComboMode, type FailTrigger, type SourceRef } from './combo.js';

// Request-level combo validation + defaulting (single responsibility). Keeps the
// API layer a thin transport: both /search and /search/stream funnel their
// inline or persisted combo input through here, and every failure mode that maps
// to a 400 bad_request (missing/invalid JSON, empty sources) is centralized.
export class ComboValidationError extends Error {}

const DEFAULT_TIMEOUT = 15_000;
// Built-in field defaults for any combo whose optional fields are missing.
// (These were formerly derived from a DEFAULT_COMBO constant; the constant was
// removed when the fallback combo was deleted — `provider` is now required.)
const DEFAULT_FALLBACK_ON: FailTrigger[] = ['timeout', 'error', 'empty'];
const DEFAULT_MERGE = { dedupe: 'url-normalized', rank: 'rrf', cap: 20 } as const;
const DEFAULT_MIN_RESULTS = 5;
const DEFAULT_CONCURRENT_COUNT = 1;

// Every optional field defaulted so routing can rely on a full shape; `sources`
// carry a required timeoutMs. `weight` stays declared (v2 only — not used in RRF).
export type NormalizedSource = { provider: string; timeoutMs: number; weight?: number; accountId?: string };
export interface NormalizedCombo {
  id: string;
  name?: string;
  sources: NormalizedSource[];
  mode: ComboMode;
  merge: { dedupe: Combo['merge']['dedupe']; rank: 'rrf'; cap: number };
  fallback: { on: Combo['fallback']['on']; min_results: number };
  hybrid: { concurrentCount: number };
}

export interface NormalizeComboOptions {
  // persisted combos are already complete; this is the fallback id for inline
  // combos (e.g. 'inline' for /search) so meta.combo stays meaningful.
  fallbackId?: string;
  // request-level mode override (design §5.3) — overrides combo.mode, never persisted.
  mode?: ComboMode;
}

export function normalizeCombo(input: unknown, opts: NormalizeComboOptions = {}): NormalizedCombo {
  const raw = typeof input === 'string' ? parseJson(input) : input;
  if (!raw || typeof raw !== 'object') throw new ComboValidationError('combo must be an object');

  const c = raw as Record<string, any>;
  const sources = parseSources(c.sources);
  if (sources.length === 0) throw new ComboValidationError('combo.sources must not be empty');

  return {
    id: typeof c.id === 'string' && c.id ? c.id : (opts.fallbackId ?? 'inline'),
    name: typeof c.name === 'string' ? c.name : undefined,
    sources,
    mode: opts.mode ?? parseMode(c.mode),
    merge: {
      dedupe: parseDedupe(c.merge?.dedupe),
      rank: 'rrf' as const,
      cap: typeof c.merge?.cap === 'number' && c.merge.cap > 0 ? c.merge.cap : DEFAULT_MERGE.cap,
    },
    fallback: {
      on: parseFallbackOn(c.fallback?.on),
      min_results: typeof c.fallback?.min_results === 'number' && c.fallback.min_results >= 0 ? c.fallback.min_results : DEFAULT_MIN_RESULTS,
    },
    hybrid: { concurrentCount: parseConcurrentCount(c.hybrid?.concurrentCount) },
  };
}

// Repo record -> routing Combo (id/name/mode are fixed columns, the rest lives
// in the `data` JSON blob). Server + API routes share this so the stored-combo
// re-read (#9) and the boot-time list produce identical shapes.
export interface StoredComboRecord { id: string; name: string; mode: string; data: Record<string, unknown> }

export function storedComboToCombo(record: StoredComboRecord): Combo {
  return { id: record.id, name: record.name, mode: record.mode as ComboMode, ...record.data } as Combo;
}

// Match a provider string to a saved combo by id (exact) or name
// (case-insensitive). Case-insensitive name matching lets a model send `"web"`
// and still hit the built-in `WEB` combo; ids stay exact (they are opaque).
export function findStoredCombo(combos: Combo[], idOrName: string): Combo | undefined {
  const lower = idOrName.toLowerCase();
  return combos.find((c) => c.id === idOrName || (typeof c.name === 'string' && c.name.toLowerCase() === lower));
}

// Stream accepts `?combo=` as either an inline JSON combo or a stored combo id/name.
export function isJsonComboInput(s: string): boolean {
  try { JSON.parse(s); return true; } catch { return false; }
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    throw new ComboValidationError('combo is not valid JSON');
  }
}

function parseSources(sources: unknown): NormalizedSource[] {
  if (!Array.isArray(sources)) throw new ComboValidationError('combo.sources must be an array');
  return sources.map((s, i) => {
    if (!s || typeof s !== 'object') throw new ComboValidationError(`combo.sources[${i}] must be an object`);
    const ref = s as Record<string, any>;
    if (typeof ref.provider !== 'string' || !ref.provider) throw new ComboValidationError(`combo.sources[${i}].provider is required`);
    const timeoutMs = typeof ref.timeoutMs === 'number' && ref.timeoutMs > 0 ? ref.timeoutMs : DEFAULT_TIMEOUT;
    const source: NormalizedSource = { provider: ref.provider, timeoutMs };
    if (typeof ref.weight === 'number') source.weight = ref.weight; // declared, v2 only
    if (typeof ref.accountId === 'string' && ref.accountId) source.accountId = ref.accountId;
    return source;
  });
}

function parseMode(mode: unknown): ComboMode {
  if (mode === 'concurrent' || mode === 'sequential' || mode === 'hybrid') return mode;
  return 'concurrent';
}

function parseFallbackOn(on: unknown): Combo['fallback']['on'] {
  // Missing -> built-in triggers. `[]` is a legal
  // sentinel (request-level default-off: every failure triggers fall-through),
  // so it is preserved. An array of only-invalid triggers defaults instead.
  if (on === undefined || on === null) return DEFAULT_FALLBACK_ON;
  if (!Array.isArray(on)) throw new ComboValidationError('combo.fallback.on must be an array');
  if (on.length === 0) return on as Combo['fallback']['on'];
  const valid = on.filter((t): t is Combo['fallback']['on'][number] =>
    t === 'timeout' || t === 'ratelimit' || t === 'error' || t === 'empty');
  if (valid.length === 0) return DEFAULT_FALLBACK_ON;
  return valid;
}

function parseDedupe(dedupe: unknown): Combo['merge']['dedupe'] {
  if (dedupe === 'url-normalized' || dedupe === 'off' || dedupe === 'url' || dedupe === 'url+title') return dedupe;
  return DEFAULT_MERGE.dedupe;
}

function parseConcurrentCount(n: unknown): number {
  if (typeof n === 'number' && Number.isInteger(n) && n >= 1) return n;
  return DEFAULT_CONCURRENT_COUNT;
}
