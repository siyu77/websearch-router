import type { ProviderConnection } from '../db/repos/connectionsRepo.js';

export function selectAccount(connections: ProviderConnection[], now = Date.now()): ProviderConnection | null {
  const available = connections
    .filter((c) => c.isActive)
    .filter((c) => {
      const until = (c.data.cooldown as { until?: number } | undefined)?.until;
      return !until || until <= now;
    })
    .sort((a, b) => a.priority - b.priority); // priority ASC, 0 highest
  return available[0] ?? null;
}