import type { PaidAdapter } from '../paidProvider.js';
import type { Result, EngineCtx } from '../../shared/types.js';
import { resetAtFromRetryAfter } from '../quota.js';
import { requestWithSafeRedirects } from '../../engines/http.js';

// Exa search API (paid, Tavily-tier competitor): POST https://api.exa.ai/search
// authenticated via the `x-api-key` header. Billing is per request, so numResults
// is capped at 10 as a cost guard (cost does not scale with limit). Exa's
// relevance `score`/`highlightScores` are deliberately NOT mapped to Result.score
// (tavily-aligned): the merge layer stays RRF-agnostic.
// Contents: `text` is disabled and `highlights` enabled — Exa returns no
// description field by default, so we request the highlight excerpts and use
// them as the snippet (parallels bing/ddg/google/tavily which all carry one).
export const exaAdapter: PaidAdapter = {
  async search(account: any, query: string, limit: number, ctx?: EngineCtx) {
    const apiKey = account.data.apiKey as string;
    const body = JSON.stringify({
      query,
      numResults: Math.min(limit, 10),
      type: 'auto',
      contents: { highlights: true, text: false },
    });
    const res = await exaHttp(apiKey, body, ctx?.signal);
    const status = res.status;
    if (status >= 200 && status < 300) {
      const json = JSON.parse(res.data);
      const results: Result[] = ((json.results) ?? []).map((r: any, i: number) => ({
        title: r.title ?? '', url: r.url ?? '', snippet: snippetFromExaResult(r),
        rank_in_source: i, score: undefined as number | undefined,
      }));
      // Exa exposes no quota header; explicit exhausted:false (tavily no-header path).
      return { results, quota: { exhausted: false } };
    }
    if (status === 401) return { results: [], error: { kind: 'auth' } };
    if (status === 402) return { results: [], error: { kind: 'quota' } };
    if (status === 429) return { results: [], error: { kind: 'ratelimit', resetAt: resetAtFromRetryAfter(res.headers['retry-after'] ?? res.headers['reset-at']) } };
    return { results: [], error: { kind: 'unknown' } };
  },
};

// Snippet precedence: the requested highlights array (each item is a content
// excerpt, some span thousands of chars) -> joined into one line and trimmed to
// SNIPPET_MAX so dashboard rows stay consistent with the short parsed snippets
// from the free engines; fall back to metadata bits (author/publishedDate) when
// highlights are absent (e.g. the result carried no matching passage).
const SNIPPET_MAX = 300;
function snippetFromExaResult(r: any): string {
  if (Array.isArray(r.highlights) && r.highlights.length > 0) {
    const joined = r.highlights.join(' ');
    return joined.length > SNIPPET_MAX ? joined.slice(0, SNIPPET_MAX) + '…' : joined;
  }
  const bits: string[] = [];
  if (r.author) bits.push(`Author: ${r.author}`);
  if (r.publishedDate) bits.push(`Published: ${new Date(r.publishedDate).toISOString().slice(0, 10)}`);
  return bits.join('. ');
}

let _exaHttp: ((apiKey: string, body: string, signal?: AbortSignal) => Promise<{ status: number; headers: Record<string, string>; data: string }>) | undefined;
export function __setExaHttpForTests(fn: typeof _exaHttp) { _exaHttp = fn; }

async function exaHttp(apiKey: string, body: string, signal?: AbortSignal): Promise<{ status: number; headers: Record<string, string>; data: string }> {
  if (_exaHttp) return _exaHttp(apiKey, body, signal);
  const res = await requestWithSafeRedirects('POST', 'https://api.exa.ai/search', {
    trustedStaticHost: true,
    timeout: 20_000,
    signal,
    body,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
  });
  return { status: res.status, headers: res.headers, data: res.data };
}
