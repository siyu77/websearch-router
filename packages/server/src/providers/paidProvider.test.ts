import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initAdapterForPath } from '../db/driver.js';
import { runMigrationOnce } from '../db/migrate.js';
import { upsert, type ProviderConnection } from '../db/repos/connectionsRepo.js';
import { createPaidProvider, type AccountStatus } from './paidProvider.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface StatusWrite { id: string; status: AccountStatus }

describe('paid provider', () => {
  let adapter: any; let dir: string;
  let writes: StatusWrite[];
  let inactive: string[];
  let statuses: Map<string, AccountStatus>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wsr-'));
    adapter = await initAdapterForPath(join(dir, 'data.sqlite'));
    await runMigrationOnce(adapter);
    writes = [];
    inactive = [];
    statuses = new Map();
  });
  afterEach(() => { adapter?.close?.(); rmSync(dir!, { recursive: true, force: true }); });

  const now = () => new Date().toISOString();
  const conn = (id: string, priority: number, key: string): ProviderConnection =>
    ({ id, provider: 'tavily', authType: 'apikey', priority, isActive: true, data: { apiKey: key }, createdAt: now(), updatedAt: now() });

  const baseRepo = {
    listByProvider: (a: any) => a === adapter ? [conn('a1', 0, 'k1'), conn('a2', 1, 'k2')] : [],
    setIsActive: (_a: any, id: string) => { inactive.push(id); },
  };

  // stateful per-account status: every write is captured and readable back,
  // so getAccountStatus sees the latest written cooldown/quota/lastError.
  const getAccountStatus = (account: any): AccountStatus =>
    statuses.get(account.id) ?? { cooldown: undefined, quota: undefined, lastError: undefined };
  const writeAccountStatus = (id: string, status: AccountStatus) => {
    writes.push({ id, status });
    statuses.set(id, status);
  };

  it('selects primary account, succeeds, writes back quota + resets backoff', async () => {
    upsert(adapter, conn('a1', 0, 'k1'));
    upsert(adapter, conn('a2', 1, 'k2'));

    const calls: string[] = [];
    const provider = createPaidProvider({
      id: 'tavily', adapter: {
        async search(account: any) {
          calls.push(account.data.apiKey);
          return { results: [{ title: 't', url: 'u', snippet: 's', rank_in_source: 0 }], quota: { remaining: 5, exhausted: false } };
        },
      },
      repo: { ...baseRepo } as any,
      getAccountStatus,
      writeAccountStatus,
    }, adapter);

    const r = await provider.search('q', 5);
    expect(calls).toEqual(['k1']);
    expect(r.results.length).toBe(1);
    expect(r.quota?.remaining).toBe(5);
    // success path: backoff level reset to 0, quota written back
    expect(writes).toContainEqual({ id: 'a1', status: { cooldown: { until: 0, level: 0 }, quota: { remaining: 5, exhausted: false }, lastError: undefined } });
  });

  it('ratelimit: writes cooldown on primary, falls back to next account', async () => {
    upsert(adapter, conn('a1', 0, 'k1'));
    upsert(adapter, conn('a2', 1, 'k2'));

    const calls: string[] = [];
    const provider = createPaidProvider({
      id: 'tavily', adapter: {
        async search(account: any) {
          calls.push(account.data.apiKey);
          if (account.data.apiKey === 'k1') return { error: { kind: 'ratelimit' } };
          return { results: [{ title: 't', url: 'u', snippet: 's', rank_in_source: 0 }], quota: { remaining: 5, exhausted: false } };
        },
      },
      repo: { ...baseRepo } as any,
      getAccountStatus,
      writeAccountStatus,
    }, adapter);

    const r = await provider.search('q', 5);
    expect(calls).toEqual(['k1', 'k2']); // fell through to account 2
    expect(r.results.length).toBe(1);

    const a1 = writes.find((w) => w.id === 'a1');
    expect(a1?.status.lastError).toBe('ratelimit');
    expect(a1?.status.cooldown?.level).toBe(1); // applyErrorRule(429, 0) -> nextBackoffLevel(0) = 1
    expect(a1?.status.cooldown?.until).toBeGreaterThan(Date.now()); // ~now + 2000ms (getQuotaCooldown(1))
  });

  it('all accounts fail: returns { results: [], error } assembled from lastError', async () => {
    upsert(adapter, conn('a1', 0, 'k1'));
    upsert(adapter, conn('a2', 1, 'k2'));

    const calls: string[] = [];
    const provider = createPaidProvider({
      id: 'tavily', adapter: {
        async search(account: any) {
          calls.push(account.data.apiKey);
          if (account.data.apiKey === 'k1') return { error: { kind: 'ratelimit', resetAt: 1_700_000_000_000 } };
          return { error: { kind: 'quota' } };
        },
      },
      repo: { ...baseRepo } as any,
      getAccountStatus,
      writeAccountStatus,
    }, adapter);

    const r = await provider.search('q', 5);
    expect(calls).toEqual(['k1', 'k2']); // every account attempted
    expect(r.results).toEqual([]);
    expect(r.error?.kind).toBe('ratelimit'); // first failing account's lastError wins
    expect(r.error?.resetAt).toBe(1_700_000_000_000); // carried through the quota writeback
  });

  it('#1: error with resetAt writes ONE status combining cooldown + lastError + quota (no stale-snapshot overwrite)', async () => {
    upsert(adapter, conn('a1', 0, 'k1'));
    upsert(adapter, conn('a2', 1, 'k2'));

    const provider = createPaidProvider({
      id: 'tavily', adapter: {
        async search(account: any) {
          if (account.data.apiKey === 'k1') return { error: { kind: 'ratelimit', resetAt: 1_800_000_000_000 } };
          return { results: [{ title: 't', url: 'u', snippet: 's', rank_in_source: 0 }] };
        },
      },
      repo: { ...baseRepo } as any,
      getAccountStatus,
      writeAccountStatus,
    }, adapter);

    const r = await provider.search('q', 5);
    expect(r.results.length).toBe(1); // fell back to a2

    // Exactly ONE write-back for the failing account, and it carries all three
    // fields together. (The old bug did a second write that re-read the stale
    // snapshot and replaced the status with quota-only, erasing cooldown+lastError.)
    const a1Writes = writes.filter((w) => w.id === 'a1');
    expect(a1Writes).toHaveLength(1);
    const w = a1Writes[0];
    expect(w.status.lastError).toBe('ratelimit');
    expect(w.status.cooldown?.level).toBe(1);
    expect(w.status.cooldown?.until).toBeGreaterThan(Date.now());
    expect(w.status.quota).toEqual({ exhausted: true, resetAt: 1_800_000_000_000, remaining: 0 });
  });

  it('auth error: marks primary inactive, falls back', async () => {
    upsert(adapter, conn('a1', 0, 'k1'));
    upsert(adapter, conn('a2', 1, 'k2'));

    const calls: string[] = [];
    const provider = createPaidProvider({
      id: 'tavily', adapter: {
        async search(account: any) {
          calls.push(account.data.apiKey);
          if (account.data.apiKey === 'k1') return { error: { kind: 'auth' } };
          return { results: [{ title: 't', url: 'u', snippet: 's', rank_in_source: 0 }], quota: { remaining: 5, exhausted: false } };
        },
      },
      repo: { ...baseRepo } as any,
      getAccountStatus,
      writeAccountStatus,
    }, adapter);

    const r = await provider.search('q', 5);
    expect(inactive).toEqual(['a1']); // setIsActive('a1', false) called
    expect(calls).toEqual(['k1', 'k2']);

    const a1 = writes.find((w) => w.id === 'a1');
    expect(a1?.status.lastError).toBe('auth');
    expect(r.results.length).toBe(1);
  });

  it('single-account: locates the named account and runs only it (#engine-test)', async () => {
    upsert(adapter, conn('a1', 0, 'k1'));
    upsert(adapter, conn('a2', 1, 'k2'));

    const calls: string[] = [];
    const provider = createPaidProvider({
      id: 'tavily', adapter: {
        async search(account: any) {
          calls.push(account.id);
          return { results: [{ title: 't', url: 'u', snippet: 's', rank_in_source: 0 }], quota: { remaining: 5, exhausted: false } };
        },
      },
      repo: { ...baseRepo } as any,
      getAccountStatus,
      writeAccountStatus,
    }, adapter);

    // ctx.accountId targets a2 even though it is NOT priority 0
    const r = await provider.search('q', 5, { accountId: 'a2' });
    expect(calls).toEqual(['a2']); // only the named account, no polling
    expect(r.results.length).toBe(1);
    expect(r.quota?.remaining).toBe(5);
  });

  it('single-account: runs an inactive account (no isActive filter)', async () => {
    // baseRepo hard-codes both accounts active; override listByProvider so a2
    // genuinely comes back inactive, proving the single-account branch does not
    // filter on isActive (decision 7).
    const activeA1 = conn('a1', 0, 'k1');
    const inactiveA2 = conn('a2', 1, 'k2');
    inactiveA2.isActive = false;
    const repo = {
      listByProvider: () => [activeA1, inactiveA2],
      setIsActive: (_a: any, id: string) => { inactive.push(id); },
    };

    const calls: string[] = [];
    const provider = createPaidProvider({
      id: 'tavily', adapter: {
        async search(account: any) { calls.push(account.id); return { results: [], error: { kind: 'auth' } }; },
      },
      repo: repo as any,
      getAccountStatus,
      writeAccountStatus,
    }, adapter);

    await provider.search('q', 5, { accountId: 'a2' });
    expect(calls).toEqual(['a2']); // inactive account still tested
  });

  it('single-account: unknown accountId -> { results: [], error: { kind: "unknown" } }', async () => {
    upsert(adapter, conn('a1', 0, 'k1'));
    const provider = createPaidProvider({
      id: 'tavily', adapter: { async search() { throw new Error('should not be called'); } },
      repo: { ...baseRepo } as any, getAccountStatus, writeAccountStatus,
    }, adapter);

    const r = await provider.search('q', 5, { accountId: 'does-not-exist' });
    expect(r.results).toEqual([]);
    expect(r.error?.kind).toBe('unknown');
  });

  it('single-account: auth failure disables the account (ERROR_RULES write-back)', async () => {
    upsert(adapter, conn('a1', 0, 'k1'));
    const provider = createPaidProvider({
      id: 'tavily', adapter: {
        async search() { return { results: [], error: { kind: 'auth' } }; },
      },
      repo: { ...baseRepo } as any, getAccountStatus, writeAccountStatus,
    }, adapter);

    const r = await provider.search('q', 5, { accountId: 'a1' });
    expect(inactive).toEqual(['a1']); // markInactive -> setIsActive('a1', false)
    expect(r.error?.kind).toBe('auth');
    const a1 = writes.find((w) => w.id === 'a1');
    expect(a1?.status.lastError).toBe('auth');
  });

  it('single-account: quota failure writes a long cooldown', async () => {
    upsert(adapter, conn('a1', 0, 'k1'));
    const provider = createPaidProvider({
      id: 'tavily', adapter: {
        async search() { return { results: [], error: { kind: 'quota' } }; },
      },
      repo: { ...baseRepo } as any, getAccountStatus, writeAccountStatus,
    }, adapter);

    await provider.search('q', 5, { accountId: 'a1' });
    const a1 = writes.find((w) => w.id === 'a1');
    expect(a1?.status.lastError).toBe('quota');
    // httpStatusFromKind('quota') = 402 -> ERROR_RULES long-cooldown (LONG_COOLDOWN_MS = 15min)
    expect(a1?.status.cooldown?.level).toBe(0); // long-cooldown resets level to 0
    expect(a1?.status.cooldown?.until).toBeGreaterThan(Date.now() + 14 * 60 * 1000); // ~now + 15min
  });

  it('no accountId -> existing polling behavior unchanged (regression)', async () => {
    upsert(adapter, conn('a1', 0, 'k1'));
    upsert(adapter, conn('a2', 1, 'k2'));
    const calls: string[] = [];
    const provider = createPaidProvider({
      id: 'tavily', adapter: {
        async search(account: any) {
          calls.push(account.data.apiKey);
          if (account.data.apiKey === 'k1') return { error: { kind: 'ratelimit' } };
          return { results: [{ title: 't', url: 'u', snippet: 's', rank_in_source: 0 }], quota: { remaining: 5, exhausted: false } };
        },
      },
      repo: { ...baseRepo } as any, getAccountStatus, writeAccountStatus,
    }, adapter);

    const r = await provider.search('q', 5); // no ctx / no accountId
    expect(calls).toEqual(['k1', 'k2']); // priority polling, fell through
    expect(r.results.length).toBe(1);
  });
});
