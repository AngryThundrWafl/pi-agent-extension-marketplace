# AGENTS.md

Authoritative repository contract for AI coding agents working in this Option B Pi package catalog monorepo.

## 1. Repository Architecture & Discovery

- **Layout:** Private npm workspaces monorepo (`packages/pi-<name>/`, package names `@local/pi-<name>`, `MIT` license, Node `>=22.19.0`).
- **Runtime model:** Packages ship raw TypeScript (`.ts`) loaded directly by Pi `1.6.0` (`@earendil-works/pi-coding-agent`) via `jiti`—no per-package build step.
- **Dynamic package discovery:** **Never hardcode package lists or counts** in `AGENTS.md` or scripts. Discover packages dynamically with:
  - `npm run catalog:list`
  - inspecting `packages/*/package.json`

## 2. Authoritative Pi API Docs

- Read Pi v1.6.0 APIs directly from `node_modules/@earendil-works/pi-coding-agent/docs/` (and sibling installed `@earendil-works/*` / `typebox` declarations).
- **Never** invent CLI flags, hook names, or extension APIs.
- **Never** follow legacy `@mariozechner/*` or `@sinclair/typebox` guides.

## 3. Dependency & Manifest Invariants

- **Canonical host-provided packages (exact 5):**
  1. `@earendil-works/pi-ai` (and subpaths `/compat`, `/models`, `/oauth`, `/providers/all`)
  2. `@earendil-works/pi-agent-core`
  3. `@earendil-works/pi-coding-agent`
  4. `@earendil-works/pi-tui`
  5. `typebox` (and subpaths `/compile`, `/value`)
- Declare these 5 host-provided packages **ONLY** in `peerDependencies` as `"*"`—**NEVER** in `dependencies` or a workspace package's `devDependencies`.
- `@earendil-works/pi-codemode` and `@earendil-works/pi-mcp` are **NOT** host-provided.
- **Import discipline:**
  - **No phantom imports** of root `devDependencies` (or unlisted packages) from workspace packages.
  - **No relative `../../` imports** across packages.
- **Manifest trap (`package.json` `"pi"` field):**
  - Omit `pi.extensions`, `pi.skills`, `pi.prompts`, and `pi.themes` when using conventional directories (`extensions/`, `skills/`, `prompts/`, `themes/`).
  - Setting **any** resource key disables Pi's auto-discovery of all omitted conventional directories.
  - Metadata-only keys (`pi.changelogPath`, `pi.image`, `pi.video`) keep conventional auto-discovery active.

## 4. Extension Authoring Checklist

- **Schemas & validation:**
  - Import `Type`, `Static`, and `TSchema` from `"typebox"`.
  - Import `StringEnum` from `"@earendil-works/pi-ai"` (never use `Type.Union([Type.Literal(...)])`).
  - Never rely on TypeBox-only validation (`Refine`, `Codec`, `BigInt`) without explicit runtime checks in `execute()`.
- **Tools & execution:**
  - Always include the required `details` property on `AgentToolResult`.
  - Provide `promptSnippet` and tool-named `promptGuidelines` on custom tools.
  - Wrap file mutations in `withFileMutationQueue()`.
  - Use `truncateHead` / `truncateTail` for large tool output.
  - Set `executionMode: "sequential"` on tools that share mutable state.
- **Lifecycle & state:**
  - Defer background resources (timers, watchers, processes, connections) to `session_start` and clean them up idempotently in `session_shutdown`.
  - Reconstruct extension state from `ctx.sessionManager.getBranch()` on both `session_start` and `session_tree`.
- **UI, security & MCP:**
  - Guard UI interactions with `ctx.hasUI`; **fail closed** in destructive `tool_call` / `user_bash` guards when UI is unavailable.
  - Guard TUI-only APIs with `ctx.mode === "tui"`.
  - Use `context.keyHint()` / `context.keyText()` inside renderers—never import `keyHint` or `keyText` directly.
  - Use `CONFIG_DIR_NAME` for config paths and check `ctx.isProjectTrusted()` before reading project-local config.
  - Register session-only MCP servers via `pi.registerMcpServer()`.

## 5. Catalog, Scaffolding & Verification Commands

- **Scaffold a new package:**
  ```bash
  npm run new-package -- --name <slug> --type <extension|skill|prompt|theme>
  ```
- **Generated catalog markers:** Never hand-edit inside `<!-- pi-catalog:start -->` / `<!-- pi-catalog:end -->` in `README.md` or `docs/catalog.md`. Regenerate and verify with:
  ```bash
  npm run catalog:generate
  npm run catalog:check
  ```
- **Pre-completion verification:** Run the full check suite before finishing changes:
  ```bash
  npm run check
  ```
  (`typecheck`, `lint`, `audit`, `test`, `catalog:check`, `verify:install`)

## 6. Safety, Isolation & Release Boundaries

- **Test & Pi sandbox isolation:**
  - Never touch `~/.pi` in tests or verification scripts. Use `scripts/lib/pi-sandbox.mjs` (sets isolated `PI_CODING_AGENT_DIR` and `HOME`, plus `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`).
  - Never call live paid LLM or external network APIs in tests.
- **No duplicate registration:** Never copy working-tree extensions into `~/.pi/agent/extensions/` alongside `pi install ./packages/<name>` (causes duplicate registration and tool hard errors).
- **Release & git boundaries:** Never bump package versions manually for release, run `npm publish`, create git remotes, or run `git push` without explicit human approval (see `docs/release-policy.md`).
