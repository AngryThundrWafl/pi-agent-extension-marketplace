# @local/pi-sample-prompt

Starter Pi prompt template package providing a focused `/sample-review` command.

## Install or Try

Install the package into your Pi configuration:

```bash
pi install ./packages/pi-sample-prompt
```

Or try it in a single session without installing:

```bash
pi -e ./packages/pi-sample-prompt
```

## Included Prompts

- [`prompts/sample-review.md`](prompts/sample-review.md) — registers `/sample-review [focus]` via Pi's conventional `prompts/` directory discovery.

## Usage

Run `/sample-review` in Pi, optionally passing a primary focus as the first argument and additional files, scope, or notes afterward:

```text
/sample-review
```
Uses the default focus (`correctness, security, and tests`).

```text
/sample-review performance
```
Sets the primary focus (`$1`) to `performance`.

```text
/sample-review "error handling" src/api/ src/worker.ts
```
Sets the primary focus (`$1`) to `error handling`, passes `src/api/ src/worker.ts` as extra scope (`${@:2}`), and preserves the full argument list (`$@`).
