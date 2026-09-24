// Single source of truth for the server's reported version.
//
// Bumping the release number is a ONE-LINE change in packages/server/package.json
// ("version"). Nothing else needs editing — this module reads it back at runtime:
//   - monorepo: dist/version.js sits in packages/server/dist, one level below
//     packages/server/package.json
//   - published tarball: dist/version.js sits in dist/server, one level below the
//     publish-root dist/package.json (whose version is mirrored from the server
//     package by scripts/pack.mjs)
// Both resolve to "version" by walking up exactly one directory, so the same code
// works before and after release. Consume it from /health (app.ts) and /mcp
// (mcp.ts) instead of hardcoding the number anywhere else.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg: { version?: string } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

export const VERSION: string = pkg.version ?? '0.0.0';