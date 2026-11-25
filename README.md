# Pi Package Catalog

A monorepo catalog of Pi (`@earendil-works/pi-coding-agent` v1.6.0) packages — extensions, skills, prompt templates, and themes — authored as private npm workspaces under `packages/pi-<name>/`.

## Quick Start

Install root development tooling (used for typechecking, linting, auditing, and isolated Pi testing):

```bash
npm install --ignore-scripts --no-audit --no-fund
```

Install any package from this catalog locally into Pi:

```bash
pi install ./packages/<package-dir>
```

Or preview / batch-install packages using the catalog helper:

```bash
npm run catalog:list
npm run pi:install -- --all --dry-run
```

Scaffold a new package (`extension`, `skill`, `prompt`, or `theme`) and run full repository verification:

```bash
npm run new-package -- --name <slug> --type <extension|skill|prompt|theme>
npm run check
```

## Local Development with Docker

The repo ships a `Dockerfile` for an offline-safe dev container (Node 22.19.0, dev dependencies pre-installed):

```bash
docker build -t pi-catalog-dev .
docker run --rm -it pi-catalog-dev bash
```

Inside the container the repo is at `/app`; run `npm run check`, `npm run typecheck`, `npm run lint`, or `npm test` as usual.

To work against the live working tree instead of the baked-in copy, mount it (requires a Docker daemon that shares the host filesystem):

```bash
docker run --rm -it -v "$PWD":/app -w /app pi-catalog-dev bash
```

Note: the mount shadows the baked-in `/app`, so re-run `npm ci --ignore-scripts --no-audit --no-fund` inside the container on first use (or ensure the host already has `node_modules`).

## Documentation

- [Catalog Details](docs/catalog.md) (generated from package manifests)
- [Install Matrix](docs/install-matrix.md) (personal, `--local`, `-e`, filtering, `pi config`, `/reload`)
- [Release Policy](docs/release-policy.md) (independent SemVer, `CHANGELOG.md`, scoped tags, human-gated publish)
- [Agent Contract](AGENTS.md) (authoring, dependency, and isolation rules)

## Catalog

<!-- pi-catalog:start -->
| Package | Dir | Version | Resources | Description | Local Install |
| --- | --- | --- | --- | --- | --- |
| `@local/pi-sample-extension` | [`packages/pi-sample-extension`](./packages/pi-sample-extension) | 0.1.0 | extensions (1) | Starter Pi extension package demonstrating custom tool, command, CLI flag, and session lifecycle best practices. | `pi install ./packages/pi-sample-extension` |
| `@local/pi-sample-prompt` | [`packages/pi-sample-prompt`](./packages/pi-sample-prompt) | 0.1.0 | prompts (1) | Starter Pi prompt template package providing a focused /sample-review command. | `pi install ./packages/pi-sample-prompt` |
| `@local/pi-sample-skill` | [`packages/pi-sample-skill`](./packages/pi-sample-skill) | 0.1.0 | skills (1) | Starter Pi skill package providing a pre-merge review checklist for Pi packages. | `pi install ./packages/pi-sample-skill` |
| `@local/pi-sample-theme` | [`packages/pi-sample-theme`](./packages/pi-sample-theme) | 0.1.0 | themes (1) | Starter dark slate theme package for Pi demonstrating conventional themes/ auto-discovery. | `pi install ./packages/pi-sample-theme` |
<!-- pi-catalog:end -->
