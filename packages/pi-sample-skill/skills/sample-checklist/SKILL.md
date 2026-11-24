---
name: sample-checklist
description: "Guides pre-merge reviews of Pi packages against host peerDependencies, manifest discovery, test isolation, and catalog freshness rules. Use when reviewing, auditing, or preparing changes to a Pi extension, skill, prompt, or theme package."
---

# Sample Checklist

Pre-merge review workflow for workspace packages in a Pi v1.6.0 catalog monorepo.

## When to Use

- Use this skill when reviewing a pull request or local diff touching `packages/pi-*`.
- Use this skill before merging a newly scaffolded or updated extension, skill, prompt, or theme package.

## Instructions

1. Read [references/checklist.md](references/checklist.md) from this skill directory before evaluating package changes.
2. Inspect the modified package's `package.json`, source files, resource directories, and tests against each section of the checklist.
3. Report every failing check with its exact file path and concrete remediation, or confirm all applicable checks pass.
4. Recommend running `npm run catalog:generate` (if catalog entries changed) and `npm run check` before final sign-off.
