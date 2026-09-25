import express, { type Application } from 'express';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function mountDashboard(app: Application, distDir?: string) {
  const dir = distDir ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dashboard-dist');
  if (existsSync(dir)) {
    app.use(express.static(dir));
    // SPA fallback: serve index.html for any non-API GET/HEAD so the frontend
    // router can handle deep links / refresh. /api/* and non-GET methods fall
    // through to Express's 404 (unknown /api subpaths have no named handler and
    // must not return HTML; PUT /search etc. are not page loads either).
    // Express 5: app.get('*') is gone — use a use() catch-all. Registered last
    // in app.ts so /search /fetch /mcp /health are already handled before this runs.
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(join(dir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => res.json({ name: 'websearch-router', dashboard: 'not built — run npm run build:dashboard' }));
  }
}
