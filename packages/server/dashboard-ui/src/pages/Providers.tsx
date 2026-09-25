import { useEffect, useState } from 'react';
import { getProviders, getEngines, saveProvider, updateProvider, toggleProvider, removeProvider } from '../lib/api';
import type { EngineRow, ProviderGroup } from '../lib/types';

export function ProvidersPage() {
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [engines, setEngines] = useState<EngineRow[]>([]);
  const [editing, setEditing] = useState<{ id: string; provider: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = () => getProviders().then((r) => setGroups('providers' in r ? r.providers : [])).catch(() => {});
  useEffect(() => { refresh(); getEngines().then((r) => setEngines('engines' in r ? r.engines : [])).catch(() => {}); }, []);

  return (
    <div>
      <h2>Providers & Engines</h2>

      <h3>Engines</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr><th className="border border-border px-2 py-1 text-left">Engine</th><th className="border border-border px-2 py-1 text-left">Kind</th><th className="border border-border px-2 py-1 text-left">Status</th></tr></thead>
          <tbody>
            {engines.map((e) => (
              <tr key={e.id} className="hover:bg-row-hover"><td className="border border-border px-2 py-1">{e.id}</td><td className="border border-border px-2 py-1">{e.kind}</td><td className="border border-border px-2 py-1">{e.kind === 'paid' ? (groups.find((g) => g.id === e.id) ? 'account(s) configured' : 'no account — read-only') : 'available (v1: read-only)'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Provider accounts</h3>
      {groups.length === 0 && <p className="text-muted">No provider connections configured.</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr><th className="border border-border px-2 py-1 text-left">Provider</th><th className="border border-border px-2 py-1 text-left">Name</th><th className="border border-border px-2 py-1 text-left">ID</th><th className="border border-border px-2 py-1 text-left">Active</th><th className="border border-border px-2 py-1 text-left">Priority</th><th className="border border-border px-2 py-1 text-left">API key</th><th className="border border-border px-2 py-1 text-left">Quota</th><th className="border border-border px-2 py-1 text-left">Cooldown</th><th className="border border-border px-2 py-1 text-left">Last error</th><th></th></tr></thead>
          <tbody>
            {groups.map((g) =>
              (g.accounts ?? []).map((a) => (
                <tr key={`${g.id}:${a.id}`} className="hover:bg-row-hover">
                  <td className="border border-border px-2 py-1">{g.id}</td>
                  <td className="border border-border px-2 py-1">{a.name ?? '—'}</td>
                  <td className="border border-border px-2 py-1">{a.id.slice(0, 8)}…</td>
                  <td className="border border-border px-2 py-1">{a.isActive ? '✓' : '✗'}</td>
                  <td className="border border-border px-2 py-1">{a.priority}</td>
                  <td className="border border-border px-2 py-1">{a.apiKeySet ? (a.apiKey ?? 'set') : '—'}</td>
                  <td className="border border-border px-2 py-1">{a.quota?.remaining ?? '—'}</td>
                  <td className="border border-border px-2 py-1">{a.cooldown?.until ? new Date(a.cooldown.until).toLocaleTimeString() : '—'}</td>
                  <td className="border border-border px-2 py-1">{a.lastError ?? '—'}</td>
                  <td className="border border-border px-2 py-1">
                    <button onClick={() => setEditing({ id: a.id, provider: g.id })} className="rounded border border-border px-2 py-0.5 hover:bg-row-hover">Edit</button>{' '}
                    <button onClick={() => toggleProvider(a.id, !a.isActive)} className="rounded border border-border px-2 py-0.5 hover:bg-row-hover">{a.isActive ? 'Disable' : 'Enable'}</button>{' '}
                    <button onClick={async () => { if (confirm(`Delete account ${a.id.slice(0, 8)}…?`)) { await removeProvider(a.id); refresh(); } }} className="rounded border border-border px-2 py-0.5 text-danger hover:bg-row-hover">Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <button onClick={() => setAdding(!adding)} className="mt-3 rounded bg-brand px-3 py-1 font-medium text-white hover:bg-brand-hover">{adding ? 'Cancel add' : '+ Add account'}</button>

      {adding && engines.length === 0 && <p className="text-xs text-muted">Engine list loading…</p>}
      {adding && engines.length > 0 && <AddAccountForm paid={engines.filter((e) => e.kind === 'paid').map((e) => e.id)} onDone={() => { setAdding(false); refresh(); }} />}
      {editing && <EditForm key={editing.id} id={editing.id} provider={editing.provider} onDone={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function AddAccountForm({ paid, onDone }: { paid: string[]; onDone: () => void }) {
  const [provider, setProvider] = useState(paid[0]);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [priority, setPriority] = useState(0);
  const [proxy, setProxy] = useState('');
  const submit = async () => {
    if (!apiKey) { alert('API key is required'); return; }
    await saveProvider({ provider, apiKey, priority: Number(priority) || 0, proxy: proxy || undefined, name: name || undefined });
    onDone();
  };
  return (
    <div className="mt-3 max-w-[360px] rounded border border-border bg-surface p-2.5">
      <h4>Add {provider} account</h4>
      <label className="mb-1.5 block">Provider
        <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded border border-border px-2 py-1">
          {paid.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label className="mb-1.5 block">Name (optional) <input value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-border px-2 py-1" /></label>
      <label className="mb-1.5 block">API key <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="rounded border border-border px-2 py-1" /></label>
      <label className="mb-1.5 block">Priority <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="rounded border border-border px-2 py-1" /></label>
      <label className="mb-1.5 block">Proxy (optional) <input value={proxy} onChange={(e) => setProxy(e.target.value)} className="rounded border border-border px-2 py-1" /></label>
      <button onClick={submit} className="mt-3 rounded bg-brand px-3 py-1 font-medium text-white hover:bg-brand-hover">Save</button>
    </div>
  );
}

function EditForm({ id, provider, onDone }: { id: string; provider: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [priority, setPriority] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [proxy, setProxy] = useState('');
  useEffect(() => {
    getProviders().then((r) => {
      const groups = 'providers' in r ? r.providers : [];
      for (const g of groups) {
        const acc = (g.accounts ?? []).find((a) => a.id === id);
        if (acc) { setName(acc.name ?? ''); setPriority(String(acc.priority)); setIsActive(acc.isActive); return; }
      }
    }).catch(() => {});
  }, [id]);
  const submit = async () => {
    await updateProvider(id, {
      apiKey: apiKey || undefined, // empty = keep stored key
      priority: priority === '' ? undefined : Number(priority),
      isActive,
      proxy,
      name, // empty = clear label
    });
    onDone();
  };
  return (
    <div className="mt-3 max-w-[360px] rounded border border-border bg-surface p-2.5">
      <h4>Edit {provider} account</h4>
      <p className="text-xs text-muted">Leave API key empty to keep the stored key.</p>
      <label className="mb-1.5 block">Name (empty clears) <input value={name} placeholder="(none)" onChange={(e) => setName(e.target.value)} className="rounded border border-border px-2 py-1" /></label>
      <label className="mb-1.5 block">API key <input value={apiKey} placeholder="(unchanged)" onChange={(e) => setApiKey(e.target.value)} className="rounded border border-border px-2 py-1" /></label>
      <label className="mb-1.5 block">Priority <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded border border-border px-2 py-1" /></label>
      <label className="mb-1.5 block">Proxy (empty clears) <input value={proxy} onChange={(e) => setProxy(e.target.value)} className="rounded border border-border px-2 py-1" /></label>
      <label className="mb-1.5 block"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active</label>
      <button onClick={submit} className="mt-3 rounded bg-brand px-3 py-1 font-medium text-white hover:bg-brand-hover">Save</button>
    </div>
  );
}
