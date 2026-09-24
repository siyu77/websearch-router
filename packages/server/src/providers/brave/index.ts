import type { PaidAdapter } from '../paidProvider.js';
import type { Result, EngineCtx } from '../../shared/types.js';
import { quotaFromBraveHeaders, resetAtFromRetryAfter } from '../quota.js';
import { requestWithSafeRedirects } from '../../engines/http.js';

export const braveAdapter: PaidAdapter = {
  async search(account: any, query: string, limit: number, ctx?: EngineCtx) {
    const apiKey = account.data.apiKey as string;
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}`;
    const res = await braveHttp(apiKey, url, ctx?.signal);
    const status = res.status;
    if (status >= 200 && status < 300) {
      const json = JSON.parse(res.data);
      const results: Result[] = ((json.web?.results) ?? []).map((r: any, i: number) => ({
        title: r.title ?? '', url: r.url ?? '', snippet: r.description ?? '',
        rank_in_source: i, score: undefined as number | undefined,
      }));
      return { results, quota: quotaFromBraveHeaders(res.headers, false) };
    }
    if (status === 401) return { results: [], error: { kind: 'auth' } };
    if (status === 402) return { results: [], error: { kind: 'quota' } };
    if (status === 429) return { results: [], error: { kind: 'ratelimit', resetAt: resetAtFromRetryAfter(res.headers['retry-after'] ?? res.headers['reset-at']) } };
    return { results: [], error: { kind: 'unknown' } };
  },
};

let _braveHttp: ((apiKey: string, url: string, signal?: AbortSignal) => Promise<{ status: number; headers: Record<string, string>; data: string }>) | undefined;
export function __setBraveHttpForTests(fn: typeof _braveHttp) { _braveHttp = fn; }

async function braveHttp(apiKey: string, url: string, signal?: AbortSignal): Promise<{ status: number; headers: Record<string, string>; data: string }> {
  if (_braveHttp) return _braveHttp(apiKey, url, signal);
  const res = await requestWithSafeRedirects('GET', url, {
    trustedStaticHost: true,
    timeout: 20_000,
    signal,
    headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
  });
  return { status: res.status, headers: res.headers, data: res.data };
}
