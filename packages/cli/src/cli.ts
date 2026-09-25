import { realpathSync } from 'node:fs';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from './start.js';
import { status } from './status.js';
import { search } from './search.js';
import { stop } from './stop.js';
import { initTray } from './tray/index.js';
import * as pidfile from './tray/pidfile.js';

function openDashboardUrl(port: number): void {
  const url = `http://127.0.0.1:${port}/`;
  // The `open` npm package is not a dependency; use platform commands instead.
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, { windowsHide: true }, (err) => { if (err) console.warn('Failed to open dashboard:', err.message); });
}

export function parseArgs(argv: string[]): { command: string; flags: Record<string, string | boolean> } {
  const command = argv[0] ?? '';
  const flags: Record<string, string | boolean> = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    }
  }
  return { command, flags };
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const port = Number(flags.port ?? process.env.PORT ?? 8787);
  const host = String(flags.host ?? '127.0.0.1');
  if (!command || command === 'help') { console.log('Usage: websearch <start|status|search|stop> [--port N] [--query Q] [--provider P]'); return; }
  switch (command) {
    case 'start': {
      // Tray status item index 0 is the "Running on :port" line.
      let tray: { updateItem(index: number, title?: string, enabled?: boolean, checked?: boolean): void; kill(): void } | null = null;
      const resident: NodeJS.Timeout | undefined = flags.tray ? setInterval(() => {}, 60000) : undefined;
      if (flags.tray) {
        tray = initTray({
          port,
          cliPath: fileURLToPath(import.meta.url),
          openDashboard: () => openDashboardUrl(port),
          onQuit: () => {
            void stop(port).then(() => {
              tray?.kill();
              if (resident) clearInterval(resident);
              pidfile.remove();
              process.exit(0);
            });
          },
        });
        // W7: register the supervisor pid so `websearch stop` can signal us to
        // tear down the tray + server. On SIGTERM/SIGINT we kill the tray,
        // clear the resident interval, drop the pidfile and exit — abandoning
        // any pending server respawn deliberately.
        pidfile.write(process.pid);
        process.on('SIGTERM', () => {
          tray?.kill();
          if (resident) clearInterval(resident);
          pidfile.remove();
          process.exit(0);
        });
        process.on('SIGINT', () => {
          tray?.kill();
          if (resident) clearInterval(resident);
          pidfile.remove();
          process.exit(0);
        });
      }
      await startServer({
        port,
        host,
        showLog: !!flags.log,
        // Give-up fires only when the resident tray parent is alive (start --tray),
        // because only that path keeps the process running after readiness.
        // Update the tray status line to the abnormal state per acceptance #5.
        onGiveUp: () => tray?.updateItem(0, `Server crashed — disabled`),
      });
      break;
    }
    case 'status': { const s = await status(port); if (s.ok) console.log(JSON.stringify(s.body, null, 2)); else { console.error('Server unreachable:', s.error); process.exitCode = 1; } break; }
    case 'search': {
      // `provider` is required server-side (the built-in default combo was
      // removed). Default to ddg (free, no key) when omitted so the zero-arg
      // `websearch search --query X` flow keeps working.
      let provider = String(flags.provider ?? '');
      if (!provider) { provider = 'ddg'; console.log('using provider: ddg (pass --provider to choose)'); }
      await search(port, String(flags.query ?? ''), provider);
      break;
    }
    case 'stop': await stop(port); break;
    default: console.log('Usage: websearch <start|status|search|stop> [--port N] [--query Q] [--provider P]'); break;
  }
}

// Guard the entry point so this module can be imported by tests (and other
// modules) without side effects, while the `bin` still runs when executed.
// Compare resolved realpaths because the bin shim may invoke the file through
// the `node_modules/websearch-router` symlink, where process.argv[1] differs
// from import.meta.url.
const invokedDirectly =
  !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
