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

Run repository checks:

```bash
npm run typecheck
npm run lint
npm run audit
npm test
```

## Catalog

<!-- pi-catalog:start -->
_Catalog table will be generated once packages are added (`npm run catalog:generate`)._
<!-- pi-catalog:end -->
