import type { FreeErrorKind } from '../shared/errorKind.js';

// Single shared classification for exceptions thrown by engines/http/adapters.
// The regex union covers the four copies that previously lived in
// bing/google/ddg/execute.ts (DRY): timeout/abort -> timeout, network-level
// failures -> transient, everything else -> unknown. Only ever produces free
// kinds, which are a subset of the unified ErrorKind — so engines can consume
// it directly and routing can widen it freely.
export function classifyError(e: unknown): FreeErrorKind {
  const msg = e instanceof Error ? e.message : String(e);
  if (/timeout|etimedout|abort/i.test(msg)) return 'timeout';
  if (/network|econnreset|econnrefused/i.test(msg)) return 'transient';
  return 'unknown';
}
