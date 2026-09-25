import { describe, it, expect } from 'vitest';
import { analyzeBlockedPage } from './blocked.js';

describe('analyzeBlockedPage', () => {
  it('flags a captcha page with no results', () => {
    const r = analyzeBlockedPage('<html><title>请输入验证码</title><body></body></html>', {
      keywords: ['验证码', 'captcha'], captchaSelectors: ['iframe[src*="captcha"]', '#b_captcha'],
      resultSelector: '#b_results li.b_algo',
      titleHints: ['验证码', 'captcha'],
    });
    expect(r.blocked).toBe(true);
    expect(r.detectedKeywords).toContain('验证码');
    expect(r.hasResults).toBe(false);
  });

  it('does not flag a page that has results despite a suspicious keyword', () => {
    const html = `<html><body><div id="b_results"><li class="b_algo"><h2><a href="https://x.com">Title</a></h2></li></div></body></html>`;
    const r = analyzeBlockedPage(html, {
      keywords: ['rate limit'], captchaSelectors: [], resultSelector: '#b_results li.b_algo',
    });
    expect(r.blocked).toBe(false);
    expect(r.hasResults).toBe(true);
  });

  it('detects captcha-UI elements', () => {
    const r = analyzeBlockedPage('<html><body><form action="/validate"><input name="captcha"/></form></body></html>', {
      keywords: [], captchaSelectors: ['form[action*="validate"]', 'input[name*="captcha"]'], resultSelector: '#none',
    });
    expect(r.blocked).toBe(true);
  });
});
