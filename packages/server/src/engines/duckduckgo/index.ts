import type { Engine, EngineCtx, EngineResult, Result } from '../../shared/types.js';
import { requestWithSafeRedirects, BROWSER_HEADERS } from '../http.js';
import { classifyError } from '../../routing/classifyError.js';
import { analyzeBlockedPage } from '../blocked.js';
import { DDG_BLOCKED_OPTIONS } from './blocked.js';
import * as cheerio from 'cheerio';

// The JSONP `a` (abstract) field carries HTML (<b>, &#x27;, &amp;, …), unlike the
// HTML fallback whose .result__snippet is text. Strip tags + decode entities so
// the normalized snippet is plain text in both paths.
function cleanJsonpSnippet(raw: string): string {
  return cheerio.load(raw).text().trim();
}

export const ddgEngine: Engine = {
  id: 'ddg',
  async search(query: string, limit: number, ctx?: EngineCtx): Promise<EngineResult> {
    try {
      // JSONP path returns canonical result URLs directly (no DDG redirect
      // wrapper to decode) — preferred when it yields items.
      const results = await searchViaJsonp(query, limit, ctx);
      if (results.length > 0) return { results };

      // JSONP came back empty — try the HTML fallback. If it is also empty,
      // check whether DDG served the anomaly/CAPTCHA page: report
      // ErrorKind.blocked instead of a silent zero-result success so the UI
      // can surface the blocked-by-anti-bot diagnostic.
      const { results: fallback, html } = await searchViaHtml(query, limit, ctx);
      if (fallback.length > 0) return { results: fallback };
      if (html && analyzeBlockedPage(html, DDG_BLOCKED_OPTIONS).blocked) {
        return { results: [], error: { kind: 'blocked' } };
      }
      return { results: [] };
    } catch (e) {
      return { results: [], error: { kind: classifyError(e) } };
    }
  },
};

function isTrustedPreloadUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'links.duckduckgo.com'
      && (u.port === '' || u.port === '443') && u.username === '' && u.password === '' && u.pathname === '/d.js';
  } catch { return false; }
}

interface DdgJsonItem { u?: string; t?: string; a?: string; n?: string }

async function searchViaJsonp(query: string, limit: number, ctx?: EngineCtx): Promise<EngineResult['results']> {
  const homeUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&t=h_&ia=web`;
  const homeHtml = await ddgHttpGet(homeUrl, ctx);

  // Resolve the d.js data URL. The home page has *many* `rel="preload"` links
  // and the first is a font (/font/DuckSansProduct-Regular.woff2), not d.js — so
  // we must not grab `link[rel="preload"]` generically (it collides on the
  // font). Prefer the single `#deep_preload_script` element, then the regex
  // fallback. Both hold the valid links.duckduckgo.com/d.js?…vqd=… URL.
  const $ = cheerio.load(homeHtml);
  let preloadUrl = $('#deep_preload_script').attr('src') ?? '';
  if (!preloadUrl) {
    const m = homeHtml.match(/https:\/\/links\.duckduckgo\.com\/d\.js[^"'\s]*/);
    if (m) preloadUrl = m[0];
  }
  if (!isTrustedPreloadUrl(preloadUrl)) return [];

  const dataHtml = await ddgHttpGet(`${preloadUrl}&s=0`, ctx);
  const jsonpMatch = dataHtml.match(/DDG\.pageLayout\.load\('d',\s*(\[.*?\])\s*\);/s);
  if (!jsonpMatch?.[1]) return [];

  const items = JSON.parse(jsonpMatch[1]) as DdgJsonItem[];
  const results: Result[] = [];
  for (const item of items) {
    if (item.n) continue; // navigation items
    if (results.length >= limit) break;
    if (!item.u || !item.t) continue;
    results.push({ title: item.t, url: item.u, snippet: cleanJsonpSnippet(item.a ?? ''), rank_in_source: results.length });
  }
  return results;
}

// HTML fallback. GET (not POST — POST triggers DDG's 202 anomaly reliably, even
// with modern headers). The parsed a.result__a href is a protocol-relative DDG
// redirect wrapper `//duckduckgo.com/l/?uddg=<encoded real url>&rut=…` that (a)
// fails `new URL()` without a base and (b) is therefore dropped by
// filterPrivateResults — so decode the real target from `uddg` first (mirrors
// bing/parser.ts's decodeBingRedirectTarget). Returns the raw body too so the
// caller can run anomaly/CAPTCHA detection on it.
async function searchViaHtml(
  query: string,
  limit: number,
  ctx?: EngineCtx,
): Promise<{ results: EngineResult['results']; html: string }> {
  const html = await ddgHttpGet(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, ctx);
  const $ = cheerio.load(html);
  const results: Result[] = [];
  $('.result, div.result').each((_, el) => {
    if (results.length >= limit) return;
    const $el = $(el);
    if ($el.hasClass('result--ad')) return;
    const $a = $el.find('a.result__a').first();
    const title = $a.text().trim();
    const href = $a.attr('href') ?? '';
    const url = unwrapDdgRedirect(href);
    const snippet = $el.find('.result__snippet').first().text().trim();
    if (!title || !url) return;
    results.push({ title, url, snippet, rank_in_source: results.length });
  });
  return { results, html };
}

// a.result__a href is protocol-relative `//duckduckgo.com/l/?uddg=<encoded>…`.
// Resolve against the DDG origin, then unwrap the real target from `uddg`.
// Passes plain canonical URLs through untouched.
function unwrapDdgRedirect(rawHref: string): string {
  if (!rawHref) return '';
  try {
    const u = new URL(rawHref, 'https://duckduckgo.com/');
    if (u.hostname === 'duckduckgo.com' && u.pathname === '/l/') {
      const target = u.searchParams.get('uddg')?.trim();
      if (target) return decodeURIComponent(target);
      return '';
    }
    return u.toString();
  } catch { return ''; }
}

// injection seam for offline tests (open-webSearch __setXxxHttpGetForTests pattern).
// The injected fn mirrors requestWithSafeRedirects's return shape so the test mock can
// stand in for the network call and we extract `.data` uniformly in both paths.
// GET-only: the HTML fallback no longer POSTs (POST triggers DDG's 202 anomaly).
type DdgHttpResponse = { status: number; headers: Record<string, string>; data: string };
let _ddgHttpGet: ((url: string, ctx?: EngineCtx) => Promise<DdgHttpResponse>) | undefined;
export function __setDdgHttpGetForTests(fn: typeof _ddgHttpGet) { _ddgHttpGet = fn; }

async function ddgHttpGet(url: string, ctx?: EngineCtx): Promise<string> {
  if (_ddgHttpGet) {
    const res = await _ddgHttpGet(url, ctx);
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
