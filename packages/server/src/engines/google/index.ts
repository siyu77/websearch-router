import type { Engine, EngineCtx, EngineResult, Result } from '../../shared/types.js';
import { requestWithSafeRedirects, BROWSER_HEADERS } from '../http.js';
import { classifyError } from '../../routing/classifyError.js';
import { analyzeBlockedPage } from '../blocked.js';
import { GOOGLE_BLOCKED_OPTIONS, GOOGLE_ENABLEJS_PATH, GOOGLE_TROUBLE_DIV_ID } from './blocked.js';
import * as cheerio from 'cheerio';

export const googleEngine: Engine = {
  id: 'google',
  async search(query: string, limit: number, ctx?: EngineCtx): Promise<EngineResult> {
    try {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=${Math.max(limit, 10)}`;
      const res = await googleHttpGet(url, ctx);
      const { status, data: html } = res;

      // 429 = anti-bot (the recaptcha "unusual traffic" body, not a generic error).
      if (status === 429) return { results: [], error: { kind: 'blocked' } };

      const pageState = analyzeBlockedPage(html, GOOGLE_BLOCKED_OPTIONS);
      if (pageState.blocked) return { results: [], error: { kind: 'blocked' } };

      const results = parseGoogleResults(html, limit);
      // Non-blocked page with zero results: Google served its JS-only interstitial
      // (a bare shell with no .g blocks, no <h3>s, and a <noscript> refresh to
      // /httpservice/retry/enablejs or a "trouble accessing Google Search" div).
      // Empty here is not a legit "no results" — report blocked so the UI
      // surfaces the blocked-by-anti-bot diagnostic instead of a silent zero-result success.
      if (results.length === 0 && isJsOnlyInterstitial(html)) {
        return { results: [], error: { kind: 'blocked' } };
      }
      return { results };
    } catch (e) {
      return { results: [], error: { kind: classifyError(e) } };
    }
  },
};

// True when the page is Google's JS-only anti-bot shell: zero result markup
// (<h3> is a reliable zero-false-positive signal across SERP variants) plus
// either the enablejs <noscript> redirect or the "trouble accessing Google
// Search" fallback div. If there IS result markup (an <h3> we failed to parse),
// treat it as a legit page, not a block.
function isJsOnlyInterstitial(html: string): boolean {
  const lower = html.toLowerCase();
  if (lower.includes('<h3')) return false;
  if (lower.includes(GOOGLE_ENABLEJS_PATH)) return true;
  return lower.includes(`id="${GOOGLE_TROUBLE_DIV_ID}"`) || lower.includes(`id='${GOOGLE_TROUBLE_DIV_ID}'`);
}

function parseGoogleResults(html: string, limit: number): Result[] {
  const $ = cheerio.load(html);
  const results: Result[] = [];
  const seen = new Set<string>();
  $('#search div.g, div.g').each((_, el) => {
    if (results.length >= limit) return;
    const $el = $(el);
    const $a = $el.find('a').first();
    const $h3 = $el.find('h3').first();
    const title = $h3.text().trim() || $a.text().trim();
    const href = unwrapGoogleUrl($a.attr('href') ?? '');
    const snippet = $el.find('span, .st').not('h3 *').last().text().trim();
    if (!title || !href || !href.startsWith('http') || seen.has(href)) return;
    seen.add(href);
    results.push({ title, url: href, snippet, rank_in_source: results.length });
  });
  return results;
}

// Unwrap google's /url?q=<target> redirect wrapper (relative OR absolute host form).
// Returns the decoded target URL, or the original href if it's not a wrapper.
function unwrapGoogleUrl(href: string): string {
  // match both '/url?q=...' and 'https://www.google.com/url?q=...'
  const m = href.match(/[?&]q=([^&]+)/);
  if (m && /\/url(\?|$)/.test(href)) {
    try { const decoded = decodeURIComponent(m[1]); if (/^https?:\/\//.test(decoded)) return decoded; } catch { /* fall through */ }
  }
  return href;
}

// injection seam for offline tests (open-webSearch __setXxxHttpGetForTests pattern).
// The injected fn mirrors requestWithSafeRedirects's return shape so the test mock can
// stand in for the network call and we extract `.data` uniformly in both paths.
type GoogleHttpResponse = { status: number; headers: Record<string, string>; data: string };
let _googleHttpGet: ((url: string, ctx?: EngineCtx) => Promise<GoogleHttpResponse>) | undefined;
export function __setGoogleHttpGetForTests(fn: typeof _googleHttpGet) { _googleHttpGet = fn; }

async function googleHttpGet(url: string, ctx?: EngineCtx): Promise<GoogleHttpResponse> {
  if (_googleHttpGet) {
    return await _googleHttpGet(url, ctx);
  }
  return await requestWithSafeRedirects('GET', url, {
    trustedStaticHost: true, timeout: ctx?.timeoutMs, signal: ctx?.signal, headers: BROWSER_HEADERS,
  });
}
