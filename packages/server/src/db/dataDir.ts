import { existsSync, mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const home = homedir();
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'websearch-router');
  }
  return join(home, '.websearch-router'); // mac + linux
}

export function ensureDataDir(): string {
  const dir = join(resolveDataDir(), 'db');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbFilePath(): string {
  return join(ensureDataDir(), 'data.sqlite');
}
