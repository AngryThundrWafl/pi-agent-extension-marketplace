#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { isBuiltin, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { discoverWorkspacePackages } from "./lib/catalog.mjs";

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const CANONICAL_HOST_PACKAGES = new Map([
  ["@earendil-works/pi-ai", new Set(["", "/compat", "/models", "/oauth", "/providers/all"])],
  ["@earendil-works/pi-agent-core", new Set([""])],
  ["@earendil-works/pi-coding-agent", new Set([""])],
  ["@earendil-works/pi-tui", new Set([""])],
  ["typebox", new Set(["", "/compile", "/value"])],
]);

export const LEGACY_HOST_PACKAGES = new Set([
  "@mariozechner/pi-ai",
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-tui",
  "@sinclair/typebox",
]);

export const NON_HOST_PI_PACKAGES = new Set([
  "@earendil-works/pi-codemode",
  "@earendil-works/pi-mcp",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]s$/i;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathInside(parentDir, targetPath) {
  const rel = path.relative(parentDir, targetPath);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function canonicalizeExisting(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function isLegacyPackageName(pkgName) {
  return LEGACY_HOST_PACKAGES.has(pkgName) || pkgName.startsWith("@mariozechner/");
}

function splitPackageSpecifier(specifier) {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length < 2) {
      return { pkgName: specifier, subpath: "" };
    }
    const pkgName = `${parts[0]}/${parts[1]}`;
    const subpath = parts.length > 2 ? `/${parts.slice(2).join("/")}` : "";
    return { pkgName, subpath };
  }
  const parts = specifier.split("/");
  const pkgName = parts[0] ?? specifier;
  const subpath = parts.length > 1 ? `/${parts.slice(1).join("/")}` : "";
  return { pkgName, subpath };
}

/**
 * Tokenize JS/TS source, stripping comments and tracking string/template/regex boundaries.
 * @param {string} source
 * @returns {Array<{ type: "word" | "string" | "punct" | "template", value: string }>}
 */
function tokenizeSource(source) {
  const tokens = [];
  const len = source.length;
  let i = 0;

  const regexPredecessors = new Set([
    "=",
    "(",
    "[",
    ",",
    ":",
    ";",
    "!",
    "?",
    "{",
    "}",
    "=>",
    "&",
    "|",
    "^",
    "~",
    "+",
    "-",
    "*",
    "%",
    "<",
    ">",
    "return",
    "throw",
    "case",
    "typeof",
    "void",
    "in",
    "of",
  ]);

  function canStartRegex() {
    if (tokens.length === 0) return true;
    const prev = tokens[tokens.length - 1];
    return regexPredecessors.has(prev.value);
  }

  function readQuotedString(quote) {
    let value = "";
    i += 1;
    while (i < len) {
      const ch = source[i];
      if (ch === "\\") {
        value += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === quote) {
        i += 1;
        break;
      }
      value += ch;
      i += 1;
    }
    tokens.push({ type: "string", value });
  }

  function readTemplateLiteral() {
    i += 1;
    tokens.push({ type: "template", value: "`" });
    while (i < len) {
      const ch = source[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") {
        i += 1;
        break;
      }
      if (ch === "$" && source[i + 1] === "{") {
        i += 2;
        tokens.push({ type: "punct", value: "${" });
        let depth = 1;
        while (i < len && depth > 0) {
          const inner = source[i];
          if (inner === "{") {
            depth += 1;
            tokens.push({ type: "punct", value: "{" });
            i += 1;
          } else if (inner === "}") {
            depth -= 1;
            tokens.push({ type: "punct", value: "}" });
            i += 1;
          } else if (!consumeNextToken()) {
            i += 1;
          }
        }
        continue;
      }
      i += 1;
    }
  }

  function consumeNextToken() {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      return true;
    }
    if (ch === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < len && source[i] !== "\n") {
        i += 1;
      }
      return true;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      return true;
    }
    if (ch === "'" || ch === '"') {
      readQuotedString(ch);
      return true;
    }
    if (ch === "`") {
      readTemplateLiteral();
      return true;
    }
    if (ch === "/" && canStartRegex()) {
      i += 1;
      let inClass = false;
      while (i < len) {
        const rc = source[i];
        if (rc === "\\") {
          i += 2;
          continue;
        }
        if (rc === "[") {
          inClass = true;
        } else if (rc === "]" && inClass) {
          inClass = false;
        } else if (rc === "/" && !inClass) {
          i += 1;
          while (i < len && /[a-z]/i.test(source[i])) {
            i += 1;
          }
          break;
        } else if (rc === "\n") {
          break;
        }
        i += 1;
      }
      tokens.push({ type: "punct", value: "/regex/" });
      return true;
    }
    if (ch === "=" && source[i + 1] === ">") {
      tokens.push({ type: "punct", value: "=>" });
      i += 2;
      return true;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let end = i + 1;
      while (end < len && /[A-Za-z0-9_$]/.test(source[end])) {
        end += 1;
      }
      tokens.push({ type: "word", value: source.slice(i, end) });
      i = end;
      return true;
    }
    if (/[0-9]/.test(ch)) {
      let end = i + 1;
      while (end < len && /[0-9A-Za-z_.]/.test(source[end])) {
        end += 1;
      }
      tokens.push({ type: "punct", value: source.slice(i, end) });
      i = end;
      return true;
    }
    tokens.push({ type: "punct", value: ch });
    i += 1;
    return true;
  }

  while (i < len) {
    consumeNextToken();
  }

  return tokens;
}

/**
 * Extract static/dynamic import and require specifiers and Type.Union([Type.Literal(...)]) hits.
 * @param {string} source
 * @returns {{ specifiers: string[], hasTypeUnionLiteral: boolean }}
 */
function inspectSourceTokens(source) {
  const tokens = tokenizeSource(source);
  const specifiers = [];
  let hasTypeUnionLiteral = false;

  for (let idx = 0; idx < tokens.length; idx += 1) {
    const tok = tokens[idx];

    // Static import: `import "..."` or `import ... from "..."`
    if (tok.type === "word" && tok.value === "import") {
      const next = tokens[idx + 1];
      if (next?.type === "string") {
        specifiers.push(next.value);
        continue;
      }
      if (next?.type === "punct" && next.value === "(") {
        const arg = tokens[idx + 2];
        if (arg?.type === "string") {
          specifiers.push(arg.value);
        }
        continue;
      }
      // Scan ahead for `from "..."` without crossing `;`
      let braceDepth = 0;
      for (let j = idx + 1; j < tokens.length; j += 1) {
        const t = tokens[j];
        if (t.type === "punct" && t.value === "{") braceDepth += 1;
        else if (t.type === "punct" && t.value === "}") braceDepth = Math.max(0, braceDepth - 1);
        else if (braceDepth === 0 && t.type === "punct" && t.value === ";") break;
        else if (braceDepth === 0 && t.type === "word" && t.value === "from") {
          if (tokens[j + 1]?.type === "string") {
            specifiers.push(tokens[j + 1].value);
          }
          break;
        }
      }
      continue;
    }

    // Re-export: `export ... from "..."`
    if (tok.type === "word" && tok.value === "export") {
      const next = tokens[idx + 1];
      if (
        next?.type === "word" &&
        ["function", "const", "let", "var", "class", "interface", "type", "enum", "default", "async"].includes(
          next.value,
        ) &&
        next.value !== "type"
      ) {
        continue;
      }
      let braceDepth = 0;
      for (let j = idx + 1; j < tokens.length; j += 1) {
        const t = tokens[j];
        if (t.type === "punct" && t.value === "{") braceDepth += 1;
        else if (t.type === "punct" && t.value === "}") braceDepth = Math.max(0, braceDepth - 1);
        else if (braceDepth === 0 && t.type === "punct" && t.value === ";") break;
        else if (braceDepth === 0 && t.type === "word" && t.value === "from") {
          if (tokens[j + 1]?.type === "string") {
            specifiers.push(tokens[j + 1].value);
          }
          break;
        }
      }
      continue;
    }

    // CommonJS `require("...")` (ignore property access like `foo.require(...)`)
    if (
      tok.type === "word" &&
      tok.value === "require" &&
      tokens[idx - 1]?.value !== "." &&
      tokens[idx + 1]?.type === "punct" &&
      tokens[idx + 1]?.value === "(" &&
      tokens[idx + 2]?.type === "string"
    ) {
      specifiers.push(tokens[idx + 2].value);
      continue;
    }

    // `Type.Union([ ... Type.Literal(...) ... ])`
    if (
      tok.type === "word" &&
      tok.value === "Type" &&
      tokens[idx + 1]?.value === "." &&
      tokens[idx + 2]?.type === "word" &&
      tokens[idx + 2]?.value === "Union" &&
      tokens[idx + 3]?.value === "(" &&
      tokens[idx + 4]?.value === "["
    ) {
      let bracketDepth = 1;
      for (let j = idx + 5; j < tokens.length && bracketDepth > 0; j += 1) {
        const t = tokens[j];
        if (t.value === "[") bracketDepth += 1;
        else if (t.value === "]") bracketDepth -= 1;
        else if (
          t.type === "word" &&
          t.value === "Type" &&
          tokens[j + 1]?.value === "." &&
          tokens[j + 2]?.type === "word" &&
          tokens[j + 2]?.value === "Literal" &&
          tokens[j + 3]?.value === "("
        ) {
          hasTypeUnionLiteral = true;
          break;
        }
      }
    }
  }

  return { specifiers, hasTypeUnionLiteral };
}

function collectPackageSourceFiles(packageRoot) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "tests") {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (
          SOURCE_EXTENSIONS.has(ext) &&
          !entry.name.endsWith(".d.ts") &&
          !TEST_FILE_RE.test(entry.name)
        ) {
          files.push(fullPath);
        }
      }
    }
  }
  walk(packageRoot);
  return files.sort();
}

function unquoteYamlScalar(raw) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parse top-level YAML frontmatter from a SKILL.md document.
 * @param {string} content
 * @returns {{ ok: boolean, data: Record<string, string>, error?: string }}
 */
function parseSkillFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { ok: false, data: {}, error: "Missing YAML frontmatter opening '---'." };
  }
  const closeIdx = normalized.indexOf("\n---", 4);
  if (closeIdx === -1) {
    return { ok: false, data: {}, error: "Missing YAML frontmatter closing '---'." };
  }

  const yamlBlock = normalized.slice(4, closeIdx);
  const lines = yamlBlock.split("\n");
  const data = {};

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const key = match[1];
    const rest = match[2];

    if (rest === "|" || rest === ">" || rest === "|-" || rest === ">-") {
      const blockLines = [];
      let baseIndent = -1;
      for (let j = i + 1; j < lines.length; j += 1) {
        const nextLine = lines[j];
        if (!nextLine.trim()) {
          blockLines.push("");
          i = j;
          continue;
        }
        const indent = nextLine.match(/^ */)[0].length;
        if (indent === 0) {
          break;
        }
        if (baseIndent === -1) {
          baseIndent = indent;
        }
        blockLines.push(nextLine.slice(Math.min(indent, baseIndent)));
        i = j;
      }
      data[key] = blockLines.join(rest.startsWith(">") ? " " : "\n").trim();
    } else {
      data[key] = unquoteYamlScalar(rest);
    }
  }

  return { ok: true, data };
}

function loadThemeSchema(repoRoot) {
  const candidates = [
    path.join(repoRoot, "node_modules", "@earendil-works", "pi-coding-agent", "schemas", "theme.schema.json"),
    "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/schemas/theme.schema.json",
  ];
  try {
    const req = createRequire(import.meta.url);
    const pkgJson = req.resolve("@earendil-works/pi-coding-agent/package.json");
    candidates.push(path.join(path.dirname(pkgJson), "schemas", "theme.schema.json"));
  } catch {
    // Ignore resolution error
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, "utf8"));
    }
  }
  return null;
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const OK_COLOR_RE = /^ok(?:lch|hsl)\([^)]+\)$/i;

function isConcreteColorValue(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value <= 255;
  }
  if (typeof value === "string") {
    return value === "" || HEX_COLOR_RE.test(value) || OK_COLOR_RE.test(value);
  }
  return false;
}

function validateColorValue(value, vars, visited = new Set()) {
  if (isConcreteColorValue(value)) {
    return null;
  }
  if (typeof value !== "string") {
    return `invalid ColorValue (${typeof value})`;
  }
  if (value.startsWith("#")) {
    return `invalid hex color "${value}"`;
  }
  if (/^ok(?:lch|hsl)/i.test(value)) {
    return `invalid ok(lch|hsl) color "${value}"`;
  }
  if (!vars || !Object.prototype.hasOwnProperty.call(vars, value)) {
    return `unknown color variable reference "${value}"`;
  }
  if (visited.has(value)) {
    return `circular color variable reference "${value}"`;
  }
  const nextVisited = new Set(visited);
  nextVisited.add(value);
  return validateColorValue(vars[value], vars, nextVisited);
}

function validateThemeObject(themeData, schema, relLabel) {
  const errors = [];
  if (!isPlainObject(themeData)) {
    return [`${relLabel}: theme JSON root must be an object`];
  }

  const allowedTopKeys = new Set(Object.keys(schema.properties ?? {}));
  for (const reqKey of schema.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(themeData, reqKey)) {
      errors.push(`${relLabel}: missing required top-level key "${reqKey}"`);
    }
  }
  for (const key of Object.keys(themeData)) {
    if (!allowedTopKeys.has(key)) {
      errors.push(`${relLabel}: unknown top-level key "${key}"`);
    }
  }

  if (themeData.$schema !== undefined && typeof themeData.$schema !== "string") {
    errors.push(`${relLabel}: "$schema" must be a string`);
  }

  if (themeData.name !== undefined) {
    const namePattern = schema.properties?.name?.pattern
      ? new RegExp(schema.properties.name.pattern)
      : /^[^/]+$/;
    if (typeof themeData.name !== "string" || !namePattern.test(themeData.name)) {
      errors.push(`${relLabel}: "name" must match ${namePattern}`);
    } else if (themeData.name === "system") {
      errors.push(`${relLabel}: "name" cannot be "system" (reserved by Pi)`);
    }
  }

  if (
    themeData.appearance !== undefined &&
    themeData.appearance !== "dark" &&
    themeData.appearance !== "light"
  ) {
    errors.push(`${relLabel}: "appearance" must be "dark" or "light"`);
  }

  let vars = {};
  if (themeData.vars !== undefined) {
    if (!isPlainObject(themeData.vars)) {
      errors.push(`${relLabel}: "vars" must be an object`);
    } else {
      vars = themeData.vars;
      for (const [varKey, varVal] of Object.entries(vars)) {
        const err = validateColorValue(varVal, vars);
        if (err) {
          errors.push(`${relLabel}: vars.${varKey}: ${err}`);
        }
      }
    }
  }

  if (themeData.colors !== undefined) {
    if (!isPlainObject(themeData.colors)) {
      errors.push(`${relLabel}: "colors" must be an object`);
    } else {
      const colorProps = schema.properties?.colors?.properties ?? {};
      const requiredColors = schema.properties?.colors?.required ?? [];
      const allowedColors = new Set(Object.keys(colorProps));

      for (const reqColor of requiredColors) {
        if (!Object.prototype.hasOwnProperty.call(themeData.colors, reqColor)) {
          errors.push(`${relLabel}: colors missing required token "${reqColor}"`);
        }
      }
      for (const [colorKey, colorVal] of Object.entries(themeData.colors)) {
        if (!allowedColors.has(colorKey)) {
          errors.push(`${relLabel}: colors contains unknown token "${colorKey}"`);
          continue;
        }
        const err = validateColorValue(colorVal, vars);
        if (err) {
          errors.push(`${relLabel}: colors.${colorKey}: ${err}`);
        }
      }
    }
  }

  if (themeData.export !== undefined) {
    if (!isPlainObject(themeData.export)) {
      errors.push(`${relLabel}: "export" must be an object`);
    } else {
      const allowedExportKeys = new Set(Object.keys(schema.properties?.export?.properties ?? {}));
      for (const [exportKey, exportVal] of Object.entries(themeData.export)) {
        if (!allowedExportKeys.has(exportKey)) {
          errors.push(`${relLabel}: export contains unknown key "${exportKey}"`);
          continue;
        }
        const err = validateColorValue(exportVal, vars);
        if (err) {
          errors.push(`${relLabel}: export.${exportKey}: ${err}`);
        }
      }
    }
  }

  return errors;
}

function isForbiddenFilesEntry(entry) {
  if (typeof entry !== "string") return true;
  const normalized = entry.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  return (
    normalized === "*" ||
    normalized === "tests" ||
    normalized.startsWith("tests/")
  );
}

/**
 * Audit all workspace packages in `repoRoot` against Pi v1.6.0 & catalog rules.
 * @param {string} [repoRoot]
 * @returns {{ ok: boolean, errors: string[], warnings: string[], checkedPackages: number }}
 */
export function auditWorkspace(repoRoot = process.cwd()) {
  const resolvedRoot = path.resolve(repoRoot);
  const errors = [];
  const warnings = [];

  const packages = discoverWorkspacePackages(resolvedRoot);
  let cachedThemeSchema;

  for (const pkg of packages) {
    const prefix = `[${pkg.relDir}]`;
    const { manifest, absDir, dirName, resources } = pkg;

    // 1. package.json metadata rules
    const expectedName = `@local/${dirName}`;
    if (manifest.name !== expectedName) {
      errors.push(`${prefix} package.json "name" must be "${expectedName}", got ${JSON.stringify(manifest.name)}`);
    }
    if (typeof manifest.version !== "string" || !SEMVER_RE.test(manifest.version)) {
      errors.push(`${prefix} package.json "version" must be valid SemVer, got ${JSON.stringify(manifest.version)}`);
    }
    if (manifest.type !== "module") {
      errors.push(`${prefix} package.json "type" must be "module"`);
    }
    if (manifest.license !== "MIT") {
      errors.push(`${prefix} package.json "license" must be "MIT"`);
    }
    if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("pi-package")) {
      errors.push(`${prefix} package.json "keywords" must include "pi-package"`);
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      errors.push(`${prefix} package.json "files" must be a non-empty array`);
    } else {
      for (const fileEntry of manifest.files) {
        if (isForbiddenFilesEntry(fileEntry)) {
          errors.push(`${prefix} package.json "files" must not include "${fileEntry}" (excludes tests/ and "*")`);
        }
      }
    }
    if (typeof manifest.description !== "string" || manifest.description.trim().length === 0) {
      errors.push(`${prefix} package.json "description" must be a non-empty string`);
    }

    // 2. Host package & dependency placement rules
    const deps = isPlainObject(manifest.dependencies) ? manifest.dependencies : {};
    const devDeps = isPlainObject(manifest.devDependencies) ? manifest.devDependencies : {};
    const peerDeps = isPlainObject(manifest.peerDependencies) ? manifest.peerDependencies : {};

    for (const [sectionName, depMap] of [
      ["dependencies", deps],
      ["devDependencies", devDeps],
    ]) {
      for (const depName of Object.keys(depMap)) {
        if (CANONICAL_HOST_PACKAGES.has(depName)) {
          errors.push(`${prefix} host-provided package "${depName}" must not be in ${sectionName} (use peerDependencies: "*")`);
        } else if (isLegacyPackageName(depName)) {
          errors.push(`${prefix} legacy package "${depName}" is forbidden in ${sectionName}`);
        }
      }
    }

    for (const [peerName, peerRange] of Object.entries(peerDeps)) {
      if (isLegacyPackageName(peerName)) {
        errors.push(`${prefix} legacy package "${peerName}" is forbidden in peerDependencies`);
      } else if (CANONICAL_HOST_PACKAGES.has(peerName)) {
        if (peerRange !== "*") {
          errors.push(`${prefix} host-provided peerDependency "${peerName}" must have range "*", got ${JSON.stringify(peerRange)}`);
        }
      } else if (NON_HOST_PI_PACKAGES.has(peerName)) {
        if (!Object.prototype.hasOwnProperty.call(deps, peerName)) {
          errors.push(`${prefix} "${peerName}" is NOT host-provided and cannot be placed in peerDependencies without also declaring it in dependencies`);
        }
      }
    }

    // Check explicit pi.* resource entries do not escape packageRoot or miss files
    if (isPlainObject(manifest.pi)) {
      for (const type of ["extensions", "skills", "prompts", "themes"]) {
        const entries = manifest.pi[type];
        if (entries === undefined) continue;
        if (!Array.isArray(entries)) {
          errors.push(`${prefix} pi.${type} must be an array`);
          continue;
        }
        for (const rawEntry of entries) {
          if (typeof rawEntry !== "string") {
            errors.push(`${prefix} pi.${type} entries must be strings`);
            continue;
          }
          if (rawEntry.startsWith("!") || rawEntry.startsWith("-")) continue;
          const clean = rawEntry.startsWith("+") ? rawEntry.slice(1) : rawEntry;
          const resolvedEntry = path.resolve(absDir, clean);
          if (!isPathInside(absDir, resolvedEntry) && resolvedEntry !== absDir) {
            errors.push(`${prefix} pi.${type} entry "${rawEntry}" escapes package root`);
          } else if (!fs.existsSync(resolvedEntry)) {
            errors.push(`${prefix} pi.${type} entry "${rawEntry}" does not exist`);
          }
        }
      }
    }

    // 3 & 4. Source code import audit & StringEnum check
    const canonicalRoot = canonicalizeExisting(absDir);
    const sourceFiles = collectPackageSourceFiles(absDir);

    for (const filePath of sourceFiles) {
      const relFile = path.relative(absDir, filePath).split(path.sep).join("/");
      const source = fs.readFileSync(filePath, "utf8");
      const { specifiers, hasTypeUnionLiteral } = inspectSourceTokens(source);

      if (hasTypeUnionLiteral && filePath.endsWith(".ts")) {
        errors.push(
          `${prefix} ${relFile}: use StringEnum from "@earendil-works/pi-ai" instead of Type.Union([Type.Literal(...)])`,
        );
      }

      for (const spec of specifiers) {
        if (spec.startsWith(".") || spec.startsWith("/")) {
          if (spec.startsWith("/")) {
            errors.push(`${prefix} ${relFile}: absolute import "${spec}" is forbidden`);
            continue;
          }
          const resolvedImport = path.resolve(path.dirname(filePath), spec);
          if (!isPathInside(absDir, resolvedImport) && resolvedImport !== absDir) {
            errors.push(`${prefix} ${relFile}: relative import "${spec}" escapes package root`);
            continue;
          }
          if (fs.existsSync(resolvedImport)) {
            const canonicalTarget = canonicalizeExisting(resolvedImport);
            if (!isPathInside(canonicalRoot, canonicalTarget) && canonicalTarget !== canonicalRoot) {
              errors.push(`${prefix} ${relFile}: relative import "${spec}" escapes package root via symlink`);
            }
          }
          continue;
        }

        if (spec.startsWith("node:") || isBuiltin(spec)) {
          continue;
        }

        const { pkgName, subpath } = splitPackageSpecifier(spec);

        if (isLegacyPackageName(pkgName)) {
          errors.push(`${prefix} ${relFile}: legacy import "${spec}" is forbidden (use @earendil-works/pi-* or typebox)`);
          continue;
        }

        if (CANONICAL_HOST_PACKAGES.has(pkgName)) {
          if (peerDeps[pkgName] !== "*") {
            errors.push(
              `${prefix} ${relFile}: host package "${pkgName}" imported via "${spec}" must be declared in peerDependencies as "*"`,
            );
            continue;
          }
          const allowedSubpaths = CANONICAL_HOST_PACKAGES.get(pkgName);
          if (!allowedSubpaths.has(subpath)) {
            errors.push(
              `${prefix} ${relFile}: subpath "${subpath}" of host package "${pkgName}" ("${spec}") is not in allowed subpaths`,
            );
          }
          continue;
        }

        if (!Object.prototype.hasOwnProperty.call(deps, pkgName)) {
          errors.push(
            `${prefix} ${relFile}: undeclared/phantom dependency "${pkgName}" imported via "${spec}" (must be in package dependencies)`,
          );
        }
      }
    }

    // 5. Changelog rules
    const piMeta = isPlainObject(manifest.pi) ? manifest.pi : null;
    const rawChangelogPath = piMeta?.changelogPath;
    if (rawChangelogPath !== undefined && typeof rawChangelogPath !== "string") {
      errors.push(`${prefix} pi.changelogPath must be a string`);
    } else if (typeof rawChangelogPath === "string" && rawChangelogPath !== "") {
      const resolvedChangelog = path.resolve(absDir, rawChangelogPath);
      if (!isPathInside(absDir, resolvedChangelog)) {
        errors.push(`${prefix} pi.changelogPath "${rawChangelogPath}" must resolve strictly inside package root`);
      } else if (!fs.existsSync(resolvedChangelog) || !fs.statSync(resolvedChangelog).isFile()) {
        errors.push(`${prefix} pi.changelogPath "${rawChangelogPath}" does not exist`);
      } else {
        const canonicalCl = canonicalizeExisting(resolvedChangelog);
        if (!isPathInside(canonicalRoot, canonicalCl)) {
          errors.push(`${prefix} pi.changelogPath "${rawChangelogPath}" escapes package root via symlink`);
        }
      }
    }

    const changelogDisabled = rawChangelogPath === "";
    const targetChangelogPath = !changelogDisabled
      ? path.resolve(absDir, typeof rawChangelogPath === "string" ? rawChangelogPath : "CHANGELOG.md")
      : null;

    if (resources.extensions.length > 0 && !changelogDisabled) {
      if (!targetChangelogPath || !isPathInside(absDir, targetChangelogPath) || !fs.existsSync(targetChangelogPath)) {
        errors.push(`${prefix} extension packages must include a CHANGELOG.md (or valid pi.changelogPath) inside package root`);
      }
    }

    if (
      targetChangelogPath &&
      isPathInside(absDir, targetChangelogPath) &&
      fs.existsSync(targetChangelogPath) &&
      fs.statSync(targetChangelogPath).isFile()
    ) {
      const changelogText = fs.readFileSync(targetChangelogPath, "utf8");
      if (/^\s*##\s+v\d+\.\d+\.\d+/m.test(changelogText)) {
        errors.push(`${prefix} changelog heading must not start with "v" (use "## [0.1.0]" or "## 0.1.0 - YYYY-MM-DD", not "## v0.1.0")`);
      }
      if (!/^##\s+\[?\d+\.\d+\.\d+\]?/m.test(changelogText)) {
        errors.push(`${prefix} changelog must contain at least one heading matching "## [X.Y.Z]" or "## X.Y.Z"`);
      }
    }

    // 6. Skill frontmatter validation
    for (const relSkill of resources.skills) {
      if (path.basename(relSkill) !== "SKILL.md") {
        continue;
      }
      const skillPath = path.join(absDir, relSkill);
      const skillText = fs.readFileSync(skillPath, "utf8");
      const parsed = parseSkillFrontmatter(skillText);
      if (!parsed.ok) {
        errors.push(`${prefix} ${relSkill}: ${parsed.error}`);
        continue;
      }
      const { name, description } = parsed.data;
      if (typeof description !== "string" || description.trim().length === 0) {
        errors.push(`${prefix} ${relSkill}: frontmatter requires a non-empty "description"`);
      } else if (description.length > 1024) {
        errors.push(`${prefix} ${relSkill}: frontmatter "description" exceeds 1024 characters (${description.length})`);
      }

      if (name !== undefined) {
        if (
          name.length === 0 ||
          name.length > 64 ||
          !/^[a-z0-9-]+$/.test(name) ||
          name.startsWith("-") ||
          name.endsWith("-") ||
          name.includes("--")
        ) {
          errors.push(
            `${prefix} ${relSkill}: frontmatter "name" (${JSON.stringify(name)}) must be 1..64 chars matching /^[a-z0-9-]+$/ without leading/trailing "-" or "--"`,
          );
        }
      }
    }

    // 7. Theme schema validation
    if (resources.themes.length > 0) {
      if (cachedThemeSchema === undefined) {
        cachedThemeSchema = loadThemeSchema(resolvedRoot);
      }
      if (!cachedThemeSchema) {
        errors.push(`${prefix} unable to locate Pi theme.schema.json to validate theme files`);
      } else {
        for (const relTheme of resources.themes) {
          const themePath = path.join(absDir, relTheme);
          let themeJson;
          try {
            themeJson = JSON.parse(fs.readFileSync(themePath, "utf8"));
          } catch (err) {
            errors.push(`${prefix} ${relTheme}: invalid JSON (${err.message})`);
            continue;
          }
          const themeErrors = validateThemeObject(themeJson, cachedThemeSchema, `${prefix} ${relTheme}`);
          errors.push(...themeErrors);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checkedPackages: packages.length,
  };
}

function isExecutedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return (
      import.meta.url === pathToFileURL(process.argv[1]).href ||
      import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  const args = process.argv.slice(2);
  let rootDir = process.cwd();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--root" && args[i + 1]) {
      rootDir = path.resolve(args[i + 1]);
      i += 1;
    }
  }

  const result = auditWorkspace(rootDir);
  for (const warn of result.warnings) {
    console.warn(`WARN: ${warn}`);
  }
  for (const err of result.errors) {
    console.error(`ERROR: ${err}`);
  }

  if (result.ok) {
    console.log(`Audit passed (${result.checkedPackages} package(s) checked).`);
    process.exit(0);
  } else {
    console.error(`Audit failed with ${result.errors.length} error(s) across ${result.checkedPackages} package(s).`);
    process.exit(1);
  }
}
