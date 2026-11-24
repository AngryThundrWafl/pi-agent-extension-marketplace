import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unexpectedStderrLines } from "../scripts/verify-install.mjs";

const NO_MODELS_WARNING = `Warning: No models available. Use /login to log into a provider via OAuth or API key. See:
  /home/runner/work/pi-agent-extension-marketplace/pi-agent-extension-marketplace/node_modules/@earendil-works/pi-coding-agent/docs/providers.md
  /home/runner/work/pi-agent-extension-marketplace/pi-agent-extension-marketplace/node_modules/@earendil-works/pi-coding-agent/docs/models.md`;

describe("unexpectedStderrLines", () => {
  it("ignores Pi's benign no-models guidance from an unauthenticated CI environment", () => {
    assert.deepEqual(unexpectedStderrLines(NO_MODELS_WARNING), []);
  });

  it("keeps genuine errors even when the no-models guidance is also present", () => {
    assert.deepEqual(unexpectedStderrLines(`${NO_MODELS_WARNING}\nError: Failed to load extension`), [
      "Error: Failed to load extension",
    ]);
  });

  it("keeps unrelated warnings and blank-line-separated output", () => {
    assert.deepEqual(
      unexpectedStderrLines("Warning: something else\n\n  detail line"),
      ["Warning: something else", "detail line"],
    );
  });
});
