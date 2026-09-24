import type { BlockedPageOptions } from '../blocked.js';

export const GOOGLE_BLOCKED_KEYWORDS: string[] = [
  'captcha', 'unusual traffic', 'verify you are human', '验证码', 'verification code', '人机验证', 'human verification',
  'detected unusual traffic', 'automated queries',
];

export const GOOGLE_BLOCKED_TITLE_HINTS: string[] = ['验证', 'verification', 'sorry', 'captcha'];

export const GOOGLE_CAPTCHA_SELECTORS: string[] = [
  'iframe[src*="captcha"]', 'form[action*="captcha"]', 'input[name*="captcha"]',
  '#captcha', '.g-recaptcha', '#recaptcha',
  // recaptcha/enterprise challenge form (429 anti-bot body, id=captcha-form)
  '#captcha-form',
];

// JS-only interstitial signals. Google now serves a JS shell (title "Google
// Search", zero .g result blocks, a <noscript> refresh to /httpservice/retry/enablejs,
// or a "trouble accessing Google Search" fallback div) to non-browser clients
// instead of a captcha — historically this read as a silent zero-result success.
// Detect it so we report ErrorKind.blocked and the UI reports the engine as blocked by anti-bot.
export const GOOGLE_ENABLEJS_PATH = '/httpservice/retry/enablejs';
export const GOOGLE_TROUBLE_DIV_ID = 'yvlrue';

export const GOOGLE_BLOCKED_OPTIONS: BlockedPageOptions = {
  keywords: GOOGLE_BLOCKED_KEYWORDS,
  captchaSelectors: GOOGLE_CAPTCHA_SELECTORS,
  resultSelector: '#search div.g',
  titleHints: GOOGLE_BLOCKED_TITLE_HINTS,
};