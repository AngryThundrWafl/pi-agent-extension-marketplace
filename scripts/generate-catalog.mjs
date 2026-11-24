#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  discoverWorkspacePackages,
  renderCatalogDoc,
  renderReadmeCatalogSection,
  replaceCatalogMarkers,
} from "./lib/catalog.mjs";

const VALID_MODES = new Set(["list", "generate", "check"]);

const LEAKED_PATH_PATTERNS = [
  { label: "/home/", regex: /\/home\// },
  { label: "/Users/", regex: /\/Users\// },
  { label: "/tmp/", regex: /\/tmp\// },
  { label: "/var/folders/", regex: /\/var\/folders\// },
  { label: "C:\\Users\\", regex: /C:\\Users\\/i },
];

function ensureTrailingNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function findLeakedLocalPaths(targetName, content) {
  const errors = [];
  for (const { label, regex } of LEAKED_PATH_PATTERNS) {
    if (regex.test(content)) {
      errors.push(
        `Leaked machine-local path (${label}) detected in generated ${targetName}.`,
      );
    }
  }
  return errors;
}

function summarizePackage(pkg) {
  const piCatalog =
    pkg.manifest.piCatalog && typeof pkg.manifest.piCatalog === "object"
      ? pkg.manifest.piCatalog
      : {};

  const name = String(pkg.manifest.name ?? pkg.dirName);
  const version = String(pkg.manifest.version ?? "0.0.0");
  const category =
    typeof piCatalog.category === "string" && piCatalog.category.trim().length > 0
      ? piCatalog.category.trim()
      : "uncategorized";
  const status =
    typeof piCatalog.status === "string" && piCatalog.status.trim().length > 0
      ? piCatalog.status.trim()
      : "unspecified";
  const description = String(pkg.manifest.description ?? "")
    .replace(/\r?\n/g, " ")
    .trim();

  const resources = {
    extensions: pkg.resources.extensions.length,
    skills: pkg.resources.skills.length,
    prompts: pkg.resources.prompts.length,
    themes: pkg.resources.themes.length,
  };

  return {
    dirName: pkg.dirName,
    relDir: pkg.relDir,
    name,
    version,
    category,
    status,
    resources,
    description,
  };
}

function formatListOutput(entries) {
  if (entries.length === 0) {
    return "No workspace packages found.";
  }

  return entries
    .map((entry) => {
      const resourceSummary =
        `extensions=${entry.resources.extensions}, ` +
        `skills=${entry.resources.skills}, ` +
        `prompts=${entry.resources.prompts}, ` +
        `themes=${entry.resources.themes}`;
      const descPart = entry.description || "(no description)";
      return (
        `${entry.dirName} | ${entry.name}@${entry.version} | ` +
        `category=${entry.category} | status=${entry.status} | ` +
        `resources: ${resourceSummary} | ${descPart}`
      );
    })
    .join("\n");
}

function renderCatalogArtifacts(resolvedRoot) {
  const errors = [];
  const readmePath = path.join(resolvedRoot, "README.md");
  const catalogDocPath = path.join(resolvedRoot, "docs", "catalog.md");

  if (!fs.existsSync(readmePath)) {
    errors.push(`Missing README.md at ${path.relative(resolvedRoot, readmePath) || "README.md"}.`);
    return { ok: false, errors };
  }

  const packages = discoverWorkspacePackages(resolvedRoot);
  const readmeText = fs.readFileSync(readmePath, "utf8");

  let expectedReadme;
  try {
    const renderedSection = renderReadmeCatalogSection(packages);
    expectedReadme = ensureTrailingNewline(
      replaceCatalogMarkers(readmeText, renderedSection),
    );
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { ok: false, errors };
  }

  const expectedCatalogDoc = ensureTrailingNewline(renderCatalogDoc(packages));

  errors.push(...findLeakedLocalPaths("README.md", expectedReadme));
  errors.push(...findLeakedLocalPaths("docs/catalog.md", expectedCatalogDoc));

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    packageCount: packages.length,
    readmePath,
    catalogDocPath,
    expectedReadme,
    expectedCatalogDoc,
  };
}

/**
 * Run catalog listing, generation, or freshness checking for a workspace root.
 * @param {{ rootDir?: string, mode?: "list" | "generate" | "check" }} [options]
 * @returns {{
 *   ok: boolean,
 *   mode: "list" | "generate" | "check",
 *   errors: string[],
 *   packageCount: number,
 *   packages?: Array<ReturnType<typeof summarizePackage>>,
 *   output?: string,
 * }}
 */
export function runCatalog({ rootDir = process.cwd(), mode = "generate" } = {}) {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Invalid catalog mode "${mode}". Expected "list", "generate", or "check".`);
  }

  const resolvedRoot = path.resolve(rootDir);

  if (mode === "list") {
    const packages = discoverWorkspacePackages(resolvedRoot);
    const entries = packages.map(summarizePackage);
    return {
      ok: true,
      mode: "list",
      errors: [],
      packageCount: entries.length,
      packages: entries,
      output: formatListOutput(entries),
    };
  }

  const rendered = renderCatalogArtifacts(resolvedRoot);
  if (!rendered.ok) {
    return {
      ok: false,
      mode,
      errors: rendered.errors,
      packageCount: 0,
    };
  }

  if (mode === "generate") {
    fs.mkdirSync(path.dirname(rendered.catalogDocPath), { recursive: true });
    fs.writeFileSync(rendered.readmePath, rendered.expectedReadme, "utf8");
    fs.writeFileSync(rendered.catalogDocPath, rendered.expectedCatalogDoc, "utf8");
    return {
      ok: true,
      mode: "generate",
      errors: [],
      packageCount: rendered.packageCount,
    };
  }

  // mode === "check"
  const checkErrors = [];
  const actualReadmeBytes = fs.readFileSync(rendered.readmePath);
  const expectedReadmeBytes = Buffer.from(rendered.expectedReadme, "utf8");
  if (Buffer.compare(actualReadmeBytes, expectedReadmeBytes) !== 0) {
    checkErrors.push(
      "README.md catalog section is out of date. Run `npm run catalog:generate` to update it.",
    );
  }

  if (!fs.existsSync(rendered.catalogDocPath)) {
    checkErrors.push(
      "docs/catalog.md is missing. Run `npm run catalog:generate` to create it.",
    );
  } else {
    const actualCatalogBytes = fs.readFileSync(rendered.catalogDocPath);
    const expectedCatalogBytes = Buffer.from(rendered.expectedCatalogDoc, "utf8");
    if (Buffer.compare(actualCatalogBytes, expectedCatalogBytes) !== 0) {
      checkErrors.push(
        "docs/catalog.md is out of date. Run `npm run catalog:generate` to update it.",
      );
    }
  }

  return {
    ok: checkErrors.length === 0,
    mode: "check",
    errors: checkErrors,
    packageCount: rendered.packageCount,
  };
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/generate-catalog.mjs [options]",
      "",
      "Options:",
      "  --list         Print a deterministic summary of workspace packages",
      "  --check        Verify README.md and docs/catalog.md are up to date (default: generate)",
      "  --root <dir>   Target repository root directory (default: current working directory)",
      "  --help, -h     Show this help message",
    ].join("\n"),
  );
}

function parseCliArgs(argv) {
  let mode = null;
  let rootDir = process.cwd();
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--list") {
      if (mode !== null && mode !== "list") {
        throw new Error(`Conflicting mode flags: "--${mode}" and "--list".`);
      }
      mode = "list";
    } else if (arg === "--check") {
      if (mode !== null && mode !== "check") {
        throw new Error(`Conflicting mode flags: "--${mode}" and "--check".`);
      }
      mode = "check";
    } else if (arg === "--generate") {
      if (mode !== null && mode !== "generate") {
        throw new Error(`Conflicting mode flags: "--${mode}" and "--generate".`);
      }
      mode = "generate";
    } else if (arg === "--root") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error('Option "--root" requires a directory argument.');
      }
      rootDir = path.resolve(next);
      i += 1;
    } else if (arg.startsWith("--root=")) {
      const value = arg.slice("--root=".length);
      if (!value) {
        throw new Error('Option "--root=" requires a non-empty directory.');
      }
      rootDir = path.resolve(value);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    help,
    mode: mode ?? "generate",
    rootDir,
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
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (parsed.help) {
    printHelp();
    process.exit(0);
  }

  let result;
  try {
    result = runCatalog({ rootDir: parsed.rootDir, mode: parsed.mode });
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`ERROR: ${err}`);
    }
    process.exit(1);
  }

  if (result.mode === "list") {
    console.log(result.output);
  } else if (result.mode === "generate") {
    console.log(`Generated README.md and docs/catalog.md (${result.packageCount} package(s)).`);
  } else if (result.mode === "check") {
    console.log(`Catalog check passed (${result.packageCount} package(s)).`);
  }
  process.exit(0);
}
