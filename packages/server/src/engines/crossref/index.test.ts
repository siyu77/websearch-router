import { describe, it, expect, beforeEach } from 'vitest';
import { crossrefEngine, __setCrossrefHttpForTests } from './index.js';

function ok(data: unknown) {
  return { status: 200, headers: {}, data: JSON.stringify(data) };
}

describe('crossref engine', () => {
  beforeEach(() => { __setCrossrefHttpForTests(undefined); });

  it('parses items with doi url and jats-stripped abstract', async () => {
    __setCrossrefHttpForTests(async () => ok({
      message: { items: [{ title: ['Attention Is All You Need'], DOI: '10.5555/3295222', abstract: '<jats:p>The Transformer wins.</jats:p>' }] },
    }));
    const r = await crossrefEngine.search('transformer', 5);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].title).toBe('Attention Is All You Need');
    expect(r.results[0].url).toBe('https://doi.org/10.5555/3295222');
    expect(r.results[0].snippet).toBe('The Transformer wins.');
    expect(r.results[0].rank_in_source).toBe(0);
  });

  it('falls back to venue/year when no abstract', async () => {
    __setCrossrefHttpForTests(async () => ok({
      message: { items: [{ title: ['T1'], DOI: '10.1/x', 'container-title': ['Nature'], issued: { 'date-parts': [[2020, 3]] } }] },
    }));
    const r = await crossrefEngine.search('q', 5);
    expect(r.results[0].snippet).toBe('Venue: Nature. Year: 2020');
  });

  it('sends the mailto polite-pool param and caps rows at 1000', async () => {
    const urls: string[] = [];
    __setCrossrefHttpForTests(async (url) => { urls.push(url); return ok({ message: { items: [] } }); });
    await crossrefEngine.search('q', 2000);
    await crossrefEngine.search('q', 3);
    expect(urls[0]).toContain('rows=1000');
    expect(urls[0]).toContain('mailto=');
    expect(urls[1]).toContain('rows=3');
  });

  it('maps 429 -> ratelimit, 5xx -> transient, other -> unknown', async () => {
    __setCrossrefHttpForTests(async () => ({ status: 429, headers: {}, data: '{}' }));
    expect((await crossrefEngine.search('q', 5)).error?.kind).toBe('ratelimit');
    __setCrossrefHttpForTests(async () => ({ status: 500, headers: {}, data: '' }));
    expect((await crossrefEngine.search('q', 5)).error?.kind).toBe('transient');
    __setCrossrefHttpForTests(async () => ({ status: 404, headers: {}, data: '' }));
    expect((await crossrefEngine.search('q', 5)).error?.kind).toBe('unknown');
  });

  it('classifies thrown network errors via classifyError', async () => {
    __setCrossrefHttpForTests(async () => { throw new Error('network error'); });
    const r = await crossrefEngine.search('q', 5);
    expect(r.error?.kind).toBe('transient');
  });
});
