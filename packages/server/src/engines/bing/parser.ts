import * as cheerio from 'cheerio';
import type { Result } from '../../shared/types.js';

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source'];

function decodeBingRedirectTarget(url: URL): string {
  const encodedTarget = url.searchParams.get('u')?.trim();
  if (!encodedTarget) return '';
  const base64Payload = encodedTarget.startsWith('a1') ? encodedTarget.slice(2) : encodedTarget;
  try {
    const decoded = Buffer.from(base64Payload, 'base64url').toString('utf8').trim();
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) return decoded;
  } catch { return ''; }
  return '';
}

function sanitizeBingUrl(rawUrl: string): string {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return rawUrl; }
  // /ck/a redirect: decode the real target from `u` param
  if (u.hostname.endsWith('bing.com') && u.pathname.startsWith('/ck/a')) {
    const decoded = decodeBingRedirectTarget(u);
    return decoded ? sanitizeBingUrl(decoded) : '';
  }
  // Bing internal search/redirect links with no usable target
  if (u.hostname.endsWith('bing.com') && (u.pathname.startsWith('/search') || u.pathname.startsWith('/newtabredir'))) {
    return '';
  }
  for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
  u.hash = '';
  return u.toString();
}

export function parseBingSearchResults(html: string, limit: number): Result[] {
  const $ = cheerio.load(html);
  const results: Result[] = [];
  const seen = new Set<string>();

  $('#b_results li.b_algo, #b_results li.b_ans, .b_algo, .b_ans').each((_, el) => {
    if (results.length >= limit) return;
    const $el = $(el);
    // skip ads / pagination / messages
    if ($el.hasClass('b_ad') || $el.hasClass('b_pag') || $el.hasClass('b_msg')) return;

    const $a = $el.find('h2 a, .b_title a, a.tilk, a[target="_blank"]').first();
    const title = $a.text().trim();
    let href = $a.attr('href') ?? '';
    href = sanitizeBingUrl(href);
    if (!title || !href) return;

    const snippet = $el.find('.b_caption p, .b_snippet, .b_lineclamp2, .b_lineclamp3').first().text().trim();
    const url = href;
    if (seen.has(url)) return;
    seen.add(url);
    results.push({ title, url, snippet, rank_in_source: results.length });
  });

  // fallback: collect any links if parser found nothing
  if (results.length === 0) {
    $('#b_results a[href]').each((_, el) => {
      if (results.length >= limit) return;
      const href = sanitizeBingUrl($(el).attr('href') ?? '');
      const title = $(el).text().trim();
      if (!href || !title || seen.has(href)) return;
      seen.add(href);
      results.push({ title, url: href, snippet: '', rank_in_source: results.length });
    });
  }

  return results;
}