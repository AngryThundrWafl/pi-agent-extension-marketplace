# Pi Package Pre-Merge Review Checklist

Verify every applicable section below when reviewing changes to a `packages/pi-<name>/` workspace package.

## 1. Dependencies & Imports (`peerDependencies: "*"`)

- [ ] **Canonical host packages only in `peerDependencies`:** `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` are declared **only** in `peerDependencies` as `"*"` when imported—never in `dependencies` or package `devDependencies`.
- [ ] **Non-host packages declared properly:** `@earendil-works/pi-codemode` and `@earendil-works/pi-mcp` are not treated as host-provided; any non-host runtime dependency imported by package code is declared in `dependencies`.
- [ ] **No legacy or phantom imports:** Zero imports from `@mariozechner/*` or `@sinclair/typebox`, zero phantom imports of root `devDependencies`, and zero cross-package relative (`../../`) imports.

## 2. Package Manifest & Resource Discovery (`package.json`)

- [ ] **Required metadata:** `"name"` matches `@local/<dirName>`, `"version"` is valid SemVer, `"type": "module"`, `"license": "MIT"`, `"description"` is non-empty, and `"keywords"` includes `"pi-package"`.
- [ ] **Clean `"files"` array:** Includes shipped directories and `README.md` (plus `CHANGELOG.md` if present), and excludes `tests/` and `"*"`.
- [ ] **Conventional discovery preserved:** `pi.extensions`, `pi.skills`, `pi.prompts`, and `pi.themes` are omitted when using conventional directories (`extensions/`, `skills/`, `prompts/`, `themes/`), because setting any resource key disables auto-discovery of all omitted directories.
- [ ] **Changelog present for extensions:** Extension packages include `CHANGELOG.md` (or a valid in-package `pi.changelogPath`) with `## [X.Y.Z]` or `## X.Y.Z` headings (no `v` prefix).

## 3. Resource & Authoring Hygiene

- [ ] **Extension conventions (if applicable):** Uses `StringEnum` from `@earendil-works/pi-ai` (never `Type.Union([Type.Literal(...)])`), includes `details` on `AgentToolResult`, wraps file writes in `withFileMutationQueue()`, guards UI with `ctx.hasUI` (failing closed in destructive guards), and cleans up `session_start` resources in `session_shutdown`.
- [ ] **Skill frontmatter (if applicable):** `SKILL.md` declares a valid `name` (`<=64` chars, lowercase alphanumeric and single hyphens matching its parent directory) and non-empty `description` (`<=1024` chars), referencing bundled files with relative paths from the skill directory.

## 4. Tests & Sandbox Isolation

- [ ] **Isolated Pi execution:** Tests and verification scripts isolate Pi state (`PI_CODING_AGENT_DIR`, `HOME`, `PI_CODING_AGENT_SESSION_DIR`, `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`), never touch `~/.pi`, and never call live paid LLM or external network APIs.
- [ ] **Tarball hygiene:** `npm pack --dry-run` ships only intended runtime/doc files and excludes `tests/` and `node_modules/`.

## 5. Catalog Freshness & Final Verification

- [ ] **Catalog markers synced:** Generated catalog tables in `README.md` and `docs/catalog.md` are updated via `npm run catalog:generate` (never hand-edited inside `<!-- pi-catalog:start -->` / `<!-- pi-catalog:end -->`).
- [ ] **Full verification passes:** `npm run check` (`typecheck`, `lint`, `audit`, `test`, `catalog:check`, `verify:install`) succeeds with zero errors.
