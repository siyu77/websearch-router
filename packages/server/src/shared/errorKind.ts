// `ratelimit` is shared: keyless academic engines (openalex/crossref/arxiv)
// also emit it on HTTP 429, even though they never carry resetAt (free kinds
// stay resetAt-less — the quota/backoff machinery is paid-provider-only).
export type FreeErrorKind = 'blocked' | 'timeout' | 'transient' | 'ratelimit' | 'unknown';
export type PaidErrorKind = 'ratelimit' | 'quota' | 'auth' | 'transient' | 'unknown';
export type ErrorKind = 'blocked' | 'timeout' | 'ratelimit' | 'quota' | 'auth' | 'transient' | 'unknown';

// All-source-failure HTTP status (per-source failures stay in partialFailures, no HTTP error).
export function errorKindToHttpStatus(kind: ErrorKind): number {
  switch (kind) {
    case 'quota': case 'ratelimit': return 429;
    case 'auth': return 401;
    case 'blocked': case 'timeout': case 'transient': return 503;
    case 'unknown': return 500;
  }
}

export const KIND_PRIORITY: ErrorKind[] = ['auth', 'quota', 'ratelimit', 'blocked', 'timeout', 'transient', 'unknown'];
