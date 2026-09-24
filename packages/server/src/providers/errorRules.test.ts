import { describe, it, expect } from 'vitest';
import { ERROR_RULES, BACKOFF, getQuotaCooldown, applyErrorRule, nextBackoffLevel } from './errorRules.js';

describe('error rules', () => {
  it('maps HTTP statuses to kinds', () => {
    expect(ERROR_RULES[429].kind).toBe('ratelimit');
    expect(ERROR_RULES[432].kind).toBe('quota');
    expect(ERROR_RULES[433].kind).toBe('quota');
    expect(ERROR_RULES[402].kind).toBe('quota');
    expect(ERROR_RULES[401].kind).toBe('auth');
  });

  it('backoff is exponential and capped at 5min', () => {
    expect(getQuotaCooldown(1)).toBe(BACKOFF.base);        // 2s
    expect(getQuotaCooldown(2)).toBe(BACKOFF.base * 2);    // 4s
    expect(getQuotaCooldown(10)).toBeLessThanOrEqual(BACKOFF.max);
    expect(getQuotaCooldown(20)).toBe(BACKOFF.max);        // capped
  });

  it('applyErrorRule: 429 -> backoff with growing level; 432 -> long cooldown; 401 -> mark inactive', () => {
    const rl = applyErrorRule(429, 1);
    expect(rl.kind).toBe('ratelimit');
    expect(rl.newLevel).toBe(2);
    expect(rl.cooldownMs).toBe(getQuotaCooldown(2));

    const q = applyErrorRule(432, 0);
    expect(q.kind).toBe('quota');
    expect(q.cooldownMs).toBeGreaterThan(BACKOFF.max * 2); // long cooldown

    const a = applyErrorRule(401, 0);
    expect(a.kind).toBe('auth');
    expect(a.markInactive).toBe(true);
  });

  it('nextBackoffLevel caps at maxLevel', () => {
    expect(nextBackoffLevel(BACKOFF.maxLevel)).toBe(BACKOFF.maxLevel);
  });
});
