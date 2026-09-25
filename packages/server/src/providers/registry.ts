import type { Provider } from '../shared/types.js';
import { PAID_PROVIDERS } from '../shared/catalog.js';
import { DefaultProvider } from './defaultProvider.js';
import { createPaidProvider, type AccountStatus } from './paidProvider.js';
import { tavilyAdapter } from './tavily/index.js';
import { braveAdapter } from './brave/index.js';
import { exaAdapter } from './exa/index.js';
import { semanticScholarAdapter } from './semanticScholar/index.js';
import { openalexAdapter } from './openalex/index.js';
import { bingEngine } from '../engines/bing/index.js';
import { ddgEngine } from '../engines/duckduckgo/index.js';
import { googleEngine } from '../engines/google/index.js';
import { crossrefEngine } from '../engines/crossref/index.js';
import { arxivEngine } from '../engines/arxiv/index.js';
import * as connectionsRepo from '../db/repos/connectionsRepo.js';

// adapter map keyed by provider id — every id here MUST be a member of the
// catalog's paid set (PAID_PROVIDERS), which is the single source of truth.
const PAID_ADAPTERS: Record<string, typeof tavilyAdapter> = {
  tavily: tavilyAdapter,
  brave: braveAdapter,
  exa: exaAdapter,
  semantic_scholar: semanticScholarAdapter,
  openalex: openalexAdapter,
};

export function buildProviders(db: any): Record<string, Provider> {
  const providers: Record<string, Provider> = {
    bing: new DefaultProvider(bingEngine),
    ddg: new DefaultProvider(ddgEngine),
    google: new DefaultProvider(googleEngine),
    crossref: new DefaultProvider(crossrefEngine),
    arxiv: new DefaultProvider(arxivEngine),
  };

  const paid = PAID_PROVIDERS.map((id) => [id, PAID_ADAPTERS[id]] as const);

  for (const [id, adapter] of paid) {
    providers[id] = createPaidProvider({
      id,
      adapter,
      repo: connectionsRepo,
      getAccountStatus: (account: any): AccountStatus => ({
        cooldown: account.data.cooldown,
        quota: account.data.quota,
        lastError: account.data.lastError,
      }),
      writeAccountStatus: (accountId: string, status: AccountStatus) => {
        connectionsRepo.updateData(db, accountId, {
          cooldown: status.cooldown, quota: status.quota, lastError: status.lastError,
        });
      },
    }, db);
  }

  return providers;
}