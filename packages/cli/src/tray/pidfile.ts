import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataDir } from '../dataDir.js';

// The tray supervisor's pidfile lives in the data dir (not the runtime dir,
// which npm owns). `stop` reads it to signal the parent so the parent's handler
// can kill the tray gracefully before the server child is taken down.
function pidfilePath(): string {
  return join(resolveDataDir(), 'tray.pid');
}

export function write(pid: number) {
  writeFileSync(pidfilePath(), String(pid));
}

export function read(): number | null {
  try {
    const p = pidfilePath();
    if (!existsSync(p)) return null;
    const pid = Number(readFileSync(p, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

export function remove() {
  try { rmSync(pidfilePath(), { force: true }); } catch { /* best-effort */ }
}
