import { initAdapter, type DbAdapter } from './driver.js';
import { runMigrationOnce } from './migrate.js';
import { dbFilePath } from './dataDir.js';
import * as connectionsRepo from './repos/connectionsRepo.js';
import * as combosRepo from './repos/combosRepo.js';
import * as settingsRepo from './repos/settingsRepo.js';
import * as usageRepo from './repos/usageRepo.js';
import * as detailsRepo from './repos/detailsRepo.js';
import * as kvRepo from './repos/kvRepo.js';

export const repos = { connections: connectionsRepo, combos: combosRepo, settings: settingsRepo, usage: usageRepo, details: detailsRepo, kv: kvRepo };

export async function openDatabase(): Promise<{ adapter: DbAdapter; repos: typeof repos }> {
  const adapter = await initAdapter();
  // Pass the on-disk db path so destructive migrations can back the file up
  // before running (persistence spec Req4).
  await runMigrationOnce(adapter, dbFilePath());
  return { adapter, repos };
}