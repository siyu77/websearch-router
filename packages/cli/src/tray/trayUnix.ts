import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TrayMenuItem } from './trayWin.js';
import { resolveDataDir } from '../dataDir.js';

// Abstraction over where the systray2 binary lives (DIP): the tray depends on a
// `TrayRuntime` that resolves + lazily installs the binary, not on a concrete
// install step. Tests stub this to exercise init/kill without spawning npm.
export interface TrayRuntime {
  resolveBin(): string | null;
}

function platformBin(): string {
  return process.platform === 'darwin' ? 'tray_darwin_release' : 'tray_linux_release';
}

// Lazy installer (SRP: the install owns a dedicated script; the tray only
// invokes it on first miss). Idempotent — a present binary short-circuits.
export class Systray2Runtime implements TrayRuntime {
  resolveBin(): string | null {
    const bin = join(resolveDataDir(), 'runtime', 'node_modules', 'systray2', 'traybin', platformBin());
    if (existsSync(bin)) return bin;
    const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'install-systray.mjs');
    try {
      const res = spawnSync(process.execPath, [scriptPath], { stdio: 'ignore', timeout: 130_000 });
      if (res.status !== 0) return null;
      return existsSync(bin) ? bin : null;
    } catch { return null; }
  }
}

export function initUnixTray(
  opts: { tooltip: string; items: TrayMenuItem[]; onClick: (action: string) => void },
  runtime: TrayRuntime = new Systray2Runtime(),
) {
  const bin = runtime.resolveBin();
  if (!bin) { console.warn('systray2 unavailable; running without tray.'); return null; }
  const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const send = (cmd: object) => { try { proc?.stdin?.write(`${JSON.stringify(cmd)}\n`); } catch {} };
  const rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', (line) => { try { const evt = JSON.parse(line); if (evt.type === 'click') opts.onClick(opts.items[evt.index]?.action ?? ''); } catch {} });
  opts.items.forEach((item, index) => send({ action: 'add-item', index, title: item.title, enabled: item.enabled !== false }));
  return {
    updateItem(index: number, title?: string, enabled?: boolean, checked?: boolean) { send({ action: 'update-item', index, title, enabled, checked }); },
    setTooltip(text: string) { send({ action: 'set-tooltip', text }); },
    kill() {
      send({ action: 'kill' });                                  // graceful
      setTimeout(() => { try { proc.kill('SIGTERM'); } catch {} }, 3000);  // timed SIGTERM
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 6000);  // timed SIGKILL
    },
  };
}
