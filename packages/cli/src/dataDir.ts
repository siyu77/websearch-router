import { homedir, platform } from 'node:os';
import { join } from 'node:path';

// CLI-local data dir resolution. The CLI must NOT import server internals
// (package isolation), so this mirrors server/src/db/dataDir.ts deliberately —
// duplication is the cost of keeping the two packages independent.
export function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const home = homedir();
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'websearch-router');
  }
  return join(home, '.websearch-router'); // mac + linux
}
