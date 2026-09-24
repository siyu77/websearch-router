import { describe, it, expect } from 'vitest';
import { executeCombo } from './execute.js';
import { selectTopLevelError } from './errors.js';
import type { Combo } from './combo.js';
import type { Provider, Result } from '../shared/types.js';

const mkProvider = (id: string, results: Result[] | ((q: string) => Promise<Result[]>), error?: any): Provider => ({
  id,
  async search(q: string) {
    if (error) return { results: [], error };
    const r = typeof results === 'function' ? await results(q) : results;
    return { results: r, quota: null };
  },
});

const res = (url: string, rank = 0): Result => ({ title: `t`, url, snippet: '', rank_in_source: rank });

const combo: Combo = {
  id: 'c1', sources: [{ provider: 'a' }, { provider: 'b' }], mode: 'concurrent',
  merge: { dedupe: 'url-normalized', rank: 'rrf', cap: 20 },
  fallback: { on: ['timeout', 'error', 'empty'], min_results: 5 },
};

describe('executeCombo', () => {
  it('concurrent: merges results, records partialFailures, calls onSourceDone per source', async () => {
    const providers = {
      a: mkProvider('a', [res('https://a.com/1')]),
      b: mkProvider('b', [], { kind: 'blocked' }),
    };
    const done: string[] = [];
    const r = await executeCombo(combo, 'q', providers, {
      onSourceDone: (src) => done.push(src),
    });
    expect(r.results.length).toBe(1);
    expect(r.partialFailures).toHaveLength(1);
    expect(r.partialFailures[0].source).toBe('b');
    expect(r.partialFailures[0].error.kind).toBe('blocked');
    expect(done.sort()).toEqual(['a', 'b']);
    expect(r.meta.sourceTimings.a).toBeTypeOf('number');
    expect(r.meta.degraded).toBe(false);
  });

  it('sequential: stops at first source with >= min_results', async () => {
    const calls: string[] = [];
    const providers = {
      a: mkProvider('a', async () => { calls.push('a'); return [res('https://a.com/1')]; }),
      b: mkProvider('b', async () => { calls.push('b'); return [res('https://b.com/1')]; }),
    };
    const seq: Combo = { ...combo, mode: 'sequential', sources: [{ provider: 'a' }, { provider: 'b' }], fallback: { on: ['error', 'empty'], min_results: 1 } };
    await executeCombo(seq, 'q', providers);
    expect(calls).toEqual(['a']); // b never called
  });

  it('sequential: falls through when below min_results', async () => {
    const providers = {
      a: mkProvider('a', []), // empty
      b: mkProvider('b', [res('https://b.com/1')]),
    };
    const seq: Combo = { ...combo, mode: 'sequential', sources: [{ provider: 'a' }, { provider: 'b' }], fallback: { on: ['empty'], min_results: 1 } };
    const r = await executeCombo(seq, 'q', providers);
    expect(r.results.length).toBe(1);
  });

  it('hybrid: concurrent first N, fills if below min_results, marks degraded', async () => {
    const calls: string[] = [];
    const providers = {
      a: mkProvider('a', async () => { calls.push('a'); return [res('https://a.com/1')]; }),
      b: mkProvider('b', async () => { calls.push('b'); return []; }),
      c: mkProvider('c', async () => { calls.push('c'); return [res('https://c.com/1')]; }),
    };
    const hy: Combo = { ...combo, mode: 'hybrid', hybrid: { concurrentCount: 2 }, sources: [{ provider: 'a' }, { provider: 'b' }, { provider: 'c' }], fallback: { on: ['empty'], min_results: 2 } };
    const r = await executeCombo(hy, 'q', providers);
    expect(r.meta.degraded).toBe(true); // fill triggered
    expect(r.results.length).toBe(2);
    expect(calls).toEqual(expect.arrayContaining(['a', 'b'])); // a+b concurrent
    expect(calls).toContain('c'); // c filled sequentially
  });

  it('all sources fail -> top-level error, provider carried through (#1/#7)', async () => {
    const providers = {
      a: mkProvider('a', [], { kind: 'blocked' }),
      b: mkProvider('b', [], { kind: 'blocked' }),
    };
    const r = await executeCombo(combo, 'q', providers);
    expect(r.results).toHaveLength(0);
    expect(r.partialFailures).toHaveLength(2);
    expect(r.meta.degraded).toBe(false);
    // #1/#7: failures (and therefore the top-level error) now carry the provider.
    expect(r.error).toEqual({ kind: 'blocked', provider: 'a' });
    expect(r.partialFailures[0].error.provider).toBe('a');
    expect(selectTopLevelError(r.partialFailures)).toEqual({ kind: 'blocked', provider: 'a' }); // still consistent
  });

  it('empty-success counts toward all-source failure (unified #6/#7)', async () => {
    const providers = {
      a: mkProvider('a', []), // empty success — no error
      b: mkProvider('b', [], { kind: 'blocked' }),
    };
    const r = await executeCombo(combo, 'q', providers);
    expect(r.partialFailures).toHaveLength(1); // only b errored
    expect(r.error).toBeDefined(); // but a's empty result counts as a failed source
    expect(r.error?.kind).toBe('blocked');
    expect(r.error?.provider).toBe('b');
  });

  it('limit is forwarded to provider.search (#5)', async () => {
    const limits: number[] = [];
    const providers = {
      a: { id: 'a', async search(_q: string, limit: number) { limits.push(limit); return { results: [res('https://a.com/1')], quota: null }; } } as Provider,
    };
    await executeCombo(combo, 'q', providers, { limit: 7 });
    expect(limits).toEqual([7]);
  });

  it('sequential: fallback.on mismatch stops the chain even below min_results (F2)', async () => {
    const calls: string[] = [];
    const providers = {
      a: mkProvider('a', [], { kind: 'blocked' }), // blocked NOT in on:['empty']
      b: mkProvider('b', async () => { calls.push('b'); return [res('https://b.com/1')]; }),
    };
    const seq: Combo = { ...combo, mode: 'sequential', sources: [{ provider: 'a' }, { provider: 'b' }], fallback: { on: ['empty'], min_results: 1 } };
    const r = await executeCombo(seq, 'q', providers);
    expect(calls).toEqual([]); // a blocked but on:['empty'] -> no fall-through
    expect(r.results).toHaveLength(0);
  });

  it('sequential: fallback.on match falls through (F2)', async () => {
    const calls: string[] = [];
    const providers = {
      a: mkProvider('a', [], { kind: 'blocked' }),
      b: mkProvider('b', async () => { calls.push('b'); return [res('https://b.com/1')]; }),
    };
    const seq: Combo = { ...combo, mode: 'sequential', sources: [{ provider: 'a' }, { provider: 'b' }], fallback: { on: ['error'], min_results: 1 } };
    const r = await executeCombo(seq, 'q', providers);
    expect(calls).toEqual(['b']); // blocked -> 'error' trigger matches
    expect(r.results).toHaveLength(1);
  });

  it('on: [] treats every failure as a fall-through (test/legacy behavior)', async () => {
    const calls: string[] = [];
    const providers = {
      a: mkProvider('a', [], { kind: 'blocked' }),
      b: mkProvider('b', async () => { calls.push('b'); return [res('https://b.com/1')]; }),
    };
    const seq: Combo = { ...combo, mode: 'sequential', sources: [{ provider: 'a' }, { provider: 'b' }], fallback: { on: [], min_results: 1 } };
    const r = await executeCombo(seq, 'q', providers);
    expect(calls).toEqual(['b']);
    expect(r.results).toHaveLength(1);
  });

  it('hybrid: fill only fires when a first-N source had a matching failure (F2)', async () => {
    const calls: string[] = [];
    const providers = {
      a: mkProvider('a', async () => { calls.push('a'); return [res('https://a.com/1')]; }),
      b: mkProvider('b', async () => { calls.push('b'); return []; }), // empty, on:['error'] doesn't match
      c: mkProvider('c', async () => { calls.push('c'); return [res('https://c.com/1')]; }),
    };
    const hy: Combo = { ...combo, mode: 'hybrid', hybrid: { concurrentCount: 2 }, sources: [{ provider: 'a' }, { provider: 'b' }, { provider: 'c' }], fallback: { on: ['error'], min_results: 2 } };
    const r = await executeCombo(hy, 'q', providers);
    expect(calls).toEqual(['a', 'b']); // c never filled: no matching failure among first N
    expect(r.meta.degraded).toBe(false);
    expect(r.results.length).toBe(1);
  });

  it('hybrid: sourceResultCounts reports pre-merge counts (#12)', async () => {
    const providers = {
      a: mkProvider('a', [res('https://a.com/1'), res('https://a.com/2')]),
      b: mkProvider('b', []),
    };
    const r = await executeCombo(combo, 'q', providers);
    expect(r.sourceResultCounts.a).toBe(2);
    expect(r.sourceResultCounts.b).toBe(0);
  });

  it('unknown provider becomes a partialFailure', async () => {
    const providers = { a: mkProvider('a', [res('https://a.com/1')]) };
    const r = await executeCombo(combo, 'q', providers);
    expect(r.partialFailures).toHaveLength(1);
    expect(r.partialFailures[0].source).toBe('b');
  });

  it('S3: filters private/local and non-http result URLs before merging', async () => {
    const providers = {
      a: mkProvider('a', [
        res('https://a.com/1'),
        res('http://127.0.0.1/x'),          // loopback — dropped
        res('http://[::1]/y'),              // IPv6 loopback — dropped
        res('ftp://a.com/z'),               // non-http — dropped
        res('not a url'),                   // unparseable — dropped
      ]),
      b: mkProvider('b', [res('http://localhost:8080/secret')]), // localhost — dropped
    };
    const r = await executeCombo(combo, 'q', providers);
    expect(r.results.map((x) => x.url).sort()).toEqual(['https://a.com/1']);
    // sourceResultCounts still reflects pre-filter counts (routing counts, S3 filters)
    expect(r.sourceResultCounts.a).toBe(5);
  });

  // C1 end-to-end: a free engine's 'blocked' must survive DefaultProvider -> execute
  // -> SourceFailure -> partialFailures as 'blocked' (not collapsed to 'transient').
  it('free-engine blocked propagates as blocked through DefaultProvider -> partialFailures', async () => {
    const { DefaultProvider } = await import('../providers/defaultProvider.js');
    const blockedProvider = new DefaultProvider({ id: 'bing', async search() { return { results: [], error: { kind: 'blocked' } }; } } as any);
    const providers = { a: blockedProvider, b: mkProvider('b', [res('https://b.com/1')]) };
    const r = await executeCombo(combo, 'q', providers);
    expect(r.partialFailures).toHaveLength(1);
    expect(r.partialFailures[0].source).toBe('a');
    expect(r.partialFailures[0].error.kind).toBe('blocked');
  });

  it('merges ref.accountId into provider.search ctx (#engine-test)', async () => {
    const ctxs: any[] = [];
    const providers = {
      a: { id: 'a', async search(_q: string, _limit: number, ctx?: any) { ctxs.push(ctx); return { results: [res('https://a.com/1')], quota: null }; } } as Provider,
    };
    const one: Combo = { ...combo, sources: [{ provider: 'a', accountId: 'acct-9' }] };
    await executeCombo(one, 'q', providers);
    expect(ctxs).toHaveLength(1);
    expect(ctxs[0].accountId).toBe('acct-9');
    expect(ctxs[0].timeoutMs).toBeTypeOf('number'); // existing fields still present
  });
});