import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../app.js';
import { __setFetchContentForTests } from './fetch.js';
import { BodyTooLargeError } from '../../engines/http.js';

const PUBLIC_HTML = `<html><head><title>Art</title></head><body><article><p>${'x'.repeat(150)}</p></article></body></html>`;

describe('POST /fetch', () => {
  beforeEach(() => { __setFetchContentForTests(undefined); });

  it('returns extracted content', async () => {
    __setFetchContentForTests(async () => ({ title: 'Art', text: 'x'.repeat(150), mode: 'container' as const }));
    const { app } = await createApp({ providers: {}, combos: [], db: null as any });
    const res = await (await import('supertest')).default(app).post('/fetch').send({ url: 'https://example.com/a' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Art');
    expect(res.body.mode).toBe('container');
  });

  it('missing url -> 400', async () => {
    const { app } = await createApp({ providers: {}, combos: [], db: null as any });
    const res = await (await import('supertest')).default(app).post('/fetch').send({});
    expect(res.status).toBe(400);
  });

  it('private url -> rejected (SSRF)', async () => {
    __setFetchContentForTests(async (url: string) => { throw new Error('SSRF protection: url is private/local or invalid'); });
    const { app } = await createApp({ providers: {}, combos: [], db: null as any });
    const res = await (await import('supertest')).default(app).post('/fetch').send({ url: 'http://127.0.0.1' });
    expect(res.status).toBe(400);
    expect(res.body.error.kind).toBe('bad_request');
  });

  it('#13: oversized response body -> 400 bad_request, not 500', async () => {
    __setFetchContentForTests(async () => { throw new BodyTooLargeError(5 * 1024 * 1024, 6 * 1024 * 1024); });
    const { app } = await createApp({ providers: {}, combos: [], db: null as any });
    const res = await (await import('supertest')).default(app).post('/fetch').send({ url: 'https://example.com/big' });
    expect(res.status).toBe(400);
    expect(res.body.error.kind).toBe('bad_request');
  });
});