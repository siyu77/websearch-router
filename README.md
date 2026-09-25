# websearch-router

A local websearch aggregation routing service. Combines multiple search backends via a combo→provider→engine three-layer architecture, with normalized merge (URL dedup + RRF), a React dashboard, and a tray/autostart CLI.

## Install

```bash
npm i -g websearch-router
websearch start --tray
```

The server runs on `http://127.0.0.1:8787` by default. The dashboard is served at `/`.

## API

- `POST /search` `{query, provider, accountId?, limit?, mode?}` → `{results, partialFailures, meta}`
- `POST /fetch` `{url}` → `{title, text, mode}` (SSRF-protected)
- `GET /health` → service + provider health + version
- `POST /mcp` → MCP Streamable HTTP endpoint (stateless, JSON-only); exposes one `websearch` tool, see [MCP](#mcp)

## `provider` param

`provider` is required on `/search` and `/mcp` (there is no built-in default combo). Its value resolves as:

- a **saved combo** id or name — wins on name clash (add/edit combos in the dashboard Combos page);
- an **engine id** — `bing` | `ddg` | `google` (free) or `tavily` | `brave` | `exa` (paid, needs an account) — desugared to a single-source inline combo;
- an **inline combo** JSON object or JSON string — `{"sources":[{"provider":"bing"},{"provider":"ddg"}],"mode":"concurrent","merge":{"dedupe":"url-normalized","rank":"rrf","cap":20},"fallback":{"on":["timeout","error","empty"],"min_results":5}}`.

The built-in **`WEB`** combo (id `web`) is seeded on every database and covers the general web-search default: concurrent `bing` + `ddg` with RRF merge. It is **protected** on the dashboard (cannot be deleted or renamed) but its sources/mode/merge/fallback stay editable.

On `/search` (the dashboard test page) the optional `accountId` and `mode` are also accepted; `/mcp` exposes only `{query, provider?, limit}`.

## Configure paid providers

Add accounts via the dashboard (Providers page) or directly into the connections store. Tavily needs a `tvly-` key; Brave needs an `X-Subscription-Token` key. Quota exhaustion returns `{error:{kind:"quota", provider, resetAt}}` (HTTP 429), not 500.

## MCP

The server exposes one MCP tool `websearch` over Streamable HTTP at `POST /mcp` (same port, stateless, JSON-only). inputSchema: `{ query?: string (required in-handler), provider?: "WEB", limit?: number }`.

`provider` is an **optional enum** — currently the only value is `"WEB"`, and omitting it defaults to `WEB`. This pins the MCP surface to the built-in category combo (decision: MCP is the default search entry, not a strategy selector); a future `MEDIA`/`ACADEMIC`/`SOCIAL` category just adds an enum value + a built-in combo. Because the value is enum-validated by the SDK, an illegal provider (e.g. an engine id like `"google"`) is rejected before the handler runs and surfaces as an `isError:true` tool result (HTTP 200) — external callers cannot bypass the `WEB` default via an engine id or inline JSON. `/search` remains the full-parameter interface and still accepts any provider (combo name/id, engine id, inline JSON).

Connect Claude Code (restart the session afterward so it loads the tool):

```bash
claude mcp add --transport http --scope user websearch http://127.0.0.1:8787/mcp
```

With an API key configured (`--apiKey` / `apiKey`), pass the header:

```bash
claude mcp add --transport http --scope user websearch http://127.0.0.1:8787/mcp \
  --header "x-api-key: <your-key>"
```

## Development

```bash
npm install                 # workspaces: packages/server + packages/cli
npm test                    # vitest (offline, no real network)
npm --workspace @websearch/router-internal run build
npm --workspace @websearch/router-dashboard-ui run build   # SPA -> dashboard-dist/
```

Build the publish tarball (bundles CLI + server + dashboard into one package):

```bash
npm run pack                # -> websearch-router-<version>.tgz
```

## Source

Repository: <https://github.com/siyu77/websearch-router> — issues and PRs welcome. Released under the [MIT License](./LICENSE).
