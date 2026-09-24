import type { AxiosRequestConfig, RawAxiosRequestHeaders } from 'axios';
import { isPrivateOrLocalHostname, assertPublicHttpUrl } from './urlSafety.js';

export { isPrivateOrLocalHostname };

export interface BuildOptions {
  timeout?: number;
  signal?: AbortSignal;           // forward client abort to in-flight axios requests
  trustedStaticHost?: boolean;   // engine host we control — maxRedirects:0, manual Location chase
  headers?: RawAxiosRequestHeaders;
  maxRedirects?: number;
  responseType?: AxiosRequestConfig['responseType'];
  validateStatus?: AxiosRequestConfig['validateStatus'];
  // OCP: centralized POST body + body size cap so engines/adapters don't each
  // implement their own (#2). `body` is forwarded to every redirect hop;
  // `maxBodyBytes` enforces a cap via Content-Length pre-check and a post-check
  // on the actual response body byte length (#13).
  body?: string | URLSearchParams;
  maxBodyBytes?: number;
}

// Thrown when a response body exceeds the configured cap (#13). Routes map this
// to a 400 bad_request.
export class BodyTooLargeError extends Error {
  constructor(public limit: number, public actual: number) {
    super(`response body too large: ${actual} bytes exceeds limit ${limit}`);
    this.name = 'BodyTooLargeError';
  }
}

const DEFAULT_TIMEOUT = 15_000;

export function buildAxiosRequestOptions(opts: BuildOptions = {}): AxiosRequestConfig {
  const config: AxiosRequestConfig = { proxy: false };
  const maxRedirects = opts.trustedStaticHost ? 0 : (opts.maxRedirects ?? 5);
  config.maxRedirects = maxRedirects;
  config.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  if (opts.signal) config.signal = opts.signal;
  if (opts.headers) config.headers = opts.headers;
  if (opts.responseType) config.responseType = opts.responseType;
  if (opts.validateStatus) config.validateStatus = opts.validateStatus;

  // SSRF re-check on each redirect hop (sync — follow-redirects constraint).
  if (!opts.trustedStaticHost) {
    config.beforeRedirect = (redirectOpts) => {
      const target = (redirectOpts.hostname ?? redirectOpts.host) as string | undefined;
      if (target && isPrivateOrLocalHostname(target)) {
        throw new Error('Redirect target points to a private or local network address');
      }
    };
  }

  return config;
}

// Common browser-spoofed headers engines pass in. Chrome 131 with modern client
// hints + Sec-Fetch-* — the header set that avoids DuckDuckGo's 202 anomaly on the
// GET paths (home page + html.duckduckgo.com/html/?q=…). Bing already resolved
// fine; this is a superset that still resolves normally.
export const BROWSER_HEADERS: RawAxiosRequestHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Connection': 'keep-alive',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Referer': 'https://www.google.com/',
};

// Wrap axios's response with a transform that keeps the raw body string and, when
// a body cap is set, rejects oversized bodies (#13). Content-Length is honored
// as an early signal; the actual byte length of String(res.data) is the backstop.
function bodyGuardTransform(maxBodyBytes?: number): AxiosRequestConfig['transformResponse'] {
  if (!maxBodyBytes) return [(d) => d];
  return [(data, headers) => {
    const len = contentLength(headers as Record<string, string>);
    if (typeof len === 'number' && len > maxBodyBytes) {
      throw new BodyTooLargeError(maxBodyBytes, len);
    }
    const body = String(data ?? '');
    const actual = Buffer.byteLength(body, 'utf8');
    if (actual > maxBodyBytes) {
      throw new BodyTooLargeError(maxBodyBytes, actual);
    }
    return body;
  }];
}

function contentLength(headers: Record<string, string> | undefined): number | undefined {
  if (!headers) return undefined;
  const v = headers['content-length'] ?? headers['Content-Length'];
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Manually chase 3xx with per-hop public-URL checks. Pattern from open-webSearch requestWithSafeRedirects.
export async function requestWithSafeRedirects(
  method: 'GET' | 'POST' | 'HEAD',
  initialUrl: string,
  opts: BuildOptions,
  maxHops = 5,
): Promise<{ status: number; headers: Record<string, string>; data: string }> {
  const axios = (await import('axios')).default;
  assertPublicHttpUrl(initialUrl, 'initial URL');
  // For POST, resolve the body to an axios `data` payload once; forward it to
  // every hop so 307/308 POST redirects carry the body along.
  const postData = method === 'POST' && opts.body !== undefined ? toAxiosData(opts.body, opts.headers) : undefined;
  const transform = bodyGuardTransform(opts.maxBodyBytes);
  let url = initialUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    const config = buildAxiosRequestOptions({ ...opts, maxRedirects: 0, validateStatus: (s: number) => s >= 200 && s < 400 });
    const req: AxiosRequestConfig = { ...config, method, url, transformResponse: transform };
    if (postData !== undefined) req.data = postData;
    const res = await axios.request(req);
    if (res.status >= 300 && res.status < 400) {
      const location = String(res.headers?.location ?? '');
      if (!location) return { status: res.status, headers: res.headers as Record<string, string>, data: String(res.data ?? '') };
      url = new URL(location, url).toString();
      assertPublicHttpUrl(url, 'redirect target');
      continue;
    }
    return { status: res.status, headers: res.headers as Record<string, string>, data: String(res.data ?? '') };
  }
  throw new Error(`Too many redirects from ${initialUrl}`);
}

// axios serializes URLSearchParams natively (setting the form Content-Type), so
// pass it through as-is; a pre-stringified form body rides on the caller-supplied
// Content-Type header. Both paths forward the body to every redirect hop.
function toAxiosData(body: string | URLSearchParams, _headers?: RawAxiosRequestHeaders): string | URLSearchParams {
  return body;
}
