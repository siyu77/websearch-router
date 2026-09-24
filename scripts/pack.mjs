// Build the publish tarball for the single `websearch-router` package.
//
// The npm package bundles the CLI and the server + dashboard into one flat
// `dist/` layout:
//   dist/cli.js            (from packages/cli/dist/cli.js — the bin entry)
//   dist/tray|scripts/...  (CLI assets)
//   dist/server/           (from packages/server/dist — serverEntry() probes
//                           dist/server/server.js after publish)
//   dist/dashboard-dist/   (SPA; dashboard.ts default distDir resolves here)
//   dist/package.json      (published package metadata; deps = server runtime deps,
//                           minus the internal workspace dep which is bundled)
//
// Run after `npm run build` (both workspaces + dashboard built). Produces
// websearch-router-<version>.tgz next to this repo's package.json.

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(root, 'dist');

const cliPkg = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));
const serverPkg = JSON.parse(readFileSync(join(root, 'packages/server/package.json'), 'utf8'));

rmSync(distRoot, { recursive: true, force: true });
mkdirSync(join(distRoot, 'server'), { recursive: true });
mkdirSync(join(distRoot, 'dashboard-dist'), { recursive: true });

// CLI dist -> publish root (cli.js, tray/, scripts/, ...)
cpSync(join(root, 'packages/cli/dist'), distRoot, { recursive: true });
// Server dist -> dist/server
cpSync(join(root, 'packages/server/dist'), join(distRoot, 'server'), { recursive: true });
// Dashboard SPA -> dist/dashboard-dist (skip if not built; dashboard.ts falls
// back to its JSON "not built" response when dashboard-dist is absent).
const dashboardDist = join(root, 'packages/server/dashboard-dist');
if (existsSync(dashboardDist)) {
  cpSync(dashboardDist, join(distRoot, 'dashboard-dist'), { recursive: true });
}

// Published package.json. Runtime deps come from the server package (the CLI has
// no external runtime deps beyond the bundled server). Exclude the internal
// workspace dep `@websearch/router-internal` — the server ships in the tarball.
const dependencies = { ...serverPkg.dependencies };
delete dependencies['@websearch/router-internal'];

const publishedPkg = {
  name: cliPkg.name, // websearch-router
  version: cliPkg.version,
  description: cliPkg.description,
  license: cliPkg.license,
  author: cliPkg.author,
  repository: cliPkg.repository,
  type: 'module',
  main: 'cli.js',
  bin: { websearch: 'cli.js' },
  files: ['**/*'],
  engines: { node: serverPkg.engines?.node ?? '>=22.5.0' },
  dependencies,
  ...(serverPkg.optionalDependencies ? { optionalDependencies: serverPkg.optionalDependencies } : {}),
};

writeFileSync(join(distRoot, 'package.json'), JSON.stringify(publishedPkg, null, 2) + '\n');

// Pack dist/ as a real npm package -> websearch-router-<version>.tgz
execSync(`npm pack ./dist --pack-destination ${root}`, { cwd: root, stdio: 'inherit' });
console.log('\nPacked websearch-router@' + publishedPkg.version + '.');