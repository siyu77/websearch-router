import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_RESTARTS = 2;
const CRASH_LOG_LINES = 200;

export function waitServerReady(port: number, { timeoutMs = 15000, intervalMs = 150 } = {}): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryConnect = () => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => { socket.destroy(); resolve(true); });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tryConnect, intervalMs);
      });
    };
    tryConnect();
  });
}

export async function killProcessOnPort(port: number): Promise<void> {
  try {
    if (process.platform === 'win32') {
      // Beware substring matches: `findstr :8787` also matches :87870, :87871…
      // Parse netstat output and match the exact local port + LISTENING state.
      const out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true, timeout: 5000 }) as string;
      const wanted = String(port);
      const line = out.split('\n').find((l) => {
        const parts = l.trim().split(/\s+/);
        if (parts.length < 5 || parts[3] !== 'LISTENING') return false;
        const localAddr = parts[1]; // e.g. 0.0.0.0:8787 or [::]:8787
        const portPart = localAddr.slice(localAddr.lastIndexOf(':') + 1).replace(/\]$/, '');
        if (portPart !== wanted) return false;
        const pid = parts[4];
        return !!pid && pid !== '0';
      });
      if (line) { const pid = line.trim().split(/\s+/).pop(); execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore', windowsHide: true, timeout: 3000 }); }
    } else {
      // lsof -i:<port> is exact — no substring risk.
      const pidOut = execSync(`lsof -ti:${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (pidOut) execSync(`kill -9 ${pidOut.split('\n')[0]} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
    }
  } catch { /* port free */ }
  await new Promise((r) => setTimeout(r, 500));
}

// Resolve the server entry. Two layouts:
//  1. Monorepo dev: packages/cli/dist/start.js -> up to packages/ -> server/dist/server.js
//  2. Published npm package: dist/start.js (via bin) alongside dist/server/server.js
//     (scripts/pack.mjs flattens server dist into dist/server/). Probe both and
//     return whichever exists so the same code runs in the repo and the tarball.
// The server's dist/server.js carries the boot guard (createServer().then(...))
// so spawning `node <entry>` starts it.
function serverEntry(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const monorepo = join(here, '..', '..', 'server', 'dist', 'server.js');
  const published = join(here, 'server', 'server.js');
  return existsSync(monorepo) ? monorepo : published;
}

export function spawnServer({ port, host, showLog = false }: { port: number; host: string; showLog?: boolean }): any {
  const child = spawn(process.execPath, ['--dns-result-order=ipv4first', serverEntry()], {
    stdio: showLog ? 'inherit' : ['ignore', 'ignore', 'pipe'],
    detached: true,
    windowsHide: true,
    // #4: pass the bind host via HOST (explicit), never by clobbering HOSTNAME —
    // the child server reads HOST for its bind address.
    env: { ...process.env as any, PORT: String(port), HOST: host },
  });
  child.unref();
  return child;
}

export async function startServer(opts: { port: number; host: string; showLog?: boolean; onGiveUp?: () => void }): Promise<void> {
  await killProcessOnPort(opts.port);
  let server: any;
  let restartCount = 0;
  let startTime = Date.now();
  const crashLog: string[] = [];

  const boot = () => {
    startTime = Date.now();
    server = spawnServer(opts);
    if (server?.stderr) {
      server.stderr.on('data', (d: Buffer) => {
        const lines = d.toString().split('\n').filter(Boolean);
        crashLog.push(...lines);
        if (crashLog.length > CRASH_LOG_LINES) crashLog.splice(0, crashLog.length - CRASH_LOG_LINES);
      });
    }
    server?.on('exit', (code: number) => {
      const alive = Date.now() - startTime;
      if (alive >= 30_000) restartCount = 0; // stable run resets counter
      if (restartCount >= MAX_RESTARTS) {
        console.error(`\n⚠️ Server exited ${MAX_RESTARTS} times. Giving up.\n--- last log ---\n${crashLog.join('\n')}\n--- end ---`);
        opts.onGiveUp?.();
        return;
      }
      restartCount++;
      const delay = Math.min(1000 * restartCount, 10_000);
      console.error(`\n⚠️ Server exited (code=${code ?? 'unknown'}). Restarting in ${delay / 1000}s (${restartCount}/${MAX_RESTARTS}).`);
      setTimeout(boot, delay);
    });
  };

  boot();
  const ready = await waitServerReady(opts.port);
  if (ready) console.log(`Server ready on http://127.0.0.1:${opts.port}`);
  else console.error(`Server did not become ready on port ${opts.port} in time.`);
}
