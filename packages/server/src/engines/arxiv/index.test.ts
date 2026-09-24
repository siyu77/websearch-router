import { describe, it, expect, beforeEach } from 'vitest';
import { arxivEngine, parseAtom, __setArxivHttpForTests } from './index.js';

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <title>  Attention Is
    All You Need </title>
    <summary>  The dominant sequence transduction models are based on
    recurrent networks. We propose the Transformer.  </summary>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2005.14165v4</id>
    <title>GPT-3</title>
    <summary></summary>
  </entry>
</feed>`;

function ok(data: string) {
  return { status: 200, headers: {}, data };
}

describe('arxiv engine', () => {
  beforeEach(() => { __setArxivHttpForTests(undefined); });

  it('parses atom entries with normalized whitespace', async () => {
    __setArxivHttpForTests(async () => ok(ATOM));
    const r = await arxivEngine.search('transformer', 5);
    expect(r.results).toHaveLength(2);
    expect(r.results[0].title).toBe('Attention Is All You Need');
    expect(r.results[0].url).toBe('http://arxiv.org/abs/1706.03762v7');
    expect(r.results[0].snippet).toContain('We propose the Transformer.');
    expect(r.results[0].rank_in_source).toBe(0);
    expect(r.results[1].snippet).toBe('');
    expect(r.error).toBeUndefined();
  });

  it('trims long summaries to a bounded length', () => {
    const long = parseAtom(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>u</id><title>t</title><summary>${'x'.repeat(600)}</summary></entry></feed>`);
    expect(long[0].snippet.length).toBeLessThanOrEqual(301);
    expect(long[0].snippet.endsWith('…')).toBe(true);
  });

  it('caps max_results at 2000 and passes smaller limits through', async () => {
    const urls: string[] = [];
    __setArxivHttpForTests(async (url) => { urls.push(url); return ok('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'); });
    await arxivEngine.search('q', 5000);
    await arxivEngine.search('q', 3);
    expect(urls[0]).toContain('max_results=2000');
    expect(urls[1]).toContain('max_results=3');
    expect(urls[0]).toContain('search_query=all%3Aq');
  });

  it('maps 429 -> ratelimit, 5xx -> transient, other -> unknown', async () => {
    __setArxivHttpForTests(async () => ({ status: 429, headers: {}, data: '' }));
    expect((await arxivEngine.search('q', 5)).error?.kind).toBe('ratelimit');
    __setArxivHttpForTests(async () => ({ status: 503, headers: {}, data: '' }));
    expect((await arxivEngine.search('q', 5)).error?.kind).toBe('transient');
    __setArxivHttpForTests(async () => ({ status: 400, headers: {}, data: '' }));
    expect((await arxivEngine.search('q', 5)).error?.kind).toBe('unknown');
  });

  it('classifies thrown network errors via classifyError', async () => {
    __setArxivHttpForTests(async () => { throw new Error('econnrefused'); });
    const r = await arxivEngine.search('q', 5);
    expect(r.error?.kind).toBe('transient');
  });
});
