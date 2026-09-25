import { describe, it, expect } from 'vitest';
import { selectAccount } from './accountSelector.js';
import { DefaultProvider } from './defaultProvider.js';
import type { ProviderConnection } from '../db/repos/connectionsRepo.js';

const conn = (id: string, priority: number, isActive = true, cooldownUntil?: number): ProviderConnection => ({
  id, provider: 'tavily', authType: 'apikey', priority, isActive,
  data: cooldownUntil ? { cooldown: { until: cooldownUntil, level: 1 } } : {},
  createdAt: '', updatedAt: '',
});

describe('accountSelector', () => {
  const now = Date.now();
  it('selects lowest priority number among active, non-cooldown', () => {
    const c = [conn('b', 2), conn('a', 0), conn('c', 1)];
    expect(selectAccount(c, now)?.id).toBe('a'); // priority 0
  });
  it('skips accounts in cooldown', () => {
    const c = [conn('a', 0, true, now + 10_000), conn('b', 1), conn('c', 2)];
    expect(selectAccount(c, now)?.id).toBe('b');
  });
  it('returns null when all active accounts are in cooldown', () => {
    const c = [conn('a', 0, true, now + 10_000), conn('b', 1, true, now + 10_000)];
    expect(selectAccount(c, now)).toBeNull();
  });
  it('ignores inactive accounts', () => {
    const c = [conn('a', 0, false), conn('b', 1)];
    expect(selectAccount(c, now)?.id).toBe('b');
  });
});

describe('DefaultProvider', () => {
  it('delegates to the engine and reports null quota', async () => {
    const engine = {
      id: 'bing',
      async search(q: string, limit: number) { return { results: [{ title: 't', url: 'u', snippet: 's', rank_in_source: 0 }] }; },
    };
    const p = new DefaultProvider(engine as any);
    expect(p.id).toBe('default:bing');
    const r = await p.search('hello', 5);
    expect(r.results.length).toBe(1);
    expect(r.quota).toBeNull();
    expect(p.getAccount?.().priority).toBe(0);
  });

  // C1 regression: a free engine's failure kind (blocked/timeout/...) must propagate
  // through DefaultProvider unchanged — it must NOT be collapsed to 'transient'.
  it.each([
    ['blocked', 'blocked'],
    ['timeout', 'timeout'],
    ['transient', 'transient'],
    ['unknown', 'unknown'],
  ])('free-engine error kind %s propagates as %s (not collapsed to transient)', async (engineKind, expected) => {
    const engine = {
      id: 'bing',
      async search() { return { results: [], error: { kind: engineKind } }; },
    };
    const p = new DefaultProvider(engine as any);
    const r = await p.search('q', 5);
    expect(r.error?.kind).toBe(expected);
  });
});