// API-boundary masking of secrets (presentation concern, SRP). The repo stores
// plaintext keys; masking happens only here so a masked value can never be
// written back into the DB by a client round-trip.
export function maskApiKey(key: string | undefined | null): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return `${key.slice(0, 2)}••••`;
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
