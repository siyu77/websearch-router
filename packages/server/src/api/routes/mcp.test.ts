import { describe, it, expect } from 'vitest';
import { createApp } from '../app.js';
import { BUILTIN_COMBOS, MCP_PROVIDER_ENUM } from '../../routing/builtinCombos.js';
import type { Provider, Result } from '../../shared/types.js';

const okProvider = (id: string, results: Result[]): Provider => ({
  id, async search() { return { results, quota: null }; },
});

// JSON-RPC request builders. The initialize handshake is needed before tools/list or
// tools/call in a stateful server, but ours is stateless — we still send initialize
// first to mirror a real client and assert the no-session-id contract.
const rpc = (id: number, method: string, params: unknown = {}) => ({
  jsonrpc: '2.0', id, method, params,
});

const initialize = rpc(1, 'initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'test-client', version: '1.0' },
});

const toolsList = rpc(2, 'tools/list');

const callTool = (id: number, args: Record<string, unknown>) =>
  rpc(id, 'tools/call', { name: 'websearch', arguments: args });

// Helper: run the initialize handshake, then make a second request on a fresh
// connection (no Mcp-Session-Id carried) — asserts statelessness.
async function mcpPost(app: any, body: unknown) {
  const supertest = (await import('supertest')).default;
  return supertest(app).post('/mcp').set('Accept', 'application/json, text/event-stream').send(body);
}

// The built-in WEB combo needs bing + ddg providers registered so its sources
// can actually execute (default MCP provider path).
const webProviders = () => ({
  bing: okProvider('bing', [{ title: 't', url: 'https://bing.com/1', snippet: '', rank_in_source: 0 }]),
  ddg: okProvider('ddg', []),
});

describe('MCP /mcp endpoint', () => {
  it('initialize -> InitializeResult, no Mcp-Session-Id (stateless)', async () => {
    const { app } = await createApp({ providers: {}, combos: BUILTIN_COMBOS, db: null as any });
    const res = await mcpPost(app, initialize);
    expect(res.status).toBe(200);
    expect(res.headers['mcp-session-id']).toBeUndefined();
    const body = res.body.result ?? res.body;
    expect(body.protocolVersion).toBe('2025-03-26');
    expect(body.capabilities?.tools).toBeDefined();
    expect(body.serverInfo?.name).toBe('websearch-router');
  });

  it('tools/list -> exactly one websearch tool; provider is an enum over built-in combos', async () => {
    const { app } = await createApp({ providers: {}, combos: BUILTIN_COMBOS, db: null as any });
    const res = await mcpPost(app, toolsList);
    expect(res.status).toBe(200);
    const tools = res.body.result.tools;
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('websearch');
    const props = tools[0].inputSchema.properties;
    expect(Object.keys(props).sort()).toEqual(['limit', 'provider', 'query']);
    // provider is an enum (['WEB']), not a free-form string.
    expect(props.provider).toEqual({ type: 'string', enum: MCP_PROVIDER_ENUM });
    // The contract forbids combo/accountId/mode.
    expect(props).not.toHaveProperty('combo');
    expect(props).not.toHaveProperty('accountId');
    expect(props).not.toHaveProperty('mode');
  });

  it('tools/call without provider -> defaults to the built-in WEB combo', async () => {
    const calls: string[] = [];
    const providers = {
      bing: { id: 'bing', async search(q: string) { calls.push(q); return { results: [{ title: 't', url: 'https://bing.com/1', snippet: '', rank_in_source: 0 }] }; } } as any,
      ddg: { id: 'ddg', async search(q: string) { calls.push(q); return { results: [], quota: null }; } } as any,
    };
    const { app } = await createApp({ providers, combos: BUILTIN_COMBOS, db: null as any });
    const res = await mcpPost(app, callTool(3, { query: 'hello' }));
    expect(res.status).toBe(200);
    const result = res.body.result;
    expect(result.isError).toBe(false);
    // WEB = concurrent over bing + ddg.
    expect(calls).toEqual(['hello', 'hello']);
    const content = JSON.parse(result.content[0].text);
    expect(content.meta.combo).toBe('web');
  });

  it('tools/call with provider WEB -> same execution path', async () => {
    const calls: string[] = [];
    const providers = {
      bing: { id: 'bing', async search(q: string) { calls.push(q); return { results: [{ title: 't', url: 'https://bing.com/1', snippet: '', rank_in_source: 0 }] }; } } as any,
      ddg: { id: 'ddg', async search(q: string) { calls.push(q); return { results: [], quota: null }; } } as any,
    };
    const { app } = await createApp({ providers, combos: BUILTIN_COMBOS, db: null as any });
    const res = await mcpPost(app, callTool(4, { query: 'hello', provider: 'WEB' }));
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(false);
    expect(calls).toEqual(['hello', 'hello']);
    const content = JSON.parse(res.body.result.content[0].text);
    expect(content.meta.combo).toBe('web');
  });

  it('tools/call with an illegal provider value -> isError:true tool result (SDK enum validation)', async () => {
    // `provider` is an enum; the SDK rejects non-enum values with -32602. In SDK
    // v1.30.0 a thrown McpError inside a tool handler is serialized as an
    // isError:true tool result (HTTP 200), so decision #13 still holds — the
    // illegal provider surfaces as a tool result, never a JSON-RPC error, and the
    // handler never runs. This is the deliberate "MCP is pinned to the built-in
    // WEB category" contract: external callers cannot bypass it via an engine id
    // or inline JSON.
    const calls: string[] = [];
    const providers = {
      bing: { id: 'bing', async search(q: string) { calls.push(q); return { results: [], quota: null }; } } as any,
    };
    const { app } = await createApp({ providers, combos: BUILTIN_COMBOS, db: null as any });
    const res = await mcpPost(app, callTool(5, { query: 'hello', provider: 'google' }));
    expect(res.status).toBe(200);
    const result = res.body.result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('MCP error -32602');
    expect(result.content[0].text).toContain('expected one of "WEB"|"ACADEMIC"');
    expect(calls.length).toBe(0); // handler never ran
  });

  it('tools/call all-source failure -> isError:true, envelope with sourceTimings in meta, HTTP 200', async () => {
    const providers = {
      bing: { id: 'bing', async search() { return { results: [], error: { kind: 'blocked' } }; } } as any,
      ddg: { id: 'ddg', async search() { return { results: [], error: { kind: 'blocked' } }; } } as any,
    };
    const { app } = await createApp({ providers, combos: BUILTIN_COMBOS, db: null as any });
    const res = await mcpPost(app, callTool(6, { query: 'hello' }));
    expect(res.status).toBe(200); // NOT 500
    const result = res.body.result;
    expect(result.isError).toBe(true);
    const content = JSON.parse(result.content[0].text);
    expect(content.error.kind).toBe('blocked');
    // sourceTimings MUST be in top-level meta, NOT inside error (mirrors api/errors.ts:9-10)
    expect(content.meta.sourceTimings.bing).toBeTypeOf('number');
    expect(content.error).not.toHaveProperty('sourceTimings');
  });

  it('tools/call param error (missing query) -> isError:true, bad_request envelope, no search executed', async () => {
    const calls: string[] = [];
    const providers = {
      bing: { id: 'bing', async search(q: string) { calls.push(q); return { results: [], quota: null }; } } as any,
      ddg: { id: 'ddg', async search(q: string) { calls.push(q); return { results: [], quota: null }; } } as any,
    };
    const { app } = await createApp({ providers, combos: BUILTIN_COMBOS, db: null as any });
    const res = await mcpPost(app, callTool(7, {}));
    expect(res.status).toBe(200);
    const result = res.body.result;
    expect(result.isError).toBe(true);
    const content = JSON.parse(result.content[0].text);
    expect(content.error.kind).toBe('bad_request');
    expect(calls.length).toBe(0); // search never ran
  });

  it('configured apiKey without key -> 401', async () => {
    const { app } = await createApp({ providers: {}, combos: BUILTIN_COMBOS, db: null as any, apiKey: 'secret' });
    const res = await mcpPost(app, initialize);
    expect(res.status).toBe(401);
  });

  it('configured apiKey with valid key -> processes normally', async () => {
    const { app } = await createApp({ providers: webProviders(), combos: BUILTIN_COMBOS, db: null as any, apiKey: 'secret' });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).post('/mcp').set('x-api-key', 'secret').set('Accept', 'application/json, text/event-stream').send(callTool(8, { query: 'hello' }));
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(false);
  });

  it('GET /mcp (authenticated) -> 405', async () => {
    const { app } = await createApp({ providers: {}, combos: BUILTIN_COMBOS, db: null as any, apiKey: 'secret' });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/mcp').set('x-api-key', 'secret');
    expect(res.status).toBe(405);
  });

  it('DELETE /mcp (authenticated) -> 405', async () => {
    const { app } = await createApp({ providers: {}, combos: BUILTIN_COMBOS, db: null as any, apiKey: 'secret' });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).delete('/mcp').set('x-api-key', 'secret');
    expect(res.status).toBe(405);
  });

  it('stateless: second request without Mcp-Session-Id is processed normally', async () => {
    const { app } = await createApp({ providers: webProviders(), combos: BUILTIN_COMBOS, db: null as any });
    // First request (initialize) — assert no session id returned.
    const r1 = await mcpPost(app, initialize);
    expect(r1.headers['mcp-session-id']).toBeUndefined();
    // Second request (tools/call) on a fresh connection, carrying no session id.
    const r2 = await mcpPost(app, callTool(9, { query: 'hello' }));
    expect(r2.status).toBe(200);
    expect(r2.body.result.isError).toBe(false);
  });

  it('Origin guard: loopback / no Origin allowed; unexpected Origin rejected', async () => {
    const { app } = await createApp({ providers: webProviders(), combos: BUILTIN_COMBOS, db: null as any });

    // No Origin header (loopback local client) -> allowed.
    const supertest = (await import('supertest')).default;
    const noOrigin = await supertest(app).post('/mcp').set('Accept', 'application/json, text/event-stream').send(callTool(10, { query: 'hello' }));
    expect(noOrigin.status).toBe(200);

    // Loopback-derived Origin -> allowed.
    const loopback = await supertest(app).post('/mcp').set('Origin', 'http://127.0.0.1:8787').set('Accept', 'application/json, text/event-stream').send(callTool(11, { query: 'hello' }));
    expect(loopback.status).toBe(200);

    // Unexpected Origin -> rejected (403).
    const evil = await supertest(app).post('/mcp').set('Origin', 'http://evil.example.com').set('Accept', 'application/json, text/event-stream').send(callTool(12, { query: 'hello' }));
    expect(evil.status).toBe(403);
  });

  it('/health payload includes mcp: { endpoint, transport, stateless }', async () => {
    const { app } = await createApp({ providers: {}, combos: BUILTIN_COMBOS, db: null as any });
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.mcp).toEqual({ endpoint: '/mcp', transport: 'streamable-http', stateless: true });
    // Existing fields still present (no breakage).
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBeDefined();
  });
});
