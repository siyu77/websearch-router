import { useEffect, useState } from 'react';
import { getCombos, saveCombo, deleteCombo } from '../lib/api';
import type { Combo, ComboMode, DedupeMode, FailTrigger } from '../lib/types';

const FALLBACK_TRIGGERS: FailTrigger[] = ['timeout', 'ratelimit', 'error', 'empty'];

const emptyDraft: Combo = {
  id: '',
  name: '',
  sources: [{ provider: 'bing' }],
  mode: 'concurrent',
  merge: { dedupe: 'url-normalized', rank: 'rrf', cap: 20 },
  fallback: { on: ['timeout', 'error', 'empty'], min_results: 5 },
};

export function CombosPage() {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [draft, setDraft] = useState<Combo>(emptyDraft);

  const refresh = () => getCombos().then((r) => setCombos('combos' in r ? r.combos : [])).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const moveSource = (i: number, dir: -1 | 1) => {
    const src = [...draft.sources]; const j = i + dir;
    if (j < 0 || j >= src.length) return;
    [src[i], src[j]] = [src[j], src[i]]; setDraft({ ...draft, sources: src });
  };

  const toggleTrigger = (t: FailTrigger) => {
    const on = draft.fallback.on.includes(t) ? draft.fallback.on.filter((x) => x !== t) : [...draft.fallback.on, t];
    setDraft({ ...draft, fallback: { ...draft.fallback, on } });
  };

  const save = async () => {
    await saveCombo({ ...draft, id: draft.id || 'custom', name: draft.name || undefined });
    refresh();
  };

  // Editing a built-in combo: keep its locked id/name, only sources/mode/
  // merge/fallback are user-editable (the API enforces the same on the server).
  const editingBuiltin = combos.find((c) => c.id === draft.id)?.builtin ?? false;

  return (
    <div>
      <h2>Combos</h2>
      <ul>{combos.map((c) => (
        <li key={c.id} className="flex items-center gap-1 rounded border border-border bg-surface px-2 py-1">
          {c.name ?? c.id} — {c.mode}
          {c.builtin && ' (built-in)'}
          {' '}<button onClick={() => setDraft({ ...emptyDraft, ...c })} className="rounded border border-border px-2 py-0.5 hover:bg-row-hover">Edit</button>
          {!c.builtin && (
            <button onClick={async () => { if (confirm(`Delete combo ${c.name ?? c.id}?`)) { await deleteCombo(c.id); refresh(); } }} className="rounded border border-border px-2 py-0.5 text-danger hover:bg-row-hover">Delete</button>
          )}
        </li>
      ))}</ul>
      <h3>New / Edit combo</h3>
      <div className="mt-3 max-w-[360px] rounded border border-border bg-surface p-2.5">
        <label className="mb-1.5 block">Name <input value={draft.name ?? ''} disabled={editingBuiltin} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full rounded border border-border px-2 py-1" /></label>
        <div>
          <strong className="mb-1.5 block">Sources (↑/↓ to reorder; drag-and-drop is a v2 item):</strong>
          {draft.sources.map((s, i) => (
            <div key={i} className="mb-1.5 flex items-center gap-1">
              <input value={s.provider} onChange={(e) => { const src = [...draft.sources]; src[i] = { ...s, provider: e.target.value }; setDraft({ ...draft, sources: src }); }} className="flex-1 rounded border border-border px-2 py-1" />
              <button onClick={() => moveSource(i, -1)} className="rounded border border-border px-2 py-1 hover:bg-row-hover">↑</button>
              <button onClick={() => moveSource(i, 1)} className="rounded border border-border px-2 py-1 hover:bg-row-hover">↓</button>
              <button onClick={() => setDraft({ ...draft, sources: draft.sources.filter((_, k) => k !== i) })} className="rounded border border-border px-2 py-1 hover:bg-row-hover">×</button>
            </div>
          ))}
          <button onClick={() => setDraft({ ...draft, sources: [...draft.sources, { provider: 'ddg' }] })} className="rounded border border-border px-2 py-1 hover:bg-row-hover">+ source</button>
        </div>
        <label className="mb-1.5 block">Mode
          <select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as ComboMode })} className="ml-1 rounded border border-border px-2 py-1">
            <option value="concurrent">concurrent</option>
            <option value="sequential">sequential</option>
            <option value="hybrid">hybrid</option>
          </select>
        </label>
        <label className="mb-1.5 block">Dedupe
          <select value={draft.merge.dedupe} onChange={(e) => setDraft({ ...draft, merge: { ...draft.merge, dedupe: e.target.value as DedupeMode } })} className="ml-1 rounded border border-border px-2 py-1">
            <option value="url-normalized">url-normalized</option>
            <option value="url">url</option>
            <option value="url+title">url+title</option>
            <option value="off">off</option>
          </select>
        </label>
        <label className="mb-1.5 block">Cap <input type="number" value={draft.merge.cap} onChange={(e) => setDraft({ ...draft, merge: { ...draft.merge, cap: Number(e.target.value) } })} className="ml-1 rounded border border-border px-2 py-1" /></label>
        <label className="mb-1.5 block">min_results <input type="number" value={draft.fallback.min_results} onChange={(e) => setDraft({ ...draft, fallback: { ...draft.fallback, min_results: Number(e.target.value) } })} className="ml-1 rounded border border-border px-2 py-1" /></label>
        <div className="mb-1.5">Fallback on:
          {FALLBACK_TRIGGERS.map((t) => (
            <label key={t} className="mr-2">
              <input type="checkbox" checked={draft.fallback.on.includes(t)} onChange={() => toggleTrigger(t)} /> {t}
            </label>
          ))}
        </div>
        <button onClick={save} className="mt-3 rounded bg-brand px-3 py-1 font-medium text-white hover:bg-brand-hover">Save</button>
      </div>
    </div>
  );
}
