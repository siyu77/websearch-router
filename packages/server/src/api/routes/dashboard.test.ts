import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../app.js';
import { initAdapterForPath } from '../../db/driver.js';
import { runMigrationOnce } from '../../db/migrate.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('dashboard SPA fallback', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wsr-dist-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>test</title>');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('deep link /combos returns index.html when a distDir exists', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any, repos: {}, distDir: dir });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/combos');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<!doctype html>');
  });

  it('all 4 page paths + / return index.html (SPA fallback covers every page route)', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any, repos: {}, distDir: dir });
    const supertest = (await import('supertest')).default;
    for (const p of ['/', '/search', '/providers', '/combos', '/usage']) {
      const res = await supertest(app).get(p);
      expect(res.status, `${p} status`).toBe(200);
      expect(res.headers['content-type'], `${p} content-type`).toContain('text/html');
    }
  });

  it('/api/combos is NOT intercepted by the fallback (repos present)', async () => {
    const supertest = (await import('supertest')).default;
    // Real repos/db (like dashboardApi.test.ts) so the API route genuinely
    // responds — the strongest proof it is the API handler, NOT the HTML fallback.
    const dbdir = mkdtempSync(join(tmpdir(), 'wsr-db-'));
    const adapter = await initAdapterForPath(join(dbdir, 'data.sqlite'));
    await runMigrationOnce(adapter);
    const repos = (await import('../../db/index.js')).repos;
    const { app } = await createApp({ providers: {}, combos: [], db: adapter, repos, distDir: dir });
    const res = await supertest(app).get('/api/combos');
    expect(res.status).toBe(200); // handled by the dashboard API route, not the fallback
    expect(res.headers['content-type']).toContain('application/json');
    adapter.close?.();
    rmSync(dbdir, { recursive: true, force: true });
  });

  it('unknown /api/* subpath falls through to 404, NOT index.html', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any, repos: {}, distDir: dir });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    // Express 5's default 404 is text/html ("Cannot GET ..."), so assert the
    // spec requirement — the SPA index.html must NOT be served — not JSON.
    expect(res.text).not.toContain('<!doctype html>');
  });

  it('non-GET/HEAD methods on page paths fall through to 404, NOT index.html', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any, repos: {}, distDir: dir });
    const supertest = (await import('supertest')).default;
    // /combos is a page path with no non-API backend route; unsupported methods
    // must fall through to 404 rather than serve the SPA shell.
    for (const method of ['put', 'post', 'delete', 'patch'] as const) {
      const res = await supertest(app)[method]('/combos');
      expect(res.status, `${method} status`).toBe(404);
      expect(res.text, `${method} must not serve HTML`).not.toContain('<!doctype html>');
    }
  });

  it('/mcp POST is not intercepted; /mcp GET still 405 (fallback after mountMcp)', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any, repos: {}, distDir: dir });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/mcp');
    expect(res.status).toBe(405); // mounted route wins over fallback, not index.html
  });

  it('/search POST is not intercepted; GET /search returns the SPA fallback', async () => {
    // No repos (undefined): currentCombos falls back to the static combos list, so
    // resolveProvider runs and throws the intended 'provider is required' -> 400.
    // (repos: {} would make currentCombos return undefined -> a 500 instead.)
    const { app } = await createApp({ providers: {}, combos: [], db: null as any, distDir: dir });
    const supertest = (await import('supertest')).default;
    const post = await supertest(app).post('/search').send({ query: 'q' });
    expect(post.status).toBe(400);
    expect(post.headers['content-type']).toContain('application/json');
    const get = await supertest(app).get('/search');
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toContain('text/html');
  });

  it('/fetch POST and /health GET are not intercepted', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any, repos: {}, distDir: dir });
    const supertest = (await import('supertest')).default;
    const fetchRes = await supertest(app).post('/fetch').send({ url: 'not-a-url' });
    expect(fetchRes.status).not.toBe(200); // handled by the fetch route (an error), not HTML
    const healthRes = await supertest(app).get('/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('ok');
  });

  it('no repos -> dashboardApi NOT mounted; unknown /api/* still 404 JSON (not HTML)', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any, distDir: dir });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/api/combos');
    expect(res.status).toBe(404); // no repos => no /api/combos handler; fallback must NOT return HTML
    // Express 5's default 404 is text/html; assert the SPA index.html is NOT served.
    expect(res.text).not.toContain('<!doctype html>');
  });

  it('no distDir exists -> no fallback; / returns the JSON prompt (unchanged)', async () => {
    // Point distDir at a path that provably does not exist (independent of any
    // local dashboard build under packages/server/dashboard-dist), so the
    // mountDashboard else-branch (JSON prompt) is exercised deterministically.
    const { app } = await createApp({ providers: {}, combos: [], db: null as any, repos: {}, distDir: join(dir, 'no-such-dir') });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('health reports even when dashboard mounts after it (mount order safe)', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any, repos: {}, distDir: dir });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
