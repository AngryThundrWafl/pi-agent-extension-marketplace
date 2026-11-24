import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCatalog } from "../scripts/generate-catalog.mjs";
import {
  CATALOG_END_MARKER,
  CATALOG_START_MARKER,
} from "../scripts/lib/catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATOR_SCRIPT = path.resolve(__dirname, "..", "scripts", "generate-catalog.mjs");

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function createTempCatalogWorkspace({
  readmeBefore = "# Test Catalog\n\nIntro paragraph.\n\n## Packages\n\n",
  readmePlaceholder = "_Placeholder_",
  readmeAfter = "\n\n## Footer\n\nPreserved footer text.\n",
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-test-"));
  tempDirs.push(root);

  writeJson(path.join(root, "package.json"), {
    name: "test-pi-catalog",
    private: true,
    version: "0.0.0",
    type: "module",
    workspaces: ["packages/*"],
  });

  const readmeContent =
    `${readmeBefore}${CATALOG_START_MARKER}\n${readmePlaceholder}\n${CATALOG_END_MARKER}${readmeAfter}`;
  writeText(path.join(root, "README.md"), readmeContent);
  fs.mkdirSync(path.join(root, "packages"), { recursive: true });
  return root;
}

function addSamplePackage(
  root,
  dirName,
  {
    name = `@local/${dirName}`,
    version = "0.1.0",
    description = `Sample package ${dirName}`,
    piCatalog = { category: "utilities", status: "stable" },
    extensions = [],
    skills = [],
    prompts = [],
    themes = [],
  } = {},
) {
  const pkgDir = path.join(root, "packages", dirName);
  writeJson(path.join(pkgDir, "package.json"), {
    name,
    version,
    type: "module",
    license: "MIT",
    description,
    keywords: ["pi-package"],
    files: ["extensions", "skills", "prompts", "themes"],
    piCatalog,
  });

  for (const rel of extensions) {
    writeText(path.join(pkgDir, "extensions", rel), "export default function () {}\n");
  }
  for (const skillName of skills) {
    writeText(
      path.join(pkgDir, "skills", skillName, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Skill ${skillName}\n---\n\n# ${skillName}\n`,
    );
  }
  for (const promptFile of prompts) {
    writeText(path.join(pkgDir, "prompts", promptFile), "# Prompt\n");
  }
  for (const themeFile of themes) {
    writeJson(path.join(pkgDir, "themes", themeFile), { name: themeFile.replace(/\.json$/, "") });
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [GENERATOR_SCRIPT, ...args], {
    encoding: "utf8",
  });
}

describe("generate-catalog", () => {
  it("list mode returns deterministic entries and stdout summary for sample packages", () => {
    const root = createTempCatalogWorkspace();
    // Create in reverse alphabetical order to verify deterministic ASCII sorting
    addSamplePackage(root, "pi-z-theme", {
      version: "0.2.0",
      description: "Zeta theme pack",
      piCatalog: { category: "themes", status: "beta" },
      themes: ["dark.json"],
    });
    addSamplePackage(root, "pi-a-ext", {
      version: "1.0.0",
      description: "Alpha extension & skill",
      piCatalog: { category: "workflows", status: "stable" },
      extensions: ["index.ts"],
      skills: ["helper-skill"],
      prompts: ["review.md"],
    });

    const first = runCatalog({ rootDir: root, mode: "list" });
    const second = runCatalog({ rootDir: root, mode: "list" });

    assert.equal(first.ok, true);
    assert.equal(first.mode, "list");
    assert.equal(first.packageCount, 2);
    assert.deepEqual(first, second);

    assert.deepEqual(
      first.packages.map((p) => p.dirName),
      ["pi-a-ext", "pi-z-theme"],
    );
    assert.deepEqual(first.packages[0], {
      dirName: "pi-a-ext",
      relDir: "packages/pi-a-ext",
      name: "@local/pi-a-ext",
      version: "1.0.0",
      category: "workflows",
      status: "stable",
      resources: { extensions: 1, skills: 1, prompts: 1, themes: 0 },
      description: "Alpha extension & skill",
    });

    assert.match(first.output, /pi-a-ext \| @local\/pi-a-ext@1\.0\.0/);
    assert.match(first.output, /category=workflows \| status=stable/);
    assert.match(first.output, /extensions=1, skills=1, prompts=1, themes=0/);
    assert.match(first.output, /Alpha extension & skill/);

    const cli = runCli(["--list", "--root", root]);
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout.trim(), first.output);
  });

  it("generate writes docs/catalog.md, preserves README outside markers, and is strictly idempotent", () => {
    const readmeBefore = "# Custom Header\n\nKeep this intro intact.\n\n";
    const readmeAfter = "\n\n## Appendix\n\nKeep this footer intact.\n";
    const root = createTempCatalogWorkspace({ readmeBefore, readmeAfter });

    addSamplePackage(root, "pi-demo", {
      version: "0.3.1",
      description: "Demo utility package",
      extensions: ["index.ts"],
    });

    const gen1 = runCatalog({ rootDir: root, mode: "generate" });
    assert.equal(gen1.ok, true);
    assert.equal(gen1.packageCount, 1);

    const readmePath = path.join(root, "README.md");
    const catalogDocPath = path.join(root, "docs", "catalog.md");

    assert.equal(fs.existsSync(catalogDocPath), true);

    const readmeAfterGen1 = fs.readFileSync(readmePath);
    const catalogAfterGen1 = fs.readFileSync(catalogDocPath);
    const readmeText1 = readmeAfterGen1.toString("utf8");
    const catalogText1 = catalogAfterGen1.toString("utf8");

    assert.equal(readmeText1.endsWith("\n"), true);
    assert.equal(catalogText1.endsWith("\n"), true);
    assert.equal(readmeText1.startsWith(`${readmeBefore}${CATALOG_START_MARKER}\n`), true);
    assert.equal(readmeText1.endsWith(`\n${CATALOG_END_MARKER}${readmeAfter}`), true);
    assert.match(readmeText1, /@local\/pi-demo/);
    assert.match(readmeText1, /\(\.\/packages\/pi-demo\)/);
    assert.match(readmeText1, /Demo utility package/);
    assert.doesNotMatch(readmeText1, /_Placeholder_/);
    assert.match(catalogText1, /^# Pi Package Catalog/);
    assert.match(catalogText1, /\(\.\.\/packages\/pi-demo\)/);
    assert.match(catalogText1, /### @local\/pi-demo \(`v0\.3\.1`\)/);

    const gen2 = runCatalog({ rootDir: root, mode: "generate" });
    assert.equal(gen2.ok, true);

    assert.equal(Buffer.compare(fs.readFileSync(readmePath), readmeAfterGen1), 0);
    assert.equal(Buffer.compare(fs.readFileSync(catalogDocPath), catalogAfterGen1), 0);
  });

  it("check passes after generate and fails when README.md drifts or docs/catalog.md is missing/drifts", () => {
    const root = createTempCatalogWorkspace();
    addSamplePackage(root, "pi-demo", {
      description: "Clean demo package",
      prompts: ["hello.md"],
    });

    const genRes = runCatalog({ rootDir: root, mode: "generate" });
    assert.equal(genRes.ok, true);

    const okCheck = runCatalog({ rootDir: root, mode: "check" });
    assert.equal(okCheck.ok, true);
    assert.deepEqual(okCheck.errors, []);

    const okCli = runCli(["--check", "--root", root]);
    assert.equal(okCli.status, 0, okCli.stderr);

    // 1. README.md catalog marker region drifts
    const readmePath = path.join(root, "README.md");
    const originalReadme = fs.readFileSync(readmePath, "utf8");
    fs.writeFileSync(
      readmePath,
      originalReadme.replace("@local/pi-demo", "@local/stale-demo"),
      "utf8",
    );

    const readmeDrift = runCatalog({ rootDir: root, mode: "check" });
    assert.equal(readmeDrift.ok, false);
    assert.match(readmeDrift.errors.join("\n"), /README\.md/);

    const readmeDriftCli = runCli(["--check", "--root", root]);
    assert.equal(readmeDriftCli.status, 1);
    assert.match(readmeDriftCli.stderr, /README\.md/);

    // Restore README.md
    fs.writeFileSync(readmePath, originalReadme, "utf8");

    // 2. docs/catalog.md drifts
    const catalogDocPath = path.join(root, "docs", "catalog.md");
    const originalCatalog = fs.readFileSync(catalogDocPath, "utf8");
    fs.writeFileSync(catalogDocPath, `${originalCatalog}\n<!-- stale -->\n`, "utf8");

    const docDrift = runCatalog({ rootDir: root, mode: "check" });
    assert.equal(docDrift.ok, false);
    assert.match(docDrift.errors.join("\n"), /docs\/catalog\.md/);

    // 3. docs/catalog.md missing
    fs.rmSync(catalogDocPath);
    const docMissing = runCatalog({ rootDir: root, mode: "check" });
    assert.equal(docMissing.ok, false);
    assert.match(docMissing.errors.join("\n"), /docs\/catalog\.md is missing/);

    const docMissingCli = runCli(["--check", "--root", root]);
    assert.equal(docMissingCli.status, 1);
    assert.match(docMissingCli.stderr, /docs\/catalog\.md is missing/);
  });

  it("fails generate and check when package description leaks machine-local paths", () => {
    for (const leakedDesc of [
      "Reads config from /home/alice/secret/config.json",
      "Writes scratch files to /tmp/foo/bar",
      "Uses macOS path /Users/bob/Desktop",
      "Caches in /var/folders/xy/abc",
      "Windows path C:\\Users\\alice\\app",
    ]) {
      const root = createTempCatalogWorkspace();
      addSamplePackage(root, "pi-leaky", {
        description: leakedDesc,
        extensions: ["index.ts"],
      });

      const readmeBefore = fs.readFileSync(path.join(root, "README.md"), "utf8");

      const genRes = runCatalog({ rootDir: root, mode: "generate" });
      assert.equal(genRes.ok, false, `Expected generate to fail for: ${leakedDesc}`);
      assert.match(genRes.errors.join("\n"), /Leaked machine-local path/);
      assert.equal(fs.existsSync(path.join(root, "docs", "catalog.md")), false);
      assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), readmeBefore);

      const checkRes = runCatalog({ rootDir: root, mode: "check" });
      assert.equal(checkRes.ok, false, `Expected check to fail for: ${leakedDesc}`);
      assert.match(checkRes.errors.join("\n"), /Leaked machine-local path/);

      const checkCli = runCli(["--check", "--root", root]);
      assert.equal(checkCli.status, 1);
      assert.match(checkCli.stderr, /Leaked machine-local path/);
    }
  });

  it("supports --help CLI flag", () => {
    const cli = runCli(["--help"]);
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /Usage: node scripts\/generate-catalog\.mjs/);
    assert.match(cli.stdout, /--list/);
    assert.match(cli.stdout, /--check/);
    assert.match(cli.stdout, /--root/);
  });
});
