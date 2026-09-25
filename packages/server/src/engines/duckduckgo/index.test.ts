import { describe, it, expect, beforeEach } from 'vitest';
import { ddgEngine, __setDdgHttpGetForTests } from './index.js';

// Home page fixture whose FIRST `link[rel="preload"]` is a font (the collision
// case from the live page) but that also carries #deep_preload_script src=d.js.
const JSONP_HTML = `<html><head>
  <link rel="preload" href="/font/DuckSansProduct-Regular.woff2" as="font">
  <script id="deep_preload_script" src="https://links.duckduckgo.com/d.js?q=test&s=0&vqd=abc"></script>
</head><body></body></html>`;
const JSONP_DATA = `DDG.pageLayout.load('d', [{"u":"https://ex.com/1","t":"Result One","a":"Snippet one","i":"ex"},{"u":"https://ex.com/2","t":"Result Two","a":"Snippet two"}]);`;
const JSONP_DATA_HTML_SNIPPET = `DDG.pageLayout.load('d', [{"u":"https://ex.com/1","t":"Result One","a":"<b>Claude</b> is <b>Anthropic&#x27;s</b> AI &amp; more"},{"u":"https://ex.com/2","t":"Result Two","a":"Plain text"}]);`;
const HTML_FALLBACK = `<html><body>
  <div class="result"><a class="result__a" href="https://ex.com/1">Result One</a><a class="result__snippet">Snippet one</a></div>
</body></html>`;
const ANOMALY_HTML = `<html><body>
  <div data-testid="anomaly-modal">Unfortunately, bots use DuckDuckGo too. Verify you are human.</div>
  <form id="challenge-form"></form>
</body></html>`;

function makeResponse(status: number, data: string, headers: Record<string,string> = {}) {
  return { status, headers, data };
}

describe('ddg engine', () => {
  beforeEach(() => { __setDdgHttpGetForTests(undefined); });

  it('extracts JSONP preload results, picking #deep_preload_script (not the font preload)', async () => {
    let call = 0;
    __setDdgHttpGetForTests(async (url: string) => {
      call++;
      if (call === 1) return makeResponse(200, JSONP_HTML, { location: 'https://links.duckduckgo.com/d.js' });
      // call 2 is the d.js data fetch — must be the d.js URL, never the font.
      expect(url).toContain('links.duckduckgo.com/d.js');
      expect(url).not.toContain('DuckSansProduct');
      return makeResponse(200, JSONP_DATA);
    });
    const r = await ddgEngine.search('test', 5);
    expect(r.results.length).toBe(2);
    expect(r.results[0].title).toBe('Result One');
    expect(r.results[0].snippet).toBe('Snippet one');
    expect(r.results[0].rank_in_source).toBe(0);
  });

  it('strips HTML + decodes entities from JSONP snippet (a field carries markup)', async () => {
    let call = 0;
    __setDdgHttpGetForTests(async () => {
      call++;
      if (call === 1) return makeResponse(200, JSONP_HTML);
      return makeResponse(200, JSONP_DATA_HTML_SNIPPET);
    });
    const r = await ddgEngine.search('test', 5);
    expect(r.results[0].snippet).toBe("Claude is Anthropic's AI & more");
    expect(r.results[1].snippet).toBe('Plain text');
  });

  it('falls back to HTML when JSONP is unavailable', async () => {
    let call = 0;
    __setDdgHttpGetForTests(async () => {
      call++;
      if (call === 1) return makeResponse(200, '<html></html>'); // no preload link
      return makeResponse(200, HTML_FALLBACK);
    });
    const r = await ddgEngine.search('test', 5);
    expect(r.results.length).toBe(1);
    expect(r.results[0].title).toBe('Result One');
  });

  it('#2: the HTML fallback issues a GET with the query in the URL (no POST body)', async () => {
    let call = 0;
    const seen: string[] = [];
    __setDdgHttpGetForTests(async (url: string) => {
      call++;
      seen.push(url);
      if (call === 1) return makeResponse(200, '<html></html>'); // home page, no preload
      return makeResponse(200, HTML_FALLBACK);
    });
    await ddgEngine.search('test', 5);
    // The fallback call (call 2) is a GET to html.duckduckgo.com/html/?q=test.
    const fallback = seen[1];
    expect(fallback).toContain('html.duckduckgo.com/html/');
    expect(fallback).toContain('q=test');
  });

  it('decodes the uddg redirect wrapper from a.result__a hrefs', async () => {
    let call = 0;
    const html = `<html><body><div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FX&rut=abc">Result One</a>
      <a class="result__snippet">Snippet one</a>
    </div></body></html>`;
    __setDdgHttpGetForTests(async () => {
      call++;
      if (call === 1) return makeResponse(200, '<html></html>'); // no preload -> JSONP empty
      return makeResponse(200, html);
    });
    const r = await ddgEngine.search('test', 5);
    expect(r.results.length).toBe(1);
    expect(r.results[0].url).toBe('https://en.wikipedia.org/wiki/X');
  });

  it('returns ErrorKind.blocked on the anomaly/CAPTCHA page', async () => {
    let call = 0;
    __setDdgHttpGetForTests(async () => {
      call++;
      if (call === 1) return makeResponse(200, '<html></html>'); // JSONP empty
      return makeResponse(200, ANOMALY_HTML); // HTML fallback served the anomaly page
    });
    const r = await ddgEngine.search('test', 5);
    expect(r.results.length).toBe(0);
    expect(r.error?.kind).toBe('blocked');
  });
});
