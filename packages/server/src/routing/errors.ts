import type { SourceFailure } from '../shared/types.js';
import { KIND_PRIORITY, type ErrorKind } from '../shared/errorKind.js';

export function selectTopLevelError(failures: SourceFailure[]): { kind: ErrorKind; provider?: string; resetAt?: number } | null {
  if (failures.length === 0) return null;

  const withReset = failures.filter((f) => typeof f.error.resetAt === 'number');
  if (withReset.length > 0) {
    const earliest = withReset.reduce((a, b) => (a.error.resetAt! < b.error.resetAt! ? a : b));
    return { kind: earliest.error.kind, provider: earliest.error.provider, resetAt: earliest.error.resetAt };
  }

  for (const kind of KIND_PRIORITY) {
    const hit = failures.find((f) => f.error.kind === kind);
    if (hit) return { kind, provider: hit.error.provider };
  }
  return { kind: failures[0].error.kind, provider: failures[0].error.provider };
}