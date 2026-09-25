import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './api/app.js';
import { openDatabase } from './db/index.js';
import { buildProviders } from './providers/registry.js';
import type { Combo } from './routing/combo.js';

export async function createServer(opts: { port?: number; hostname?: string; apiKey?: string } = {}) {
  const { adapter: db, repos } = await openDatabase();
  const combos = repos.combos.list(db).map((c): Combo => ({ id: c.id, name: c.name, mode: c.mode as Combo['mode'], ...c.data } as Combo));
  const providers = buildProviders(db);
  const { app } = await createApp({ providers, combos, db, apiKey: opts.apiKey, repos });

  // #4: `HOSTNAME` is set by many shells/OS to the machine name (e.g. "DESKTOP-X"),
  // which would make us try to bind to a non-loopback interface and fail. Only
  // explicit opts.hostname or an explicit HOST override change the bind address;
  // otherwise stay loopback-safe.
  const port = opts.port ?? Number(process.env.PORT ?? 8787);
  const hostname = opts.hostname ?? process.env.HOST ?? '127.0.0.1';
  const server = app.listen(port, hostname);
  // Node 22 binds asynchronously: `server.address()` is null until the
  // 'listening' event. Wait for it so callers always get a live server and
  // the actual bound port (relevant when port 0 requests an OS-assigned port).
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  // W8: after 'listening' the bound port is final (port:0 -> OS-assigned).
  // Publish it on app.locals so /health can report it without threading a
  // port through createApp at construction (OCP: extend the payload, don't
  // change the contract).
  const boundPort = (server.address() as { port: number }).port;
  app.locals.port = boundPort;
  app.locals.hostname = hostname;

  return {
    port: boundPort,
    hostname,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Boot guard: the CLI launcher spawns `node dist/server.js`, so running this
// file directly must start the server (createServer().then). Guard on resolved
// realpaths so the module can also be imported as a library without side
// effects (same pattern as the CLI entry).
const invokedDirectly =
  !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { port, hostname } = await createServer();
  console.log(`[server] listening on http://${hostname}:${port}`);
}