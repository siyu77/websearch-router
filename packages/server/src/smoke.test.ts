import { describe, it, expect } from 'vitest';
import { createApp } from './api/app.js';
import type { Provider, Result } from './shared/types.js';

const ok = (id: string): Provider => ({
  id, async search() { return { results: [{ title: 't', url: `https://${id}.com/1`, snippet: 's', rank_in_source: 0 }] }; },
});
const blocked: Provider = { id: 'bing', async search() { return { results: [], error: { kind: 'blocked' } }; } };

describe('end-to-end smoke', () => {
  it('single-engine search returns results via REST', async () => {
    const { app } = await createApp({ providers: { bing: ok('bing'), ddg: ok('ddg') }, combos: [], db: null as any });
    const res = await (await import('supertest')).default(app).post('/search').send({ query: 'test', provider: 'bing' });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.meta.combo).toBe('inline');
  });

  it('partial failure tolerated, results still returned', async () => {
    const { app } = await createApp({ providers: { bing: blocked, ddg: ok('ddg') }, combos: [], db: null as any });
    const res = await (await import('supertest')).default(app).post('/search').send({ query: 'test', provider: { sources: [{ provider: 'bing' }, { provider: 'ddg' }] } });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(1);
    expect(res.body.partialFailures[0].source).toBe('bing');
  });
});
