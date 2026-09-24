import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { search } from './api.js';

describe('search() error contract', () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { (globalThis as any).fetch = origFetch; });

  const stubFetch = (status: number, body: any) => {
    const calls: any[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    });
    return calls;
  };

  it('returns { ok: true, ...data } on success', async () => {
    const calls = stubFetch(200, { results: [{ title: 't' }], partialFailures: [], meta: { combo: 'inline' } });
    const r = await search({ query: 'hi', provider: 'google' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.results.length).toBe(1);
    expect(calls[0].init.body).toContain('"provider":"google"');
  });

  it('returns { ok: false, error, meta } on failure WITHOUT throwing (DIP/ISP)', async () => {
    stubFetch(503, { error: { kind: 'blocked', provider: 'google' }, meta: { sourceTimings: { google: 432 } } });
    const r = await search({ query: 'hi', provider: 'google' });
    if (r.ok) throw new Error('expected failure');
    expect(r.error.kind).toBe('blocked');
    expect(r.error.provider).toBe('google');
    expect(r.meta?.sourceTimings.google).toBe(432);
  });

  it('returns { ok: false, error: { message } } on a 400 bad_request (provider required)', async () => {
    stubFetch(400, { error: { kind: 'bad_request', message: 'provider is required' } });
    const r = await search({ query: 'hi' });
    if (r.ok) throw new Error('expected failure');
    expect(r.error.kind).toBe('bad_request');
    expect(r.error.message).toContain('provider is required');
  });
});
