// Lazy-install systray2 for macOS/Linux into <DATA_DIR>/runtime/node_modules.
// Windows uses the PowerShell NotifyIcon tray (no binary) — this script is a
// no-op there. Pattern ported from 9router cli/hooks/trayRuntime.js.
//
// systray2 (maintained fork) is used instead of the original `systray@1.0.5`,
// whose bundled 2017 x86_64 Go binary is rejected by modern dyld on macOS.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

// CLI-local data dir (mirrors cli/src/dataDir.ts — the CLI must not import
// server internals, and this script runs as a standalone .mjs from dist/scripts).
function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const home = homedir();
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'websearch-router');
  }
  return join(home, '.websearch-router');
}

const SYSTRAY_PKG = 'systray2';
const SYSTRAY_VERSION = '2.1.4';
const LEGACY_SYSTRAY_PKG = 'systray';

function runtimeDir() {
  return join(resolveDataDir(), 'runtime');
}
function runtimeNodeModules() {
  return join(runtimeDir(), 'node_modules');
}
function trayBinPath() {
  const binName = platform() === 'darwin' ? 'tray_darwin_release' : 'tray_linux_release';
  return join(runtimeNodeModules(), SYSTRAY_PKG, 'traybin', binName);
}
function hasSystray() {
  return existsSync(join(runtimeNodeModules(), SYSTRAY_PKG, 'package.json'));
}

// Remove the legacy `systray` package (broken binary on modern macOS/Linux).
function cleanupLegacySystray() {
  const targets = [
    join(runtimeNodeModules(), LEGACY_SYSTRAY_PKG),
    join(import.meta.dirname, '..', 'node_modules', LEGACY_SYSTRAY_PKG),
  ];
  for (const dir of targets) {
    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); }
      catch { /* best-effort */ }
    }
  }
}

// systray2's npm tarball sometimes ships the Go binary without the +x bit on
// macOS, causing spawn() to fail with EACCES.
function chmodTrayBin() {
  const bin = trayBinPath();
  if (!existsSync(bin)) return;
  try { chmodSync(bin, 0o755); } catch { /* best-effort */ }
}

function ensureRuntimeDir() {
  const dir = runtimeDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, JSON.stringify({ name: 'websearch-router-runtime', version: '1.0.0', private: true }, null, 2));
  }
  return dir;
}

// Idempotent: re-runs with the binary present exit fast.
function install() {
  if (platform() === 'win32') return 0;
  cleanupLegacySystray();
  if (hasSystray()) { chmodTrayBin(); return 0; }
  const dir = ensureRuntimeDir();
  const res = spawnSync('npm', ['install', '--no-save', `${SYSTRAY_PKG}@${SYSTRAY_VERSION}`], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120000,
    stdio: 'pipe',
    windowsHide: true,
  });
  if (res.status !== 0) {
    const stderr = (res.stderr ?? '').toString().slice(0, 2000);
    console.warn(`[websearch-router][runtime] systray2 install failed: ${stderr}`);
    return 1;
  }
  chmodTrayBin();
  return hasSystray() ? 0 : 1;
}

process.exit(install());
