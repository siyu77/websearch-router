import { describe, it, expect, vi, afterEach } from 'vitest';
import { status } from './status.js';
import { createServer as createHttp } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Mirror the authoritative server version (../package.json next to dist/version.js).
const SERVER_VERSION = (JSON.parse(
  readFileSync(fileURLToPath(new URL('../../server/package.json', import.meta.url)), 'utf8'),
) as { version?: string }).version;

describe('status command', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns the health payload from the server', async () => {
    const payload = await status(39999); // no server — should return an unreachable marker
    expect(payload.ok).toBe(false);
  });

  it('surfaces the port from /health body (W8)', async () => {
    // A tiny stand-in server that answers /health echoing its own bound port.
    const srv = createHttp((req, res) => {
      if (req.url === '/health') {
        res.setHeader('content-type', 'application/json');
        const bound = (srv.address() as any).port;
        res.end(JSON.stringify({ status: 'ok', version: SERVER_VERSION, providers: [], port: bound, hostname: '127.0.0.1' }));
      } else { res.statusCode = 404; res.end(); }
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as any).port as number;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const payload = await status(port);
    expect(payload.ok).toBe(true);
    expect(payload.body.port).toBe(port);
    expect(log).toHaveBeenCalledWith(`Port: ${port}`);
    srv.close();
  });
});
