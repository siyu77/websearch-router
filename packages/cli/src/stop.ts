import { execSync } from 'node:child_process';
import { killProcessOnPort } from './start.js';
import * as pidfile from './tray/pidfile.js';

// Coordinator (SRP): the pidfile owns supervisor lifetime, start.ts owns the
// server child — stop only sequences them. A present tray.pid means a `start
// --tray` parent is alive; signal it so its handler kills the tray gracefully,
// then always take down the detached server child via the port.
export async function stop(port: number): Promise<void> {
  console.log(`Stopping websearch-router on port ${port}…`);
  const pid = pidfile.read();
  if (pid) {
    try {
      if (process.platform === 'win32') execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true, timeout: 3000 });
      else process.kill(pid, 'SIGTERM');
    } catch {
      // ESRCH / permission — stale pidfile; fall through to port-kill alone.
    }
  }
  await killProcessOnPort(port);
  pidfile.remove();
  console.log('Stopped.');
}
