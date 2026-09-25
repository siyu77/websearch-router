import type { Result } from '../shared/types.js';
import { normalizeUrl } from '../shared/url.js';
import type { DedupeMode } from './combo.js';

const RRF_K = 60;

export function mergeResults(
  sources: { source: string; results: Result[] }[],
  cap: number,
  dedupe: DedupeMode,
): Result[] {
  if (dedupe === 'off') {
    const flat = sources.flatMap((s) => s.results);
    return flat.slice(0, cap);
  }

  // accumulate RRF score + winning result per dedup key
  const buckets = new Map<string, { result: Result; score: number; sources: Set<string> }>();

  const keyOf = (result: Result): string => {
    if (dedupe === 'url') return result.url;
    if (dedupe === 'url+title') return `${result.url}|${result.title.toLowerCase()}`;
    return normalizeUrl(result.url) ?? result.url; // url-normalized
  };

  for (const s of sources) {
    s.results.forEach((result, index) => {
      const rank = result.rank_in_source ?? index;
      const key = keyOf(result);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { result, score: 0, sources: new Set() }; buckets.set(key, bucket); }
      bucket.sources.add(s.source);
      bucket.score += 1 / (RRF_K + rank + 1); // RRF: score = Σ 1/(k + rank); rank is 0-based, +1 to match k=60 convention
    });
  }

  return Array.from(buckets.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((b) => ({ ...b.result, score: round(b.score) }));
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}