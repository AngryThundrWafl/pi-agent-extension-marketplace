# @local/pi-sample-skill

Starter Pi skill package providing a pre-merge review checklist for Pi packages.

## Install

```bash
pi install ./packages/pi-sample-skill
```

## Try Without Installing

```bash
pi -e ./packages/pi-sample-skill
```

## Usage

Invoke the bundled skill explicitly in Pi:

```text
/skill:sample-checklist
```

You can also pass a target package or scope as arguments:

```text
/skill:sample-checklist packages/pi-my-extension
```

## Included Skills

- `skills/sample-checklist/SKILL.md` — Pre-merge Pi package review workflow
- `skills/sample-checklist/references/checklist.md` — Verification checklist for dependencies, manifests, tests, and catalog freshness
