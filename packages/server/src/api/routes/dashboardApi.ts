import { randomUUID } from 'node:crypto';
import type { Application } from 'express';
import { maskApiKey } from '../mask.js';
import { ENGINE_CATALOG, PAID_PROVIDERS } from '../../shared/catalog.js';
import { BUILTIN_COMBOS, isBuiltinCombo, PROTECTED_COMBO_IDS } from '../../routing/builtinCombos.js';

// Paid provider ids a user can attach an API-key account to (v1) — derived from
// the catalog (single source of truth). Free engines are surfaced read-only via
// GET /api/engines; toggling free engines is a v2 item.

export function mountDashboardApi(app: Application, ctx: { db: any; repos: any }) {
  const conns = ctx.repos.connections;
  const combosRepo = ctx.repos.combos;

  // GET /api/engines — list every engine with its kind; free engines are
  // read-only available in v1 (account enable/disable applies to paid only).
  app.get('/api/engines', (_req, res) => {
    try {
      res.json({ engines: ENGINE_CATALOG });
    } catch (e) {
      res.status(500).json({ error: { kind: 'unknown', message: (e as Error).message } });
    }
  });

  // GET /api/providers — list provider connections (grouped by provider) with
  // quota/cooldown/lastError. API keys are masked at the boundary (LSP): the
  // client sees `apiKeySet` + a masked preview, never the plaintext.
  app.get('/api/providers', (_req, res) => {
    try {
      const rows = conns.listAll(ctx.db);
      const grouped: Record<string, any[]> = {};
      for (const row of rows) {
        const key = row.data.apiKey as string | undefined;
        (grouped[row.provider] ??= []).push({
          id: row.id,
          name: typeof row.data.name === 'string' && row.data.name ? row.data.name : undefined,
          priority: row.priority,
          isActive: row.isActive,
          apiKeySet: !!key,
          apiKey: maskApiKey(key),
          quota: row.data.quota,
          cooldown: row.data.cooldown,
          lastError: row.data.lastError,
        });
      }
      res.json({ providers: Object.entries(grouped).map(([id, accounts]) => ({ id, accounts })) });
    } catch (e) {
      res.status(500).json({ error: { kind: 'unknown', message: (e as Error).message } });
    }
  });

  // POST /api/providers — create a paid-provider account (ISP: focused handler).
  // Only the paid set is addressable in v1; apiKey is required on create.
  app.post('/api/providers', (req, res) => {
    try {
      const { provider, apiKey, priority, proxy, name } = req.body ?? {};
      if (!PAID_PROVIDERS.includes(provider)) {
        res.status(400).json({ error: { kind: 'bad_request', message: `provider must be one of ${PAID_PROVIDERS.join(', ')}` } });
        return;
      }
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        res.status(400).json({ error: { kind: 'bad_request', message: 'apiKey is required' } });
        return;
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      const data: Record<string, unknown> = { apiKey };
      if (typeof name === 'string' && name.trim().length > 0) data.name = name.trim(); // optional display label
      if (typeof proxy === 'string' && proxy.length > 0) data.proxyOverride = proxy;
      conns.upsert(ctx.db, {
        id, provider, authType: 'apikey',
        priority: typeof priority === 'number' ? priority : 0,
        isActive: true, data, createdAt: now, updatedAt: now,
      });
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ error: { kind: 'unknown', message: (e as Error).message } });
    }
  });

  // PUT /api/providers/:id — partial update. An empty/omitted apiKey preserves
  // the stored key (user decision): the form only changes what was typed.
  app.put('/api/providers/:id', (req, res) => {
    try {
      const existing = conns.getById(ctx.db, req.params.id);
      if (!existing) {
        res.status(404).json({ error: { kind: 'not_found', message: `provider connection not found: ${req.params.id}` } });
        return;
      }
      const { apiKey, priority, isActive, proxy, name } = req.body ?? {};
      const data: Record<string, unknown> = { ...existing.data };
      if (typeof apiKey === 'string' && apiKey.length > 0) data.apiKey = apiKey; // empty = keep
      // proxy === '' clears the override; undefined leaves it untouched.
      if (proxy !== undefined) {
        if (typeof proxy === 'string' && proxy.length > 0) data.proxyOverride = proxy;
        else delete data.proxyOverride;
      }
      // name === '' clears the label; undefined leaves it untouched (same pattern as proxy).
      if (name !== undefined) {
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (trimmed.length > 0) data.name = trimmed;
        else delete data.name;
      }
      const nextPriority = typeof priority === 'number' ? priority : existing.priority;
      const nextActive = typeof isActive === 'boolean' ? isActive : existing.isActive;
      conns.upsert(ctx.db, { ...existing, priority: nextPriority, isActive: nextActive, data, updatedAt: new Date().toISOString() });
      res.json({ ok: true, id: existing.id });
    } catch (e) {
      res.status(500).json({ error: { kind: 'unknown', message: (e as Error).message } });
    }
  });

  // DELETE /api/providers/:id — remove an account.
  app.delete('/api/providers/:id', (req, res) => {
    try {
      conns.remove(ctx.db, req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: { kind: 'unknown', message: (e as Error).message } });
    }
  });

  // GET /api/combos — list saved combos; built-in category combos are flagged
  // `builtin: true` so the UI can show them as protected (decision C).
  app.get('/api/combos', (_req, res) => {
    try {
      const combos = combosRepo.list(ctx.db);
      res.json({ combos: combos.map((c: any) => ({ id: c.id, name: c.name, mode: c.mode, ...c.data, builtin: PROTECTED_COMBO_IDS.has(c.id) })) });
    } catch (e) {
      res.status(500).json({ error: { kind: 'unknown', message: (e as Error).message } });
    }
  });

  // POST /api/combos — save (upsert) a combo. Built-in category combos are
  // protected: id/name are locked to the built-in definition (decision A), but
  // sources/mode/merge/fallback/hybrid remain user-editable.
  app.post('/api/combos', (req, res) => {
    try {
      const { id, name, mode, sources, merge, fallback, hybrid } = req.body ?? {};
      const now = new Date().toISOString();
      const builtin = typeof id === 'string' && isBuiltinCombo(id);
      const recordId = builtin ? BUILTIN_COMBOS.find((c) => c.id === id)!.id : id;
      const recordName = builtin ? BUILTIN_COMBOS.find((c) => c.id === id)!.name! : name;
      combosRepo.upsert(ctx.db, { id: recordId, name: recordName, mode, data: { sources, merge, fallback, hybrid }, createdAt: now, updatedAt: now });
      res.json({ ok: true, id: recordId });
    } catch (e) {
      res.status(500).json({ error: { kind: 'unknown', message: (e as Error).message } });
    }
  });

  // DELETE /api/combos/:id — remove a saved combo. Built-in combos cannot be
  // deleted (decision A): the websearch MCP tool defaults to `WEB`, so it must
  // always exist.
  app.delete('/api/combos/:id', (req, res) => {
    try {
      if (isBuiltinCombo(req.params.id)) {
        res.status(400).json({ error: { kind: 'bad_request', message: `built-in combo '${req.params.id}' cannot be deleted` } });
        return;
      }
      combosRepo.remove(ctx.db, req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: { kind: 'unknown', message: (e as Error).message } });
    }
  });

  // GET /api/usage — recent searches with per-source timing/failures. The
  // detail join is a single IN query delegated to the repo (no N+1); the route
  // stays a thin delegator (SRP).
  app.get('/api/usage', (_req, res) => {
    try {
      const usage = ctx.repos.usage.recent(ctx.db, 50);
      const detailsByUsage = ctx.repos.details.byUsageIds(ctx.db, usage.map((u: any) => u.id));
      const usageWithSources = usage.map((u: any) => ({
        ...u,
        perSource: (detailsByUsage[u.id] ?? []).map((d: any) => ({
          source: d.source,
          durationMs: d.data.durationMs,
          resultCount: d.data.resultCount,
          error: d.data.error,
        })),
      }));
      res.json({ usage: usageWithSources });
    } catch (e) {
      res.status(500).json({ error: { kind: 'unknown', message: (e as Error).message } });
    }
  });
}
