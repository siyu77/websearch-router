import { describe, it, expect, beforeEach } from 'vitest';
import { exaAdapter, __setExaHttpForTests } from './index.js';

describe('exa adapter', () => {
  beforeEach(() => { __setExaHttpForTests(undefined); });

  it('parses results with normalized fields, no score', async () => {
    __setExaHttpForTests(async () => ({
      status: 200,
      headers: {},
      data: JSON.stringify({
        results: [
          { title: 'T1', url: 'https://ex.com/1', author: 'Ann', publishedDate: '2026-08-01T00:00:00Z' },
          { title: 'T2', url: 'https://ex.com/2' },
        ],
      }),
    }));
    const r = await exaAdapter.search({ data: { apiKey: 'exa-x' } }, 'q', 5);
    expect(r.results).toHaveLength(2);
    expect(r.results[0].title).toBe('T1');
    expect(r.results[0].url).toBe('https://ex.com/1');
    expect(r.results[0].snippet).toContain('Author: Ann');
    expect(r.results[0].snippet).toContain('Published: 2026-08-01');
    expect(r.results[0].rank_in_source).toBe(0);
    expect(r.results[0].score).toBeUndefined();
    expect(r.results[1].snippet).toBe('');
    expect(r.quota).toEqual({ exhausted: false });
  });

  it('uses highlights as snippet when present (contents.highlights requested)', async () => {
    __setExaHttpForTests(async () => ({
      status: 200,
      headers: {},
      data: JSON.stringify({
        results: [
          { title: 'T1', url: 'https://ex.com/1', highlights: ['First passage', 'Second passage'] },
        ],
      }),
    }));
    const r = await exaAdapter.search({ data: { apiKey: 'exa-x' } }, 'q', 5);
    expect(r.results[0].snippet).toBe('First passage Second passage');
  });

  it('trims long highlight snippets to a bounded length', async () => {
    __setExaHttpForTests(async () => ({
      status: 200,
      headers: {},
      data: JSON.stringify({
        results: [{ title: 'T1', url: 'https://ex.com/1', highlights: ['x'.repeat(600)] }],
      }),
    }));
    const r = await exaAdapter.search({ data: { apiKey: 'exa-x' } }, 'q', 5);
    expect(r.results[0].snippet.length).toBeLessThanOrEqual(301);
  });

  it('sends contents.highlights with text disabled so excerpts are returned', async () => {
    let sentBody = '';
    __setExaHttpForTests(async (_apiKey, body) => { sentBody = body; return { status: 200, headers: {}, data: '{"results":[]}' }; });
    await exaAdapter.search({ data: { apiKey: 'exa-x' } }, 'q', 5);
    const parsed = JSON.parse(sentBody);
    expect(parsed.contents).toEqual({ highlights: true, text: false });
  });

  it('caps numResults at 10 when limit exceeds it (cost guard)', async () => {
    let sentBody = '';
    __setExaHttpForTests(async (_apiKey, body) => { sentBody = body; return { status: 200, headers: {}, data: '{"results":[]}' }; });
    await exaAdapter.search({ data: { apiKey: 'exa-x' } }, 'q', 50);
    expect(JSON.parse(sentBody).numResults).toBe(10);
  });

  it('passes limit through when below the cap', async () => {
    let sentBody = '';
    __setExaHttpForTests(async (_apiKey, body) => { sentBody = body; return { status: 200, headers: {}, data: '{"results":[]}' }; });
    await exaAdapter.search({ data: { apiKey: 'exa-x' } }, 'q', 3);
    expect(JSON.parse(sentBody).numResults).toBe(3);
  });

  it('maps 402 -> quota', async () => {
    __setExaHttpForTests(async () => ({ status: 402, headers: {}, data: '{}' }));
    const r = await exaAdapter.search({ data: { apiKey: 'exa-x' } }, 'q', 5);
    expect(r.error?.kind).toBe('quota');
  });

  it('maps 429 -> ratelimit with Retry-After resetAt', async () => {
    __setExaHttpForTests(async () => ({ status: 429, headers: { 'retry-after': '120' }, data: '{}' }));
    const r = await exaAdapter.search({ data: { apiKey: 'exa-x' } }, 'q', 5);
    expect(r.error?.kind).toBe('ratelimit');
    expect(r.error?.resetAt).toBeTypeOf('number');
    expect(r.error?.resetAt as number).toBeGreaterThan(0);
  });

  it('maps 401 -> auth', async () => {
    __setExaHttpForTests(async () => ({ status: 401, headers: {}, data: '{}' }));
    const r = await exaAdapter.search({ data: { apiKey: 'bad' } }, 'q', 5);
    expect(r.error?.kind).toBe('auth');
  });

  it('maps other statuses -> unknown', async () => {
    __setExaHttpForTests(async () => ({ status: 500, headers: {}, data: '{"error":"boom"}' }));
    const r = await exaAdapter.search({ data: { apiKey: 'exa-x' } }, 'q', 5);
    expect(r.error?.kind).toBe('unknown');
  });
});
