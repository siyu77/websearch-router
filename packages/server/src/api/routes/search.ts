import type { Application } from 'express';
import type { Provider } from '../../shared/types.js';
import { executeCombo } from '../../routing/execute.js';
import { resolveProvider } from '../../routing/resolveProvider.js';
import { ComboValidationError, storedComboToCombo } from '../../routing/normalizeCombo.js';
import { sendError, sendBadRequest } from '../errors.js';
import { writeUsage } from '../usage.js';

// #9: combos are re-read from the repo on every request so edits made in the
// dashboard take effect immediately (session-scoped). Without a repo (tests),
// fall back to the static list passed at app-creation time.
function currentCombos(ctx: { combos: any[]; db: any; repos?: any }): any[] {
  if (ctx.repos) return ctx.repos.combos.list(ctx.db).map((c: any) => storedComboToCombo(c));
  return ctx.combos;
}

export function mountSearch(app: Application, ctx: { providers: Record<string, Provider>; combos: any[]; db: any; repos?: any }) {
  app.post('/search', async (req, res) => {
    // /search is the internal full-param interface (dashboard test page): it
    // accepts accountId/mode alongside the unified `provider` param. /mcp is
    // the external surface and parses only {query, provider, limit}.
    const { query, provider, accountId, limit, mode } = req.body ?? {};
    if (!query || typeof query !== 'string') return sendBadRequest(res, 'query is required');

    let normalized;
    try {
      normalized = resolveProvider(provider, currentCombos(ctx), { accountId, mode });
    } catch (e) {
      if (e instanceof ComboValidationError) return sendBadRequest(res, e.message);
      throw e;
    }

    const response = await executeCombo(normalized, query, ctx.providers, { limit: typeof limit === 'number' && limit > 0 ? limit : undefined });

    if (ctx.repos) writeUsage(ctx.db, ctx.repos, query, normalized, response);

    // all-source failure -> top-level error (non-500); provider + timings carried (#7)
    if (response.error) {
      return sendError(res, response.error.kind, { provider: response.error.provider, resetAt: response.error.resetAt, sourceTimings: response.meta.sourceTimings });
    }

    res.json({ results: response.results, partialFailures: response.partialFailures, meta: response.meta });
  });
}
