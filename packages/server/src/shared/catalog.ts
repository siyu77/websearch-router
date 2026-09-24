// Single source of truth for engine/provider metadata (OCP). Every engine and
// paid provider in v1 lives here; the dashboard API routes (dashboardApi) and
// the provider registry (registry.ts) derive their lists from this catalog
// instead of maintaining parallel hard-coded arrays. Adding a paid provider =
// one row here + an adapter file + one line in the registry's adapter map.
export const ENGINE_CATALOG = [
  { id: 'bing', kind: 'free' },
  { id: 'ddg', kind: 'free' },
  { id: 'google', kind: 'free' },
  // Academic APIs — all free-tier but require an API key (S2/OpenAlex) or are
  // truly keyless (crossref/arxiv). S2/OpenAlex carry quota/429 semantics, so
  // they go through the paid-provider machinery; crossref/arxiv are free engines.
  { id: 'semantic_scholar', kind: 'paid' },
  { id: 'openalex', kind: 'paid' },
  { id: 'crossref', kind: 'free' },
  { id: 'arxiv', kind: 'free' },
  { id: 'tavily', kind: 'paid' },
  { id: 'brave', kind: 'paid' },
  { id: 'exa', kind: 'paid' },
] as const;

export type EngineKind = (typeof ENGINE_CATALOG)[number]['kind'];

// Paid provider ids — derived from the catalog, never maintained by hand.
export const PAID_PROVIDERS = ENGINE_CATALOG.filter((e) => e.kind === 'paid').map((e) => e.id);
