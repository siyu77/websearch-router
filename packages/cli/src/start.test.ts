import { describe, it, expect } from 'vitest';
import { waitServerReady, killProcessOnPort } from './start.js';
import { createServer as createHttp } from 'node:http';

describe('start helpers', () => {
  it('waitServerReady resolves true when a TCP listener appears', async () => {
    const srv = createHttp(() => {});
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as any).port;
    const ready = await waitServerReady(port, { timeoutMs: 2000, intervalMs: 50 });
    expect(ready).toBe(true);
    srv.close();
  });

  it('waitServerReady resolves false when nothing listens', async () => {
    const ready = await waitServerReady(39999, { timeoutMs: 300, intervalMs: 50 });
    expect(ready).toBe(false);
  });

  it('killProcessOnPort resolves without throwing when port free', async () => {
    await expect(killProcessOnPort(39998)).resolves.toBeUndefined();
  });
});
