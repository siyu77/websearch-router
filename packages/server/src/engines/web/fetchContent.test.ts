import { describe, it, expect } from 'vitest';
import { extractMainTextFromHtml } from './fetchContent.js';

describe('extractMainTextFromHtml', () => {
  it('extracts from article container', () => {
    const html = `<html><head><title>Page</title></head><body><article><p>${'x'.repeat(150)}</p></article></body></html>`;
    const r = extractMainTextFromHtml(html);
    expect(r.title).toBe('Page');
    expect(r.mode).toBe('container');
    expect(r.text.length).toBeGreaterThanOrEqual(150);
  });

  it('falls back to body when no container', () => {
    const html = `<html><head><title>P</title></head><body><p>${'y'.repeat(200)}</p></body></html>`;
    const r = extractMainTextFromHtml(html);
    expect(r.mode).toBe('body');
  });

  it('csdn uses #content_views', () => {
    const html = `<html><body><div id="content_views"><script>bad</script><p>${'z'.repeat(150)}</p></div></body></html>`;
    const r = extractMainTextFromHtml(html);
    expect(r.mode).toBe('container');
    expect(r.text).not.toContain('bad');
  });
});