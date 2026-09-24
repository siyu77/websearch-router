import express, { type Application } from 'express';
import type { Provider } from '../shared/types.js';
import type { Combo } from '../routing/combo.js';
import { mountSearch } from './routes/search.js';
import { mountFetch } from './routes/fetch.js';
import { mountDashboard } from './routes/dashboard.js';
import { mountDashboardApi } from './routes/dashboardApi.js';
import { mountMcp } from './routes/mcp.js';
import { VERSION } from '../version.js';

export interface CreateAppOptions {
  providers: Record<string, Provider>;
  combos: Combo[];
  db: any;
  apiKey?: string;
  repos?: any;
  distDir?: string;
}

export async function createApp(opts: CreateAppOptions): Promise<{ app: Application; providers: Record<string, Provider>; combos: Combo[]; db: any }> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Optional API key (loopback assumed by bind; header check if configured)
  app.use((req, res, next) => {
    if (opts.apiKey && (req.path.startsWith('/search') || req.path === '/fetch' || req.path === '/mcp')) {
      if (req.header('x-api-key') !== opts.apiKey) {
        res.status(401).json({ error: { kind: 'auth', message: 'missing/invalid API key' } });
        return;
      }
    }
    next();
  });

  app.get('/health', (_req, res) => {
    const providerHealth = Object.keys(opts.providers).map((id) => ({ id, available: true }));
    // W8: bound port/hostname set on app.locals by server.ts after 'listening'
    // (correct even when port:0 requests an OS-assigned port); null when the app
    // was created without a live listen (tests).
    res.json({
      status: 'ok',
      version: VERSION,
      providers: providerHealth,
      port: res.app.locals.port ?? null,
      hostname: res.app.locals.hostname ?? null,
      mcp: { endpoint: '/mcp', transport: 'streamable-http', stateless: true },
    });
  });

  // routes: /search (6.2), /fetch (6.4), /mcp, dashboard API (7.6), dashboard serve (6.4)
  mountSearch(app, { providers: opts.providers, combos: opts.combos, db: opts.db, repos: opts.repos });
  mountFetch(app);
  mountMcp(app, { providers: opts.providers, combos: opts.combos, db: opts.db, repos: opts.repos });

  // dashboard API routes (7.6): /api/providers + /api/combos + /api/usage — the SPA pages consume these.
  // Handlers dereference ctx.repos, so only mount when repos is present.
  if (opts.repos) mountDashboardApi(app, { db: opts.db, repos: opts.repos });

  // SPA serve + fallback LAST: the catch-all must register after /search /fetch
  // /mcp /api/* /health so it never intercepts them. (Only moving mountDashboardApi
  // earlier would still let the fallback swallow mountMcp, which is why the whole
  // dashboard mount moves to the end — single source of truth, no exclusion list.)
  mountDashboard(app, opts.distDir);

  return { app, providers: opts.providers, combos: opts.combos, db: opts.db };
}