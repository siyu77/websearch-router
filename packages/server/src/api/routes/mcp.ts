import type { Application } from 'express';
import type { Provider } from '../../shared/types.js';
import { executeCombo, type SearchResponse } from '../../routing/execute.js';
import { resolveProvider } from '../../routing/resolveProvider.js';
import { ComboValidationError, storedComboToCombo } from '../../routing/normalizeCombo.js';
import { DEFAULT_MCP_PROVIDER, MCP_PROVIDER_ENUM } from '../../routing/builtinCombos.js';
import { VERSION } from '../../version.js';
import { writeUsage } from '../usage.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

// The agent-facing inputSchema, expressed as a Zod "raw shape" (what McpServer.tool()
// expects in SDK v1 — NOT a JSON-Schema object; a plain {type:'object',...} object would
// be misread as ToolAnnotations or rejected). Making query optional here is deliberate:
// the SDK rejects *missing required* Zod fields as a transport-level JSON-RPC error
// BEFORE the handler runs, but spec decision #13 requires param errors to surface as
// isError:true tool results (HTTP 200), not JSON-RPC errors. So we mark everything
// optional at the schema layer and validate query ourselves inside the handler.
//
// `provider` is an ENUM over built-in category combo names (currently just
// 'WEB'), serialized to the model and strictly validated by the SDK. It stays
// optional: omitting it defaults to DEFAULT_MCP_PROVIDER in the handler.
const websearchParams = {
  query: z.string().optional(),
  provider: z.enum(MCP_PROVIDER_ENUM).optional(),
  limit: z.number().optional(),
} as const;

type McpContext = { providers: Record<string, Provider>; combos: any[]; db: any; repos?: any };

// #9 parity with /search: re-read combos from the repo per request so dashboard
// edits take effect immediately; fall back to the boot-time static list when no
// repo is present (tests).
function currentCombos(ctx: McpContext): any[] {
  if (ctx.repos) return ctx.repos.combos.list(ctx.db).map((c: any) => storedComboToCombo(c));
  return ctx.combos;
}

function isLoopbackOrigin(origin: string): boolean {
  // Allow loopback-derived origins (http://127.0.0.1:<port>, http://localhost:<port>).
  try {
    const url = new URL(origin);
    const h = url.hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1';
  } catch {
    return false;
  }
}

function mcpOriginGuard(_req: any, res: any, next: any) {
  const origin = _req.headers.origin;
  if (!origin || isLoopbackOrigin(origin)) return next();
  res.status(403).json({ error: { kind: 'bad_request', message: 'origin not allowed' } });
}

// The websearch tool handler. Extracted so each POST can get a fresh McpServer +
// transport: in stateless mode the SDK (v1.30.0) REQUIRES a fresh transport per
// request — reusing one throws "Stateless transport cannot be reused across
// requests" on the second request. Registering the same tool on each per-request
// McpServer is cheap (handler closures only, no I/O).
async function handleWebsearch(ctx: McpContext, args: { query?: unknown; provider?: unknown; limit?: unknown }) {
    const query = args.query;
    // provider is validated to the enum by the SDK, but keep the `?? default`
    // here — a client that omits it should still get the built-in category combo
    // (decision 2) rather than a hard error. This is not the JSON-RPC path: the
    // enum is what rejects *illegal* values before the handler runs.
    const provider = (args.provider as string | undefined) ?? DEFAULT_MCP_PROVIDER;
    const limit = args.limit;

    // Param error -> isError:true tool result (NOT a JSON-RPC error; decision #13).
    if (typeof query !== 'string' || !query) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: { kind: 'bad_request', message: 'query is required' } }) }],
        isError: true,
      };
    }

    // Shared resolver: provider = combo name/id (saved combo wins) | engine id
    // | inline JSON. MCP passes no accountId/mode (external interface).
    let normalized;
    try {
      normalized = resolveProvider(provider, currentCombos(ctx), {});
    } catch (e) {
      if (e instanceof ComboValidationError) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: { kind: 'bad_request', message: e.message } }) }],
          isError: true,
        };
      }
      throw e;
    }

    const response: SearchResponse = await executeCombo(
      normalized, query, ctx.providers,
      { limit: typeof limit === 'number' && limit > 0 ? limit : undefined },
    );

    if (ctx.repos) writeUsage(ctx.db, ctx.repos, query, normalized, response);

    // All-source failure -> isError:true tool result; envelope mirrors sendError
    // (api/errors.ts:9-10): sourceTimings in top-level meta, NOT inside error.
    if (response.error) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: { kind: response.error.kind, ...(response.error.provider ? { provider: response.error.provider } : {}), ...(response.error.resetAt ? { resetAt: response.error.resetAt } : {}) },
            meta: { sourceTimings: response.meta.sourceTimings },
          }),
        }],
        isError: true,
      };
    }

    // Success -> isError:false; project out internal sourceResultCounts (mirrors search.ts:57).
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          results: response.results,
          partialFailures: response.partialFailures,
          meta: response.meta,
        }),
      }],
      isError: false,
    };
}

export function mountMcp(app: Application, ctx: McpContext) {
  // POST /mcp — pass Express's already-parsed body as the 3rd arg so the SDK
  // doesn't re-read the (already-consumed) request stream. A fresh transport +
  // McpServer per request: in stateless mode the SDK (v1.30.0) forbids reusing a
  // stateless transport across requests (each POST must be self-contained), so we
  // create one per request instead of a shared instance.
  app.post('/mcp', mcpOriginGuard, async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,   // stateless: no session creation/validation
      enableJsonResponse: true,         // JSON-only: single application/json response, no SSE
    });
    const server = new McpServer({ name: 'websearch-router', version: VERSION });
    server.tool('websearch', websearchParams, (args) => handleWebsearch(ctx, args));
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  // Stateless server: no server-initiated stream (GET) or session termination (DELETE).
  app.get('/mcp', (_req, res) => res.status(405).json({ error: { kind: 'bad_request', message: 'use POST' } }));
  app.delete('/mcp', (_req, res) => res.status(405).json({ error: { kind: 'bad_request', message: 'use POST' } }));
}
