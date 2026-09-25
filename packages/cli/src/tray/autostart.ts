import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export const APP_NAME = 'websearch-router';
export const APP_LABEL = 'com.websearch.router';

export function getPlatformPaths(): { path: string; enabled: boolean } {
  const p = platform();
  if (p === 'win32') {
    const startup = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    return { path: join(startup, `${APP_NAME}.vbs`), enabled: true };
  }
  if (p === 'darwin') return { path: join(homedir(), 'Library', 'LaunchAgents', `${APP_LABEL}.plist`), enabled: true };
  return { path: join(homedir(), '.config', 'autostart', `${APP_NAME}.desktop`), enabled: true };
}

function cliCmd(cliPath: string): string {
  // node <path-to-cli> --tray
  return `"${process.execPath}" "${cliPath}" --tray`;
}

export function enableAutoStart(cliPath?: string): boolean {
  const p = platform();
  if (!cliPath) return false;
  try {
    if (p === 'win32') {
      const { path } = getPlatformPaths();
      mkdirSync(join(path, '..'), { recursive: true });
      // Substitute the real cliPath into the VBS template, then swap in the
      // actual process.execPath (double-quote-escaped, since it often contains
      // spaces on Windows).
      const cmd = `cmd /c ${cliCmd(cliPath)}`;
      writeFileSync(path, `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run "${cmd.replace(/"/g, '""')}", 0, False\n`);
      return true;
    }
    if (p === 'darwin') {
      const { path } = getPlatformPaths();
      mkdirSync(join(path, '..'), { recursive: true });
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${APP_LABEL}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${cliPath}</string><string>--tray</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict></plist>`;
      writeFileSync(path, plist);
      try { execSync(`launchctl load -w "${path}"`, { stdio: 'ignore', timeout: 3000 }); } catch { /* file write is the acceptance point */ }
      return true;
    }
    // linux
    const { path } = getPlatformPaths();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `[Desktop Entry]\nType=Application\nName=${APP_NAME}\nExec=${process.execPath} ${cliPath} --tray\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n`);
    return true;
  } catch { return false; }
}

export function disableAutoStart(): boolean {
  try {
    const { path } = getPlatformPaths();
    if (existsSync(path)) rmSync(path, { force: true });
    return true;
  } catch { return false; }
}

export function isAutoStartEnabled(): boolean {
  try {
    const { path } = getPlatformPaths();
    if (!existsSync(path)) return false;
    if (platform() === 'darwin') {
      try { execSync(`launchctl list ${APP_LABEL}`, { stdio: 'ignore', timeout: 3000 }); return true; }
      catch { return false; }
    }
    return true;
  } catch { return false; }
}
