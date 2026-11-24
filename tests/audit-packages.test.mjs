import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditWorkspace } from "../scripts/audit-packages.mjs";

const tempDirs = [];

function createTempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-audit-test-"));
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

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

const VALID_THEME_COLORS = {
  accent: "#5f87ff",
  border: "#444444",
  borderAccent: "primary",
  borderMuted: "#333333",
  success: "#00af5f",
  error: "#ff5f5f",
  warning: "#ffaf00",
  muted: "#808080",
  dim: "#626262",
  text: "",
  thinkingText: "#9e9e9e",
  selectedBg: "#262626",
  userMessageBg: "#1c1c1c",
  userMessageText: "",
  customMessageBg: "#1c1c1c",
  customMessageText: "",
  customMessageLabel: "#5f87ff",
  toolPendingBg: "#1c1c1c",
  toolSuccessBg: "#12261a",
  toolErrorBg: "#261212",
  toolTitle: "#ffffff",
  toolOutput: "#cccccc",
  mdHeading: "#5f87ff",
  mdLink: "#5fafd7",
  mdLinkUrl: "#808080",
  mdCode: "#af87ff",
  mdCodeBlock: "#d0d0d0",
  mdCodeBlockBorder: "#444444",
  mdQuote: "#808080",
  mdQuoteBorder: "#444444",
  mdHr: "#444444",
  mdListBullet: "#5f87ff",
  toolDiffAdded: "#00af5f",
  toolDiffRemoved: "#ff5f5f",
  toolDiffContext: "#808080",
  syntaxComment: "#626262",
  syntaxKeyword: "#af87ff",
  syntaxFunction: "#5f87ff",
  syntaxVariable: "#d7875f",
  syntaxString: "#87af5f",
  syntaxNumber: "#d7af5f",
  syntaxType: "#5fafd7",
  syntaxOperator: "#d0d0d0",
  syntaxPunctuation: "#a8a8a8",
  thinkingOff: "#444444",
  thinkingMinimal: "#626262",
  thinkingLow: "#5fafd7",
  thinkingMedium: "#5f87ff",
  thinkingHigh: "#af87ff",
  thinkingXhigh: "#ff5faf",
  bashMode: "#ffaf00",
};

function createValidExtensionPackage(root, dirName = "pi-ext-demo") {
  const pkgDir = path.join(root, "packages", dirName);
  writeJson(path.join(pkgDir, "package.json"), {
    name: `@local/${dirName}`,
    version: "0.1.0",
    type: "module",
    license: "MIT",
    description: "Valid extension fixture",
    keywords: ["pi-package"],
    files: ["extensions", "CHANGELOG.md", "README.md"],
    peerDependencies: {
      "@earendil-works/pi-ai": "*",
      "@earendil-works/pi-coding-agent": "*",
      typebox: "*",
    },
  });
  writeText(
    path.join(pkgDir, "CHANGELOG.md"),
    "# Changelog\n\n## [0.1.0] - 2026-11-24\n\n- Initial release.\n",
  );
  writeText(
    path.join(pkgDir, "extensions", "index.ts"),
    [
      'import { StringEnum } from "@earendil-works/pi-ai";',
      'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
      'import { Type } from "typebox";',
      'import { helper } from "./helper.ts";',
      "",
      'const ModeSchema = StringEnum(["fast", "thorough"] as const);',
      "export default function (pi: ExtensionAPI) {",
      "  void pi;",
      "  void ModeSchema;",
      "  void Type;",
      "  void helper;",
      "}",
      "",
    ].join("\n"),
  );
  writeText(
    path.join(pkgDir, "extensions", "helper.ts"),
    'import path from "node:path";\nexport const helper = path.basename("a/b");\n',
  );
  return pkgDir;
}

function createValidSkillPackage(root, dirName = "pi-skill-demo") {
  const pkgDir = path.join(root, "packages", dirName);
  writeJson(path.join(pkgDir, "package.json"), {
    name: `@local/${dirName}`,
    version: "0.1.0",
    type: "module",
    license: "MIT",
    description: "Valid skill fixture",
    keywords: ["pi-package"],
    files: ["skills", "README.md"],
  });
  writeText(
    path.join(pkgDir, "skills", "demo-skill", "SKILL.md"),
    [
      "---",
      "name: demo-skill",
      "description: Performs a deterministic demo task.",
      "---",
      "",
      "# Demo Skill",
      "",
      "Instructions here.",
      "",
    ].join("\n"),
  );
  return pkgDir;
}

function createValidPromptPackage(root, dirName = "pi-prompt-demo") {
  const pkgDir = path.join(root, "packages", dirName);
  writeJson(path.join(pkgDir, "package.json"), {
    name: `@local/${dirName}`,
    version: "0.1.0",
    type: "module",
    license: "MIT",
    description: "Valid prompt fixture",
    keywords: ["pi-package"],
    files: ["prompts", "README.md"],
  });
  writeText(path.join(pkgDir, "prompts", "review.md"), "Review the changes carefully.\n");
  return pkgDir;
}

function createValidThemePackage(root, dirName = "pi-theme-demo") {
  const pkgDir = path.join(root, "packages", dirName);
  writeJson(path.join(pkgDir, "package.json"), {
    name: `@local/${dirName}`,
    version: "0.1.0",
    type: "module",
    license: "MIT",
    description: "Valid theme fixture",
    keywords: ["pi-package"],
    files: ["themes", "README.md"],
  });
  writeJson(path.join(pkgDir, "themes", "cobalt.json"), {
    name: "cobalt-demo",
    appearance: "dark",
    vars: {
      primary: "#5f87ff",
    },
    colors: VALID_THEME_COLORS,
  });
  return pkgDir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("auditWorkspace", () => {
  it("passes on valid extension, skill, prompt, and theme fixtures", () => {
    const root = createTempWorkspace();
    createValidExtensionPackage(root);
    createValidSkillPackage(root);
    createValidPromptPackage(root);
    createValidThemePackage(root);

    const result = auditWorkspace(root);
    assert.equal(result.ok, true, `Expected audit to pass, got errors: ${result.errors.join("; ")}`);
    assert.equal(result.checkedPackages, 4);
    assert.deepEqual(result.errors, []);
  });

  it("fails when a host package is placed in dependencies", () => {
    const root = createTempWorkspace();
    const pkgDir = createValidExtensionPackage(root);
    const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    pkgJson.dependencies = { "@earendil-works/pi-coding-agent": "1.6.0", typebox: "1.3.27" };
    writeJson(path.join(pkgDir, "package.json"), pkgJson);

    const result = auditWorkspace(root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /host-provided package "@earendil-works\/pi-coding-agent" must not be in dependencies/);
    assert.match(result.errors.join("\n"), /host-provided package "typebox" must not be in dependencies/);
  });

  it("fails when a legacy package is imported or declared in peerDependencies", () => {
    const root = createTempWorkspace();
    const pkgDir = createValidExtensionPackage(root);
    const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    pkgJson.peerDependencies["@mariozechner/pi-coding-agent"] = "*";
    writeJson(path.join(pkgDir, "package.json"), pkgJson);
    writeText(
      path.join(pkgDir, "extensions", "legacy.ts"),
      'import { Type } from "@sinclair/typebox";\nvoid Type;\n',
    );

    const result = auditWorkspace(root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /legacy package "@mariozechner\/pi-coding-agent" is forbidden in peerDependencies/);
    assert.match(result.errors.join("\n"), /legacy import "@sinclair\/typebox" is forbidden/);
  });

  it("fails when an undeclared phantom dependency is imported", () => {
    const root = createTempWorkspace();
    const pkgDir = createValidExtensionPackage(root);
    writeText(
      path.join(pkgDir, "extensions", "phantom.ts"),
      'import pc from "picocolors";\nvoid pc;\n',
    );

    const result = auditWorkspace(root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /undeclared\/phantom dependency "picocolors"/);
  });

  it("fails when @earendil-works/pi-codemode is imported with only peerDependencies: '*'", () => {
    const root = createTempWorkspace();
    const pkgDir = createValidExtensionPackage(root);
    const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    pkgJson.peerDependencies["@earendil-works/pi-codemode"] = "*";
    writeJson(path.join(pkgDir, "package.json"), pkgJson);
    writeText(
      path.join(pkgDir, "extensions", "codemode.ts"),
      'import { codemode } from "@earendil-works/pi-codemode";\nvoid codemode;\n',
    );

    const result = auditWorkspace(root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /"@earendil-works\/pi-codemode" is NOT host-provided/);
    assert.match(result.errors.join("\n"), /undeclared\/phantom dependency "@earendil-works\/pi-codemode"/);
  });

  it("fails on Type.Union([Type.Literal(...), ...])", () => {
    const root = createTempWorkspace();
    const pkgDir = createValidExtensionPackage(root);
    writeText(
      path.join(pkgDir, "extensions", "bad-union.ts"),
      [
        'import { Type } from "typebox";',
        'export const Bad = Type.Union([Type.Literal("a"), Type.Literal("b")]);',
        "",
      ].join("\n"),
    );

    const result = auditWorkspace(root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /use StringEnum from "@earendil-works\/pi-ai"/);
  });

  it("fails on relative import escaping package root", () => {
    const root = createTempWorkspace();
    const pkgDir = createValidExtensionPackage(root);
    writeText(
      path.join(pkgDir, "extensions", "escape.ts"),
      'import { x } from "../../other/index.ts";\nvoid x;\n',
    );

    const result = auditWorkspace(root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /relative import "\.\.\/\.\.\/other\/index\.ts" escapes package root/);
  });

  it("fails on escaping pi.changelogPath and on '## v0.1.0' changelog headings", () => {
    const root = createTempWorkspace();
    const pkgDir = createValidExtensionPackage(root, "pi-cl-escape");
    const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    pkgJson.pi = { changelogPath: "../../CHANGELOG.md" };
    writeJson(path.join(pkgDir, "package.json"), pkgJson);

    const pkgDir2 = createValidExtensionPackage(root, "pi-cl-vprefix");
    writeText(
      path.join(pkgDir2, "CHANGELOG.md"),
      "# Changelog\n\n## v0.1.0\n\n- Bad v prefix.\n",
    );

    const result = auditWorkspace(root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /pi\.changelogPath "\.\.\/\.\.\/CHANGELOG\.md" must resolve strictly inside package root/);
    assert.match(result.errors.join("\n"), /changelog heading must not start with "v"/);
  });

  it("fails on missing skill description, reserved theme name 'system', and unknown theme color token", () => {
    const root = createTempWorkspace();
    const skillPkg = createValidSkillPackage(root);
    writeText(
      path.join(skillPkg, "skills", "demo-skill", "SKILL.md"),
      "---\nname: demo-skill\n---\n\n# Missing description\n",
    );

    const themePkg1 = createValidThemePackage(root, "pi-theme-system");
    writeJson(path.join(themePkg1, "themes", "cobalt.json"), {
      name: "system",
      colors: VALID_THEME_COLORS,
    });

    const themePkg2 = createValidThemePackage(root, "pi-theme-extra");
    writeJson(path.join(themePkg2, "themes", "cobalt.json"), {
      name: "extra-token",
      colors: {
        ...VALID_THEME_COLORS,
        unknownToken: "#112233",
      },
    });

    const result = auditWorkspace(root);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /frontmatter requires a non-empty "description"/);
    assert.match(result.errors.join("\n"), /"name" cannot be "system"/);
    assert.match(result.errors.join("\n"), /colors contains unknown token "unknownToken"/);
  });
});
