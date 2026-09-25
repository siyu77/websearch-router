import { describe, it, expect } from 'vitest';
import { mergeResults } from './merge.js';
import type { Result } from '../shared/types.js';

const r = (url: string, rank: number, source: string): Result => ({ title: `t-${url}`, url, snippet: '', rank_in_source: rank });

describe('mergeResults', () => {
  it('dedupes same URL across sources and sums RRF scores', () => {
    const a = [r('https://example.com/a', 0, 'bing')];
    const b = [r('https://EXAMPLE.com/a?utm_source=x', 1, 'ddg')];
    const merged = mergeResults([
      { source: 'bing', results: a },
      { source: 'ddg', results: b },
    ], 20, 'url-normalized');
    expect(merged.length).toBe(1);
    expect(merged[0].url).toBe('https://example.com/a');
  });

  it('ranks by RRF: an item ranked #0 in two sources outranks a single #0', () => {
    const both = [r('https://example.com/hot', 0, 'bing')];
    const single = [r('https://example.com/one', 0, 'ddg'), r('https://example.com/two', 1, 'ddg')];
    const merged = mergeResults([
      { source: 'bing', results: both },
      { source: 'ddg', results: single },
    ], 20, 'url-normalized');
    expect(merged[0].url).toBe('https://example.com/hot'); // RRF sums across sources
  });

  it('truncates to cap', () => {
    const many = Array.from({ length: 10 }, (_, i) => r(`https://example.com/${i}`, i, 'bing'));
    const merged = mergeResults([{ source: 'bing', results: many }], 3, 'url-normalized');
    expect(merged.length).toBe(3);
  });

  it('dedupe=off keeps duplicates', () => {
    const a = [r('https://example.com/a', 0, 'bing')];
    const b = [r('https://example.com/a', 1, 'ddg')];
    const merged = mergeResults([{ source: 'bing', results: a }, { source: 'ddg', results: b }], 20, 'off');
    expect(merged.length).toBe(2);
  });
});
