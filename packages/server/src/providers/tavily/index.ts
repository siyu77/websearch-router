import type { PaidAdapter } from '../paidProvider.js';
import type { EngineCtx } from '../../shared/types.js';
import { quotaFromTavilyBody, resetAtFromRetryAfter } from '../quota.js';
import { buildAxiosRequestOptions } from '../../engines/http.js';
import { assertPublicHttpUrl } from '../../engines/urlSafety.js';

export const tavilyAdapter: PaidAdapter = {
  async search(account: any, query: string, limit: number, ctx?: EngineCtx) {
    const apiKey = account.data.apiKey as string;
    const body = JSON.stringify({ query, max_results: limit, search_depth: 'basic' });
    const res = await tavilyHttp(apiKey, body, ctx?.signal);
    const status = res.status;
    if (status >= 200 && status < 300) {
      const json = JSON.parse(res.data);
      const results = (json.results ?? []).map((r: any, i: number) => ({
        title: r.title ?? '', url: r.url ?? '', snippet: r.content ?? '',
        rank_in_source: i, score: typeof r.score === 'number' ? r.score : undefined,
      }));
      return { results, quota: quotaFromTavilyBody(json.usage, false) };
    }
    if (status === 401) return { results: [], error: { kind: 'auth' } };
    if (status === 432 || status === 433) return { results: [], error: { kind: 'quota' } };
    if (status === 429) return { results: [], error: { kind: 'ratelimit', resetAt: resetAtFromRetryAfter(res.headers['retry-after'] ?? res.headers['reset-at']) } };
    return { results: [], error: { kind: 'unknown' } };
  },
};

let _tavilyHttp: ((apiKey: string, body: string, signal?: AbortSignal) => Promise<{ status: number; headers: Record<string, string>; data: string }>) | undefined;
export function __setTavilyHttpForTests(fn: typeof _tavilyHttp) { _tavilyHttp = fn; }

async function tavilyHttp(apiKey: string, body: string, signal?: AbortSignal): Promise<{ status: number; headers: Record<string, string>; data: string }> {
  if (_tavilyHttp) return _tavilyHttp(apiKey, body, signal);
  // Tavily POSTs a JSON body; use axios directly with the shared factory config (SSRF/UA).
  assertPublicHttpUrl('https://api.tavily.com/search', 'tavily url'); // belt-and-suspenders (hardcoded public URL)
  const axios = (await import('axios')).default;
  const config = buildAxiosRequestOptions({ trustedStaticHost: true, timeout: 20_000, signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } });
  const res = await axios.post('https://api.tavily.com/search', body, config);
  return { status: res.status, headers: res.headers as Record<string, string>, data: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) };
}
