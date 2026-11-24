#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VALID_PACKAGE_TYPES = ["extension", "skill", "prompt", "theme"];
const SLUG_RE = /^[a-z0-9-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SLUG_LENGTH = 50;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_ROOT = path.resolve(SCRIPT_DIR, "..", "templates", "package");

/**
 * Normalize and validate a package name into a `<slug>`, directory name, and npm package name.
 * @param {string} rawName
 * @param {string} type
 * @returns {{ slug: string, dirName: string, packageName: string }}
 */
export function normalizePackageSlug(rawName, type) {
  if (typeof rawName !== "string" || rawName.length === 0) {
    throw new Error('Option "--name" must be a non-empty string.');
  }
  if (rawName !== rawName.trim()) {
    throw new Error(`Invalid package name ${JSON.stringify(rawName)}: leading or trailing whitespace is not allowed.`);
  }

  const slug = rawName.startsWith("pi-") ? rawName.slice(3) : rawName;

  if (slug.length === 0) {
    throw new Error(`Invalid package name ${JSON.stringify(rawName)}: slug after stripping "pi-" cannot be empty.`);
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    throw new Error(`Invalid slug ${JSON.stringify(slug)}: must be at most ${MAX_SLUG_LENGTH} characters (got ${slug.length}).`);
  }
  if (!SLUG_RE.test(slug) || slug.startsWith("-") || slug.endsWith("-") || slug.includes("--")) {
    throw new Error(
      `Invalid slug ${JSON.stringify(slug)}: must match /^[a-z0-9-]+$/ without leading/trailing "-" or "--".`,
    );
  }
  if (type === "theme" && slug === "system") {
    throw new Error('Theme slug "system" is reserved by Pi and cannot be used.');
  }

  const dirName = `pi-${slug}`;
  return {
    slug,
    dirName,
    packageName: `@local/${dirName}`,
  };
}

function collectTemplateFiles(dirPath, relPrefix = "") {
  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const absPath = path.join(dirPath, entry.name);
    const relPath = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectTemplateFiles(absPath, relPath));
    } else if (entry.isFile() && entry.name.endsWith(".tmpl")) {
      results.push({ absPath, relPath });
    }
  }
  return results;
}

function replaceTokens(text, tokens) {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : match,
  );
}

function escapeJsonStringInner(value) {
  return JSON.stringify(value).slice(1, -1);
}

function renderTemplateContent(rawContent, outputRelPath, baseTokens) {
  const ext = path.extname(outputRelPath).toLowerCase();
  if (ext === ".json" || ext === ".ts") {
    return replaceTokens(rawContent, {
      ...baseTokens,
      DESCRIPTION: escapeJsonStringInner(baseTokens.DESCRIPTION),
    });
  }

  if (ext === ".md") {
    const singleLineDesc = baseTokens.DESCRIPTION.replace(/\r?\n/g, " ").replace(/"/g, "'");
    const lines = rawContent.split("\n");
    if (lines[0] === "---") {
      const closingIdx = lines.indexOf("---", 1);
      if (closingIdx !== -1) {
        const frontmatter = lines
          .slice(0, closingIdx + 1)
          .map((line) => replaceTokens(line, { ...baseTokens, DESCRIPTION: singleLineDesc }));
        const body = lines.slice(closingIdx + 1).map((line) => replaceTokens(line, baseTokens));
        return [...frontmatter, ...body].join("\n");
      }
    }
  }

  return replaceTokens(rawContent, baseTokens);
}

/**
 * Scaffold a new Pi catalog package from `templates/package/<type>/`.
 * @param {{
 *   name: string,
 *   type: "extension" | "skill" | "prompt" | "theme",
 *   description?: string,
 *   outDir?: string,
 *   date?: string,
 * }} options
 * @returns {{
 *   slug: string,
 *   dirName: string,
 *   packageName: string,
 *   type: "extension" | "skill" | "prompt" | "theme",
 *   targetDir: string,
 *   filesWritten: string[],
 * }}
 */
export function scaffoldPackage(options) {
  if (!options || typeof options !== "object") {
    throw new Error("scaffoldPackage options object is required.");
  }

  const { name, type, description, outDir = "packages", date } = options;

  if (!VALID_PACKAGE_TYPES.includes(type)) {
    throw new Error(
      `Invalid package type ${JSON.stringify(type)}: expected one of ${VALID_PACKAGE_TYPES.join(", ")}.`,
    );
  }

  const { slug, dirName, packageName } = normalizePackageSlug(name, type);

  let resolvedDescription;
  if (description === undefined) {
    resolvedDescription = `Starter Pi ${type} package for ${slug}.`;
  } else if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error('Option "--description" must be a non-empty string.');
  } else {
    resolvedDescription = description.trim();
  }

  if (type === "skill" && resolvedDescription.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    throw new Error(
      `Skill description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters (${resolvedDescription.length}).`,
    );
  }

  const resolvedDate = date ?? new Date().toISOString().slice(0, 10);
  if (typeof resolvedDate !== "string" || !DATE_RE.test(resolvedDate)) {
    throw new Error(`Invalid date ${JSON.stringify(resolvedDate)}: expected YYYY-MM-DD.`);
  }

  if (typeof outDir !== "string" || outDir.trim().length === 0) {
    throw new Error('Option "--out-dir" must be a non-empty directory path.');
  }
  const resolvedOutDir = path.resolve(outDir);
  const targetDir = path.join(resolvedOutDir, dirName);

  if (fs.existsSync(targetDir)) {
    throw new Error(`Target directory already exists and will not be overwritten: ${targetDir}`);
  }

  const templateDir = path.join(TEMPLATES_ROOT, type);
  if (!fs.existsSync(templateDir) || !fs.statSync(templateDir).isDirectory()) {
    throw new Error(`Missing template directory for type "${type}": ${templateDir}`);
  }

  const tokens = {
    DIR_NAME: dirName,
    PACKAGE_NAME: packageName,
    SLUG: slug,
    TOOL_NAME: slug.replace(/-/g, "_"),
    CMD_NAME: slug,
    FLAG_NAME: slug,
    DESCRIPTION: resolvedDescription,
    DATE: resolvedDate,
  };

  const templateFiles = collectTemplateFiles(templateDir);
  const filesWritten = [];

  for (const templateFile of templateFiles) {
    const strippedRelPath = templateFile.relPath.slice(0, -".tmpl".length);
    const renderedRelPath = replaceTokens(strippedRelPath, tokens);
    const outputAbsPath = path.join(targetDir, renderedRelPath);
    const rawContent = fs.readFileSync(templateFile.absPath, "utf8");
    const renderedContent = renderTemplateContent(rawContent, renderedRelPath, tokens);

    fs.mkdirSync(path.dirname(outputAbsPath), { recursive: true });
    fs.writeFileSync(outputAbsPath, renderedContent, "utf8");
    filesWritten.push(renderedRelPath.split(path.sep).join("/"));
  }

  filesWritten.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    slug,
    dirName,
    packageName,
    type,
    targetDir,
    filesWritten,
  };
}

function formatHelpText() {
  return [
    "Usage: node scripts/new-package.mjs --name <name> --type <type> [options]",
    "",
    "Options:",
    "  --name <name>           Package name or slug (optional leading 'pi-' is stripped)",
    "  --type <type>           One of: extension | skill | prompt | theme",
    "  --description <text>    Non-empty package description",
    "  --out-dir <dir>         Output directory (default: packages)",
    "  --date <YYYY-MM-DD>     Changelog date override (default: today UTC)",
    "  --help, -h              Show this help message",
  ].join("\n");
}

function parseCliArgs(argv) {
  const parsed = {
    help: false,
    name: undefined,
    type: undefined,
    description: undefined,
    outDir: undefined,
    date: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    const eqIdx = arg.indexOf("=");
    const flag = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;
    const inlineValue = eqIdx !== -1 ? arg.slice(eqIdx + 1) : undefined;

    const readValue = () => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      if (i + 1 >= argv.length) {
        throw new Error(`Missing value for option "${flag}".`);
      }
      i += 1;
      return argv[i];
    };

    if (flag === "--name") {
      parsed.name = readValue();
    } else if (flag === "--type") {
      parsed.type = readValue();
    } else if (flag === "--description") {
      parsed.description = readValue();
    } else if (flag === "--out-dir") {
      parsed.outDir = readValue();
    } else if (flag === "--date") {
      parsed.date = readValue();
    } else {
      throw new Error(`Unknown CLI option "${arg}". Use --help for usage.`);
    }
  }

  return parsed;
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
  try {
    const cli = parseCliArgs(process.argv.slice(2));
    if (cli.help) {
      console.log(formatHelpText());
      process.exit(0);
    }

    if (!cli.name) {
      throw new Error('Missing required option "--name <name>". Use --help for usage.');
    }
    if (!cli.type) {
      throw new Error('Missing required option "--type <extension|skill|prompt|theme>". Use --help for usage.');
    }

    const result = scaffoldPackage({
      name: cli.name,
      type: cli.type,
      description: cli.description,
      outDir: cli.outDir,
      date: cli.date,
    });

    console.log(`Created ${result.type} package ${result.packageName} at ${result.targetDir}`);
    for (const relFile of result.filesWritten) {
      console.log(`  - ${relFile}`);
    }
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
