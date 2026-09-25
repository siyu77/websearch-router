import { describe, it, expect, beforeEach } from 'vitest';
import { bingEngine, __setBingHttpGetForTests } from './index.js';

const NORMAL_HTML = `
<html><body><div id="b_results">
  <li class="b_algo"><h2><a href="https://example.com/a">Result One</a></h2><div class="b_caption"><p>Snippet one</p></div></li>
  <li class="b_algo"><h2><a href="/ck/a?...">Result Two</a></h2><div class="b_caption"><p>Snippet two</p></div></li>
</div></body></html>`;

const BLOCKED_HTML = `<html><title>请输入验证码</title><body></body></html>`;

function makeResponse(status: number, data: string) {
  return { status, headers: {}, data };
}

describe('bing engine', () => {
  beforeEach(() => { __setBingHttpGetForTests(undefined); });

  it('parses results and assigns rank_in_source', async () => {
    __setBingHttpGetForTests(async () => makeResponse(200, NORMAL_HTML));
    const r = await bingEngine.search('test', 5);
    expect(r.results.length).toBe(2);
    expect(r.results[0].title).toBe('Result One');
    expect(r.results[0].rank_in_source).toBe(0);
    expect(r.results[1].rank_in_source).toBe(1);
    expect(r.results[0].snippet).toBe('Snippet one');
  });

  it('returns ErrorKind.blocked on a captcha page', async () => {
    __setBingHttpGetForTests(async () => makeResponse(200, BLOCKED_HTML));
    const r = await bingEngine.search('test', 5);
    expect(r.error?.kind).toBe('blocked');
    expect(r.results.length).toBe(0);
  });

  it('decodes /ck/a redirect URLs', async () => {
    const realTarget = 'https://real-target.example.com/page';
    const encoded = `a1${Buffer.from(realTarget).toString('base64url')}`;
    const html = `<html><body><div id="b_results"><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=${encoded}">T</a></h2></li></div></body></html>`;
    __setBingHttpGetForTests(async () => makeResponse(200, html));
    const r = await bingEngine.search('test', 5);
    expect(r.results[0].url).toBe(realTarget);
  });
});
