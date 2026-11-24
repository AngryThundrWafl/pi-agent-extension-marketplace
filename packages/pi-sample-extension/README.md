# @local/pi-sample-extension

Starter Pi extension package demonstrating Pi v1.6.0 extension best practices: TypeBox + `StringEnum` tool schema, CLI flag registration, UI-guarded slash command, and idempotent session lifecycle hooks.

## Install

Install locally into Pi:

```bash
pi install ./packages/pi-sample-extension
```

Or try it for a single invocation without adding it to settings:

```bash
pi -e ./packages/pi-sample-extension
```

## Features

- **Tool `sample_greet`**: Formats a greeting for a target `name` with an optional `tone` (`"friendly"` or `"formal"`), returning text content and structured `details`.
- **Command `/sample-greet`**: Displays the current greeting and `--sample-greet-prefix` status when UI is available.
- **CLI flag `--sample-greet-prefix`**: Sets the greeting prefix string (defaults to `"Hello"`).
