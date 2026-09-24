import { randomUUID } from 'node:crypto';
import type { SearchResponse } from '../routing/execute.js';
import type { Combo } from '../routing/combo.js';

export function writeUsage(db: any, repos: any, query: string, combo: Combo, response: SearchResponse): void {
  // fire-and-forget; never throw
  try {
    const ts = new Date().toISOString();
    const usageId = randomUUID();
    repos.usage.insert(db, {
      id: usageId, ts, query, comboId: combo.id,
      data: { sourceCount: combo.sources.length, totalResults: response.results.length, degraded: response.meta.degraded },
    });
    for (const [source, durationMs] of Object.entries(response.meta.sourceTimings)) {
      const failure = response.partialFailures.find((f) => f.source === source);
      repos.details.insert(db, {
        id: randomUUID(), ts, usageId, source,
        // #12: record the real per-source result count instead of a hardcoded 0.
        data: { durationMs, resultCount: response.sourceResultCounts[source] ?? 0, error: failure?.error.kind },
      });
    }
  } catch (e) {
    console.warn('[usage] writeback failed:', (e as Error).message);
  }
}