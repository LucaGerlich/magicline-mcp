# magicline-mcp-server

MCP server for the Magicline APIs (OpenAPI, Connect API, Device API, Webhooks).
The server loads the official OpenAPI specs and registers each operation as an MCP tool.

## Overview

This server exposes Magicline endpoints to MCP-compatible clients via stdio.
Each operation in the official OpenAPI specs becomes a tool with a stable, namespaced name.

Included APIs:
- OpenAPI (core Magicline API)
- Connect API
- Device API
- Webhooks API

Tool prefixes:
- `magicline_` (OpenAPI)
- `magicline_connect_` (Connect API)
- `magicline_device_` (Device API)
- `magicline_webhooks_` (Webhooks)

Generic fallback tools:
- `magicline_request` (JSON or raw body)
- `magicline_request_multipart` (multipart/form-data)

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- Magicline credentials and base URLs

## Quick Start

1) Install dependencies:

```bash
npm install
```

2) Fetch the latest specs (optional but recommended):

```bash
npm run update-openapi
```

3) Build:

```bash
npm run build
```

4) Run (stdio transport):

```bash
MAGICLINE_BASE_URL="https://..." \
MAGICLINE_API_KEY="..." \
node build/index.js
```

## Environment Variables

### OpenAPI (required)

- `MAGICLINE_BASE_URL`
- `MAGICLINE_API_KEY`
- `MAGICLINE_API_KEY_HEADER` (optional, default `X-API-KEY`)

### Connect API (optional)

- `MAGICLINE_CONNECT_BASE_URL`
- `MAGICLINE_CONNECT_API_KEY` (optional)
- `MAGICLINE_CONNECT_API_KEY_HEADER` (optional, default `X-API-KEY`)

### Device API (optional, Bearer token)

- `MAGICLINE_DEVICE_BASE_URL`
- `MAGICLINE_DEVICE_API_TOKEN`
- `MAGICLINE_DEVICE_AUTH_HEADER` (optional, default `Authorization`)
- `MAGICLINE_DEVICE_AUTH_PREFIX` (optional, default `Bearer `)

### Webhooks API (optional)

- `MAGICLINE_WEBHOOKS_BASE_URL`
- `MAGICLINE_WEBHOOKS_API_KEY`
- `MAGICLINE_WEBHOOKS_API_KEY_HEADER` (optional, default `X-API-KEY`)

### Spec override (advanced)

You can override the spec URLs used by the update script and runtime loader:

- `MAGICLINE_OPENAPI_URL`
- `MAGICLINE_CONNECT_OPENAPI_URL`
- `MAGICLINE_DEVICE_OPENAPI_URL`
- `MAGICLINE_WEBHOOKS_OPENAPI_URL`

## How Tools Are Generated

All tools are derived from the OpenAPI specs in:
- `src/openapi.json`
- `src/connectapi.json`
- `src/deviceapi.json`
- `src/webhooks.json`

On startup, the server loads these specs (falling back to the remote URLs if local files are missing)
and registers tools from each `operationId`.

### Tool Names

Each tool name is constructed as:

`<prefix><operationId>`

Example:
- `magicline_searchCustomers`
- `magicline_device_activateDevice`

Tool name sanitation rules:
- Non-alphanumeric characters are replaced with `_`.
- Names starting with a digit are prefixed with `op_`.
- If a collision occurs, `_2`, `_3`, ... is appended.

### Tool Inputs

Spec-generated tools accept a single JSON object with these optional fields
(depends on the endpoint):

- `pathParams`: Path parameters for `{param}` segments
- `query`: Query parameters
- `headerParams`: Header parameters defined by the spec
- `headers`: Additional headers
- `body`: JSON body
- `rawBody`: Raw body string
- `rawBodyBase64`: Raw body as base64
- `multipart`: Multipart form-data parts

Rules enforced:
- Only one of `body`, `rawBody`, `rawBodyBase64`, `multipart` may be set.
- If the spec marks the body as required, the tool will enforce it.
- Multipart is only allowed when the spec declares `multipart/form-data`.

### Multipart Format

When `multipart` is supported, each part is one of:

- `{ "kind": "json", "name": "...", "data": { ... } }`
- `{ "kind": "text", "name": "...", "data": "...", "contentType": "..." }`
- `{ "kind": "binary", "name": "...", "dataBase64": "...", "filename": "...", "contentType": "..." }`

## Generic Tools

### `magicline_request`

For ad-hoc calls to the OpenAPI base URL.

Input:
- `method`: `GET | POST | PUT | DELETE | HEAD`
- `path`: relative path like `/v1/customers`
- `query`, `headers`, `body`, `rawBody`, `rawBodyBase64`

### `magicline_request_multipart`

For ad-hoc multipart calls to the OpenAPI base URL.

Input:
- `method`: `POST | PUT`
- `path`: relative path like `/v1/customers/{id}/documents`
- `query`, `headers`, `parts`

## Response Format

All tools return a text response:
- JSON responses are pretty-printed as text.
- Non-JSON responses return `{ contentType, body }` as JSON text.

Errors return a text message like:

```
Request failed: <error message>
```

## Logging

The server logs to stderr only (stdio requirement).

## Scripts

- `npm run update-openapi`: downloads and stores all four specs into `src/`
- `npm run build`: compiles to `build/` and copies specs into `build/`

## File Layout

- `src/index.ts`: server implementation
- `src/*.json`: OpenAPI specs
- `build/index.js`: compiled server
- `build/*.json`: copied specs for runtime
- `scripts/fetch-openapi.mjs`: spec downloader

## Client Integration (stdio)

Dieses MCP läuft lokal über stdio. Jeder Client, der einen lokalen Prozess starten kann, funktioniert.

**Codex (CLI & IDE Extension)**

Codex unterstützt STDIO-Server und teilt die MCP-Konfiguration zwischen CLI und IDE.
Du kannst per CLI oder via `config.toml` konfigurieren.

CLI (stdio):

```bash
codex mcp add magicline \
  --env MAGICLINE_BASE_URL=https://... \
  --env MAGICLINE_API_KEY=... \
  -- node /absolute/path/to/magicline-mcp-server/build/index.js
```

`config.toml` (global oder projektbezogen):

```toml
[mcp_servers.magicline]
command = "node"
args = ["/absolute/path/to/magicline-mcp-server/build/index.js"]

[mcp_servers.magicline.env]
MAGICLINE_BASE_URL = "https://..."
MAGICLINE_API_KEY = "..."
```

**Claude Code (CLI)**

Claude Code kann lokale stdio-Server hinzufügen. Wichtig: Alle Optionen kommen vor dem Servernamen,
und `--` trennt die Claude-Optionen von deinem Server-Command.

```bash
claude mcp add --transport stdio \
  --env MAGICLINE_BASE_URL=https://... \
  --env MAGICLINE_API_KEY=... \
  magicline -- node /absolute/path/to/magicline-mcp-server/build/index.js
```

**Claude Desktop**

Claude Desktop kann MCP-Server über `claude_desktop_config.json` laden. Füge dort einen Eintrag unter
`mcpServers` hinzu und starte Claude Desktop neu.

```json
{
  "mcpServers": {
    "magicline": {
      "command": "node",
      "args": ["/absolute/path/to/magicline-mcp-server/build/index.js"],
      "env": {
        "MAGICLINE_BASE_URL": "https://...",
        "MAGICLINE_API_KEY": "..."
      }
    }
  }
}
```

**Weitere MCP-Clients (HTTP)**

Einige Clients wie VS Code (Copilot Agent Mode) und Cursor konfigurieren MCP-Server über JSON-Dateien
mit `type: "http"` und `url`. Das ist für HTTP-basierte MCP-Server gedacht. Wenn du dieses Projekt
später als HTTP-Server betreibst, kannst du dich an deren HTTP-Format orientieren.


## Troubleshooting

- `Missing MAGICLINE_BASE_URL` or `Missing MAGICLINE_API_KEY`:
  - Set the env vars in your MCP client config (not just your shell).
- `Path must be relative`:
  - Use `/v1/...` style paths (no full URLs) when calling generic tools.
- `This endpoint does not accept JSON bodies`:
  - Use `multipart` if the spec requires `multipart/form-data`.
- `Request body is required`:
  - Provide exactly one of `body`, `rawBody`, `rawBodyBase64`, or `multipart`.

## Security Notes

- Do not commit secrets. Use env vars or a local `.env` file.
- Keep base URLs without a trailing slash.

## Development Notes

- TypeScript source is in `src/`.
- The server expects specs in `src/*.json` at runtime.
- You can regenerate specs anytime with `npm run update-openapi`.
- `npm test` is currently a placeholder.
