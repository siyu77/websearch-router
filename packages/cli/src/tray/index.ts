import { initWinTray } from './trayWin.js';
import { initUnixTray } from './trayUnix.js';
import { buildTrayMenuItems, type TrayMenuItem } from './trayWin.js';
import { enableAutoStart, disableAutoStart, isAutoStartEnabled } from './autostart.js';

export interface TrayHandle {
  updateItem(index: number, title?: string, enabled?: boolean, checked?: boolean): void;
  setTooltip(text: string): void;
  kill(): void;
}

export interface TrayImpl {
  platform: string;
  init: (opts: { tooltip: string; items: TrayMenuItem[]; onClick: (action: string) => void }) => TrayHandle | null;
}

export function selectTrayImpl(pl: string): TrayImpl {
  if (pl === 'win32') return { platform: 'win32', init: initWinTray };
  return { platform: pl, init: initUnixTray };
}

export function initTray(opts: { port: number; cliPath: string; openDashboard: () => void; onQuit: () => void }): TrayHandle | null {
  const impl = selectTrayImpl(process.platform);

  // Build the menu and start the tray, returning the handle. Captured so the
  // autostart toggle handler can tear down + rebuild the whole tray.
  function buildTray(): TrayHandle | null {
    const autostart = isAutoStartEnabled();
    const items = buildTrayMenuItems({ port: opts.port, autostart });
    return impl.init({
      tooltip: `websearch-router on ${opts.port}`,
      items,
      onClick: (action: string) => {
        if (action === 'dashboard') opts.openDashboard();
        else if (action === 'autostart') {
          if (isAutoStartEnabled()) disableAutoStart();
          else enableAutoStart(opts.cliPath);
          // The PowerShell tray reads stdin via a 100ms Peek() loop that DROPS
          // any command written after the burst that built the menu (a
          // Windows PowerShell 5.1 console-pipe quirk). A single late
          // `update-item` to refresh the ✓ would be dropped, so the checkmark
          // would never reflect the toggle. Rebuilding the whole tray instead
          // re-sends the full menu as a fresh burst — which Peek reliably
          // reads — so the ✓ always reflects the current autostart state.
          tray?.kill();
          setTimeout(() => { tray = buildTray(); }, 400);
        } else if (action === 'quit') opts.onQuit();
      },
    });
  }

  let tray: TrayHandle | null = buildTray();
  return tray;
}
