import type { Engine, EngineCtx, EngineResult, Result } from '../../shared/types.js';
import { requestWithSafeRedirects } from '../http.js';
import { classifyError } from '../../routing/classifyError.js';
import * as cheerio from 'cheerio';

// arXiv API (keyless, Atom 1.0 XML): GET
// http://export.arxiv.org/api/query?search_query=…&max_results=….
// No key; the arXiv terms ask for serial (not parallel) requests and a polite
// UA — those are the only rate-limit levers. No quota header; a 429 surfaces as
// ErrorKind.ratelimit (free kind). Results are relevance-ranked (the Atom feed
// order is the API's relevance order), so rank_in_source follows feed order.
export const arxivEngine: Engine = {
  id: 'arxiv',
  async search(query: string, limit: number, ctx?: EngineCtx): Promise<EngineResult> {
    try {
      const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:${query}`)}&max_results=${Math.min(limit, 2000)}`;
      const res = await arxivHttp(url, ctx);
      if (res.status === 429) return { results: [], error: { kind: 'ratelimit' } };
      if (res.status >= 500) return { results: [], error: { kind: 'transient' } };
      if (res.status < 200 || res.status >= 300) return { results: [], error: { kind: 'unknown' } };
      const results = parseAtom(res.data);
      return { results };
    } catch (e) {
      return { results: [], error: { kind: classifyError(e) } };
    }
  },
};

// arXiv's Atom feed: <entry> items carry <title>, <id> (the abs page URL),
// <summary> (the abstract). The summary is plain text with whitespace runs.
const SNIPPET_MAX = 300;
export function parseAtom(xml: string): Result[] {
  const $ = cheerio.load(xml, { xml: true });
  const results: Result[] = [];
  $('entry').each((i, el) => {
    const title = $(el).find('title').first().text().replace(/\s+/g, ' ').trim();
    const id = $(el).find('id').first().text().trim();
    let summary = $(el).find('summary').first().text().replace(/\s+/g, ' ').trim();
    if (summary.length > SNIPPET_MAX) summary = summary.slice(0, SNIPPET_MAX) + '…';
    results.push({ title, url: id, snippet: summary, rank_in_source: i });
  });
  return results;
}

type ArxivHttpResponse = { status: number; headers: Record<string, string>; data: string };
let _arxivHttp: ((url: string, ctx?: EngineCtx) => Promise<ArxivHttpResponse>) | undefined;
export function __setArxivHttpForTests(fn: typeof _arxivHttp) { _arxivHttp = fn; }

async function arxivHttp(url: string, ctx?: EngineCtx): Promise<ArxivHttpResponse> {
  if (_arxivHttp) return _arxivHttp(url, ctx);
  const res = await requestWithSafeRedirects('GET', url, {
    trustedStaticHost: true,
    timeout: ctx?.timeoutMs,
    signal: ctx?.signal,
    headers: { 'User-Agent': 'websearch-router/0.1 (academic search router)', Accept: 'application/atom+xml' },
  });
  return { status: res.status, headers: res.headers, data: res.data };
}
