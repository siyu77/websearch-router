export interface SourceRef { provider: string; weight?: number; timeoutMs?: number; accountId?: string }
export type ComboMode = 'concurrent' | 'sequential' | 'hybrid';
export type FailTrigger = 'timeout' | 'ratelimit' | 'error' | 'empty';
export type DedupeMode = 'url-normalized' | 'off' | 'url' | 'url+title';

export interface Combo {
  id: string;
  name?: string;
  sources: SourceRef[];
  mode: ComboMode;
  merge: { dedupe: DedupeMode; rank: 'rrf'; cap: number };
  fallback: { on: FailTrigger[]; min_results: number };
  hybrid?: { concurrentCount: number };
}

