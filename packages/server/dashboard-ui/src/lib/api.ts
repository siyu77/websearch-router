import type {
  ApiErrorBody,
  Combo,
  DeletedOk,
  EngineRow,
  FetchResult,
  ProviderGroup,
  SearchApiResponse,
  UpsertOk,
  UsageRow,
} from './types';

const base = '';

export async function getHealth() {
  return (await fetch(`${base}/health`)).json() as Promise<{
    status: string;
    version: string;
    providers: { id: string; available: boolean }[];
    port: number | null;
    hostname: string | null;
    mcp?: { endpoint: string; transport: string; stateless: boolean };
  }>;
}

export interface SearchRequest {
  query: string;
  provider?: string;
  accountId?: string;
  limit?: number;
  mode?: string;
}

export async function search(body: SearchRequest): Promise<SearchApiResponse> {
  const r = await fetch(`${base}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok && !data.error) data.error = { kind: 'unknown', message: 'Request failed' };
  // Boundary: shield HTTP status — success and failure both return domain
  // semantics { ok, ...data } so the UI reads data.error / data.meta uniformly.
  return { ok: r.ok, ...data };
}

export async function getCombos() {
  return (await fetch(`${base}/api/combos`)).json() as Promise<{ combos: Combo[] } | ApiErrorBody>;
}
export async function saveCombo(c: Combo): Promise<UpsertOk | ApiErrorBody> {
  return (await fetch(`${base}/api/combos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) })).json();
}
export async function deleteCombo(id: string): Promise<DeletedOk | ApiErrorBody> {
  return (await fetch(`${base}/api/combos/${encodeURIComponent(id)}`, { method: 'DELETE' })).json();
}

export async function getProviders() {
  return (await fetch(`${base}/api/providers`)).json() as Promise<{ providers: ProviderGroup[] } | ApiErrorBody>;
}
export async function getEngines() {
  return (await fetch(`${base}/api/engines`)).json() as Promise<{ engines: EngineRow[] } | ApiErrorBody>;
}

export interface SaveProviderBody {
  provider: string;
  apiKey: string;
  priority?: number;
  proxy?: string;
  name?: string;
}
export async function saveProvider(body: SaveProviderBody): Promise<UpsertOk | ApiErrorBody> {
  return (await fetch(`${base}/api/providers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
}

export interface UpdateProviderBody {
  apiKey?: string;
  priority?: number;
  isActive?: boolean;
  proxy?: string;
  name?: string;
}
export async function updateProvider(id: string, body: UpdateProviderBody): Promise<UpsertOk | ApiErrorBody> {
  return (await fetch(`${base}/api/providers/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
}
export async function toggleProvider(id: string, isActive: boolean): Promise<UpsertOk | ApiErrorBody> {
  return updateProvider(id, { isActive });
}
export async function removeProvider(id: string): Promise<DeletedOk | ApiErrorBody> {
  return (await fetch(`${base}/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' })).json();
}

export async function fetchContent(url: string): Promise<FetchResult | ApiErrorBody> {
  return (await fetch(`${base}/fetch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })).json();
}

export async function getUsage() {
  return (await fetch(`${base}/api/usage`)).json() as Promise<{ usage: UsageRow[] } | ApiErrorBody>;
}
