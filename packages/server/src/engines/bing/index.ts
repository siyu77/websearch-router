import type { Engine, EngineCtx, EngineResult } from '../../shared/types.js';
import { requestWithSafeRedirects, BROWSER_HEADERS } from '../http.js';
import { classifyError } from '../../routing/classifyError.js';
import { analyzeBlockedPage } from '../blocked.js';
import { BING_BLOCKED_OPTIONS } from './blocked.js';
import { parseBingSearchResults } from './parser.js';

export const bingEngine: Engine = {
  id: 'bing',
  async search(query: string, limit: number, ctx?: EngineCtx): Promise<EngineResult> {
    try {
      const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&ensearch=0&first=1`;
      const html = await bingHttpGet(url, ctx);
      const pageState = analyzeBlockedPage(html, BING_BLOCKED_OPTIONS);
      if (pageState.blocked) return { results: [], error: { kind: 'blocked' } };
      const results = parseBingSearchResults(html, limit);
      return { results };
    } catch (e) {
      return { results: [], error: { kind: classifyError(e) } };
    }
  },
};

// injection seam for offline tests (open-webSearch __setXxxHttpGetForTests pattern).
// The injected fn mirrors requestWithSafeRedirects's return shape so the test mock can
// stand in for the network call and we extract `.data` uniformly in both paths.
type BingHttpResponse = { status: number; headers: Record<string, string>; data: string };
let _bingHttpGet: ((url: string, ctx?: EngineCtx) => Promise<BingHttpResponse>) | undefined;
export function __setBingHttpGetForTests(fn: ((url: string, ctx?: EngineCtx) => Promise<BingHttpResponse>) | undefined) {
  _bingHttpGet = fn;
}

async function bingHttpGet(url: string, ctx?: EngineCtx): Promise<string> {
  if (_bingHttpGet) {
    const res = await _bingHttpGet(url, ctx);
    return res.data;
  }
  const res = await requestWithSafeRedirects('GET', url, {
    trustedStaticHost: true,
    timeout: ctx?.timeoutMs,
    signal: ctx?.signal,
    headers: BROWSER_HEADERS,
  });
  return res.data;
}