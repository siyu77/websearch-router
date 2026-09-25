import { describe, it, expect } from 'vitest';
import { normalizeCombo, ComboValidationError, findStoredCombo } from './normalizeCombo.js';

describe('normalizeCombo', () => {
  it('defaults every optional field', () => {
    const c = normalizeCombo({ sources: [{ provider: 'a' }] });
    expect(c.sources[0].timeoutMs).toBe(15000);
    expect(c.mode).toBe('concurrent');
    expect(c.fallback.on).toEqual(['timeout', 'error', 'empty']); // matches built-in defaults
    expect(c.fallback.min_results).toBe(5);
    expect(c.merge.cap).toBe(20);
    expect(c.merge.dedupe).toBe('url-normalized');
    expect(c.hybrid.concurrentCount).toBe(1);
  });

  it('accepts a combo passed as a JSON string', () => {
    const c = normalizeCombo(JSON.stringify({ sources: [{ provider: 'a' }] }));
    expect(c.sources).toHaveLength(1);
  });

  it('rejects invalid JSON (#10)', () => {
    expect(() => normalizeCombo('{nope')).toThrow(ComboValidationError);
  });

  it('rejects empty sources', () => {
    expect(() => normalizeCombo({ sources: [] })).toThrow(ComboValidationError);
  });

  it('applies a request-level mode override', () => {
    const c = normalizeCombo({ sources: [{ provider: 'a' }] }, { mode: 'sequential' });
    expect(c.mode).toBe('sequential');
  });

  it('preserves the on:[] sentinel (every failure triggers fall-through)', () => {
    const c = normalizeCombo({ sources: [{ provider: 'a' }], fallback: { on: [], min_results: 1 } });
    expect(c.fallback.on).toEqual([]);
  });

  it('defaults fallback.on when every trigger is invalid', () => {
    const c = normalizeCombo({ sources: [{ provider: 'a' }], fallback: { on: ['bogus'] } });
    expect(c.fallback.on).toEqual(['timeout', 'error', 'empty']);
  });

  it('passes accountId through to each source (#engine-test)', () => {
    const c = normalizeCombo({ sources: [{ provider: 'tavily', accountId: 'acct-1' }] });
    expect(c.sources[0].accountId).toBe('acct-1');
  });

  it('omits accountId when not a non-empty string', () => {
    const c = normalizeCombo({ sources: [{ provider: 'tavily' }, { provider: 'brave', accountId: '' }] });
    expect(c.sources[0].accountId).toBeUndefined();
    expect(c.sources[1].accountId).toBeUndefined();
  });

  it('normalizes a single-source inline combo (single-engine test)', () => {
    const c = normalizeCombo({ sources: [{ provider: 'google' }] });
    expect(c.sources).toHaveLength(1);
    expect(c.sources[0].provider).toBe('google');
    expect(c.id).toBe('inline'); // fallbackId default
  });

  it('findStoredCombo matches name case-insensitively, id exactly', () => {
    const combos = [
      { id: 'web', name: 'WEB', sources: [], mode: 'concurrent' as const, merge: { dedupe: 'url-normalized' as const, rank: 'rrf' as const, cap: 20 }, fallback: { on: [] as any, min_results: 1 } },
      { id: 'c-saved', name: 'Saved Combo', sources: [], mode: 'concurrent' as const, merge: { dedupe: 'url-normalized' as const, rank: 'rrf' as const, cap: 20 }, fallback: { on: [] as any, min_results: 1 } },
    ];
    expect(findStoredCombo(combos, 'WEB')?.id).toBe('web');
    expect(findStoredCombo(combos, 'web')?.id).toBe('web');   // lowercase name hits too
    expect(findStoredCombo(combos, 'WeB')?.id).toBe('web');   // mixed case
    expect(findStoredCombo(combos, 'saved combo')?.id).toBe('c-saved');
    // id matching stays exact (opaque identifiers are not case-folded).
    expect(findStoredCombo(combos, 'c-saved')?.id).toBe('c-saved');
    expect(findStoredCombo(combos, 'C-SAVED')).toBeUndefined();
    expect(findStoredCombo(combos, 'nope')).toBeUndefined();
  });
});
