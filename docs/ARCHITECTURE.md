# websearch-router — Architecture

A local-first aggregate web search platform. **websearch-router** is a small npm package that bundles a Node/TypeScript server, a local dashboard web app, and a desktop tray launcher into one distributable. It aggregates queries across free search engines and paid search APIs, deduplicates and ranks the results, and exposes the result over a dedicated local HTTP API and an MCP (Model Context Protocol) tool endpoint for LLM agents.

It is a local, single-user tool: the server is intended to run on your own machine and is reachable by default only on loopback. No cloud account is required to use the free engines and built-in combo.

---

## Tech stack and distribution

- **Language & runtime:** Node.js / TypeScript.
- **Server framework:** Express.
- **Dashboard:** React single-page app compiled with Vite, served statically by the same Express process on the same port (no SSR).
- **Data layer:** single-file SQLite with a driver fallback chain (see [Persistence](#persistence)).
- **Distribution:** delivered as a **single npm package** named `websearch-router`. The package bundles the server, the dashboard build, and the CLI/tray launcher into one artifact — no separate server and cli packages.

> Config/dependency wiring uses a two-package layout internally (a root package holding the server + dashboard, and a `cli/` package published as `websearch-router` that owns the tray/autostart and launches the server). From an end-user and distribution standpoint these ship together as one npm-installable product.

---

## Three-layer architecture: combo → provider → engine

Requests flow top-down through three layers of abstraction. Each layer has a single, well-defined responsibility, and only the top layer ("combo") is visible to callers.

1. **Engine (bottom)** — Adapters that speak a single free search-engine's protocol (HTML scraping, JSONP, etc.) and normalize the response. Engines are *pure and stateless*: they hold no accounts, quotas, or cooldowns; they only turn `(query, limit)` into a list of normalized results. See [Free engines](#free-engines-and-paid-providers).
2. **Provider (middle)** — A wrapper representing one backend *class*. A provider can have **multiple accounts (connections)**, each with its own credentials, proxy, quota state, and cooldown. A provider may wrap paid search APIs (like Tavily/Brave/Exa) *or* be layered over a free engine (e.g. to run the same engine through multiple proxy egress accounts). Providers normalize responses, quotas, cooldowns, and error kinds into one uniform contract, and choose the best available account via a `priority` ordering.
3. **Combo (top)** — A strategy object encoding an *ordered list* of participating providers/engines, an execution **mode** (concurrent / sequential / hybrid), merge/dedupe rules, and failure tolerance. This is what the HTTP API and MCP surface expose. See [Search routing](#search-routing).

Because Every layer speaks the same normalized `Result` shape (see below), a combo can freely mix free engines and paid providers without the routing layer caring which engine produced which result.

---

## Free engines and paid providers

All engine and paid-provider metadata lives in a **single source of truth**: `shared/catalog.ts`, which exports `ENGINE_CATALOG` (the free/paid listing). `PAID_PROVIDERS` in the same catalog. The routing layer (`dashboardApi`) and the registry both read from this catalog — neither hardcodes its own list. **Adding a new provider requires only one new catalog row plus a new adapter file**; the dashboard and API pick it up automatically.

### Free engines (no API key)

Adapters ported from an open-source scraping-engine collection. The full pool is: `bing`, `duckduckgo`, `brave` (web scraping), `baidu`, `sogou`, `startpage`, `juejin`, `csdn`, `hackernews`, `linuxdo` (compound with `site:` filtering).

**v1 implements three of these:** `bing` (HTML scraping + anti-bot probing), `duckduckgo` (JSONP extraction with HTML fallback), and `google` (HTML scraping; heavy anti-bot, so blocked results are expected and treated as a known risk).

### Paid providers (API key required)

- **Tavily** — `POST` with a `Bearer tvly-…` key; returns a `score`; quota indicated by HTTP 432/433.
- **Brave Search API** — `GET` with an `X-Subscription-Token`; no `score`; quota in the `X-RateLimit-*` headers and HTTP 402.
- **Exa** — `POST https://api.exa.ai/search` with an `x-api-key` header; no `score`; `numResults` capped at 10 (a cost guard, `min(limit, 10)`); errors 401/402/429.
- (Exa was originally listed among the free engines, but its keyless internal endpoint broke, so it is now a paid provider.)

Each paid adapter parses its vendor's response (quota in the body or headers), normalizes it into the shared `Result` shape (optionally with a `score`), and emits `QuotaInfo {remaining, resetAt, exhausted}` plus an `ErrorKind`. Vendor HTTP statuses are mapped to the uniform error kinds via an `ERROR_RULES` table (see [Providers: error handling](#providers-error-handling-and-cooldowns)).

### Normalized result shape

Every adapter — free engine or paid provider — emits the **same** `Result`:

- `title`
- `url`
- `snippet`
- `rank_in_source` (0-based rank within that engine's own result list)
- `score` *(optional, paid providers only)*

---

## HTTP API

The server exposes a dedicated local HTTP API. The dashboard and CLI both talk to this API exclusively; neither touches storage directly.

| Endpoint | Method | Purpose |
|---|---|---|
| `/search` | POST | Run a search and return merged results |
| `/search/stream` | POST | Same, as Server-Sent Events, results pushed edge-to-edge |
| `/fetch` | POST | Fetch and return the text body of a URL |
| `/health` | GET | Service + provider/module health and version |
| `/mcp` | POST | MCP streamable-HTTP tool endpoint (see [MCP](#mcp)) |

### `POST /search` — the search contract

Request body:

```json
{ "query": "...", "provider": "...", "accountId": "...", "limit": 10, "mode": "..." }
```

- `query` — the search text (**required**).
- `provider` — the search target (**required**). Resolves to one of:
  - a **saved combo** id/name (name matching is case-insensitive; when a name collides with an engine/module id, the saved combo wins — ids match exactly);
  - an **engine/module id** (`bing` \| `ddg` \| `google` \| `tavily` \| `brave` \| `exa`) — desugared to a single-source inline combo;
  - an **inline combo** given as a JSON object or string.
  - A top-level `provider` that is a paid module may carry an `accountId` to pin the request to one specific account.
- `limit` *(optional)* — max results.
- `mode` *(optional)* — combo execution-mode override.

Response body (HTTP 200):

```json
{ "results": [...], "partialFailures": [...], "meta": { "combo": "...", "sourceTimings": {...}, "degraded": false } }
```

- `results` — merged, deduplicated, RRF-ranked result list, truncated to the combo's cap.
- `partialFailures` — per-source failures that did not block the overall search (`{source, error}`).
- `meta` — the combo used, per-source timings, and whether degradation (sequential top-up) triggered.

**Provider resolution** has no built-in fallback: `provider` is mandatory. An inline combo passed through `POST /search` uses `combo`/`provider` semantically interchangeably — a request that carries both `combo` and `provider` is rejected with `400 bad_request`, and a top-level `accountId` is ignored when `combo` is present.

The built-in **`WEB` combo** (id `web`) is seeded at first init: `{ id: 'web', name: 'WEB' }`, running `bing` + `ddg` concurrently, RRF merge, fallback on timeout/error/empty, `min_results` 5. Startup does not overwrite user edits to its sources/mode/merge/fallback. `provider: 'WEB'` (or `'web'`) hits it by name and returns `meta.combo === 'web'`.

### `POST /fetch`

Takes `{url}`, fetches and returns the article body (supports csdn, GitHub README, and general web pages). SSRF-protected — private/loopback addresses are rejected.

### `GET /health`

Returns service status, per-provider/account health, version, and MCP availability. Adds an `mcp` field:

```json
{ "...": "...", "mcp": { "endpoint": "/mcp", "transport": "streamable-http", "stateless": true } }
```

### Auth (local)

A local single-user tool, **loopback by default**: with no API key configured, `/search`, `/fetch`, and `/mcp` are reachable only on the loopback interface with no auth. Because these are LAN-protection/misuse concerns, an *optional* local API key can be configured; when set, `/search`, `/fetch`, and `/mcp` all require an `x-api-key` header (the search entry points and the MCP tool share one key), returning 401 for a missing/invalid key.

### Uniform non-500 error structure

Errors use a single structure whose `kind` comes from the routing layer's `ErrorKind`:

```json
{ "error": { "kind": "bad_request" | "auth" | "quota" | "ratelimit" | "blocked" | "timeout" | "transient" | "unknown", "provider": "...", "resetAt": "..." } }
```

Predictable errors (quota exhaustion, rate limiting, bad keys, missing required fields) **never return HTTP 500**. Example: `POST /search` without a `provider` returns `400 {error:{kind:"bad_request", message:"provider is required"}}`; a fully-exhausted paid source returns the non-500 `{error:{kind:"quota", provider, resetAt}}`.

---

## MCP

`POST /mcp` is an MCP **streamable-HTTP** transport, **stateless** and **JSON-only**. It exposes a **single `websearch` tool** with the input schema:

```json
{ "query": "string (optional)", "provider": { "enum": ["WEB"] }, "limit": "number (optional)" }
```

- `provider` is an enum restricted to the built-in combo **name** (currently `['WEB']`); its default is `'WEB'`. It is **not** a free-form module id — passing an engine id such as `google` is rejected at the SDK layer and returned as an `isError:true` tool result (HTTP 200), not a JSON-RPC error. Clients cannot bypass the `WEB` default this way.
- A missing `query` returns `isError:true` with `bad_request`.
- The endpoint is stateless and reuses the same search funnel as `POST /search` on the same port.

---

## Search routing

The combo layer orchestrates engines and providers, merges and ranks results, and tolerates partial failures — producing the `{results, partialFailures, meta}` contract.

### Execution modes

- **concurrent** — all participating sources are called in parallel; results merged after each completes or times out.
- **sequential** — sources called in order; the first source that returns enough results wins, otherwise try the next.
- **hybrid** — run a first batch concurrently; if the merged result count is below `min_results`, sequentially top up the remaining sources, then merge.

### Merge, dedupe, and ranking

- **Dedupe** — URL-normalized (the v1 default `url-normalized`). If the same URL comes back from multiple sources, it collapses to one entry and the RRF score accumulates across sources' rankings.
- **Ranking** — RRF (Reciprocal Rank Fusion) for v1. Sources with a native `score` (e.g. Tavily) and sources without (e.g. bing) are handled uniformly: v1 converts everything to rank and runs RRF, ignoring native scores (score-weighting is deferred to v2). This keeps the merge layer agnostic to engine specifics.
- **Cap/truncation** — after merging, results are truncated to the combo's `cap` by RRF score.

### Partial-failure tolerance

- A single failing source is recorded in `partialFailures` (`{source, error}`); the search succeeds as long as **at least one source** produced results.
- If **all** sources fail, the API returns a clear error structure that includes the earliest `Retry-After` / reset time; single-source and all-source failure responses built from the routing layer carry `meta.sourceTimings` so the UI can render timings without re-assembling them.

### Single module/account testing

- **Single-module test** is just a single-source inline combo (`{ sources: [{ provider: "google" }] }`), reusing the normal normalization/execution path — no separate test endpoint. If that single source fails, it returns a top-level non-500 `error` rather than hiding the failure in `partialFailures`.
- **Single-account test** passes an `accountId` through `SourceRef` / `EngineCtx` to the provider layer. With an `accountId`, the paid provider skips account polling/priority/cooldown and runs only that account; without one, it runs the normal per-account rotation. A provided `accountId` that does not exist returns `{results: [], error: {kind:"unknown"}}`. Free engines ignore `accountId`.
- Single-account tests **write state back** exactly like normal searches (they are not read-only probes): an `auth` failure disables the account, a `quota` failure sets a long cooldown — both visible in the Providers page.

### Built-in WEB combo protection

The built-in categorized combo is protected at the dashboard API layer: it is returned with a `builtin:true` flag; `POST /api/combos` forces its id `web`/name `WEB` (renames ignored) while still allowing editable sources/mode/merge/fallback; `DELETE /api/combos/web` returns `400 bad_request`.

---

## Persistence

- **Location:** a single-file SQLite database under `DATA_DIR` — the env var wins; otherwise the platform default (`~/.websearch-router` on mac/Linux, `%APPDATA%\websearch-router` on Windows). `DATA_DIR` allows multiple instances/test setups.
- **Driver fallback chain:** `bun:sqlite` → `better-sqlite3` → `node:sqlite` (≥ 22.5) → `sql.js` (pure-JS last resort). Native drivers live in `optionalDependencies`; a missing native driver automatically degrades, so `npm install` never fails on a machine without build tools (it just falls back to `sql.js` at runtime).
- **Schema — fixed columns + JSON blob:** core tables (`settings`, `providerConnections`, `combos`, `usageHistory`, `requestDetails`, `kv`) store queryable fields as fixed columns plus a `data` TEXT JSON column for everything else. Adding a new per-account extension field is a JSON write — no schema migration.
- **Migration engine:** versioned incremental migrations plus declarative auto-sync — missing columns are auto-`ADD COLUMN`-ed, missing indexes auto-created, without breaking data; destructive schema changes are preceded by an automatic DB-file backup.
- **Repos:** each table has a thin CRUD repo; all business logic reads/writes through the repos, never raw SQL scattered around. First startup auto-creates the `DATA_DIR`, tables, and base settings.

---

## CLI and tray

The CLI is a **desktop launcher shell**: it starts/stops the server process, manages the system tray, and controls autostart. It is in the same language (Node/TS) as the server and contains **no business logic** — any search/merge/engine change is made only in the server package.

### CLI commands

- `websearch start [--port][--host][--tray]` — start a detached server subprocess, TCP-poll until ready (no fixed `sleep`), clean up port conflicts, and auto-restart on crash (bounded attempts, with log tail).
- `websearch status` — query `/health` for port + provider health.
- `websearch search <query>` — issue a search and print results.
- `websearch stop` — stop the server and tray.
- Dashboard is opened via `websearch`/tray context menu ("Open Dashboard").

### Tray

The tray menu includes: service status (port, disabled state) / Open Dashboard / Enable Auto-start (`✓` toggled) / Quit.

- **Windows — zero native dependency:** spawns PowerShell + Win32 `NotifyIcon`, with stdin/stdout JSON IPC (antivirus-friendly). The icon is a custom `icon.ico` data file (teal `#0D9488` rounded square with a white "WR", multi-size DIB frames, generated by `generate-icon.ps1`) — a data file, not a compiled binary, so it does not count against the "zero dependencies" constraint.
- **macOS/Linux:** uses `systray2` (a Go binary, lazily installed via postinstall).
- **Icon fallback:** icon loading is wrapped in `try/catch`; if `icon.ico` is missing, corrupted, or otherwise unusable, the tray falls back to `SystemIcons.Application` rather than crashing.
- **Quit** is graceful → then a timed `SIGTERM` → then a timed `SIGKILL`, leaving no ghost icon.

### Autostart

Autostart is a **pure filesystem operation** with no extra dependencies; state equals whether the file exists (plus mac `launchctl list` check). Enabling/disabling writes/deletes the file:

- **mac:** `~/Library/LaunchAgents/<id>.plist` (`RunAtLoad`) + `launchctl load -w`.
- **Windows:** `%APPDATA%\...\Startup\<name>.vbs` (hidden window).
- **Linux:** `~/.config/autostart/<name>.desktop`.

The `✓` state on the "Enable Auto-start" menu item reflects the current autostart state the first time the menu opens (it does not require an initial click), and refreshes after toggling.

---

## Dashboard

A Vite-compiled React SPA served in-process by the Express server — the same process, same port as the API (no separate frontend service). No SSR; first paint is static, and all data flows through the dedicated API.

- **SPA fallback:** for GETs on non-API, non-reserved routes (i.e. anything other than `/api/*`, `/search`, `/search/stream`, `/fetch`, `/health`, `/mcp`), the server returns `index.html`, letting the frontend router render the page. This restores the user's page on refresh and direct deep links — e.g. visiting `http://127.0.0.1:8787/combos` renders the combos page. API/reserved routes are never intercepted by the fallback.
- **URL-based routing:** four pages map to `/search`, `/providers`, `/combos`, `/usage`; the root `/` redirects to `/search`. The current page is always represented by the URL, so refresh, deep-link, and back/forward all restore it. Combo/engine/account *selection* is session-state and stays out of the URL for now (query-parameter wiring is a later incremental upgrade).

### Pages

- **Search test** — a built-in search box that calls `/search` or `/search/stream`, rendering results live with `partialFailures` warnings; can test a single combo or a single engine.
- **Providers / engines** — lists all engines and providers with enable/disable; add/edit accounts for paid providers (key, proxy, priority); view quota / cooldown / recent errors.
- **Combos** — create/edit combos: order the participating providers/engines, pick the mode (concurrent/sequential/hybrid), and set merge parameters (dedupe strategy, `cap`, `min_results`, fallback triggers). Built-in combos (like `WEB`) show an "built-in" marker, are undeletable and unrenamable (id/name locked), but their sources/mode/merge/fallback remain editable.
- **Usage** — recent searches' source, timing, result counts, and failure records.

Config changes are persisted via the API and take effect immediately for subsequent searches. Transactionality note: the API key display masks keys (`apiKeySet` + first-4/last-4); plaintext keys are sent only on write, and leaving the edit field empty preserves the existing key.

---

## Providers: error handling and cooldowns

An `ERROR_RULES` table maps vendor HTTP statuses to cooldown behavior:

- `429` rate limit → exponential backoff (short cooldown, then reusable; does not switch accounts).
- `432` / `433` / `402` (quota exhausted, Tavily/Brave) → long cooldown or account switch.
- `401` bad key → account marked unusable/inactive.

Backoff escalates with consecutive failures and resets on success. Cooldowns are per-account and per-provider, respect upstream `Retry-After` / reset times, and are capped. A per-account `priority` orders scheduling so the best available account is chosen; the main account failing falls through to a backup automatically rather than failing the whole request.

---

## Engine functional notes that matter

- **Shared hardened HTTP client:** all engines share one client that forges browser request-headers, has configurable timeouts, optional proxy support, and **SSRF protection** (a result URL pointing at a private/loopback address is rejected before the request is sent). It does **not** auto-follow redirects toward known engine domains (`maxRedirects: 0`); instead it inspects the `Location` header manually.
- **Captcha / anti-bot detection:** engines like baidu, bing, and google probe for captcha/verification pages using keyword heuristics, including Chinese strings such as **`验证码`** and **`人机验证`**; a hit is treated as a blocked engine.
- **Captcha redirects:** a 302 that jumps to a captcha domain (e.g. baidu → `wappass`) is not silently followed — the `Location` header is checked and the engine is judged blocked.
- When a blocked/timeout/parse/network failure is detected, the engine reports it as an `ErrorKind` (`blocked`/`timeout`/`transient`/`unknown`) rather than throwing into the search layer — it becomes a `partialFailure` and does not affect the rest of the combo.

---

## v1 vs. deferred (v2) scope

**In v1:** 3 free engines (bing/ddg/google), 3 paid providers (Tavily/Brave/Exa), the three execution modes, RRF merge with URL-normalized dedupe, MCP endpoint, dashboard SPA, tray + autostart, SE Stream + REST `/search`, and all persistence.

**Deferred to v2:** the remaining 7 free engines, combo-source drag-and-drop ordering (v1 uses up/down buttons), free-engine enable/disable in the dashboard (v1 free engines are read-only; only paid-provider accounts toggle), score-weighted merge (v1 uses rank-only RRF), URL query-parameter wiring for dashboard selection state, and a real-browser fallback mode (only for bing).