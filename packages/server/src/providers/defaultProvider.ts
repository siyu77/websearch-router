import type { Engine, Provider, ProviderResult, EngineCtx } from '../shared/types.js';

export class DefaultProvider implements Provider {
  readonly id: string;
  constructor(private engine: Engine) {
    this.id = `default:${engine.id}`;
  }
  async search(query: string, limit: number, ctx?: EngineCtx): Promise<ProviderResult> {
    const r = await this.engine.search(query, limit, ctx);
    // Pass the free engine's error kind through unchanged (blocked/timeout/transient/unknown);
    // ProviderResult.error.kind is the unified ErrorKind, so routing sees the true failure kind.
    // Free EngineResult.error has no resetAt, so resetAt stays undefined here — fine.
    return { results: r.results, quota: null, error: r.error ? { kind: r.error.kind } : undefined };
  }
  getAccount() { return { id: 'default', priority: 0, active: true }; }
}