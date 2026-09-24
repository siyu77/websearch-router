import { describe, it, expect } from 'vitest';
import { sendError, sendBadRequest } from './errors.js';

// Minimal Express response stub: records status + body.
const mkRes = () => {
  let status = 0;
  let body: any = undefined;
  return {
    status: (s: number) => { status = s; return { json: (b: any) => { body = b; } }; },
    json: (b: any) => { body = b; },
    _status: () => status,
    _body: () => body,
  } as any;
};

describe('sendError', () => {
  it('emits status + error envelope without meta by default (backward-compatible)', () => {
    const res = mkRes();
    sendError(res, 'blocked', { provider: 'google' });
    expect(res._status()).toBe(503);
    expect(res._body()).toEqual({ error: { kind: 'blocked', provider: 'google' } });
  });

  it('forwards sourceTimings to meta.sourceTimings when provided (#engine-test)', () => {
    const res = mkRes();
    sendError(res, 'auth', { provider: 'tavily', sourceTimings: { tavily: 1234 } });
    expect(res._status()).toBe(401);
    expect(res._body()).toEqual({
      error: { kind: 'auth', provider: 'tavily' },
      meta: { sourceTimings: { tavily: 1234 } },
    });
  });
});

describe('sendBadRequest', () => {
  it('emits 400 bad_request with message', () => {
    const res = mkRes();
    sendBadRequest(res, 'nope');
    expect(res._status()).toBe(400);
    expect(res._body()).toEqual({ error: { kind: 'bad_request', message: 'nope' } });
  });
});