import type { Result, Provider, ProviderResult, SourceFailure } from '../shared/types.js';
import type { ErrorKind } from '../shared/errorKind.js';
import type { Combo, FailTrigger, SourceRef } from './combo.js';
import { mergeResults } from './merge.js';
import { selectTopLevelError } from './errors.js';
import { classifyError } from './classifyError.js';
import { filterPrivateResults } from '../engines/urlSafety.js';

export interface SearchResponse {
  results: Result[];
  // Per-source failures stay in partialFailures as { source, error: { kind } }
  // (no HTTP error); only an all-source failure becomes the top-level `error`.
  partialFailures: { source: string; error: { kind: ErrorKind; provider?: string; resetAt?: number } }[];
  meta: { combo: string; sourceTimings: Record<string, number>; degraded: boolean };
  // Per-source result counts (pre-merge) for usage writeback (#12).
  sourceResultCounts: Record<string, number>;
  error?: { kind: ErrorKind; provider?: string; resetAt?: number };
}

export interface RoutingOpts {
  signal?: AbortSignal;
  limit?: number;                 // forwarded to provider.search (#5)
  onSourceDone?: (source: string, r: { results: Result[]; error?: { kind: string } }) => void;
}

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_LIMIT = 10;

function resolveTimeout(ref: SourceRef): number {
  return ref.timeoutMs ?? DEFAULT_TIMEOUT;
}

// A source's outcome after running: success (results, no error) or failure (error).
// `provider` is carried on failures so the all-source-failure top-level error can
// name the provider (#1/#7).
interface SourceOutcome {
  source: string;
  provider: string;
  results: Result[];
  error?: { kind: ErrorKind; provider?: string; resetAt?: number };
  timing: number;
}

async function runSource(
  provider: Provider | undefined,
  ref: SourceRef,
  query: string,
  limit: number,
  opts: RoutingOpts,
): Promise<SourceOutcome> {
  const providerId = provider?.id ?? ref.provider;
  const t0 = Date.now();
  try {
    if (!provider) {
      if (opts.onSourceDone) opts.onSourceDone(ref.provider, { results: [], error: { kind: 'unknown' } });
      return { source: ref.provider, provider: providerId, results: [], error: { kind: 'unknown', provider: providerId }, timing: 0 };
    }
    const result: ProviderResult = await provider.search(query, limit, { timeoutMs: resolveTimeout(ref), signal: opts.signal, accountId: ref.accountId });
    const error = result.error ? { kind: result.error.kind, provider: providerId, resetAt: result.error.resetAt } : undefined;
    const out: SourceOutcome = { source: ref.provider, provider: providerId, results: result.results, error, timing: Date.now() - t0 };
    if (opts.onSourceDone) opts.onSourceDone(ref.provider, { results: result.results, error });
    return out;
  } catch (e) {
    const error = { kind: classifyError(e), provider: providerId };
    const out: SourceOutcome = { source: ref.provider, provider: providerId, results: [], error, timing: Date.now() - t0 };
    if (opts.onSourceDone) opts.onSourceDone(ref.provider, { results: [], error });
    return out;
  }
}

// Map a thrown/returned ErrorKind to the FailTrigger that governs degradation.
// 'timeout'/'ratelimit' have dedicated triggers; every other error kind maps to
// the catch-all 'error' trigger (blocked/quota/auth/transient/unknown).
function errorKindToTrigger(kind: ErrorKind): FailTrigger {
  if (kind === 'timeout') return 'timeout';
  if (kind === 'ratelimit') return 'ratelimit';
  return 'error';
}

// F2: a source "matches" fallback.on when its failure kind is in `on`
// (empty-success maps to the 'empty' trigger). `on: []` is the request-level
// default-off sentinel used by tests: treat every failure as matching so the
// old min_results-only fall-through behavior is preserved.
function shouldFallThrough(out: SourceOutcome, on: FailTrigger[]): boolean {
  if (on.length === 0) return true;
  if (out.error) return on.includes(errorKindToTrigger(out.error.kind));
  if (out.results.length === 0) return on.includes('empty');
  return false; // non-empty success does not trigger degradation
}

function record(out: SourceOutcome, collected: SourceOutcome[], failures: SourceFailure[], sourceTimings: Record<string, number>, counts: Record<string, number>) {
  sourceTimings[out.source] = out.timing;
  counts[out.source] = out.results.length;
  if (out.error) failures.push({ source: out.source, error: out.error });
  else collected.push(out);
}

export async function executeCombo(
  combo: Combo,
  query: string,
  providers: Record<string, Provider>,
  opts: RoutingOpts = {},
): Promise<SearchResponse> {
  const failures: SourceFailure[] = [];
  const collected: SourceOutcome[] = [];
  const sourceTimings: Record<string, number> = {};
  const sourceResultCounts: Record<string, number> = {};
  let degraded = false;

  const limit = opts.limit ?? DEFAULT_LIMIT;
  const on = combo.fallback.on;
  const minResults = combo.fallback.min_results;

  if (combo.mode === 'concurrent') {
    const outs = await Promise.all(combo.sources.map((ref) => runSource(providers[ref.provider], ref, query, limit, opts)));
    outs.forEach((o) => record(o, collected, failures, sourceTimings, sourceResultCounts));
  } else if (combo.mode === 'sequential') {
    for (const ref of combo.sources) {
      const o = await runSource(providers[ref.provider], ref, query, limit, opts);
      record(o, collected, failures, sourceTimings, sourceResultCounts);
      const total = collected.reduce((n, c) => n + c.results.length, 0);
      if (total >= minResults) break;
      if (!shouldFallThrough(o, on)) break; // F2: only matching failures fall through
    }
  } else {
    // hybrid
    const n = combo.hybrid?.concurrentCount ?? 1;
    const first = combo.sources.slice(0, n);
    const rest = combo.sources.slice(n);
    const outs = await Promise.all(first.map((ref) => runSource(providers[ref.provider], ref, query, limit, opts)));
    outs.forEach((o) => record(o, collected, failures, sourceTimings, sourceResultCounts));
    let total = collected.reduce((x, c) => x + c.results.length, 0);
    // F2: only fill when at least one of the first N had a matching failure AND below min_results.
    if (total < minResults && rest.length > 0 && outs.some((o) => shouldFallThrough(o, on))) {
      degraded = true;
      for (const ref of rest) {
        const o = await runSource(providers[ref.provider], ref, query, limit, opts);
        record(o, collected, failures, sourceTimings, sourceResultCounts);
        total += o.results.length;
        if (total >= minResults) break;
        if (!shouldFallThrough(o, on)) break;
      }
    }
  }

  // S3: SSRF choke point for result URLs — drop private/local/non-http results
  // from every source before they reach merging or the caller (covers /search,
  // /search/stream, and paid adapters that never pass through an engine).
  for (const out of collected) out.results = filterPrivateResults(out.results);

  const results = mergeResults(collected, combo.merge.cap, combo.merge.dedupe);

  // All-source failure: every source either errored or returned empty (#6/#7).
  // This determination is independent of fallback.on — only degradation is gated.
  const failedSources = failures.length + collected.filter((c) => c.results.length === 0).length;
  const error = failedSources === combo.sources.length ? selectTopLevelError(failures) ?? undefined : undefined;

  return {
    results,
    partialFailures: failures,
    meta: { combo: combo.id, sourceTimings, degraded },
    sourceResultCounts,
    error,
  };
}
