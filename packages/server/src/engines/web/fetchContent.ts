import * as cheerio from 'cheerio';
import { requestWithSafeRedirects, BROWSER_HEADERS } from '../http.js';
import type { EngineCtx } from '../../shared/types.js';

export interface HtmlExtractionResult { title: string; text: string; mode: 'container' | 'body' | 'metadata' }

const DEFAULT_MAX_CHARS = 30_000;
// Cap on the raw response body for general page fetches (#13); oversized pages
// surface as a 400 bad_request instead of being slurped into memory. The github
// raw path stays uncapped — those are our own files, small and trusted.
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function extractMainTextFromHtml(html: string): HtmlExtractionResult {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.trim()
    || $('meta[property="og:description"]').attr('content')?.trim() || '';

  $('script, style, noscript, template, iframe, svg, canvas').remove();

  // csdn-specific container first
  const csdnArticle = $('#content_views').first();
  if (csdnArticle.length > 0) {
    const candidate = normalizeText(csdnArticle.text());
    if (candidate.length >= 120) return { title, text: candidate, mode: 'container' };
  }

  const preferredContainers = [
    'article', 'main', '[role="main"]', '.markdown-body', '.article-content',
    '.post-content', '.entry-content', '.content',
  ];

  let selectedText = '';
  let mode: HtmlExtractionResult['mode'] = 'metadata';
  for (const selector of preferredContainers) {
    const container = $(selector).first();
    if (container.length === 0) continue;
    const candidate = normalizeText(container.text());
    if (candidate.length >= 120) { selectedText = candidate; mode = 'container'; break; }
  }

  if (!selectedText) {
    const body = $('body');
    selectedText = body.length > 0 ? normalizeText(body.text()) : normalizeText($.root().text());
    if (selectedText) mode = 'body';
  }
  if (!selectedText) {
    selectedText = normalizeText([title, metaDescription].filter(Boolean).join('\n\n'));
    mode = 'metadata';
  }
  return { title, text: selectedText, mode };
}

export async function fetchContent(
  url: string,
  maxChars = DEFAULT_MAX_CHARS,
  ctx?: EngineCtx,
): Promise<HtmlExtractionResult> {
  // github README: fetch raw markdown
  const ghMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/|$)/);
  if (ghMatch) {
    const [owner, repo] = ghMatch.slice(1);
    const candidates = ['README.md', 'readme.md', 'README.markdown', 'README.MD'];
    for (const file of candidates) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${file}`;
        const res = await requestWithSafeRedirects('GET', rawUrl, { trustedStaticHost: true, timeout: ctx?.timeoutMs, headers: BROWSER_HEADERS, validateStatus: (s: number) => s === 200 || s === 404 });
        if (res.status === 200) return { title: `${owner}/${repo} README`, text: res.data.slice(0, maxChars), mode: 'container' };
      } catch { /* try next candidate */ }
    }
  }

  const res = await requestWithSafeRedirects('GET', url, { trustedStaticHost: false, timeout: ctx?.timeoutMs, headers: BROWSER_HEADERS, maxBodyBytes: MAX_BODY_BYTES });
  const extracted = extractMainTextFromHtml(res.data);
  return { ...extracted, text: extracted.text.slice(0, maxChars) };
}