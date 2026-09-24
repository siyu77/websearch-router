import { useEffect, useState } from 'react';
import { search, getCombos, getEngines, getProviders } from '../lib/api';
import type { Combo, EngineRow, ProviderGroup, Result, SourceFailure } from '../lib/types';
import type { ApiErrorKind } from '../lib/types';
import { useStore } from '../store';

// engine-failure kind -> readable meaning (bad_request is NOT here on purpose)
const KIND_MEANING: Record<string, string> = {
  auth: 'Invalid or revoked API key',
  quota: 'Quota exhausted',
  ratelimit: 'Rate limited, retry later',
  blocked: 'Engine blocked by anti-bot',
  timeout: 'Request timed out',
  transient: 'Transient error, please retry',
  unknown: 'Unknown error',
};

export function SearchTestPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<(Result & { _src?: string })[]>([]);
  const [failures, setFailures] = useState<SourceFailure[]>([]);
  const [diag, setDiag] = useState<{ provider?: string; kind?: string; message?: string; ms?: number } | null>(null);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [engines, setEngines] = useState<EngineRow[]>([]);
  const [providers, setProviders] = useState<ProviderGroup[]>([]);

  const selectedComboId = useStore((s) => s.selectedComboId);
  const setSelectedCombo = useStore((s) => s.setSelectedCombo);
  const selectedEngineId = useStore((s) => s.selectedEngineId);
  const setSelectedEngine = useStore((s) => s.setSelectedEngine);
  const selectedAccountId = useStore((s) => s.selectedAccountId);
  const setSelectedAccount = useStore((s) => s.setSelectedAccount);

  useEffect(() => {
    getCombos().then((r) => setCombos('combos' in r ? r.combos : [])).catch(() => {});
    getEngines().then((r) => setEngines('engines' in r ? r.engines : [])).catch(() => {});
    getProviders().then((r) => setProviders('providers' in r ? r.providers : [])).catch(() => {});
  }, []);

  // No "Default combo" option: always pin an explicit selection so the
  // dropdown reflects what will actually be searched.
  useEffect(() => {
    if (!selectedComboId && !selectedEngineId && combos.length) {
      setSelectedCombo(combos[0].id);
    }
  }, [combos, selectedComboId, selectedEngineId, setSelectedCombo]);

  const isPaidEngine = !!selectedEngineId && engines.some((e) => e.id === selectedEngineId && e.kind === 'paid');
  const paidAccounts = providers.find((g) => g.id === selectedEngineId)?.accounts ?? [];

  // Render the diagnostic bar from a top-level error object.
  const renderDiag = (error: { kind: ApiErrorKind; message?: string; provider?: string } | undefined, sourceTimings?: Record<string, number>) => {
    if (!error) { setDiag(null); return; }
    if (error.kind === 'bad_request') {
      setDiag({ message: error.message ?? 'Request error' }); // not an engine diagnostic
      return;
    }
    const provider = error.provider ?? selectedEngineId;
    setDiag({ provider, kind: error.kind, ms: provider ? sourceTimings?.[provider] : undefined });
  };

  // Unified outbound target: a combo id and an engine id are both a `provider`
  // value (the server resolves a saved combo by name before an engine id).
  const buildTarget = (): { provider?: string; accountId?: string } => ({
    provider: selectedEngineId ?? selectedComboId,
    accountId: selectedAccountId || undefined,
  });

  const runRest = async () => {
    setResults([]); setFailures([]); setDiag(null);
    const r = await search({ query, ...buildTarget() });
    if (r.ok) {
      setResults(r.results);
      setFailures(r.partialFailures);
      renderDiag(undefined, r.meta.sourceTimings);
    } else {
      renderDiag(r.error, r.meta?.sourceTimings);
    }
  };

  return (
    <div>
      <h2>Search Test</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="query" className="w-[300px] rounded border border-border px-2 py-1" />
        <label className="flex items-center gap-1">
          Provider
          <select
            value={selectedEngineId ? `engine:${selectedEngineId}` : `combo:${selectedComboId}`}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('combo:')) setSelectedCombo(v.slice(6));
              else if (v.startsWith('engine:')) setSelectedEngine(v.slice(7));
            }}
            className="rounded border border-border px-2 py-1"
          >
            <optgroup label="Combos">
              {combos.map((c) => <option key={c.id} value={`combo:${c.id}`}>{c.name ?? c.id}</option>)}
            </optgroup>
            <optgroup label="Free engines">
              {engines.filter((e) => e.kind === 'free').map((e) => <option key={e.id} value={`engine:${e.id}`}>{e.id}</option>)}
            </optgroup>
            <optgroup label="Paid engines">
              {engines.filter((e) => e.kind === 'paid').map((e) => <option key={e.id} value={`engine:${e.id}`}>{e.id}</option>)}
            </optgroup>
          </select>
        </label>
        {isPaidEngine && (
          <label className="flex items-center gap-1">
            Key
            <select value={selectedAccountId ?? ''} onChange={(e) => setSelectedAccount(e.target.value || undefined)} className="rounded border border-border px-2 py-1">
              <option value="">All accounts · round-robin</option>
              {paidAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ? `${a.name} (${a.apiKey ?? '••••'})` : (a.apiKey ?? '••••')} · prio{a.priority}{a.isActive ? '' : ' (disabled)'}
                </option>
              ))}
            </select>
          </label>
        )}
        <button onClick={runRest} className="rounded bg-brand px-3 py-1 font-medium text-white hover:bg-brand-hover">Search</button>
      </div>

      {diag && (
        <div className="my-2 text-danger">
          {diag.kind
            ? `✗ ${diag.provider ?? ''} · ${diag.kind} — ${KIND_MEANING[diag.kind] ?? diag.kind}${diag.ms != null ? `(${diag.ms}ms)` : ''}`
            : diag.message}
          {diag.kind === 'auth' ? ' (account auto-disabled)' : ''}
        </div>
      )}

      {failures.length > 0 && (
        <div className="my-2 text-danger">⚠ Partial failures: {failures.map((f) => f.source + ':' + f.error.kind).join(', ')}</div>
      )}

      <ol>{results.map((r, i) => <li key={i}><a href={r.url} target="_blank">{r.title}</a><div>{r.snippet}</div></li>)}</ol>
    </div>
  );
}
