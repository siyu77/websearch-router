import type { QuotaInfo } from '../shared/types.js';
import { BACKOFF } from './errorRules.js';

export function normalizeQuota(partial: Partial<QuotaInfo>): QuotaInfo {
  return { remaining: partial.remaining, resetAt: partial.resetAt, exhausted: partial.exhausted === true };
}

export function quotaFromTavilyBody(usage: { credits?: number } | undefined, exhausted: boolean): QuotaInfo {
  return normalizeQuota({ remaining: usage?.credits, exhausted });
}

export function quotaFromBraveHeaders(headers: Record<string, string>, exhausted: boolean): QuotaInfo {
  const remRaw = headers['x-ratelimit-remaining'];
  const resetRaw = headers['x-ratelimit-reset'];
  const rem = remRaw ? Number(remRaw) : undefined;
  const reset = resetRaw ? Number(resetRaw) : undefined;
  return normalizeQuota({
    remaining: rem !== undefined && Number.isFinite(rem) ? rem : undefined,
    resetAt: reset !== undefined && Number.isFinite(reset) ? reset * 1000 : undefined,
    exhausted,
  });
}

// Respect upstream Retry-After / Reset-At but cap at the single 5min ceiling.
export function resetAtFromRetryAfter(header: string | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const raw = Number(header);
  if (!Number.isFinite(raw)) return undefined;
  const deltaSec = raw; // Retry-After is seconds (or epoch in some providers)
  const asDelta = now + Math.min(deltaSec * 1000, BACKOFF.max);
  return asDelta;
}