# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the TypeScript source; the MCP server implementation lives in `src/index.ts`.
- `build/` holds compiled JavaScript output (`build/index.js`) produced by the TypeScript compiler.
- `package.json` defines the CLI entry (`mcp`) and build/test scripts.
- `tsconfig.json` captures compiler settings (ES2022 target, Node16 modules, strict mode).

## Build, Test, and Development Commands
- `npm run build` — compiles `src/` to `build/` and makes `build/index.js` executable.
- `node build/index.js` — runs the server after a build (stdio transport; useful for local smoke checks).
- `npm test` — currently exits with an error because no tests are configured.

## Coding Style & Naming Conventions
- Use TypeScript with ESM-style imports (see `src/index.ts`).
- Follow the existing 2-space indentation and trailing-comma style.
- Keep helpers close to their usage in `src/index.ts` unless new modules are added.
- Name environment variables in `MAGICLINE_*` form (e.g., `MAGICLINE_API_KEY`).

## Testing Guidelines
- No automated tests are present yet; `npm test` is a placeholder.
- If you add tests, document the framework and update `npm test` accordingly.
- Prefer naming tests after the feature they cover (e.g., `magiclineRequest` behavior).

## Commit & Pull Request Guidelines
- This checkout does not include Git history, so no established commit conventions were found.
- Use short, imperative commit messages (e.g., “Add multipart request helper”).
- PRs should describe the change, mention any config/env additions, and include run instructions.

## Security & Configuration Tips
- The server requires `MAGICLINE_BASE_URL` and `MAGICLINE_API_KEY` at runtime.
- Avoid committing secrets; store local values in environment variables or a local `.env` file.
- Validate that `MAGICLINE_BASE_URL` is a full host root (e.g., `https://...`) without a trailing slash.
