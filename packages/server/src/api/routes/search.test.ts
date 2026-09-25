import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import type { Provider, Result } from '../../shared/types.js';
import { repos } from '../../db/index.js';
import { initAdapterForPath } from '../../db/driver.js';
import { runMigrationOnce } from '../../db/migrate.js';

const okProvider = (id: string, results: Result[]): Provider => ({
  id, async search() { return { results, quota: null }; },
});

describe('POST /search', () => {
  it('returns merged results + partialFailures + meta', async () => {
    const providers = {
      a: okProvider('a', [{ title: 't1', url: 'https://a.com/1', snippet: 's', rank_in_source: 0 }]),
      b: okProvider('b', [{ title: 't2', url: 'https://b.com/1', snippet: 's', rank_in_source: 0 }]),
    };
    const { app } = await createApp({ providers, combos: [], db: null as any });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).post('/search').send({ query: 'hello', provider: { sources: [{ provider: 'a' }, { provider: 'b' }], mode: 'concurrent', merge: { dedupe: 'url-normalized', rank: 'rrf', cap: 20 }, fallback: { on: [], min_results: 1 } } });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(2);
    expect(res.body.meta.combo).toBeDefined();
  });

  it('omitting provider -> 400 bad_request (no built-in default)', async () => {
    const providers = {
      bing: okProvider('bing', [{ title: 't', url: 'https://bing.com/1', snippet: '', rank_in_source: 0 }]),
      ddg: okProvider('ddg', []),
    };
    const { app } = await createApp({ providers, combos: [], db: null as any });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).post('/search').send({ query: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body.error.kind).toBe('bad_request');
  });

  it('all sources fail -> 429/503 error envelope, not 500', async () => {
    const providers = {
      a: { id: 'a', async search() { return { results: [], error: { kind: 'blocked' } }; } } as any,
    };
    const { app } = await createApp({ providers, combos: [], db: null as any });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).post('/search').send({ query: 'hello', provider: { sources: [{ provider: 'a' }], mode: 'concurrent', merge: { dedupe: 'off', rank: 'rrf', cap: 20 }, fallback: { on: [], min_results: 1 } } });
    expect(res.status).toBe(503);
    expect(res.body.error.kind).toBe('blocked');
  });

  it('missing query -> 400 bad_request', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).post('/search').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.kind).toBe('bad_request');
  });

  it('limit is forwarded to provider.search (#5)', async () => {
    const limits: number[] = [];
    const providers = {
      a: { id: 'a', async search(_q: string, limit: number) { limits.push(limit); return { results: [{ title: 't', url: 'https://a.com/1', snippet: '', rank_in_source: 0 }], quota: null }; } } as any,
    };
    const { app } = await createApp({ providers, combos: [], db: null as any });
    const supertest = (await import('supertest')).default;
    await supertest(app).post('/search').send({ query: 'hello', limit: 42, provider: { sources: [{ provider: 'a' }], mode: 'concurrent', merge: { dedupe: 'off', rank: 'rrf', cap: 20 }, fallback: { on: [], min_results: 1 } } });
    expect(limits).toEqual([42]);
  });

  it('a non-JSON provider string is treated as an engine id -> unknown engine -> 500', async () => {
    // '{not json' is neither valid JSON nor a saved combo name -> engine-id desugar
    // -> unknown provider at the execution layer (kind:'unknown'), NOT a 400.
    const { app } = await createApp({ providers: {}, combos: [], db: null as any });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).post('/search').send({ query: 'hello', provider: '{not json' });
    expect(res.status).toBe(500);
    expect(res.body.error.kind).toBe('unknown');
    expect(res.body.error.provider).toBe('{not json');
  });

  it("provider:'WEB' resolves to the seeded built-in combo by name", async () => {
    // The built-in WEB combo is seeded at migration; /search accepts its name
    // 'WEB' (and lowercase 'web' via case-insensitive name matching) as provider.
    const dir = mkdtempSync(join(tmpdir(), 'wsr-search-'));
    try {
      const adapter = await initAdapterForPath(join(dir, 'data.sqlite'));
      await runMigrationOnce(adapter);
      const providers = {
        bing: okProvider('bing', [{ title: 't', url: 'https://bing.com/1', snippet: '', rank_in_source: 0 }]),
        ddg: okProvider('ddg', []),
      };
      const { app } = await createApp({ providers, combos: [], db: adapter, repos });

      const supertest = (await import('supertest')).default;
      const byName = await supertest(app).post('/search').send({ query: 'hello', provider: 'WEB' });
      expect(byName.status).toBe(200);
      expect(byName.body.results.length).toBe(1); // bing result, ddg empty
      expect(byName.body.meta.combo).toBe('web');

      const byLower = await supertest(app).post('/search').send({ query: 'hello', provider: 'web' });
      expect(byLower.status).toBe(200);
      expect(byLower.body.meta.combo).toBe('web');

      adapter.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('#9: a combo saved to the repo is searchable by id/name on the very next request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-search-'));
    try {
      const adapter = await initAdapterForPath(join(dir, 'data.sqlite'));
      await runMigrationOnce(adapter);
      const providers = { a: okProvider('a', [{ title: 't', url: 'https://a.com/1', snippet: '', rank_in_source: 0 }]) };
      const { app } = await createApp({ providers, combos: [], db: adapter, repos });

      const supertest = (await import('supertest')).default;
      const now = new Date().toISOString();
      // Save via the dashboard API (the real write path), then search by name.
      await supertest(app).post('/api/combos').send({ id: 'c-saved', name: 'Saved Combo', mode: 'concurrent', sources: [{ provider: 'a' }], merge: { dedupe: 'off', rank: 'rrf', cap: 20 }, fallback: { on: [], min_results: 1 }, createdAt: now, updatedAt: now });

      const byName = await supertest(app).post('/search').send({ query: 'hello', provider: 'Saved Combo' });
      expect(byName.status).toBe(200);
      expect(byName.body.results.length).toBe(1);

      const byId = await supertest(app).post('/search').send({ query: 'hello', provider: 'c-saved' });
      expect(byId.status).toBe(200);
      expect(byId.body.meta.combo).toBe('c-saved');

      adapter.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('top-level provider shorthand == single-source inline combo (#engine-test)', async () => {
    const limits: string[] = [];
    const providers = {
      google: { id: 'google', async search(q: string) { limits.push(q); return { results: [{ title: 't', url: 'https://google.com/1', snippet: '', rank_in_source: 0 }] }; } } as any,
    };
    const { app } = await createApp({ providers, combos: [], db: null as any });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).post('/search').send({ query: 'hello', provider: 'google' });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(1);
    expect(limits).toEqual(['hello']); // only google was called
    expect(res.body.meta.combo).toBe('inline');
  });

  it('top-level provider + accountId forwards accountId to the provider ctx', async () => {
    const ctxs: any[] = [];
    const providers = {
      tavily: { id: 'tavily', async search(_q: string, _l: number, ctx?: any) { ctxs.push(ctx); return { results: [{ title: 't', url: 'https://tavily.com/1', snippet: '', rank_in_source: 0 }] }; } } as any,
    };
    const { app } = await createApp({ providers, combos: [], db: null as any });
    const supertest = (await import('supertest')).default;
    await supertest(app).post('/search').send({ query: 'hello', provider: 'tavily', accountId: 'acct-7' });
    expect(ctxs[0].accountId).toBe('acct-7');
  });

  it('single-source failure via shorthand -> top-level error + meta.sourceTimings', async () => {
    const providers = {
      google: { id: 'google', async search() { return { results: [], error: { kind: 'blocked' } }; } } as any,
    };
    const { app } = await createApp({ providers, combos: [], db: null as any });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).post('/search').send({ query: 'hello', provider: 'google' });
    expect(res.status).toBe(503);
    expect(res.body.error.kind).toBe('blocked');
    expect(res.body.error.provider).toBe('google');
    expect(res.body.meta.sourceTimings.google).toBeTypeOf('number');
  });

  it('top-level accountId with an inline-combo provider is ignored (not an error)', async () => {
    // provider resolves to an inline combo object; a stray top-level accountId
    // must NOT be injected into any source (it is ignored, not rejected) — accountId
    // only applies when provider desugars to a single engine id.
    const ctxs: any[] = [];
    const providers = {
      a: { id: 'a', async search(_q: string, _l: number, ctx?: any) { ctxs.push(ctx); return { results: [{ title: 't', url: 'https://a.com/1', snippet: '', rank_in_source: 0 }] }; } } as any,
    };
    const { app } = await createApp({ providers, combos: [], db: null as any });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).post('/search').send({ query: 'hello', provider: { sources: [{ provider: 'a' }] }, accountId: 'stray-acct' });
    expect(res.status).toBe(200); // ignored, not 400
    expect(ctxs[0].accountId).toBeUndefined(); // stray accountId never reached the provider
  });
});