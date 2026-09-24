import { describe, it, expect } from 'vitest';
import { normalizeUrl } from './url.js';

describe('normalizeUrl', () => {
  it('strips tracking params, drops fragment, lowercases host, removes trailing slash', () => {
    expect(normalizeUrl('https://Example.com/path/?utm_source=x&ref=y#frag'))
      .toBe('https://example.com/path');
  });
  it('returns null for non-http', () => {
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });
  it('dedupes equivalent URLs', () => {
    expect(normalizeUrl('https://example.com/A?utm_medium=m')).toBe(normalizeUrl('https://EXAMPLE.com/A/#top'));
  });
});
