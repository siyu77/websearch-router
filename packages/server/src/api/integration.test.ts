import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import type { Provider } from '../shared/types.js';
import { repos } from '../db/index.js';
import { initAdapterForPath } from '../db/driver.js';
import { runMigrationOnce } from '../db/migrate.js';

const blocked: Provider = { id: 'bing', async search() { return { results: [], error: { kind: 'blocked' } }; } };
const ok: Provider = { id: 'ddg', async search() { return { results: [{ title: 't', url: 'https://e.com/1', snippet: 's', rank_in_source: 0 }] }; } };
const quota: Provider = { id: 'tavily', async search() { return { results: [], error: { kind: 'quota', resetAt: 1234 } }; } };
// Fresh quota provider per source id (avoids sharing one object for two keys).
const quotaProvider = (id: string): Provider => ({ id, async search() { return { results: [], error: { kind: 'quota', resetAt: 1234 } }; } });

const supertest = () => import('supertest').then((m) => m.default);
const combo = (sources: string[]) => ({ sources: sources.map((p) => ({ provider: p })), mode: 'concurrent' as const, merge: { dedupe: 'url-normalized' as const, rank: 'rrf' as const, cap: 20 }, fallback: { on: [] as any, min_results: 1 } });

describe('API integration', () => {
  it('partial failure: one blocked, one ok -> 200 with partialFailures', async () => {
    const { app } = await createApp({ providers: { bing: blocked, ddg: ok }, combos: [], db: null as any });
    const res = await (await supertest())(app).post('/search').send({ query: 'q', provider: combo(['bing', 'ddg']) });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(1);
    expect(res.body.partialFailures[0].error.kind).toBe('blocked');
  });

  it('all quota -> 429 with resetAt + provider (#7)', async () => {
    const { app } = await createApp({ providers: { tavily: quota, brave: quotaProvider('brave') }, combos: [], db: null as any });
    const res = await (await supertest())(app).post('/search').send({ query: 'q', provider: combo(['tavily', 'brave']) });
    expect(res.status).toBe(429);
    expect(res.body.error.kind).toBe('quota');
    expect(typeof res.body.error.resetAt).toBe('number');
    // #1/#7: the top-level all-source error now names the provider that failed.
    expect(res.body.error.provider).toBeDefined();
  });

  it('health reports provider list', async () => {
    const { app } = await createApp({ providers: { bing: ok, ddg: ok }, combos: [], db: null as any });
    const res = await (await supertest())(app).get('/health');
    expect(res.body.providers.map((p: any) => p.id).sort()).toEqual(['bing', 'ddg']);
  });

  it('X-API-Key: /health is NOT gated (no key required)', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any, apiKey: 'secret' });
    const res = await (await supertest())(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('X-API-Key: POST /search with no key -> 401 auth', async () => {
    const { app } = await createApp({ providers: { ddg: ok }, combos: [], db: null as any, apiKey: 'secret' });
    const res = await (await supertest())(app).post('/search').send({ query: 'q', provider: combo(['ddg']) });
    expect(res.status).toBe(401);
    expect(res.body.error.kind).toBe('auth');
  });

  it('X-API-Key: POST /search with wrong key -> 401 auth', async () => {
    const { app } = await createApp({ providers: { ddg: ok }, combos: [], db: null as any, apiKey: 'secret' });
    const res = await (await supertest())(app).post('/search').set('x-api-key', 'wrong').send({ query: 'q', provider: combo(['ddg']) });
    expect(res.status).toBe(401);
    expect(res.body.error.kind).toBe('auth');
  });

  it('X-API-Key: POST /search with correct key -> 200', async () => {
    const { app } = await createApp({ providers: { ddg: ok }, combos: [], db: null as any, apiKey: 'secret' });
    const res = await (await supertest())(app).post('/search').set('x-api-key', 'secret').send({ query: 'q', provider: combo(['ddg']) });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(1);
  });

  it('precedence regression: no apiKey configured -> POST /fetch must NOT 401', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any });
    const res = await (await supertest())(app).post('/fetch').send({});
    // Missing url is a 400 bad_request — NOT a 401 auth. A key gate with no
    // key configured would have 401'd first.
    expect(res.status).toBe(400);
    expect(res.body.error.kind).toBe('bad_request');
  });

  it('unknown provider string -> 500 unknown (execution-layer, not bad_request)', async () => {
    // A non-JSON, unmatched provider string is an engine-id desugar -> unknown
    // engine at the execution layer, NOT a 400 (no saved-combo lookup failure now).
    const { app } = await createApp({ providers: { ddg: ok }, combos: [], db: null as any });
    const res = await (await supertest())(app).post('/search').send({ query: 'q', provider: 'nonexistent' });
    expect(res.status).toBe(500);
    expect(res.body.error.kind).toBe('unknown');
    expect(res.body.error.provider).toBe('nonexistent');
  });

  it('mode override: inline combo + mode sequential -> 200 with meta.degraded false', async () => {
    const calls: string[] = [];
    const tracking = (id: string): Provider => ({
      id,
      async search() {
        calls.push(id);
        return { results: [{ title: id, url: `https://${id}.example.com/r1`, snippet: 's', rank_in_source: 0 }] };
      },
    });
    const { app } = await createApp({ providers: { a: tracking('a'), b: tracking('b') }, combos: [], db: null as any });
    const res = await (await supertest())(app).post('/search').send({ query: 'q', provider: { sources: [{ provider: 'a' }, { provider: 'b' }], mode: 'concurrent', merge: { dedupe: 'off', rank: 'rrf', cap: 20 }, fallback: { on: [], min_results: 2 } }, mode: 'sequential' });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(2);
    expect(res.body.meta.degraded).toBe(false);
    // min_results=2 means sequential must NOT short-circuit after the first
    // source, so both providers are consulted, in order.
    expect(calls).toEqual(['a', 'b']);
  });

  it('DB writeback: POST /search writes usageHistory + requestDetails rows (never throws)', async () => {
    // Deferred writeback coverage: real DB via sql.js (guaranteed pure-JS
    // adapter — no native driver required) + real repos threaded through
    // createApp, exactly as the 6.2 implementer plumbed them.
    const dbDir = mkdtempSync(join(tmpdir(), 'wsr-integration-'));
    try {
      const path = join(dbDir, 'usage.sqlite');
      const adapter = await initAdapterForPath(path);
      await runMigrationOnce(adapter);
      const { app } = await createApp({ providers: { bing: blocked, ddg: ok }, combos: [], db: adapter, repos });
      const res = await (await supertest())(app).post('/search').send({ query: 'q', provider: combo(['bing', 'ddg']) });
      expect(res.status).toBe(200);

      const usage = (adapter.all('SELECT * FROM usageHistory') as any[]).map((r) => ({ ...r, data: JSON.parse(r.data) }));
      const details = (adapter.all('SELECT * FROM requestDetails') as any[]).map((r) => ({ ...r, data: JSON.parse(r.data) }));

      expect(usage.length).toBe(1);
      expect(usage[0].query).toBe('q');
      expect(usage[0].data.totalResults).toBe(1);

      // One detail row per source (bing + ddg).
      expect(details.map((d) => d.source).sort()).toEqual(['bing', 'ddg']);
      expect(details.map((d) => d.usageId)).toEqual([usage[0].id, usage[0].id]);
      // #12: requestDetails now carries the real per-source result count
      // (ddg=1) instead of a hardcoded 0.
      const ddgDetail = details.find((d) => d.source === 'ddg');
      expect(ddgDetail?.data.resultCount).toBe(1);
      adapter.close();
    } finally {
      rmSync(dbDir, { recursive: true, force: true });
    }
  });
});
