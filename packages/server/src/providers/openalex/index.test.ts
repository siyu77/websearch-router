import { describe, it, expect, beforeEach } from 'vitest';
import { openalexAdapter, abstractFromInvertedIndex, __setOpenalexHttpForTests } from './index.js';

const work = {
  display_name: 'Attention Is All You Need',
  doi: 'https://doi.org/10.5555/3295222',
  id: 'https://openalex.org/W2963403886',
  publication_year: 2017,
  primary_location: { source: { display_name: 'NeurIPS' } },
  abstract_inverted_index: { 'The': [0], 'Transformer': [1], 'wins': [2] },
};

function ok(data: unknown) {
  return { status: 200, headers: {}, data: JSON.stringify(data) };
}

describe('openalex adapter', () => {
  beforeEach(() => { __setOpenalexHttpForTests(undefined); });

  it('parses works with reconstructed abstract snippet, no score', async () => {
    __setOpenalexHttpForTests(async () => ok({ results: [work] }));
    const r = await openalexAdapter.search({ data: { apiKey: 'oa-x' } }, 'transformer', 5);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].title).toBe('Attention Is All You Need');
    expect(r.results[0].url).toBe('https://doi.org/10.5555/3295222');
    expect(r.results[0].snippet).toBe('The Transformer wins');
    expect(r.results[0].rank_in_source).toBe(0);
    expect(r.results[0].score).toBeUndefined();
    expect(r.quota).toEqual({ exhausted: false });
  });

  it('reconstructs the inverted index in position order, not key order', () => {
    // key order would give "wins The Transformer"; positions give "The Transformer wins"
    expect(abstractFromInvertedIndex({ 'wins': [2], 'The': [0], 'Transformer': [1] })).toBe('The Transformer wins');
  });

  it('falls back to year/venue metadata when no abstract', async () => {
    __setOpenalexHttpForTests(async () => ok({ results: [{ display_name: 'T1', publication_year: 2020, primary_location: { source: { display_name: 'Nature' } } }] }));
    const r = await openalexAdapter.search({ data: { apiKey: 'oa-x' } }, 'q', 5);
    expect(r.results[0].snippet).toBe('Year: 2020. Venue: Nature');
  });

  it('uses the record id as url when doi is missing', async () => {
    __setOpenalexHttpForTests(async () => ok({ results: [{ display_name: 'T1', id: 'https://openalex.org/W1' }] }));
    const r = await openalexAdapter.search({ data: { apiKey: 'oa-x' } }, 'q', 5);
    expect(r.results[0].url).toBe('https://openalex.org/W1');
  });

  it('sends the api_key query param and caps per-page at 200', async () => {
    const urls: string[] = [];
    __setOpenalexHttpForTests(async (url) => { urls.push(url); return ok({ results: [] }); });
    await openalexAdapter.search({ data: { apiKey: 'oa-secret' } }, 'q', 500);
    await openalexAdapter.search({ data: { apiKey: 'oa-secret' } }, 'q', 3);
    expect(urls[0]).toContain('api_key=oa-secret');
    expect(urls[0]).toContain('per-page=200');
    expect(urls[1]).toContain('per-page=3');
  });

  it('maps 401/403 -> auth', async () => {
    __setOpenalexHttpForTests(async () => ({ status: 403, headers: {}, data: '{"error":"bad key"}' }));
    const r = await openalexAdapter.search({ data: { apiKey: 'bad' } }, 'q', 5);
    expect(r.error?.kind).toBe('auth');
  });

  it('maps 429 -> ratelimit with retryAfter from the body (daily reset)', async () => {
    __setOpenalexHttpForTests(async () => ({
      status: 429, headers: {},
      data: JSON.stringify({ error: 'Rate limit exceeded', retryAfter: 49169, dailyRemainingUsd: 0 }),
    }));
    const r = await openalexAdapter.search({ data: { apiKey: 'oa-x' } }, 'q', 5);
    expect(r.error?.kind).toBe('ratelimit');
    expect(r.error?.resetAt).toBeTypeOf('number');
    expect(r.error?.resetAt as number).toBeGreaterThan(Date.now());
    // capped at the shared 5min BACKOFF ceiling even for a ~14h retryAfter
    expect(r.error?.resetAt as number).toBeLessThanOrEqual(Date.now() + 301_000);
  });

  it('maps 5xx -> transient, other non-2xx -> unknown', async () => {
    __setOpenalexHttpForTests(async () => ({ status: 502, headers: {}, data: '' }));
    expect((await openalexAdapter.search({ data: { apiKey: 'oa-x' } }, 'q', 5)).error?.kind).toBe('transient');
    __setOpenalexHttpForTests(async () => ({ status: 400, headers: {}, data: '' }));
    expect((await openalexAdapter.search({ data: { apiKey: 'oa-x' } }, 'q', 5)).error?.kind).toBe('unknown');
  });

  it('unwraps a thrown AxiosError response so error statuses still map (real-HTTP path)', async () => {
    // requestWithSafeRedirects validates 2xx/3xx only — a live 429 arrives as a
    // thrown AxiosError carrying .response; the openalexHttp wrapper must unwrap it.
    __setOpenalexHttpForTests(async () => {
      const err: any = new Error('Request failed with status code 429');
      err.response = { status: 429, headers: {}, data: JSON.stringify({ retryAfter: 60 }) };
      throw err;
    });
    const r = await openalexAdapter.search({ data: { apiKey: 'oa-x' } }, 'q', 5);
    expect(r.error?.kind).toBe('ratelimit');
    expect(r.error?.resetAt).toBeTypeOf('number');
  });
});
