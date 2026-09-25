import { describe, it, expect, beforeEach } from 'vitest';
import { semanticScholarAdapter, __setS2HttpForTests } from './index.js';

const paper = {
  title: 'Attention Is All You Need',
  abstract: 'The dominant sequence transduction models are based on recurrent networks.  We propose the Transformer.',
  url: 'https://www.semanticscholar.org/paper/1',
  externalIds: { DOI: '10.5555/3295222' },
  year: 2017,
  authors: [{ name: 'Vaswani' }, { name: 'Shazeer' }],
};

describe('semantic scholar adapter', () => {
  beforeEach(() => { __setS2HttpForTests(undefined); });

  it('parses results with abstract snippet, no score', async () => {
    __setS2HttpForTests(async () => ({
      status: 200,
      headers: {},
      data: JSON.stringify({ data: [paper, { title: 'T2', externalIds: { DOI: '10.1/x' } }] }),
    }));
    const r = await semanticScholarAdapter.search({ data: { apiKey: 's2-x' } }, 'transformer', 5);
    expect(r.results).toHaveLength(2);
    expect(r.results[0].title).toBe('Attention Is All You Need');
    expect(r.results[0].url).toBe('https://www.semanticscholar.org/paper/1');
    expect(r.results[0].snippet).toContain('Transformer');
    expect(r.results[0].snippet.length).toBeLessThanOrEqual(301);
    expect(r.results[0].rank_in_source).toBe(0);
    expect(r.results[0].score).toBeUndefined();
    expect(r.quota).toEqual({ exhausted: false });
  });

  it('falls back to DOI url when record has no url field', async () => {
    __setS2HttpForTests(async () => ({
      status: 200,
      headers: {},
      data: JSON.stringify({ data: [{ title: 'T1', externalIds: { DOI: '10.1/y' } }] }),
    }));
    const r = await semanticScholarAdapter.search({ data: { apiKey: 's2-x' } }, 'q', 5);
    expect(r.results[0].url).toBe('https://doi.org/10.1/y');
  });

  it('falls back to authors/year metadata snippet when abstract is missing', async () => {
    __setS2HttpForTests(async () => ({
      status: 200,
      headers: {},
      data: JSON.stringify({ data: [{ title: 'T1', year: 2020, authors: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] }] }),
    }));
    const r = await semanticScholarAdapter.search({ data: { apiKey: 's2-x' } }, 'q', 5);
    expect(r.results[0].snippet).toBe('Authors: A, B, C. Year: 2020');
  });

  it('requests the paper/search fields needed for snippets and urls', async () => {
    let sentUrl = '';
    __setS2HttpForTests(async (_apiKey, url) => { sentUrl = url; return { status: 200, headers: {}, data: '{"data":[]}' }; });
    await semanticScholarAdapter.search({ data: { apiKey: 's2-x' } }, 'q', 5);
    expect(sentUrl).toContain('/graph/v1/paper/search?query=');
    expect(sentUrl).toContain('fields=title,abstract,url,externalIds,year,authors');
  });

  it('caps limit at 100 (S2 hard max) and passes smaller limits through', async () => {
    const urls: string[] = [];
    __setS2HttpForTests(async (_apiKey, url) => { urls.push(url); return { status: 200, headers: {}, data: '{"data":[]}' }; });
    await semanticScholarAdapter.search({ data: { apiKey: 's2-x' } }, 'q', 200);
    await semanticScholarAdapter.search({ data: { apiKey: 's2-x' } }, 'q', 3);
    expect(urls[0]).toContain('limit=100');
    expect(urls[1]).toContain('limit=3');
  });

  it('maps 401 -> auth', async () => {
    __setS2HttpForTests(async () => ({ status: 401, headers: {}, data: '{}' }));
    const r = await semanticScholarAdapter.search({ data: { apiKey: 'bad' } }, 'q', 5);
    expect(r.error?.kind).toBe('auth');
  });

  it('maps 404 (malformed key per S2 docs) -> auth', async () => {
    __setS2HttpForTests(async () => ({ status: 404, headers: {}, data: '{}' }));
    const r = await semanticScholarAdapter.search({ data: { apiKey: 'malformed' } }, 'q', 5);
    expect(r.error?.kind).toBe('auth');
  });

  it('maps 429 -> ratelimit with Retry-After resetAt', async () => {
    __setS2HttpForTests(async () => ({ status: 429, headers: { 'retry-after': '60' }, data: '{}' }));
    const r = await semanticScholarAdapter.search({ data: { apiKey: 's2-x' } }, 'q', 5);
    expect(r.error?.kind).toBe('ratelimit');
    expect(r.error?.resetAt).toBeTypeOf('number');
    expect(r.error?.resetAt as number).toBeGreaterThan(0);
  });

  it('maps 5xx -> transient', async () => {
    __setS2HttpForTests(async () => ({ status: 503, headers: {}, data: '{}' }));
    const r = await semanticScholarAdapter.search({ data: { apiKey: 's2-x' } }, 'q', 5);
    expect(r.error?.kind).toBe('transient');
  });

  it('maps other statuses -> unknown', async () => {
    __setS2HttpForTests(async () => ({ status: 400, headers: {}, data: '{"error":"bad query"}' }));
    const r = await semanticScholarAdapter.search({ data: { apiKey: 's2-x' } }, 'q', 5);
    expect(r.error?.kind).toBe('unknown');
  });

  it('unwraps a thrown AxiosError response so error statuses still map (real-HTTP path)', async () => {
    // requestWithSafeRedirects validates 2xx/3xx only — a live 429 arrives as a
    // thrown AxiosError carrying .response; the s2Http wrapper must unwrap it.
    __setS2HttpForTests(async () => {
      const err: any = new Error('Request failed with status code 429');
      err.response = { status: 429, headers: { 'retry-after': '30' }, data: '{"message":"Too Many Requests"}' };
      throw err;
    });
    const r = await semanticScholarAdapter.search({ data: { apiKey: 's2-x' } }, 'q', 5);
    expect(r.error?.kind).toBe('ratelimit');
    expect(r.error?.resetAt).toBeTypeOf('number');
  });
});
