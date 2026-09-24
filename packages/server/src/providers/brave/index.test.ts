import { describe, it, expect, beforeEach } from 'vitest';
import { braveAdapter, __setBraveHttpForTests } from './index.js';

describe('brave adapter', () => {
  beforeEach(() => { __setBraveHttpForTests(undefined); });

  it('parses web.results, quota from X-RateLimit-* headers, no score', async () => {
    __setBraveHttpForTests(async () => ({
      status: 200,
      headers: { 'x-ratelimit-remaining': '8' },
      data: JSON.stringify({ web: { results: [{ title: 'T1', url: 'https://ex.com/1', description: 'Snip 1' }] } }),
    }));
    const r = await braveAdapter.search({ data: { apiKey: 'key' } }, 'q', 5);
    expect(r.results[0].title).toBe('T1');
    expect(r.results[0].url).toBe('https://ex.com/1');
    expect(r.results[0].snippet).toBe('Snip 1');
    expect(r.results[0].rank_in_source).toBe(0);
    expect(r.results[0].score).toBeUndefined();
    expect(r.quota?.remaining).toBe(8);
  });

  it('maps 402 -> quota', async () => {
    __setBraveHttpForTests(async () => ({ status: 402, headers: {}, data: '{}' }));
    const r = await braveAdapter.search({ data: { apiKey: 'key' } }, 'q', 5);
    expect(r.error?.kind).toBe('quota');
  });

  it('maps 429 -> ratelimit', async () => {
    __setBraveHttpForTests(async () => ({ status: 429, headers: { 'retry-after': '30' }, data: '{}' }));
    const r = await braveAdapter.search({ data: { apiKey: 'key' } }, 'q', 5);
    expect(r.error?.kind).toBe('ratelimit');
    expect(r.error?.resetAt).toBeTypeOf('number');
    expect(r.error?.resetAt as number).toBeGreaterThan(0);
  });

  it('maps 401 -> auth', async () => {
    __setBraveHttpForTests(async () => ({ status: 401, headers: {}, data: '{}' }));
    const r = await braveAdapter.search({ data: { apiKey: 'bad' } }, 'q', 5);
    expect(r.error?.kind).toBe('auth');
  });
});
