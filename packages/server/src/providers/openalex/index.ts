import type { PaidAdapter } from '../paidProvider.js';
import type { Result, EngineCtx } from '../../shared/types.js';
import { BACKOFF } from '../errorRules.js';
import { requestWithSafeRedirects } from '../../engines/http.js';

// OpenAlex (MAG successor): since Feb 2026 the API requires an API key and
// meters usage — every account gets $1/day free (a works search costs
// ~$0.001, i.e. ~1000 searches/day free). GET
// https://api.openalex.org/works?search=…&per-page=… with the key in the
// `api_key` query param (header auth is not offered). Quota: the 429 body
// carries `retryAfter` (seconds until the daily budget resets at midnight UTC)
// — mapped to ratelimit+resetAt so the paid-provider cooldown covers the gap;
// there is no separate quota header, so success reports exhausted:false
// (no-header path). Relevance-sorted by default: rank_in_source is the
// relevance rank, score stays undefined (RRF-agnostic merge).
export const openalexAdapter: PaidAdapter = {
  async search(account: any, query: string, limit: number, ctx?: EngineCtx) {
    const apiKey = account.data.apiKey as string;
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${Math.min(limit, 200)}&api_key=${encodeURIComponent(apiKey)}`;
    const res = await openalexHttp(url, ctx?.signal);
    const status = res.status;
    if (status >= 200 && status < 300) {
      const json = JSON.parse(res.data);
      const results: Result[] = ((json.results) ?? []).map((r: any, i: number) => ({
        title: r.display_name ?? '',
        url: r.doi ? r.doi.replace('http://doi.org/', 'https://doi.org/') : (r.id ?? ''),
        snippet: openalexSnippet(r),
        rank_in_source: i, score: undefined as number | undefined,
      }));
      return { results, quota: { exhausted: false } };
    }
    if (status === 401 || status === 403) return { results: [], error: { kind: 'auth' } };
    if (status === 429) return { results: [], error: { kind: 'ratelimit', resetAt: resetAtFromRetryAfterSeconds(res.data) } };
    if (status >= 500) return { results: [], error: { kind: 'transient' } };
    return { results: [], error: { kind: 'unknown' } };
  },
};

// The 429 body (not a header) carries `retryAfter` in seconds until the daily
// reset; fall back to the shared 5min cap when the body is unreadable.
function resetAtFromRetryAfterSeconds(body: string): number | undefined {
  try {
    const retryAfter = JSON.parse(body)?.retryAfter;
    if (typeof retryAfter === 'number' && retryAfter > 0) {
      return Date.now() + Math.min(retryAfter * 1000, BACKOFF.max);
    }
  } catch { /* fall through */ }
  return undefined;
}

// OpenAlex stores abstracts as an inverted index (word -> positions). Flip it
// back into a sentence, then apply the shared SNIPPET_MAX discipline. Fall back
// to metadata bits (year/venue) when a record carries no abstract.
const SNIPPET_MAX = 300;
export function abstractFromInvertedIndex(idx: Record<string, number[]> | undefined | null): string {
  if (!idx || typeof idx !== 'object') return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(idx)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) words[p] = word;
  }
  return words.filter(Boolean).join(' ');
}

function openalexSnippet(r: any): string {
  const a = abstractFromInvertedIndex(r.abstract_inverted_index).replace(/\s+/g, ' ').trim();
  if (a) return a.length > SNIPPET_MAX ? a.slice(0, SNIPPET_MAX) + '…' : a;
  const bits: string[] = [];
  const year = r.publication_year;
  if (typeof year === 'number') bits.push(`Year: ${year}`);
  const venue = r.primary_location?.source?.display_name;
  if (typeof venue === 'string' && venue) bits.push(`Venue: ${venue}`);
  return bits.join('. ');
}

let _openalexHttp: ((url: string, signal?: AbortSignal) => Promise<{ status: number; headers: Record<string, string>; data: string }>) | undefined;
export function __setOpenalexHttpForTests(fn: typeof _openalexHttp) { _openalexHttp = fn; }

async function openalexHttp(url: string, signal?: AbortSignal): Promise<{ status: number; headers: Record<string, string>; data: string }> {
  try {
    if (_openalexHttp) return await _openalexHttp(url, signal);
    const res = await requestWithSafeRedirects('GET', url, {
      trustedStaticHost: true,
      timeout: 20_000,
      signal,
      headers: { Accept: 'application/json' },
    });
    return { status: res.status, headers: res.headers, data: res.data };
  } catch (e) {
    // requestWithSafeRedirects validates 2xx/3xx only, so error statuses (401/
    // 403/429 — part of OpenAlex's normal error contract) arrive as AxiosError.
    // Unwrap the response so the adapter's status mapping still sees them.
    const status = (e as any)?.response?.status;
    if (typeof status === 'number') {
      return { status, headers: (e as any).response?.headers ?? {}, data: String((e as any).response?.data ?? '') };
    }
    throw e;
  }
}
