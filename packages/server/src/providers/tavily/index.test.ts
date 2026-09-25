import { describe, it, expect, beforeEach } from 'vitest';
import { tavilyAdapter, __setTavilyHttpForTests } from './index.js';

describe('tavily adapter', () => {
  beforeEach(() => { __setTavilyHttpForTests(undefined); });

  it('parses results with score, quota from usage.credits', async () => {
    __setTavilyHttpForTests(async () => ({
      status: 200, headers: {},
      data: JSON.stringify({
        results: [{ title: 'T1', url: 'https://ex.com/1', content: 'Snip 1', score: 0.9 }],
        usage: { credits: 4 },
      }),
    }));
    const r = await tavilyAdapter.search({ data: { apiKey: 'tvly-x' } }, 'q', 5);
    expect(r.results[0].title).toBe('T1');
    expect(r.results[0].snippet).toBe('Snip 1');
    expect(r.results[0].score).toBe(0.9);
    expect(r.quota?.remaining).toBe(4);
  });

  it('maps 432 -> quota', async () => {
    __setTavilyHttpForTests(async () => ({ status: 432, headers: {}, data: '{}' }));
    const r = await tavilyAdapter.search({ data: { apiKey: 'tvly-x' } }, 'q', 5);
    expect(r.error?.kind).toBe('quota');
  });

  it('maps 429 -> ratelimit with Retry-After', async () => {
    __setTavilyHttpForTests(async () => ({ status: 429, headers: { 'retry-after': '120' }, data: '{}' }));
    const r = await tavilyAdapter.search({ data: { apiKey: 'tvly-x' } }, 'q', 5);
    expect(r.error?.kind).toBe('ratelimit');
    expect(r.error?.resetAt).toBeDefined();
  });

  it('maps 401 -> auth', async () => {
    __setTavilyHttpForTests(async () => ({ status: 401, headers: {}, data: '{}' }));
    const r = await tavilyAdapter.search({ data: { apiKey: 'bad' } }, 'q', 5);
    expect(r.error?.kind).toBe('auth');
  });
});