import type { BlockedPageOptions } from '../blocked.js';

export const BING_BLOCKED_KEYWORDS: string[] = [
  'captcha', 'verification', 'verify you are human', 'access denied',
  'blocked', 'rate limit', 'too many requests', '请验证', 'please verify', '验证码', 'verification code', '人机验证', 'human verification',
];

export const BING_BLOCKED_TITLE_HINTS: string[] = ['验证', 'verification', 'verify'];

export const BING_CAPTCHA_SELECTORS: string[] = [
  'iframe[src*="captcha"]', '[id*="captcha"]', '[class*="captcha"]',
  'form[action*="validate"]', 'input[name*="captcha"]', '#b_captcha', '.b_captcha',
];

export const BING_BLOCKED_OPTIONS: BlockedPageOptions = {
  keywords: BING_BLOCKED_KEYWORDS,
  captchaSelectors: BING_CAPTCHA_SELECTORS,
  resultSelector: '#b_results li.b_algo',
  titleHints: BING_BLOCKED_TITLE_HINTS,
};