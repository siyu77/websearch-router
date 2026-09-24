import type { PaidAdapter } from '../paidProvider.js';
import type { Result, EngineCtx } from '../../shared/types.js';
import { resetAtFromRetryAfter } from '../quota.js';
import { requestWithSafeRedirects } from '../../engines/http.js';

// Semantic Scholar Academic Graph API (paid mode: free tier requires an API
// key; the paid tier shares the same endpoint and error semantics).
// GET https://api.semanticscholar.org/graph/v1/paper/search?query=…&fields=…
// authenticated via the `x-api-key` header. Error mapping follows the shared
// ERROR_RULES: 401→auth, 404 (malformed key per S2 docs)→auth, 429→ratelimit
// with Retry-After, 5xx→transient. Exa-aligned choices: S2 exposes no quota
// header on the free tier, so `exhausted:false` (no-header path); the
// `relevance`-ordered list is passed through as rank_in_source and score stays
// undefined — the merge layer stays RRF-agnostic.
export const semanticScholarAdapter: PaidAdapter = {
  async search(account: any, query: string, limit: number, ctx?: EngineCtx) {
    const apiKey = account.data.apiKey as string;
    const fields = 'title,abstract,url,externalIds,year,authors';
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${Math.min(limit, 100)}&fields=${fields}`;
    const res = await s2Http(apiKey, url, ctx?.signal);
    const status = res.status;
    if (status >= 200 && status < 300) {
      const json = JSON.parse(res.data);
      const results: Result[] = ((json.data) ?? []).map((r: any, i: number) => ({
        title: r.title ?? '', url: s2UrlOf(r), snippet: s2Snippet(r),
        rank_in_source: i, score: undefined as number | undefined,
      }));
      // S2 exposes no quota header; explicit exhausted:false (tavily no-header path).
      return { results, quota: { exhausted: false } };
    }
    if (status === 401 || status === 404) return { results: [], error: { kind: 'auth' } };
    if (status === 429) return { results: [], error: { kind: 'ratelimit', resetAt: resetAtFromRetryAfter(res.headers['retry-after']) } };
    if (status >= 500) return { results: [], error: { kind: 'transient' } };
    return { results: [], error: { kind: 'unknown' } };
  },
};

// Prefer the canonical S2 paper page; fall back to the DOI landing page, then
// the S2 URL field (present on most records; empty titles/urls are filtered by
// the merge layer like every other engine).
function s2UrlOf(r: any): string {
  const doi = r.externalIds?.DOI;
  return (typeof r.url === 'string' && r.url) || (doi ? `https://doi.org/${doi}` : '');
}

// Abstract-first snippet (exa SNIPPET_MAX pattern): fall back to TLDR-adjacent
// metadata bits (year/authors) when a record carries no abstract.
const SNIPPET_MAX = 300;
function s2Snippet(r: any): string {
  if (typeof r.abstract === 'string' && r.abstract.trim()) {
    const a = r.abstract.trim().replace(/\s+/g, ' ');
    return a.length > SNIPPET_MAX ? a.slice(0, SNIPPET_MAX) + '…' : a;
  }
  const bits: string[] = [];
  const authors: string[] | undefined = Array.isArray(r.authors)
    ? r.authors.map((a: any) => a?.name).filter((n: unknown): n is string => typeof n === 'string')
    : undefined;
  if (authors?.length) bits.push(`Authors: ${authors.slice(0, 3).join(', ')}`);
  if (typeof r.year === 'number') bits.push(`Year: ${r.year}`);
  return bits.join('. ');
}

let _s2Http: ((apiKey: string, url: string, signal?: AbortSignal) => Promise<{ status: number; headers: Record<string, string>; data: string }>) | undefined;
export function __setS2HttpForTests(fn: typeof _s2Http) { _s2Http = fn; }

async function s2Http(apiKey: string, url: string, signal?: AbortSignal): Promise<{ status: number; headers: Record<string, string>; data: string }> {
  try {
    if (_s2Http) return await _s2Http(apiKey, url, signal);
    const res = await requestWithSafeRedirects('GET', url, {
      trustedStaticHost: true,
      timeout: 20_000,
      signal,
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });
    return { status: res.status, headers: res.headers, data: res.data };
  } catch (e) {
    // requestWithSafeRedirects validates 2xx/3xx only, so error statuses (401/
    // 404/429 — all part of S2's normal error contract) arrive as AxiosError.
    // Unwrap the response so the adapter's status mapping still sees them.
    const status = (e as any)?.response?.status;
    if (typeof status === 'number') {
      return { status, headers: (e as any).response?.headers ?? {}, data: String((e as any).response?.data ?? '') };
    }
    throw e;
  }
}
