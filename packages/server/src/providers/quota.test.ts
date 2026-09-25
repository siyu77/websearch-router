import { describe, it, expect } from 'vitest';
import { quotaFromTavilyBody, quotaFromBraveHeaders, resetAtFromRetryAfter } from './quota.js';

describe('quota normalization', () => {
  it('tavily: reads usage.credits', () => {
    const q = quotaFromTavilyBody({ credits: 3 }, false);
    expect(q.remaining).toBe(3);
    expect(q.exhausted).toBe(false);
  });

  it('brave: reads X-RateLimit-* headers', () => {
    const q = quotaFromBraveHeaders({ 'x-ratelimit-remaining': '10', 'x-ratelimit-reset': '1750000000' }, false);
    expect(q.remaining).toBe(10);
    expect(q.exhausted).toBe(false);
    expect(typeof q.resetAt).toBe('number');
  });

  it('resetAt from Retry-After respects cap', () => {
    // Retry-After: 3600s = 1h, but capped at 5min
    const resetAt = resetAtFromRetryAfter('3600');
    expect(resetAt).toBeLessThanOrEqual(Date.now() + 300_000 + 5_000);
  });

  it('no quota headers -> exhausted when flagged', () => {
    const q = quotaFromBraveHeaders({}, true);
    expect(q.exhausted).toBe(true);
  });
});