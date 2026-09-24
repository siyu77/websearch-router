// Frontend API contract — mirrors backend domain types so the UI reads typed
// domain objects instead of `any`. Each type cites its backend source of truth.

// ---- Combo (src/routing/combo.ts) ---------------------------------------
export type ComboMode = 'concurrent' | 'sequential' | 'hybrid';
export type FailTrigger = 'timeout' | 'ratelimit' | 'error' | 'empty';
export type DedupeMode = 'url-normalized' | 'off' | 'url' | 'url+title';

export interface SourceRef {
  provider: string;
  weight?: number;
  timeoutMs?: number;
  accountId?: string;
}

export interface Combo {
  id: string;
  name?: string;
  sources: SourceRef[];
  mode: ComboMode;
  merge: { dedupe: DedupeMode; rank: 'rrf'; cap: number };
  fallback: { on: FailTrigger[]; min_results: number };
  hybrid?: { concurrentCount: number };
  // Built-in category combo (e.g. 'web'): id/name protected, other fields editable.
  builtin?: boolean;
}

// ---- Engines (src/shared/catalog.ts: ENGINE_CATALOG) --------------------
export type EngineKind = 'free' | 'paid';
export interface EngineRow {
  id: string;
  kind: EngineKind;
}

// ---- Providers / accounts (src/api/routes/dashboardApi.ts:27-49) ---------
export interface QuotaInfo {
  remaining?: number;
  resetAt?: number;
  exhausted: boolean;
}
export interface AccountStatus {
  cooldown?: { until?: number; level?: number };
  quota?: QuotaInfo;
  lastError?: string;
}

export interface ProviderAccount {
  id: string;
  name?: string;
  priority: number;
  isActive: boolean;
  apiKeySet: boolean;
  apiKey?: string; // masked form e.g. 'tvly-••••3456'; undefined when keyless
  quota?: QuotaInfo;
  cooldown?: { until?: number; level?: number };
  lastError?: string;
}

export interface ProviderGroup {
  id: string;
  accounts: ProviderAccount[];
}

// ---- Search results / envelope (src/shared/types.ts, execute.ts) --------
export interface Result {
  title: string;
  url: string;
  snippet: string;
  rank_in_source: number;
  score?: number;
}

// src/shared/errorKind.ts + 'bad_request' from sendBadRequest (errors.ts)
export type ErrorKind =
  | 'blocked' | 'timeout' | 'ratelimit' | 'quota' | 'auth' | 'transient' | 'unknown';
export type ApiErrorKind = ErrorKind | 'bad_request' | 'not_found';

export interface SearchError {
  kind: ApiErrorKind;
  message?: string; // present for bad_request / synthesized unknown
  provider?: string;
  resetAt?: number;
}

export interface SourceFailure {
  source: string;
  error: { kind: ErrorKind; provider?: string; resetAt?: number };
}

export interface SearchMeta {
  combo: string; // resolved id: 'inline' | stored combo id/name (no built-in default)
  sourceTimings: Record<string, number>;
  degraded: boolean;
}

// POST /search success (200) — search.ts:57. The frontend `search()` wraps this
// with a fabricated `ok` field; see SearchApiResponse for the full union.
export interface SearchSuccessBody {
  results: Result[];
  partialFailures: SourceFailure[];
  meta: SearchMeta;
}

// What `search()` actually returns after the { ok: r.ok, ...data } boundary.
export type SearchApiResponse =
  | ({ ok: true } & SearchSuccessBody)
  | ({ ok: false; error: SearchError; meta?: { sourceTimings: Record<string, number> } });

// ---- Fetch (src/engines/web/fetchContent.ts: HtmlExtractionResult) -------
export interface FetchResult {
  title: string;
  text: string;
  mode: 'container' | 'body' | 'metadata';
}

// ---- Usage (src/api/routes/dashboardApi.ts:157-174 + api/usage.ts:12) ----
export interface UsagePerSource {
  source: string;
  durationMs: number;
  resultCount: number;
  error?: string;
}
export interface UsageRow {
  id: string;
  ts: string;
  query: string;
  comboId: string;
  data: { sourceCount: number; totalResults: number; degraded: boolean };
  perSource: UsagePerSource[];
}

// ---- API mutation envelopes --------------------------------------------
export interface UpsertOk {
  ok: true;
  id?: string;
}
export interface DeletedOk {
  ok: true;
}
export interface ApiErrorBody {
  error: { kind: ApiErrorKind; message?: string; provider?: string; resetAt?: number };
}
