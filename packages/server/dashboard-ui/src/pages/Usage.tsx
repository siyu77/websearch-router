import { useEffect, useState } from 'react';
import { getUsage } from '../lib/api';
import type { UsageRow } from '../lib/types';

export function UsagePage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  useEffect(() => { getUsage().then((r) => setRows('usage' in r ? r.usage : [])).catch(() => {}); }, []);
  return (
    <div>
      <h2>Usage & Logs</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr><th className="border border-border px-1.5 py-0.5 text-left">Time</th><th className="border border-border px-1.5 py-0.5 text-left">Query</th><th className="border border-border px-1.5 py-0.5 text-left">Combo</th><th className="border border-border px-1.5 py-0.5 text-left">Results</th><th className="border border-border px-1.5 py-0.5 text-left">Degraded</th><th className="border border-border px-1.5 py-0.5 text-left">Per-source</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-row-hover">
                <td className="border border-border px-1.5 py-0.5">{new Date(r.ts).toLocaleString()}</td>
                <td className="border border-border px-1.5 py-0.5">{r.query}</td>
                <td className="border border-border px-1.5 py-0.5">{r.comboId}</td>
                <td className="border border-border px-1.5 py-0.5">{r.data?.totalResults}</td>
                <td className="border border-border px-1.5 py-0.5 text-danger">{r.data?.degraded ? '⚠' : ''}</td>
                <td className="border border-border px-1.5 py-0.5">
                  {(r.perSource ?? []).length === 0 ? '—' : (
                    <table className="w-full border-collapse">
                      <thead><tr>{['source', 'ms', 'results', 'error'].map((h) => <th key={h} className="border border-border px-1.5 py-0.5 text-left text-muted">{h}</th>)}</tr></thead>
                      <tbody>
                        {(r.perSource ?? []).map((s, i) => (
                          <tr key={i} className={s.error ? 'text-danger' : ''}>
                            <td className="border border-border px-1.5 py-0.5">{s.source}</td>
                            <td className="border border-border px-1.5 py-0.5">{s.durationMs}</td>
                            <td className="border border-border px-1.5 py-0.5">{s.resultCount}</td>
                            <td className="border border-border px-1.5 py-0.5">{s.error ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
