import { describe, it, expect } from 'vitest';
import { selectTopLevelError } from './errors.js';
import type { SourceFailure } from '../shared/types.js';

describe('selectTopLevelError', () => {
  it('picks the earliest resetAt among failures that carry one', () => {
    const f: SourceFailure[] = [
      { source: 'a', error: { kind: 'ratelimit', provider: 'brave', resetAt: 2000 } },
      { source: 'b', error: { kind: 'quota', provider: 'tavily', resetAt: 1000 } },
    ];
    const err = selectTopLevelError(f)!;
    expect(err.kind).toBe('quota');
    expect(err.provider).toBe('tavily');
    expect(err.resetAt).toBe(1000);
  });

  it('ignores failures without resetAt when another has it', () => {
    const f: SourceFailure[] = [
      { source: 'a', error: { kind: 'blocked' } },
      { source: 'b', error: { kind: 'quota', provider: 'tavily', resetAt: 500 } },
    ];
    expect(selectTopLevelError(f)?.kind).toBe('quota');
  });

  it('uses kind priority when no resetAt present', () => {
    const f: SourceFailure[] = [
      { source: 'a', error: { kind: 'timeout' } },
      { source: 'b', error: { kind: 'auth' } },
      { source: 'c', error: { kind: 'blocked' } },
    ];
    expect(selectTopLevelError(f)?.kind).toBe('auth'); // auth highest priority
  });

  it('returns null for empty failures', () => {
    expect(selectTopLevelError([])).toBeNull();
  });
});