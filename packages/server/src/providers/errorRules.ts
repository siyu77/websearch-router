import type { PaidErrorKind } from '../shared/errorKind.js';

export const BACKOFF = { base: 2_000, max: 300_000, maxLevel: 15 }; // 5min cap

export const LONG_COOLDOWN_MS = 15 * 60 * 1000; // quota exhaustion: long cooldown

export interface ErrorRule { kind: PaidErrorKind; strategy: 'backoff' | 'long-cooldown' | 'mark-inactive' }

export const ERROR_RULES: Record<number, ErrorRule> = {
  429: { kind: 'ratelimit', strategy: 'backoff' },
  432: { kind: 'quota', strategy: 'long-cooldown' },
  433: { kind: 'quota', strategy: 'long-cooldown' },
  402: { kind: 'quota', strategy: 'long-cooldown' },
  401: { kind: 'auth', strategy: 'mark-inactive' },
};

export function getQuotaCooldown(backoffLevel: number): number {
  const level = Math.max(0, backoffLevel - 1);
  return Math.min(BACKOFF.base * Math.pow(2, level), BACKOFF.max);
}

export function nextBackoffLevel(level: number): number {
  return Math.min(level + 1, BACKOFF.maxLevel);
}

export function applyErrorRule(status: number, backoffLevel: number): {
  kind: PaidErrorKind; cooldownMs: number; markInactive: boolean; newLevel: number;
} {
  const rule = ERROR_RULES[status];
  if (!rule) return { kind: 'unknown', cooldownMs: 5_000, markInactive: false, newLevel: backoffLevel };
  switch (rule.strategy) {
    case 'backoff': {
      const newLevel = nextBackoffLevel(backoffLevel);
      return { kind: rule.kind, cooldownMs: getQuotaCooldown(newLevel), markInactive: false, newLevel };
    }
    case 'long-cooldown':
      return { kind: rule.kind, cooldownMs: LONG_COOLDOWN_MS, markInactive: false, newLevel: 0 };
    case 'mark-inactive':
      return { kind: rule.kind, cooldownMs: 0, markInactive: true, newLevel: 0 };
  }
}