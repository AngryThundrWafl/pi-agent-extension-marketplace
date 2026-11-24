# Release Policy

This document defines versioning, tagging, changelog, pre-publish verification, and human-gated release rules for packages in the `pi-catalog` monorepo (Decision `D-05`).

## 1. Independent Per-Package SemVer

- The root [`package.json`](../package.json) MUST remain `"private": true` with `"version": "0.0.0"`. It is never published.
- Each workspace package under `packages/pi-<name>/` maintains its own independent [SemVer](https://semver.org/) (`X.Y.Z`) lifecycle in `packages/<dir>/package.json`.
- Bumping, releasing, or publishing one package does not require bumping any other package in the monorepo.

## 2. Package-Scoped Git Tags

- Every release tag MUST be scoped to its package directory name:

  ```text
  <dir-name>/vX.Y.Z
  ```

  Example: `pi-sample-extension/v0.1.0`

- Bare repository-global tags such as `v0.1.0` or `v1.0.0` are **forbidden**.

## 3. Per-Package Changelogs

Pi (`@earendil-works/pi-coding-agent` v1.6.0) inspects package changelogs to render `Extension Updates` notifications when a package updates. Follow these rules so Pi discovers and parses every release entry cleanly:

- **When required:**
  - **Required** for packages that load `>=1` Pi extension.
  - **Optional** for skill-, prompt-, or theme-only packages (Pi does not display changelogs for non-extension packages `[docs]` `https://docs.pi.dev/latest/packages`).
- **Location constraint:**
  - Each changelog MUST live strictly inside `packages/<dir>/` (e.g., `packages/<dir>/CHANGELOG.md`).
  - `pi.changelogPath` enforces `isPathInside(packageRoot)` — paths escaping the package directory such as `../../CHANGELOG.md` are rejected `[tested]`.
- **Heading format:**
  - Version headings MUST match `## [X.Y.Z] - YYYY-MM-DD`, `## X.Y.Z - YYYY-MM-DD`, or `## X.Y.Z`.
  - **Never** prefix the version with `v` (e.g., `## vX.Y.Z` or `## [vX.Y.Z]`). Pi's `parseChangelog()` regex `/##\s+\[?(\d+)\.(\d+)\.(\d+)\]?/` fails to match a `v`-prefixed heading `[tested]`.

  ```markdown
  ## [0.2.0] - 2026-11-24

  - Added new command flag.
  ```

- **Pi update display behavior & overrides:**
  - Pi records and displays `Extension Updates` only on **fresh interactive launches** when `package.json` `version` increases; headless RPC and print modes do not record or display it `[tested]`.
  - To suppress update notes for an extension package, set `"pi": { "changelogPath": "" }` in `packages/<dir>/package.json`.
  - To point Pi at a condensed file instead of the full changelog, set `"pi": { "changelogPath": "./UPDATE_NOTES.md" }` (still inside the package directory).

## 4. Pre-Publish & Human-Gated Release Checklist

### Agent vs. Human Responsibility

- **Agents** prepare code, version bumps, `CHANGELOG.md` entries, catalog regeneration, and local verification checks.
- **Humans** execute `npm publish` and `git push` (including pushing release tags). Agents MUST NOT run `npm publish` or `git push`.

### Pre-Publish Scope & Metadata Gate

- Packages using the placeholder `@local/*` scope (`D-07`) work for all local installs (`pi install ./packages/<dir>`) and tarball inspection (`npm pack --dry-run`), and are valid during internal catalog development.
- **Before the first public `npm publish`** of a package:
  1. Replace the `@local/*` package name in `packages/<dir>/package.json` with an owned npm scope (e.g., `@your-scope/<pkg-name>`).
  2. Add `"repository"` metadata in `packages/<dir>/package.json` pointing to this repository and the package directory.

### Step-by-Step Release Procedure

1. **Prepare release metadata (agent or human):**
   - Bump `"version"` in `packages/<dir>/package.json` according to SemVer.
   - Add a matching release section to `packages/<dir>/CHANGELOG.md` using `## [X.Y.Z] - YYYY-MM-DD` or `## X.Y.Z - YYYY-MM-DD` (no `v` prefix).
   - If publishing publicly for the first time, ensure `@local/*` has been replaced with an owned npm scope and `"repository"` metadata is present.
2. **Regenerate catalog metadata (agent or human):**
   ```bash
   npm run catalog:generate
   ```
3. **Run full verification and production dependency audit (agent or human):**
   ```bash
   npm run check && npm run audit:prod
   ```
4. **Inspect the publish tarball (agent or human):**
   ```bash
   npm pack --dry-run -w packages/<dir>
   ```
   Confirm that no `tests/` directories, secrets, `.env` files, or `node_modules/` directories are included in the tarball output.
5. **Publish package (human only):**
   ```bash
   npm publish -w packages/<dir> --access public
   ```
6. **Create and push package-scoped Git tag (human only):**
   ```bash
   git tag <dir-name>/vX.Y.Z
   git push origin <dir-name>/vX.Y.Z
   ```

## 5. Upgrade Path to Changesets

If the catalog outgrows manual version bumps, [Changesets](https://github.com/changesets/changesets) can be adopted later with **zero package layout or `CHANGELOG.md` migration**:

1. Initialize Changesets at the repository root (`npx changeset init`).
2. Keep the existing `packages/pi-<name>/` workspace layout and per-package `CHANGELOG.md` files unchanged.
3. Changesets emits `## X.Y.Z` version headings by default; Pi's `parseChangelog()` parses Changesets' default `## X.Y.Z` headings identically with no format rewrite required `[tested]`.
