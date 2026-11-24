import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditWorkspace } from "../scripts/audit-packages.mjs";
import { scaffoldPackage } from "../scripts/new-package.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEW_PACKAGE_SCRIPT = path.resolve(__dirname, "..", "scripts", "new-package.mjs");

const tempDirs = [];

function createTempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-new-pkg-test-"));
  tempDirs.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "test-catalog",
        private: true,
        version: "0.0.0",
        type: "module",
        workspaces: ["packages/*"],
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(path.join(root, "packages"), { recursive: true });
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("scaffoldPackage", () => {
  it("scaffolds all 4 package types and passes auditWorkspace", () => {
    const root = createTempWorkspace();
    const outDir = path.join(root, "packages");

    const extResult = scaffoldPackage({
      name: "demo-ext",
      type: "extension",
      description: 'Extension "starter" for testing',
      outDir,
      date: "2026-11-24",
    });
    const skillResult = scaffoldPackage({
      name: "pi-demo-skill",
      type: "skill",
      description: "Skill starter for testing.",
      outDir,
    });
    const promptResult = scaffoldPackage({
      name: "demo-prompt",
      type: "prompt",
      description: "Prompt starter for testing.",
      outDir,
    });
    const themeResult = scaffoldPackage({
      name: "demo-theme",
      type: "theme",
      description: "Theme starter for testing.",
      outDir,
    });

    assert.equal(extResult.dirName, "pi-demo-ext");
    assert.equal(extResult.packageName, "@local/pi-demo-ext");
    assert.equal(skillResult.slug, "demo-skill");
    assert.equal(skillResult.dirName, "pi-demo-skill");
    assert.equal(promptResult.dirName, "pi-demo-prompt");
    assert.equal(themeResult.dirName, "pi-demo-theme");

    const audit = auditWorkspace(root);
    assert.equal(audit.ok, true, `Expected auditWorkspace to pass, got errors: ${audit.errors.join("; ")}`);
    assert.equal(audit.checkedPackages, 4);
    assert.deepEqual(audit.errors, []);

    // Verify extension manifest & authoring rules
    const extPkg = JSON.parse(fs.readFileSync(path.join(extResult.targetDir, "package.json"), "utf8"));
    assert.equal(extPkg.name, "@local/pi-demo-ext");
    assert.equal(extPkg.version, "0.1.0");
    assert.equal(extPkg.type, "module");
    assert.equal(extPkg.license, "MIT");
    assert.deepEqual(extPkg.keywords, ["pi-package"]);
    assert.equal(extPkg.pi, undefined);
    assert.deepEqual(extPkg.piCatalog, {
      category: "extension",
      status: "starter",
      profiles: ["core"],
    });
    assert.deepEqual(extPkg.peerDependencies, {
      "@earendil-works/pi-ai": "*",
      "@earendil-works/pi-coding-agent": "*",
      typebox: "*",
    });
    assert.equal(extPkg.dependencies, undefined);
    assert.equal(extPkg.devDependencies, undefined);

    const extChangelog = fs.readFileSync(path.join(extResult.targetDir, "CHANGELOG.md"), "utf8");
    assert.match(extChangelog, /^## \[0\.1\.0\] - 2026-11-24/m);

    const extIndex = fs.readFileSync(path.join(extResult.targetDir, "extensions", "index.ts"), "utf8");
    assert.match(extIndex, /import \{ StringEnum \} from "@earendil-works\/pi-ai";/);
    assert.match(extIndex, /import type \{ ExtensionAPI \} from "@earendil-works\/pi-coding-agent";/);
    assert.match(extIndex, /import \{ Type \} from "typebox";/);
    assert.match(extIndex, /promptSnippet:/);
    assert.match(extIndex, /promptGuidelines:/);
    assert.match(extIndex, /details: \{\}/);
    assert.match(extIndex, /if \(ctx\.hasUI\)/);
    assert.match(extIndex, /pi\.on\("session_shutdown"/);

    // Non-extension packages omit peerDependencies and CHANGELOG.md
    for (const nonExt of [skillResult, promptResult, themeResult]) {
      const pkg = JSON.parse(fs.readFileSync(path.join(nonExt.targetDir, "package.json"), "utf8"));
      assert.equal(pkg.peerDependencies, undefined);
      assert.equal(pkg.pi, undefined);
      assert.equal(pkg.piCatalog?.status, "starter");
      assert.equal(fs.existsSync(path.join(nonExt.targetDir, "CHANGELOG.md")), false);
    }

    const themeJson = JSON.parse(fs.readFileSync(path.join(themeResult.targetDir, "themes", "demo-theme.json"), "utf8"));
    assert.equal(themeJson.$schema, "https://pi.dev/schemas/theme.schema.json");
    assert.equal(themeJson.name, "demo-theme");
    assert.equal(themeJson.appearance, "dark");
  });

  it("rejects invalid slugs and invalid package types", () => {
    const root = createTempWorkspace();
    const outDir = path.join(root, "packages");

    const invalidNames = [
      "",
      "pi-",
      "Uppercase",
      "bad_underscore",
      "has space",
      "-leading",
      "trailing-",
      "double--dash",
      "a".repeat(51),
    ];

    for (const badName of invalidNames) {
      assert.throws(
        () => scaffoldPackage({ name: badName, type: "skill", outDir }),
        /(Invalid|non-empty)/,
        `Expected rejection for name=${JSON.stringify(badName)}`,
      );
    }

    assert.throws(
      () => scaffoldPackage({ name: "valid-name", type: "unknown", outDir }),
      /Invalid package type/,
    );
  });

  it('rejects "system" as a theme name', () => {
    const root = createTempWorkspace();
    const outDir = path.join(root, "packages");

    assert.throws(
      () => scaffoldPackage({ name: "system", type: "theme", outDir }),
      /reserved/,
    );
    assert.throws(
      () => scaffoldPackage({ name: "pi-system", type: "theme", outDir }),
      /reserved/,
    );
  });

  it("refuses to overwrite an existing target directory", () => {
    const root = createTempWorkspace();
    const outDir = path.join(root, "packages");

    const first = scaffoldPackage({
      name: "collision-check",
      type: "prompt",
      description: "First version",
      outDir,
    });
    const readmePath = path.join(first.targetDir, "README.md");
    fs.writeFileSync(readmePath, "custom content\n", "utf8");

    assert.throws(
      () =>
        scaffoldPackage({
          name: "pi-collision-check",
          type: "prompt",
          description: "Second version",
          outDir,
        }),
      /already exists/,
    );
    assert.equal(fs.readFileSync(readmePath, "utf8"), "custom content\n");
  });

  it("supports CLI --help and scaffolding via CLI flags", () => {
    const root = createTempWorkspace();
    const outDir = path.join(root, "packages");

    const helpOut = execFileSync(process.execPath, [NEW_PACKAGE_SCRIPT, "--help"], {
      encoding: "utf8",
    });
    assert.match(helpOut, /Usage: node scripts\/new-package\.mjs/);

    execFileSync(
      process.execPath,
      [
        NEW_PACKAGE_SCRIPT,
        "--name",
        "pi-cli-demo",
        "--type",
        "extension",
        "--description",
        "CLI generated extension",
        "--out-dir",
        outDir,
        "--date",
        "2026-11-24",
      ],
      { encoding: "utf8" },
    );

    const audit = auditWorkspace(root);
    assert.equal(audit.ok, true, `Expected CLI scaffold to pass audit: ${audit.errors.join("; ")}`);
    assert.equal(audit.checkedPackages, 1);
  });
});
