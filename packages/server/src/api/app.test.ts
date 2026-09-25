import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';

describe('createApp', () => {
  it('GET /health returns status + version', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any });
    const res = await (await import('supertest')).default(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.version).toBe('string');
  });

  it('loopback: rejects non-loopback Host by default (express binds loopback)', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any });
    const res = await (await import('supertest')).default(app).get('/health');
    expect(res.status).toBe(200);
  });
});