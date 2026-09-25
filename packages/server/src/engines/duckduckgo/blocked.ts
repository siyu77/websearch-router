import type { BlockedPageOptions } from '../blocked.js';

// DuckDuckGo anti-bot surfaces the "anomaly" challenge: a "select all squares
// containing a duck" image puzzle on an "Unfortunately, bots use DuckDuckGo
// too" page. Both the JSONP home page and the HTML fallback can be served this
// 202 page under load, so we detect it and report ErrorKind.blocked instead
// of a silent zero-result success.
export const DDG_BLOCKED_KEYWORDS: string[] = [
  'anomaly', 'captcha', 'verify you are human',
  'Unfortunately, bots use DuckDuckGo',
];

export const DDG_CAPTCHA_SELECTORS: string[] = [
  '#challenge-form', '[data-testid="anomaly-modal"]', '.anomaly-modal',
];

export const DDG_BLOCKED_OPTIONS: BlockedPageOptions = {
  keywords: DDG_BLOCKED_KEYWORDS,
  captchaSelectors: DDG_CAPTCHA_SELECTORS,
  resultSelector: 'a.result__a',
  titleHints: [],
};
