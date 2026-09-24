import ipaddr from 'ipaddr.js';
import type { Result } from '../shared/types.js';

const PRIVATE_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::', '::1', '[::1]']);

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (PRIVATE_HOSTNAMES.has(h)) return true;
  // try parse as IP
  try {
    const addr = ipaddr.parse(h);
    const range = addr.range();
    return range === 'private' || range === 'loopback' || range === 'linkLocal' || range === 'uniqueLocal';
  } catch {
    // not an IP — a hostname. Block link-local-style names; allow normal domains.
    return /\.local$/.test(h) || h === '';
  }
}

export function isPublicHttpUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return !isPrivateOrLocalHostname(u.hostname);
}

export function assertPublicHttpUrl(url: string, label = 'url'): void {
  if (!isPublicHttpUrl(url)) throw new Error(`SSRF protection: ${label} is private/local or invalid`);
}

// Central SSRF choke point for search *results* (OCP: one filter covers present
// + future engines and paid adapters alike). Applied once in routing/execute.ts
// right before merging, so both /search and /search/stream, and any adapter that
// never passes through an engine, get the same protection. Drops non-http(s)
// and unparseable URLs too.
export function filterPrivateResults(results: Result[]): Result[] {
  return results.filter((r) => isPublicHttpUrl(r.url));
}
