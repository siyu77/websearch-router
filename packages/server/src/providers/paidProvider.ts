import type { Provider, ProviderResult, EngineCtx, Result, QuotaInfo } from '../shared/types.js';
import type { PaidErrorKind } from '../shared/errorKind.js';
import { applyErrorRule } from './errorRules.js';

export interface PaidAdapter {
  search(account: any, query: string, limit: number, ctx?: EngineCtx): Promise<{
    results: Result[]; quota?: QuotaInfo; error?: { kind: PaidErrorKind; resetAt?: number };
  }>;
}

export interface AccountStatus { cooldown?: { until?: number; level?: number }; quota?: QuotaInfo; lastError?: string }

export interface PaidProviderOptions {
  id: string;
  adapter: PaidAdapter;
  repo: {
    listByProvider(adapter: any, provider: string): Array<{ id: string; priority: number; isActive: boolean; data: Record<string, unknown> }>;
    getActiveByPriority?(adapter: any, provider: string): Array<{ id: string; priority: number; isActive: boolean; data: Record<string, unknown> }>;
    setIsActive(adapter: any, id: string, active: boolean): void;
    updateData(adapter: any, id: string, patch: Record<string, unknown>): void;
  };
  getAccountStatus(account: any): AccountStatus;
  writeAccountStatus(accountId: string, status: AccountStatus): void;
}

export function createPaidProvider(opts: PaidProviderOptions, db: any): Provider {
  return {
    get id() { return opts.id; },
    async search(query: string, limit: number, ctx?: EngineCtx): Promise<ProviderResult> {
      // Single-account test branch: locate the named account, skip polling /
      // priority / cooldown, execute just that one. Reuses the same write-back
      // rules as the polling loop (decision 2: not a read-only probe).
      if (ctx?.accountId) {
        const account = opts.repo.listByProvider(db, opts.id).find((a) => a.id === ctx.accountId);
        if (!account) return { results: [], error: { kind: 'unknown' } };
        const status = opts.getAccountStatus(account);
        const out = await opts.adapter.search(account, query, limit, ctx);
        if (out.error) return { results: [], error: applyAccountError(opts, db, account, status, out.error) };
        resetAccountStatus(opts, db, account, status, out.quota);
        return { results: out.results, quota: out.quota };
      }

      const accounts = opts.repo.listByProvider(db, opts.id).filter((a) => a.isActive)
        .sort((a, b) => a.priority - b.priority);

      for (const account of accounts) {
        const status = opts.getAccountStatus(account);
        if (status.cooldown?.until && status.cooldown.until > Date.now()) continue; // skip cooldown

        const out = await opts.adapter.search(account, query, limit, ctx);
        if (out.error) {
          applyAccountError(opts, db, account, status, out.error);
          continue; // try next account
        }

        resetAccountStatus(opts, db, account, status, out.quota);
        return { results: out.results, quota: out.quota };
      }

      // all accounts failed
      const firstErr = firstErrorAmong(accounts, opts);
      return { results: [], error: firstErr };
    },
  };
}

function httpStatusFromKind(kind: PaidErrorKind): number {
  switch (kind) {
    case 'ratelimit': return 429;
    case 'quota': return 402;
    case 'auth': return 401;
    default: return 500;
  }
}

function firstErrorAmong(accounts: any[], opts: PaidProviderOptions): { kind: PaidErrorKind; resetAt?: number } | undefined {
  for (const a of accounts) {
    const s = opts.getAccountStatus(a);
    if (s.lastError) {
      return { kind: s.lastError as PaidErrorKind, resetAt: s.quota?.resetAt };
    }
  }
  return undefined;
}

// Failure write-back: applyErrorRule + setIsActive/cooldown + writeAccountStatus,
// returning the error to surface. Shared by the single-account and polling paths.
function applyAccountError(opts: PaidProviderOptions, db: any, account: any, status: AccountStatus, error: { kind: PaidErrorKind; resetAt?: number }): { kind: PaidErrorKind; resetAt?: number } {
  const rule = applyErrorRule(httpStatusFromKind(error.kind), status.cooldown?.level ?? 0);
  const next: AccountStatus = {
    ...status,
    lastError: error.kind,
    quota: error.resetAt ? { exhausted: true, resetAt: error.resetAt, remaining: 0 } : status.quota,
  };
  if (rule.markInactive) {
    opts.repo.setIsActive(db, account.id, false);
  } else {
    next.cooldown = { until: Date.now() + rule.cooldownMs, level: rule.newLevel };
  }
  opts.writeAccountStatus(account.id, next);
  return error;
}

// Success: reset backoff level, persist quota. Shared by both paths.
function resetAccountStatus(opts: PaidProviderOptions, db: any, account: any, status: AccountStatus, quota: QuotaInfo | null | undefined): void {
  opts.writeAccountStatus(account.id, { ...status, cooldown: { until: 0, level: 0 }, quota: quota ?? { exhausted: false }, lastError: undefined });
}
