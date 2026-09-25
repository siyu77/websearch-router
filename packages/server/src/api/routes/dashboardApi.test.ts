import { describe, it, expect } from 'vitest';
import { createApp } from '../app.js';
import { initAdapterForPath } from '../../db/driver.js';
import { runMigrationOnce } from '../../db/migrate.js';
import { upsert as upsertConn } from '../../db/repos/connectionsRepo.js';
import { upsert as upsertCombo } from '../../db/repos/combosRepo.js';
import { insert as insertUsage } from '../../db/repos/usageRepo.js';
import { insert as insertDetail } from '../../db/repos/detailsRepo.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('dashboard API routes', () => {
  let app: any; let adapter: any; let dir: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wsr-'));
    adapter = await initAdapterForPath(join(dir, 'data.sqlite'));
    await runMigrationOnce(adapter);
    const repos = (await import('../../db/index.js')).repos;
    const built = await createApp({ providers: {}, combos: [], db: adapter, repos });
    app = built.app;
    (app as any).__db = adapter;
  });
  afterEach(() => { adapter?.close?.(); rmSync(dir!, { recursive: true, force: true }); });

  it('GET /api/providers returns provider connections grouped', async () => {
    const now = new Date().toISOString();
    const adapter = (app as any).__db;
    upsertConn(adapter, { id: 'a1', provider: 'tavily', authType: 'apikey', priority: 0, isActive: true, data: { apiKey: 'k', quota: { remaining: 5, exhausted: false }, cooldown: { level: 0 } }, createdAt: now, updatedAt: now });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/api/providers');
    expect(res.status).toBe(200);
    expect(res.body.providers).toBeInstanceOf(Array);
    expect(res.body.providers.find((p: any) => p.id === 'tavily')).toBeTruthy();
  });

  it('GET /api/combos lists combos incl. the seeded built-in WEB flagged builtin:true', async () => {
    const now = new Date().toISOString();
    const adapter = (app as any).__db;
    upsertCombo(adapter, { id: 'c1', name: 'MyCombo', mode: 'concurrent', data: { sources: [{ provider: 'bing' }] }, createdAt: now, updatedAt: now });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/api/combos');
    expect(res.status).toBe(200);
    expect(res.body.combos.length).toBeGreaterThan(0);
    // Migration seeded the built-in WEB combo and flags it protected.
    const web = res.body.combos.find((c: any) => c.id === 'web');
    expect(web).toBeTruthy();
    expect(web.name).toBe('WEB');
    expect(web.builtin).toBe(true);
    expect(res.body.combos.find((c: any) => c.id === 'c1').builtin).toBe(false);
  });

  it('POST /api/combos saves a combo', async () => {
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).post('/api/combos').send({ id: 'new', name: 'New', mode: 'concurrent', sources: [{ provider: 'ddg' }], merge: { dedupe: 'url-normalized', rank: 'rrf', cap: 20 }, fallback: { on: ['empty'], min_results: 5 } });
    expect(res.status).toBe(200);
    const list = await supertest(app).get('/api/combos');
    expect(list.body.combos.some((c: any) => c.id === 'new')).toBe(true);
  });

  it('POST /api/combos with id web: name stays WEB (built-in id/name locked), sources editable', async () => {
    const supertest = (await import('supertest')).default;
    // Try to rename the built-in WEB combo and change its sources.
    const res = await supertest(app).post('/api/combos').send({ id: 'web', name: 'Renamed', mode: 'sequential', sources: [{ provider: 'google' }], merge: { dedupe: 'url', rank: 'rrf', cap: 5 }, fallback: { on: ['timeout'], min_results: 2 } });
    expect(res.status).toBe(200);
    const list = await supertest(app).get('/api/combos');
    const web = list.body.combos.find((c: any) => c.id === 'web');
    // name is force-locked to the built-in value; editable fields went through.
    expect(web.name).toBe('WEB');
    expect(web.mode).toBe('sequential');
    expect(web.sources).toEqual([{ provider: 'google' }]);
    expect(web.merge.dedupe).toBe('url');
    expect(web.builtin).toBe(true);
  });

  it('GET /api/usage returns recent searches', async () => {
    const adapter = (app as any).__db;
    const ts = new Date().toISOString();
    insertUsage(adapter, { id: 'u1', ts, query: 'q', comboId: 'c', data: { totalResults: 2, degraded: false } });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/api/usage');
    expect(res.status).toBe(200);
    expect(res.body.usage).toBeInstanceOf(Array);
    expect(res.body.usage.length).toBeGreaterThanOrEqual(1);
    expect(res.body.usage.some((u: any) => u.id === 'u1' && u.query === 'q')).toBe(true);
  });

  it('GET /api/usage attaches perSource timing/failures from requestDetails (single IN join)', async () => {
    const adapter = (app as any).__db;
    const ts = new Date().toISOString();
    insertUsage(adapter, { id: 'u1', ts, query: 'q', comboId: 'c', data: { totalResults: 1, degraded: false } });
    insertUsage(adapter, { id: 'u2', ts, query: 'q2', comboId: 'c', data: { totalResults: 0, degraded: true } });
    insertDetail(adapter, { id: 'd1', ts, usageId: 'u1', source: 'bing', data: { durationMs: 120, resultCount: 1, error: undefined } });
    insertDetail(adapter, { id: 'd2', ts, usageId: 'u2', source: 'google', data: { durationMs: 300, resultCount: 0, error: 'blocked' } });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/api/usage');
    expect(res.status).toBe(200);
    const u1 = res.body.usage.find((u: any) => u.id === 'u1');
    expect(u1.perSource).toHaveLength(1);
    expect(u1.perSource[0]).toEqual({ source: 'bing', durationMs: 120, resultCount: 1, error: undefined });
    const u2 = res.body.usage.find((u: any) => u.id === 'u2');
    expect(u2.perSource[0].error).toBe('blocked');
    // u2 has no details but perSource is still present (empty array, no N+1 crash)
    expect(u1.perSource.find((s: any) => s.source === 'google')).toBeUndefined();
  });

  it('GET /api/engines lists free + paid engines', async () => {
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/api/engines');
    expect(res.status).toBe(200);
    const ids = res.body.engines.map((e: any) => e.id).sort();
    expect(ids).toEqual(['arxiv', 'bing', 'brave', 'crossref', 'ddg', 'exa', 'google', 'openalex', 'semantic_scholar', 'tavily']);
    expect(res.body.engines.find((e: any) => e.id === 'bing').kind).toBe('free');
    expect(res.body.engines.find((e: any) => e.id === 'tavily').kind).toBe('paid');
    expect(res.body.engines.find((e: any) => e.id === 'exa').kind).toBe('paid');
  });

  it('POST /api/providers creates an account; GET masks the key', async () => {
    const supertest = (await import('supertest')).default;
    const created = await supertest(app).post('/api/providers').send({ provider: 'tavily', apiKey: 'tvly-abcdefgh12345678', priority: 1 });
    expect(created.status).toBe(200);
    expect(created.body.id).toBeTypeOf('string');
    const list = await supertest(app).get('/api/providers');
    const tavily = list.body.providers.find((p: any) => p.id === 'tavily');
    expect(tavily).toBeTruthy();
    const acc = tavily.accounts[0];
    expect(acc.apiKeySet).toBe(true);
    expect(acc.apiKey).toContain('••••');
    expect(acc.apiKey).not.toContain('tvly-abcdefgh12345678');
    expect(acc.priority).toBe(1);
    expect(acc.isActive).toBe(true);
    expect(acc.name).toBeUndefined(); // optional name not provided
  });

  it('POST /api/providers stores an optional name; GET returns it trimmed', async () => {
    const supertest = (await import('supertest')).default;
    const created = await supertest(app).post('/api/providers').send({ provider: 'brave', apiKey: 'bsa-abcdefgh12345678', name: '  main-key  ' });
    expect(created.status).toBe(200);
    const list = await supertest(app).get('/api/providers');
    const brave = list.body.providers.find((p: any) => p.id === 'brave');
    const acc = brave.accounts.find((a: any) => a.id === created.body.id);
    expect(acc.name).toBe('main-key');
  });

  it('POST /api/providers rejects non-paid provider / missing key', async () => {
    const supertest = (await import('supertest')).default;
    const bad = await supertest(app).post('/api/providers').send({ provider: 'bing', apiKey: 'x' });
    expect(bad.status).toBe(400);
    const nokey = await supertest(app).post('/api/providers').send({ provider: 'tavily' });
    expect(nokey.status).toBe(400);
  });

  it('PUT /api/providers/:id preserves key on empty apiKey; toggles active; updates priority', async () => {
    const adapter = (app as any).__db;
    const now = new Date().toISOString();
    upsertConn(adapter, { id: 'a1', provider: 'brave', authType: 'apikey', priority: 0, isActive: true, data: { apiKey: 'secret-brave-key' }, createdAt: now, updatedAt: now });
    const supertest = (await import('supertest')).default;
    // empty apiKey => keep stored key
    let res = await supertest(app).put('/api/providers/a1').send({ apiKey: '', priority: 3 });
    expect(res.status).toBe(200);
    let list = await supertest(app).get('/api/providers');
    let acc = list.body.providers.find((p: any) => p.id === 'brave').accounts[0];
    expect(acc.priority).toBe(3);
    expect(acc.apiKeySet).toBe(true); // key still present
    // toggle inactive
    res = await supertest(app).put('/api/providers/a1').send({ isActive: false });
    expect(res.status).toBe(200);
    list = await supertest(app).get('/api/providers');
    acc = list.body.providers.find((p: any) => p.id === 'brave').accounts[0];
    expect(acc.isActive).toBe(false);
    expect(acc.apiKeySet).toBe(true); // key untouched by toggle
  });

  it('PUT /api/providers/:id sets the name; empty name clears it', async () => {
    const adapter = (app as any).__db;
    const now = new Date().toISOString();
    upsertConn(adapter, { id: 'a1', provider: 'brave', authType: 'apikey', priority: 0, isActive: true, data: { apiKey: 'k' }, createdAt: now, updatedAt: now });
    const supertest = (await import('supertest')).default;
    let res = await supertest(app).put('/api/providers/a1').send({ name: 'backup' });
    expect(res.status).toBe(200);
    let list = await supertest(app).get('/api/providers');
    let acc = list.body.providers.find((p: any) => p.id === 'brave').accounts[0];
    expect(acc.name).toBe('backup');
    // empty name clears the label
    res = await supertest(app).put('/api/providers/a1').send({ name: '  ' });
    expect(res.status).toBe(200);
    list = await supertest(app).get('/api/providers');
    acc = list.body.providers.find((p: any) => p.id === 'brave').accounts[0];
    expect(acc.name).toBeUndefined();
  });

  it('PUT /api/providers/:id updates the key when provided (non-empty)', async () => {
    const adapter = (app as any).__db;
    const now = new Date().toISOString();
    upsertConn(adapter, { id: 'a1', provider: 'tavily', authType: 'apikey', priority: 0, isActive: true, data: { apiKey: 'old-key' }, createdAt: now, updatedAt: now });
    const supertest = (await import('supertest')).default;
    await supertest(app).put('/api/providers/a1').send({ apiKey: 'new-key-1234567890' });
    const list = await supertest(app).get('/api/providers');
    const acc = list.body.providers.find((p: any) => p.id === 'tavily').accounts[0];
    expect(acc.apiKeySet).toBe(true);
    // masked preview reflects the new key
    expect(acc.apiKey).toBe('new-••••7890');
  });

  it('PUT /api/providers/:id 404s on unknown id', async () => {
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).put('/api/providers/nope').send({ isActive: false });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/providers/:id removes the account', async () => {
    const adapter = (app as any).__db;
    const now = new Date().toISOString();
    upsertConn(adapter, { id: 'a1', provider: 'tavily', authType: 'apikey', priority: 0, isActive: true, data: { apiKey: 'k' }, createdAt: now, updatedAt: now });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).delete('/api/providers/a1');
    expect(res.status).toBe(200);
    const list = await supertest(app).get('/api/providers');
    expect(list.body.providers.find((p: any) => p.id === 'tavily')).toBeUndefined();
  });

  it('DELETE /api/combos/:id removes the combo', async () => {
    const adapter = (app as any).__db;
    const now = new Date().toISOString();
    upsertCombo(adapter, { id: 'delme', name: 'DelMe', mode: 'concurrent', data: { sources: [{ provider: 'bing' }] }, createdAt: now, updatedAt: now });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).delete('/api/combos/delme');
    expect(res.status).toBe(200);
    const list = await supertest(app).get('/api/combos');
    expect(list.body.combos.some((c: any) => c.id === 'delme')).toBe(false);
  });

  it('DELETE /api/combos/web -> 400 (built-in protected)', async () => {
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).delete('/api/combos/web');
    expect(res.status).toBe(400);
    expect(res.body.error.kind).toBe('bad_request');
    // The built-in combo still exists afterwards.
    const list = await supertest(app).get('/api/combos');
    expect(list.body.combos.some((c: any) => c.id === 'web')).toBe(true);
  });
});
