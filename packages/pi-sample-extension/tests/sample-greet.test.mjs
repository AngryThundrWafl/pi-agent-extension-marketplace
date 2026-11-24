import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createPiSandbox } from "../../../scripts/lib/pi-sandbox.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");

/**
 * Temporarily apply sandbox environment variables for in-process Pi SDK calls.
 * @template T
 * @param {ReturnType<typeof createPiSandbox>} sandbox
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withSandboxEnv(sandbox, fn) {
  const keys = [
    "HOME",
    "PI_CODING_AGENT_DIR",
    "PI_CODING_AGENT_SESSION_DIR",
    "PI_OFFLINE",
    "PI_SKIP_VERSION_CHECK",
    "PI_TELEMETRY",
  ];
  const previous = new Map();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    process.env[key] = sandbox.env[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("@local/pi-sample-extension loads cleanly and registers tool, flag, and command", async () => {
  const sandbox = createPiSandbox("pi-sample-extension-test-");
  try {
    const loaded = await withSandboxEnv(sandbox, async () => {
      const settingsManager = SettingsManager.inMemory({ packages: [pkgDir] });
      const loader = new DefaultResourceLoader({
        cwd: sandbox.workDir,
        agentDir: sandbox.agentDir,
        settingsManager,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      await loader.reload();
      return loader.getExtensions();
    });

    assert.deepEqual(loaded.errors, []);

    const realPkgDir = fs.realpathSync(pkgDir);
    const ext = loaded.extensions.find((entry) => {
      const extPath = entry.resolvedPath || entry.path;
      return extPath && fs.realpathSync(extPath).startsWith(`${realPkgDir}${path.sep}`);
    });
    assert.ok(ext, "Expected pi-sample-extension to be loaded by DefaultResourceLoader");

    const greetTool = ext.tools.get("sample_greet");
    assert.ok(greetTool, "Expected tool sample_greet to be registered");
    assert.ok(ext.flags.has("sample-greet-prefix"), "Expected flag sample-greet-prefix to be registered");

    const greetCommand = ext.commands.get("sample-greet");
    assert.ok(greetCommand, "Expected command sample-greet to be registered");

    const friendlyResult = await greetTool.definition.execute(
      "call-1",
      { name: "World" },
      undefined,
      undefined,
      { cwd: sandbox.workDir, hasUI: false },
    );
    assert.equal(friendlyResult.content[0]?.type, "text");
    assert.ok(friendlyResult.content[0]?.text.includes("World"));
    assert.deepEqual(friendlyResult.details, {
      name: "World",
      tone: "friendly",
      prefix: "Hello",
    });

    const formalResult = await greetTool.definition.execute(
      "call-2",
      { name: "World", tone: "formal" },
      undefined,
      undefined,
      { cwd: sandbox.workDir, hasUI: false },
    );
    assert.equal(formalResult.content[0]?.type, "text");
    assert.ok(formalResult.content[0]?.text.includes("World"));
    assert.deepEqual(formalResult.details, {
      name: "World",
      tone: "formal",
      prefix: "Hello",
    });

    await assert.doesNotReject(async () => {
      await greetCommand.handler("", { hasUI: false });
    });
  } finally {
    sandbox.cleanup();
  }
});
