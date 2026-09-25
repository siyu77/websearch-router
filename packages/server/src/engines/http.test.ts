import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isPrivateOrLocalHostname, buildAxiosRequestOptions, requestWithSafeRedirects, BodyTooLargeError } from './http.js';

// requestWithSafeRedirects does a dynamic `await import('axios')`, so mocking
// the module lets us capture the per-hop axios config and exercise the body
// forwarding + size-cap transform without any network (127.0.0.1 is blocked by
// the SSRF guard, so a real local server is not an option here).
const axiosMock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('axios', () => ({ default: axiosMock }));

describe('http factory', () => {
  it('rejects private/local hostnames', () => {
    expect(isPrivateOrLocalHostname('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalHostname('10.0.0.1')).toBe(true);
    expect(isPrivateOrLocalHostname('169.254.169.254')).toBe(true); // metadata
    expect(isPrivateOrLocalHostname('localhost')).toBe(true);
    expect(isPrivateOrLocalHostname('example.com')).toBe(false);
  });

  it('trustedStaticHost sets maxRedirects to 0', () => {
    const opts = buildAxiosRequestOptions({ trustedStaticHost: true, timeout: 5000 });
    expect(opts.maxRedirects).toBe(0);
    expect(opts.timeout).toBe(5000);
  });

  it('non-trusted host attaches a beforeRedirect SSRF hook', () => {
    const opts = buildAxiosRequestOptions({});
    expect(typeof opts.beforeRedirect).toBe('function');
  });

  // C2: the abort signal must flow into the axios config so SSE disconnects
  // cancel in-flight HTTP requests.
  it('forwards an AbortSignal into the axios config', () => {
    const ac = new AbortController();
    const opts = buildAxiosRequestOptions({ signal: ac.signal });
    expect(opts.signal).toBe(ac.signal);
  });
});

// #2/#13: requestWithSafeRedirects centralizes POST body forwarding and the
// response body cap so engines/adapters don't each implement them.
describe('requestWithSafeRedirects body handling', () => {
  beforeEach(() => { axiosMock.request.mockReset(); });

  it('forwards a POST body into the axios request config (#2)', async () => {
    axiosMock.request.mockResolvedValue({ status: 200, headers: {}, data: '<html>ok</html>' });
    const res = await requestWithSafeRedirects('POST', 'https://example.com/', {
      trustedStaticHost: true,
      body: new URLSearchParams({ q: 'hello world' }),
    });
    expect(res.data).toBe('<html>ok</html>');
    const config = axiosMock.request.mock.calls[0][0];
    expect(config.method).toBe('POST');
    expect(config.url).toBe('https://example.com/');
    // URLSearchParams passes through as-is so axios sets the form Content-Type.
    expect(config.data).toBeInstanceOf(URLSearchParams);
    expect(String(config.data)).toBe('q=hello+world');
  });

  it('does not attach a body for GET requests', async () => {
    axiosMock.request.mockResolvedValue({ status: 200, headers: {}, data: 'ok' });
    await requestWithSafeRedirects('GET', 'https://example.com/', { trustedStaticHost: true });
    const config = axiosMock.request.mock.calls[0][0];
    expect(config.method).toBe('GET');
    expect(config.data).toBeUndefined();
  });

  it('installs a transform that rejects bodies over maxBodyBytes (#13)', async () => {
    axiosMock.request.mockResolvedValue({ status: 200, headers: {}, data: 'x'.repeat(600) });
    await requestWithSafeRedirects('GET', 'https://example.com/', { trustedStaticHost: true, maxBodyBytes: 512 });
    const config = axiosMock.request.mock.calls[0][0];
    const transform = config.transformResponse[0];

    // Content-Length pre-check short-circuits oversized responses.
    expect(() => transform('x'.repeat(600), { 'content-length': '600' })).toThrow(BodyTooLargeError);
    // Without Content-Length, the actual byte length is the backstop.
    expect(() => transform('x'.repeat(600), {})).toThrow(BodyTooLargeError);
    // Under the cap, the raw string passes through unchanged.
    expect(transform('x'.repeat(100), { 'content-length': '100' })).toBe('x'.repeat(100));
  });
});
