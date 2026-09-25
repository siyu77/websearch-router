import { describe, it, expect, beforeEach } from 'vitest';
import { googleEngine, __setGoogleHttpGetForTests } from './index.js';

const NORMAL_HTML = `<html><body><div id="search">
  <div class="g"><div><a href="https://example.com/a"><h3>Result One</h3></a><div><span>Snippet one</span></div></div></div>
  <div class="g"><div><a href="https://example.com/b"><h3>Result Two</h3></a><div><span>Snippet two</span></div></div></div>
  <div class="g"><div><a href="/url?q=https%3A%2F%2Fexample.com%2Fc&sa=U"><h3>Result Three</h3></a><div><span>Snippet three</span></div></div></div>
</div></body></html>`;

const CAPTCHA_HTML = `<html><title>验证码</title><body><form action="/validate"><input name="captcha"/></form></body></html>`;

// The JS-only interstitial Google serves to non-browser clients: bare shell,
// zero result markup, <noscript> refresh to the enablejs retry path.
const JS_INTERSTITIAL_HTML = `<!DOCTYPE html><html lang="en"><head><title>Google Search</title></head><body>
<noscript><meta content="0;url=/httpservice/retry/enablejs?sei=abc" http-equiv="refresh"></noscript>
<script nonce="abc">window.google = window.google || {};</script>
</body></html>`;

// Variant with the "trouble accessing Google Search" fallback div instead of enablejs.
const JS_INTERSTITIAL_TROUBLE_HTML = `<!DOCTYPE html><html lang="en"><head><title>Google Search</title></head><body>
<script nonce="x"></script>
<style>div{font-family:sans-serif}</style>
<div id="yvlrue" style="display:none">If you're having trouble accessing Google Search, please <a href="/search?q=x&amp;gbv=1">click here</a>.</div>
</body></html>`;

function makeResponse(status: number, data: string) { return { status, headers: {}, data }; }

describe('google engine', () => {
  beforeEach(() => { __setGoogleHttpGetForTests(undefined); });

  it('parses .g result blocks and unwraps /url?q= redirects', async () => {
    __setGoogleHttpGetForTests(async () => makeResponse(200, NORMAL_HTML));
    const r = await googleEngine.search('test', 5);
    expect(r.results.length).toBe(3);
    expect(r.results[0].title).toBe('Result One');
    expect(r.results[0].rank_in_source).toBe(0);
    // the third result's href is a /url?q= wrapper — must decode to the real target
    expect(r.results[2].url).toBe('https://example.com/c');
  });

  it('returns blocked on captcha page (known anti-bot risk)', async () => {
    __setGoogleHttpGetForTests(async () => makeResponse(200, CAPTCHA_HTML));
    const r = await googleEngine.search('test', 5);
    expect(r.error?.kind).toBe('blocked');
    expect(r.results.length).toBe(0);
  });

  it('returns blocked (not silent zero-result) on the JS-only interstitial', async () => {
    __setGoogleHttpGetForTests(async () => makeResponse(200, JS_INTERSTITIAL_HTML));
    const r = await googleEngine.search('test', 5);
    expect(r.error?.kind).toBe('blocked');
    expect(r.results.length).toBe(0);
  });

  it('detects the trouble-accessing-Google interstitial variant', async () => {
    __setGoogleHttpGetForTests(async () => makeResponse(200, JS_INTERSTITIAL_TROUBLE_HTML));
    const r = await googleEngine.search('test', 5);
    expect(r.error?.kind).toBe('blocked');
    expect(r.results.length).toBe(0);
  });

  it('returns blocked on the 429 anti-bot response', async () => {
    __setGoogleHttpGetForTests(async () => makeResponse(429, '<html>unusual traffic</html>'));
    const r = await googleEngine.search('test', 5);
    expect(r.error?.kind).toBe('blocked');
    expect(r.results.length).toBe(0);
  });

  it('treats a genuinely empty (no interstitial) page as zero results', async () => {
    __setGoogleHttpGetForTests(async () => makeResponse(200, '<html><title>Google Search</title><body></body></html>'));
    const r = await googleEngine.search('test', 5);
    expect(r.error).toBeUndefined();
    expect(r.results.length).toBe(0);
  });
});
