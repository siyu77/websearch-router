import * as cheerio from 'cheerio';

export interface BlockedPageOptions {
  keywords: string[];
  captchaSelectors: string[];
  resultSelector: string;   // engine-specific results container selector
  titleHints?: string[];
}

export interface BlockedPageState {
  blocked: boolean;
  hasResults: boolean;
  detectedKeywords: string[];
  title: string;
  hasCaptchaUi: boolean;
}

export function analyzeBlockedPage(html: string, opts: BlockedPageOptions): BlockedPageState {
  const $ = cheerio.load(html);
  const normalized = html.toLowerCase();
  const title = $('title').first().text().trim();

  const detectedKeywords = opts.keywords.filter((k) => normalized.includes(k.toLowerCase()));
  const hasCaptchaUi = opts.captchaSelectors.some((sel) => $(sel).length > 0);
  const hasStrongTitle = (opts.titleHints ?? []).some((h) => title.toLowerCase().includes(h.toLowerCase()));
  const hasResults = $(opts.resultSelector).length > 0;

  // Blocked only when no real results AND (captcha UI OR strong title OR ≥2 keyword hits).
  const blocked = !hasResults && (hasCaptchaUi || hasStrongTitle || detectedKeywords.length >= 2);

  return { blocked, hasResults, detectedKeywords, title, hasCaptchaUi };
}
