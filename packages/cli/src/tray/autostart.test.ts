import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { enableAutoStart, disableAutoStart, isAutoStartEnabled, APP_LABEL } from './autostart.js';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('autostart', () => {
  let dir: string; let origHome: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wsr-'));
    origHome = process.env.HOME;
    process.env.HOME = dir;
    process.env.APPDATA = join(dir, 'appdata');
  });
  afterEach(() => { if (origHome !== undefined) process.env.HOME = origHome; rmSync(dir, { recursive: true, force: true }); });

  it('writes the platform autostart file and reports enabled; disable removes it', () => {
    if (process.platform === 'win32') {
      expect(enableAutoStart(join(dir, 'cli.js'))).toBe(true);
      const vbs = join(process.env.APPDATA!, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'websearch-router.vbs');
      expect(existsSync(vbs)).toBe(true);
      expect(isAutoStartEnabled()).toBe(true);
      disableAutoStart();
      expect(existsSync(vbs)).toBe(false);
    } else if (process.platform === 'darwin') {
      expect(enableAutoStart(join(dir, 'cli.js'))).toBe(true);
      // S5: impl writes the reverse-DNS APP_LABEL as filename — assert via the
      // exported constant so the two can never drift apart again.
      const plist = join(dir, 'Library', 'LaunchAgents', `${APP_LABEL}.plist`);
      expect(existsSync(plist)).toBe(true);
      expect(isAutoStartEnabled()).toBe(true);
      disableAutoStart();
      expect(existsSync(plist)).toBe(false);
    } else {
      expect(enableAutoStart(join(dir, 'cli.js'))).toBe(true);
      const desktop = join(dir, '.config', 'autostart', 'websearch-router.desktop');
      expect(existsSync(desktop)).toBe(true);
      expect(isAutoStartEnabled()).toBe(true);
      disableAutoStart();
      expect(existsSync(desktop)).toBe(false);
    }
  });

  it('#3: win32 VBS is a valid WshShell.Run ... , 0, False line with quote-doubled paths (spaced path)', () => {
    if (process.platform !== 'win32') return;
    const spacedPath = join(dir, 'with space', 'cli.js');
    expect(enableAutoStart(spacedPath)).toBe(true);
    const vbs = join(process.env.APPDATA!, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'websearch-router.vbs');
    const content = readFileSync(vbs, 'utf8');
    const line = content.split('\n').find((l) => l.startsWith('WshShell.Run'))!;
    expect(line).toBeDefined();
    // Strip the leading `WshShell.Run "` and the trailing `", 0, False` to get
    // the inner VBS string content.
    const inner = line.slice('WshShell.Run "'.length, line.length - '", 0, False'.length);
    // The outer command shelled through cmd /c.
    expect(inner).toBe(`cmd /c ""${process.execPath}"" ""${spacedPath}"" --tray`);
    // The spaced cliPath is wrapped in doubled quotes so it survives cmd parsing
    // even with the space in the path.
    expect(inner).toContain(`""${spacedPath}""`);
    // No bare quotes survive inside the VBS string: every quote is part of a
    // doubled pair (VBS escaping). Build that by removing all "" and checking
    // the remainder has no quotes left.
    expect(inner.replace(/""/g, '')).not.toContain('"');
  });
});