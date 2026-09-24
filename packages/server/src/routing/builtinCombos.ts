import type { Combo } from './combo.js';

// Built-in protected category combos — single source of truth. One entry per
// search category; each is seeded into the DB at migration time (migrate.ts) so
// /search, /mcp and the dashboard all see it, and protected from delete/rename
// (decision A: sources/mode/merge/fallback stay user-editable, id/name are locked).
//
// Naming contract:
//   - `id`   is a lowercase stable identifier — it is what meta.combo reports
//     (execute.ts meta.combo = combo.id) and what the dashboard shows as the key.
//   - `name` is the UPPERCASE MCP provider enum value (MCP_PROVIDER_ENUM below).
//     resolveProvider matches a provider string by saved-combo name, so
//     `provider: 'WEB'` resolves to this combo with zero resolver changes.
export const BUILTIN_COMBOS: readonly Combo[] = [
  {
    id: 'web',
    name: 'WEB',
    mode: 'concurrent',
    sources: [{ provider: 'bing' }, { provider: 'ddg' }],
    merge: { dedupe: 'url-normalized', rank: 'rrf', cap: 20 },
    fallback: { on: ['timeout', 'error', 'empty'], min_results: 5 },
  },
  {
    id: 'academic',
    name: 'ACADEMIC',
    mode: 'concurrent',
    // Keyless academic APIs only — semantic_scholar/openalex need API-key
    // accounts, so they stay opt-in (users add them via the dashboard).
    sources: [{ provider: 'crossref' }, { provider: 'arxiv' }],
    merge: { dedupe: 'url-normalized', rank: 'rrf', cap: 20 },
    fallback: { on: ['timeout', 'error', 'empty'], min_results: 5 },
  },
] as const;

// Built-in combo ids are protected: they cannot be deleted or renamed, though
// their editable fields (sources/merge/fallback/mode) remain user-tunable.
export const PROTECTED_COMBO_IDS = new Set(BUILTIN_COMBOS.map((c) => c.id));

// The MCP `provider` parameter is an enum over built-in combo names (decision 2).
// Adding a category (MEDIA/ACADEMIC/SOCIAL…) = one entry here + the enum and
// seeding follow automatically; resolveProvider/MCP handler need no change.
// (Every built-in combo has a name; the predicate just narrows Combo.name? away.)
export const MCP_PROVIDER_ENUM: readonly string[] = BUILTIN_COMBOS.map((c) => c.name).filter((n): n is string => typeof n === 'string');

// The MCP provider default when the client omits `provider`.
export const DEFAULT_MCP_PROVIDER = BUILTIN_COMBOS[0].name;

// Is a combo built-in? Matches by either id (lowercase) or name (UPPERCASE enum).
export function isBuiltinCombo(idOrName: string): boolean {
  return BUILTIN_COMBOS.some((c) => c.id === idOrName || c.name === idOrName);
}
