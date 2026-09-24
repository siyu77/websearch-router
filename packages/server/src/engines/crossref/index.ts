import type { Engine, EngineCtx, EngineResult, Result } from '../../shared/types.js';
import { requestWithSafeRedirects } from '../http.js';
import { classifyError } from '../../routing/classifyError.js';

// Crossref (keyless DOI registry): GET
// https://api.crossref.org/works?query.bibliographic=…&rows=…. No key — the
// "polite pool" is entered via a mailto query param, which buys better rate
// limits and faster service. No quota header; a 429 surfaces as
// ErrorKind.ratelimit (free kind). Crossref relevance-sorts bibliographic
// queries, so rank_in_source is the relevance rank.
const POLITE_MAILTO = 'websearch-router@users.noreply.github.com';

export const crossrefEngine: Engine = {
  id: 'crossref',
  async search(query: string, limit: number, ctx?: EngineCtx): Promise<EngineResult> {
    try {
      const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${Math.min(limit, 1000)}&mailto=${POLITE_MAILTO}`;
      const res = await crossrefHttp(url, ctx);
      if (res.status === 429) return { results: [], error: { kind: 'ratelimit' } };
      if (res.status >= 500) return { results: [], error: { kind: 'transient' } };
      if (res.status < 200 || res.status >= 300) return { results: [], error: { kind: 'unknown' } };
      const json = JSON.parse(res.data);
      const items: any[] = ((json.message?.items) ?? []);
      const results: Result[] = items.map((r, i) => ({
        title: Array.isArray(r.title) ? (r.title[0] ?? '') : (r.title ?? ''),
        url: crossrefUrlOf(r),
        snippet: crossrefSnippet(r),
        rank_in_source: i, score: undefined as number | undefined,
      }));
      return { results };
    } catch (e) {
      return { results: [], error: { kind: classifyError(e) } };
    }
  },
};

function crossrefUrlOf(r: any): string {
  const doi = typeof r.DOI === 'string' && r.DOI ? r.DOI : undefined;
  return doi ? `https://doi.org/${doi}` : '';
}

// Crossref has no abstract on most records (publisher-deposited only). Snippet
// precedence: abstract (strip the JATS <jats:p> tags) -> container-title/year.
const SNIPPET_MAX = 300;
function crossrefSnippet(r: any): string {
  if (typeof r.abstract === 'string' && r.abstract.trim()) {
    const text = r.abstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > SNIPPET_MAX ? text.slice(0, SNIPPET_MAX) + '…' : text;
  }
  const bits: string[] = [];
  const venue = Array.isArray(r['container-title']) ? r['container-title'][0] : r['container-title'];
  if (typeof venue === 'string' && venue) bits.push(`Venue: ${venue}`);
  const year = r.issued?.['date-parts']?.[0]?.[0];
  if (typeof year === 'number') bits.push(`Year: ${year}`);
  return bits.join('. ');
}

type CrossrefHttpResponse = { status: number; headers: Record<string, string>; data: string };
let _crossrefHttp: ((url: string, ctx?: EngineCtx) => Promise<CrossrefHttpResponse>) | undefined;
export function __setCrossrefHttpForTests(fn: typeof _crossrefHttp) { _crossrefHttp = fn; }

async function crossrefHttp(url: string, ctx?: EngineCtx): Promise<CrossrefHttpResponse> {
  if (_crossrefHttp) return _crossrefHttp(url, ctx);
  const res = await requestWithSafeRedirects('GET', url, {
    trustedStaticHost: true,
    timeout: ctx?.timeoutMs,
    signal: ctx?.signal,
    headers: { Accept: 'application/json' },
  });
  return { status: res.status, headers: res.headers, data: res.data };
}
