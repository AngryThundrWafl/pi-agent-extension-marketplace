# Pi Package Install Matrix

Reference guide for installing, configuring, hot-reloading, and verifying packages from this Pi (`@earendil-works/pi-coding-agent` v1.6.0) monorepo catalog.

## Summary Matrix

| Mode | Command | Target Settings / Cache | Trust Gate | Notes |
|---|---|---|---|---|
| Personal local install | `pi install ./packages/<dir>` | `~/.pi/agent/settings.json` (path relative to `<agent-dir>`) | None | Recommended for personal use across projects `[docs]` `[tested]` |
| Project-local install | `pi install -l ./packages/<dir>` | `<cwd>/.pi/settings.json` | Requires project trust (`--approve` in non-interactive runs) | Skipped under `--no-approve` or untrusted projects `[docs]` `[tested]` |
| One-shot tryout | `pi -e ./packages/<dir>` | Not persisted to settings | None | Does **not** emit Pi's duplicate host-dependency warning `[tested]` |
| Catalog bulk helper | `node scripts/install-packages.mjs ...` | Global or `--local` settings via `pi` | Pass `--approve` with `--local` | Supports `--all`, `--profile`, positional names, `--remove`, `--dry-run` |
| Resource filtering | Object entry in `settings.json` | `<agent-dir>/settings.json` or `.pi/settings.json` | Project scope gated by trust | Narrows package resources (`[]`, `!pattern`, `+path`, `-path`) `[docs]` `[tested]` |
| Interactive config TUI | `pi config` / `pi config --local` | Global or `.pi/settings.json` | Project scope requires trust (`--approve`) | Toggle package resources & built-ins; press `Tab` to switch scope `[docs]` |
| Future npm install | `pi install npm:@<scope>/<pkg>` | Pi npm directory + `settings.json` | Project scope gated by trust | Available once packages are published under a public npm scope `[docs]` |
| Git sub-package install | `git:host/repo/packages/<dir>` | **Unsupported** | N/A | Pi clones/reconciles the repo root only `[docs]` `[tested]` |

---

## 1. Personal Local Install (`pi install`)

Install a catalog package for your personal Pi configuration (`~/.pi/agent/settings.json` or `$PI_CODING_AGENT_DIR/settings.json`):

```bash
pi install ./packages/<package-dir>
```

- Pi resolves the local path relative to `<agent-dir>/settings.json` and loads the package directly from disk without copying `[docs]` `[tested]`.
- Inspect configured packages with `pi list` `[docs]` `[tested]`.
- Remove a package entry with `pi remove ./packages/<package-dir>` (alias: `pi uninstall`) `[docs]` `[tested]`.
- Verify startup diagnostics with `pi --verbose --help` — unlike `-e`, installed packages emit host-dependency warnings if a package mistakenly lists host-provided packages under `dependencies` `[tested]`.

## 2. Project-Local Install (`-l` / `--local`) & Project Trust

Install a package for a single repository in `.pi/settings.json`:

```bash
pi install -l ./packages/<package-dir>
```

Once `.pi/settings.json` exists, Pi treats the directory as having trust-requiring project resources `[docs]`:

- **Interactive sessions:** Pi prompts for project trust (unless saved via `/trust` in `~/.pi/agent/trust.json` or overridden by `defaultProjectTrust`) `[docs]`.
- **Non-interactive / automated runs (`print`, `json`, `rpc`, `pi install -l`, `pi list`):** Pi cannot show an interactive trust prompt `[docs]`.
  - Pass `--approve` (`-a`) to trust project-local settings for that command (e.g., `pi install -l ./packages/<dir> --approve`, `pi list --approve`) `[docs]` `[tested]`.
  - Pass `--no-approve` (`-na`) to ignore project-local settings and verify untrusted fallback behavior (`pi list --no-approve` omits project packages) `[docs]` `[tested]`.

## 3. One-Shot Tryout (`pi -e`) & Duplicate-Dependency Caveat

Try a package for a single invocation without modifying `settings.json`:

```bash
pi -e ./packages/<package-dir>
```

- `-e` / `--extension` accepts a local package directory (or extension file) and loads its extensions, skills, prompt templates, and themes for that run `[docs]`.
- To preview a package theme in an interactive run:
  ```bash
  pi -e ./packages/<package-dir> --use-theme <theme-name>
  ```
- **Caveat:** One-shot `-e` does **not** emit Pi's duplicate host-dependency warning when a package mistakenly declares host-provided packages (`@earendil-works/pi-*`, `typebox`) in `dependencies` `[tested]`. Always test via `pi install` + `pi --verbose --help` (or run `npm run verify:install`) to catch manifest dependency warnings `[tested]`.

## 4. Catalog Helper (`scripts/install-packages.mjs`)

Use `scripts/install-packages.mjs` (or `npm run pi:install -- ...`) to install or remove multiple catalog packages consistently:

```bash
# Preview commands without invoking Pi
node scripts/install-packages.mjs --all --dry-run

# Install all workspace packages personally
node scripts/install-packages.mjs --all

# Install by resource profile: extension | skill | prompt | theme | core
node scripts/install-packages.mjs --profile extension
node scripts/install-packages.mjs --profile theme

# Install specific packages project-locally with approval
node scripts/install-packages.mjs pi-sample-extension packages/pi-another --local --approve

# Remove selected packages
node scripts/install-packages.mjs --all --remove
```

Selector rules:

- `--all`: selects every discovered workspace package under `packages/*`.
- `--profile <name>` (repeatable):
  - `extension`: packages declaring or containing extensions
  - `skill`: packages declaring or containing skills
  - `prompt`: packages declaring or containing prompt templates
  - `theme`: packages declaring or containing themes
  - `core`: packages tagged with `"core"` in `piCatalog.profiles`, `pi.profile === "core"`, or keyword `"core"` (or, when none are explicitly tagged, packages providing extensions, skills, or prompts)
- Positional arguments: package directory name (`pi-<name>`), workspace path (`packages/pi-<name>`), or `package.json` `name`.

`scripts/install-packages.mjs` inherits `process.env`, so setting `PI_CODING_AGENT_DIR` / `HOME` runs it cleanly against an isolated sandbox.

## 5. Settings Object Filtering (`settings.json`)

Instead of a plain string source, `packages` in `<agent-dir>/settings.json` or `.pi/settings.json` accepts an object to filter which resources load from a package `[docs]`:

```json
{
  "packages": [
    {
      "source": "./packages/<package-dir>",
      "extensions": ["extensions/*.ts", "!extensions/experimental.ts"],
      "skills": [],
      "prompts": ["+prompts/review.md"],
      "themes": ["-themes/legacy.json"]
    }
  ]
}
```

Filtering rules (`docs/packages.md#L120-L143`) `[docs]`:

- Omit a resource key to load everything allowed by the package manifest/conventions.
- Use `[]` to load none of that resource type `[tested]`.
- Use `!pattern` to exclude glob matches.
- Use `+path` to include one exact allowed path.
- Use `-path` to exclude one exact path.
- Filters only narrow what the package declares; they do not expose undeclared files.

## 6. Interactive Resource Configuration (`pi config`)

Use Pi's interactive configuration selector to toggle individual package resources and built-in extensions without hand-editing JSON `[docs]`:

```bash
pi config           # Starts in personal/global settings; press Tab to switch scope
pi config --local   # Starts in project-local .pi/settings.json (add --approve if needed)
```

## 7. Hot Reloading Local Packages (`/reload`)

In an active interactive Pi session, `/reload` reloads keybindings, extensions, skills, prompt templates, themes, and context files `[docs]`.

- Locally installed workspace packages (via `pi install ./packages/<dir>`) hot-reload on `/reload` because Pi loads extension modules via `jiti` with `moduleCache: false` `[tested]`.
- After editing a package's extension TypeScript file, skill `SKILL.md`, prompt Markdown, or theme JSON on disk, run `/reload` in the session to pick up the changes without restarting Pi `[tested]`.

## 8. Future `npm` Install After Scope Rename

Catalog packages currently use the placeholder `@local/pi-<name>` scope (`D-07`), which works for local installs (`pi install ./packages/<dir>`) and `npm pack --dry-run` without colliding on the public registry. When publishing to npm `[docs]`:

1. Replace `@local` in `package.json` `name` with your owned npm scope (`@<your-scope>/pi-<name>`), add `"repository"` metadata, and keep `"keywords": ["pi-package"]` for Pi gallery discovery `[docs]`.
2. Keep host-provided packages (`@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`) in `peerDependencies` with `"*"` rather than `dependencies`; Pi suppresses automatic peer installation for managed npm installs `[docs]`.
3. Users can then install published packages directly:
   ```bash
   pi install npm:@<your-scope>/pi-<name>
   ```

## 9. Why `git:` Sub-Package Install Is Unsupported

Pi supports `git:github.com/owner/repo@ref` and `https://...` URLs by cloning/reconciling the repository root and reading the root `package.json` or conventional directories (`extensions/`, `skills/`, `prompts/`, `themes/`) `[docs]` `[tested]`.

Monorepo subdirectories (e.g., trying to install a single `packages/pi-<name>` directory directly via a `git:` subpath) are **not** supported by Pi's `git:` package source syntax `[docs]` `[tested]`. To install packages directly from this repository, clone the repo and install via local path (`pi install ./packages/<dir>`) or publish individual packages to npm.

## 10. Isolated Test Sandbox Protocol

Automated tests and verification scripts must **never** touch `~/.pi` or `~/.agents` on the host machine. Use `scripts/lib/pi-sandbox.mjs` (`createPiSandbox()` / `runPi()`), which isolates every Pi run with:

- `PI_CODING_AGENT_DIR=<tmp>/agent`
- `HOME=<tmp>/home`
- `PI_CODING_AGENT_SESSION_DIR=<tmp>/sessions`
- `PI_OFFLINE=1`
- `PI_SKIP_VERSION_CHECK=1`
- `PI_TELEMETRY=0`

Run the automated install verification suite via:

```bash
# Verify the entire catalog (per-package + co-load + local trust + filtering)
npm run verify:install

# Verify a single package (fast Wave-2 package check)
node scripts/verify-install.mjs --package <package-dir>
```

`scripts/verify-install.mjs` cleans up every temporary sandbox in `finally` blocks and never modifies user-global state.
