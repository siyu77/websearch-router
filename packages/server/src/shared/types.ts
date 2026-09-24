import type { FreeErrorKind, ErrorKind } from './errorKind.js';

export interface Result {
  title: string;
  url: string;
  snippet: string;
  rank_in_source: number;
  score?: number;
}

export interface QuotaInfo { remaining?: number; resetAt?: number; exhausted: boolean }

export interface EngineCtx { timeoutMs?: number; signal?: AbortSignal; accountId?: string }

export interface EngineResult { results: Result[]; error?: { kind: FreeErrorKind } }

export interface Engine {
  readonly id: string;
  search(query: string, limit: number, ctx?: EngineCtx): Promise<EngineResult>;
}

export interface ProviderResult { results: Result[]; quota?: QuotaInfo | null; error?: { kind: ErrorKind; resetAt?: number } }

export interface Provider {
  readonly id: string;
  search(query: string, limit: number, ctx?: EngineCtx): Promise<ProviderResult>;
  getAccount?(): { id: string; priority: number; active: boolean };
}

export interface SourceFailure { source: string; error: { kind: ErrorKind; provider?: string; resetAt?: number } }
