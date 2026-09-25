import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import readline from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TrayMenuItem { title: string; enabled?: boolean; checked?: boolean; action: string }

export function buildTrayMenuItems(opts: { port: number; autostart: boolean }): TrayMenuItem[] {
  return [
    { title: `Running on ${opts.port}`, enabled: false, action: 'status' },
    { title: 'Open Dashboard', enabled: true, action: 'dashboard' },
    { title: 'Enable Auto-start', enabled: true, checked: opts.autostart, action: 'autostart' },
    { title: 'Quit', enabled: true, action: 'quit' },
  ];
}

export function initWinTray(opts: { tooltip: string; items: TrayMenuItem[]; onClick: (action: string) => void }) {
  const dir = dirname(fileURLToPath(import.meta.url));
  const scriptPath = join(dir, 'tray.ps1');
  const iconPath = join(dir, 'icon.ico');
  // Only pass -IconPath when the file exists; otherwise tray.ps1 degrades to the system icon.
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-InputFormat', 'Text', '-OutputFormat', 'Text', '-File', scriptPath, '-Tooltip', opts.tooltip];
  if (existsSync(iconPath)) args.push('-IconPath', iconPath);
  let ps: any;
  try {
    ps = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { return null; }

  const send = (cmd: object) => { try { ps?.stdin?.write(`${JSON.stringify(cmd)}\n`); } catch {} };
  const rl = readline.createInterface({ input: ps.stdout });
  rl.on('line', (line) => { try { const evt = JSON.parse(line); if (evt.type === 'click' && opts.onClick) opts.onClick(opts.items[evt.index]?.action ?? ''); } catch {} });
  ps.stderr.on('data', () => {});
  ps.on('error', () => {});

  opts.items.forEach((item, index) => send({ action: 'add-item', index, title: item.title, enabled: item.enabled !== false, checked: item.checked === true }));
  return {
    updateItem(index: number, title?: string, enabled?: boolean, checked?: boolean) { send({ action: 'update-item', index, title, enabled, checked }); },
    setTooltip(text: string) { send({ action: 'set-tooltip', text }); },
    kill() {
      try { send({ action: 'kill' }); } catch {}
      setTimeout(() => { if (ps && !ps.killed) { try { ps.kill(); } catch {} } ps = null; }, 300);
    },
  };
}