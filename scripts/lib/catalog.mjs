import fs from "node:fs";
import path from "node:path";

export const CATALOG_START_MARKER = "<!-- pi-catalog:start -->";
export const CATALOG_END_MARKER = "<!-- pi-catalog:end -->";

const RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"];

function toPosix(relPath) {
  return relPath.split(path.sep).join("/");
}

function asciiSort(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPathInsideOrEqual(parentDir, targetPath) {
  const rel = path.relative(parentDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function collectSkillFilesInDir(dir, includeTopLevelMd = false) {
  const results = [];
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return results;
  }

  function walk(currentDir, depth) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    const skillEntry = entries.find((entry) => entry.isFile() && entry.name === "SKILL.md");
    if (skillEntry) {
      results.push(path.join(currentDir, skillEntry.name));
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (includeTopLevelMd && depth === 0 && entry.isFile() && entry.name.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }

  walk(dir, 0);
  return results;
}

function collectExtensionFilesInDir(dir) {
  const results = [];
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return results;
  }

  const rootIndexTs = path.join(dir, "index.ts");
  const rootIndexJs = path.join(dir, "index.js");
  if (fs.existsSync(rootIndexTs) && fs.statSync(rootIndexTs).isFile()) {
    return [rootIndexTs];
  }
  if (fs.existsSync(rootIndexJs) && fs.statSync(rootIndexJs).isFile()) {
    return [rootIndexJs];
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) && !entry.name.endsWith(".d.ts")) {
      results.push(fullPath);
    } else if (entry.isDirectory()) {
      const subIndexTs = path.join(fullPath, "index.ts");
      const subIndexJs = path.join(fullPath, "index.js");
      if (fs.existsSync(subIndexTs) && fs.statSync(subIndexTs).isFile()) {
        results.push(subIndexTs);
      } else if (fs.existsSync(subIndexJs) && fs.statSync(subIndexJs).isFile()) {
        results.push(subIndexJs);
      }
    }
  }

  return results;
}

function collectMatchingFilesInDir(dir, extension) {
  const results = [];
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return results;
  }

  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

function resolveDeclaredEntries(pkgRoot, entries, resourceType) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const found = new Set();
  for (const rawEntry of entries) {
    if (typeof rawEntry !== "string") {
      continue;
    }
    if (rawEntry.startsWith("!") || rawEntry.startsWith("-")) {
      continue;
    }
    const normalized = rawEntry.startsWith("+") ? rawEntry.slice(1) : rawEntry;
    const resolved = path.resolve(pkgRoot, normalized);
    if (!isPathInsideOrEqual(pkgRoot, resolved) || !fs.existsSync(resolved)) {
      continue;
    }

    const stat = fs.statSync(resolved);
    if (stat.isFile()) {
      found.add(toPosix(path.relative(pkgRoot, resolved)));
    } else if (stat.isDirectory()) {
      let children = [];
      if (resourceType === "extensions") {
        children = collectExtensionFilesInDir(resolved);
      } else if (resourceType === "skills") {
        children = collectSkillFilesInDir(resolved, true);
      } else if (resourceType === "prompts") {
        children = collectMatchingFilesInDir(resolved, ".md");
      } else if (resourceType === "themes") {
        children = collectMatchingFilesInDir(resolved, ".json");
      }
      for (const child of children) {
        found.add(toPosix(path.relative(pkgRoot, child)));
      }
    }
  }

  return Array.from(found).sort(asciiSort);
}

/**
 * Discover Pi resources for a package following Pi's manifest-vs-convention rule (R1).
 * @param {string} pkgRoot
 * @param {Record<string, unknown>} manifest
 * @returns {{
 *   explicitManifest: boolean,
 *   extensions: string[],
 *   skills: string[],
 *   prompts: string[],
 *   themes: string[],
 * }}
 */
export function discoverPackageResources(pkgRoot, manifest) {
  const piManifest =
    manifest && typeof manifest.pi === "object" && manifest.pi !== null
      ? manifest.pi
      : null;

  const explicitManifest = Boolean(
    piManifest && RESOURCE_TYPES.some((type) => piManifest[type] !== undefined),
  );

  if (explicitManifest) {
    return {
      explicitManifest: true,
      extensions: resolveDeclaredEntries(pkgRoot, piManifest.extensions, "extensions"),
      skills: resolveDeclaredEntries(pkgRoot, piManifest.skills, "skills"),
      prompts: resolveDeclaredEntries(pkgRoot, piManifest.prompts, "prompts"),
      themes: resolveDeclaredEntries(pkgRoot, piManifest.themes, "themes"),
    };
  }

  return {
    explicitManifest: false,
    extensions: collectExtensionFilesInDir(path.join(pkgRoot, "extensions"))
      .map((p) => toPosix(path.relative(pkgRoot, p)))
      .sort(asciiSort),
    skills: collectSkillFilesInDir(path.join(pkgRoot, "skills"), true)
      .map((p) => toPosix(path.relative(pkgRoot, p)))
      .sort(asciiSort),
    prompts: collectMatchingFilesInDir(path.join(pkgRoot, "prompts"), ".md")
      .map((p) => toPosix(path.relative(pkgRoot, p)))
      .sort(asciiSort),
    themes: collectMatchingFilesInDir(path.join(pkgRoot, "themes"), ".json")
      .map((p) => toPosix(path.relative(pkgRoot, p)))
      .sort(asciiSort),
  };
}

function expandWorkspacePattern(repoRoot, pattern) {
  const cleanPattern = pattern.replace(/\/+$/, "");
  if (cleanPattern.endsWith("/*")) {
    const baseRel = cleanPattern.slice(0, -2);
    const baseAbs = path.resolve(repoRoot, baseRel);
    if (!fs.existsSync(baseAbs) || !fs.statSync(baseAbs).isDirectory()) {
      return [];
    }
    const dirs = [];
    for (const entry of fs.readdirSync(baseAbs, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      const absDir = path.join(baseAbs, entry.name);
      if (fs.existsSync(path.join(absDir, "package.json"))) {
        dirs.push(absDir);
      }
    }
    return dirs;
  }

  const literalAbs = path.resolve(repoRoot, cleanPattern);
  if (
    fs.existsSync(literalAbs) &&
    fs.statSync(literalAbs).isDirectory() &&
    fs.existsSync(path.join(literalAbs, "package.json"))
  ) {
    return [literalAbs];
  }
  return [];
}

/**
 * Discover all workspace packages defined in root `package.json`.
 * @param {string} [repoRoot]
 * @returns {Array<{
 *   dirName: string,
 *   relDir: string,
 *   absDir: string,
 *   pkgJsonPath: string,
 *   manifest: Record<string, unknown>,
 *   resources: ReturnType<typeof discoverPackageResources>,
 * }>}
 */
export function discoverWorkspacePackages(repoRoot = process.cwd()) {
  const rootPkgPath = path.join(repoRoot, "package.json");
  const rootManifest = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
  const workspacePatterns = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : Array.isArray(rootManifest.workspaces?.packages)
      ? rootManifest.workspaces.packages
      : [];

  const seenAbsDirs = new Set();
  const packages = [];

  for (const pattern of workspacePatterns) {
    if (typeof pattern !== "string" || pattern.startsWith("!")) {
      continue;
    }
    for (const absDir of expandWorkspacePattern(repoRoot, pattern)) {
      if (seenAbsDirs.has(absDir)) {
        continue;
      }
      seenAbsDirs.add(absDir);

      const pkgJsonPath = path.join(absDir, "package.json");
      const manifest = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
      const dirName = path.basename(absDir);
      const relDir = toPosix(path.relative(repoRoot, absDir));
      const resources = discoverPackageResources(absDir, manifest);

      packages.push({
        dirName,
        relDir,
        absDir,
        pkgJsonPath,
        manifest,
        resources,
      });
    }
  }

  return packages.sort((a, b) => asciiSort(a.dirName, b.dirName));
}

function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function formatResourcesSummary(resources) {
  const parts = [];
  for (const type of RESOURCE_TYPES) {
    const count = resources[type]?.length ?? 0;
    if (count > 0) {
      parts.push(`${type} (${count})`);
    }
  }
  return parts.length > 0 ? parts.join(", ") : "none";
}

/**
 * Render the Markdown catalog table for README.md or docs/catalog.md.
 * @param {ReturnType<typeof discoverWorkspacePackages>} packages
 * @param {string} [linkPrefix]
 * @returns {string}
 */
export function renderReadmeCatalogSection(packages, linkPrefix = ".") {
  if (packages.length === 0) {
    return "_No packages in catalog yet._";
  }

  const lines = [
    "| Package | Dir | Version | Resources | Description | Local Install |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const pkg of packages) {
    const name = `\`${escapeMarkdownCell(pkg.manifest.name ?? pkg.dirName)}\``;
    const dir = `[\`${pkg.relDir}\`](${linkPrefix}/${pkg.relDir})`;
    const version = escapeMarkdownCell(pkg.manifest.version ?? "0.0.0");
    const resources = escapeMarkdownCell(formatResourcesSummary(pkg.resources));
    const description = escapeMarkdownCell(pkg.manifest.description ?? "");
    const install = `\`pi install ./${pkg.relDir}\``;
    lines.push(`| ${name} | ${dir} | ${version} | ${resources} | ${description} | ${install} |`);
  }

  return lines.join("\n");
}

/**
 * Render the full `docs/catalog.md` document.
 * @param {ReturnType<typeof discoverWorkspacePackages>} packages
 * @returns {string}
 */
export function renderCatalogDoc(packages) {
  const lines = [
    "# Pi Package Catalog",
    "",
    `Total packages: **${packages.length}**`,
    "",
  ];

  if (packages.length === 0) {
    lines.push("_No packages in catalog yet._", "");
    return lines.join("\n");
  }

  lines.push(renderReadmeCatalogSection(packages, ".."), "", "## Package Details", "");

  for (const pkg of packages) {
    const pkgName = String(pkg.manifest.name ?? pkg.dirName);
    const version = String(pkg.manifest.version ?? "0.0.0");
    const description = String(pkg.manifest.description ?? "").trim();

    lines.push(`### ${pkgName} (\`v${version}\`)`, "");
    if (description) {
      lines.push(description, "");
    }
    lines.push(`- **Directory:** \`${pkg.relDir}\``);
    lines.push(`- **Local Install:** \`pi install ./${pkg.relDir}\``);

    for (const type of RESOURCE_TYPES) {
      const items = pkg.resources[type] ?? [];
      if (items.length > 0) {
        lines.push(`- **${type}:** ${items.map((item) => `\`${item}\``).join(", ")}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Replace the content strictly between `CATALOG_START_MARKER` and `CATALOG_END_MARKER`.
 * @param {string} readmeText
 * @param {string} renderedSection
 * @returns {string}
 */
export function replaceCatalogMarkers(readmeText, renderedSection) {
  const startIdx = readmeText.indexOf(CATALOG_START_MARKER);
  const endIdx = readmeText.indexOf(CATALOG_END_MARKER);

  if (startIdx === -1) {
    throw new Error(`Missing catalog start marker: ${CATALOG_START_MARKER}`);
  }
  if (endIdx === -1) {
    throw new Error(`Missing catalog end marker: ${CATALOG_END_MARKER}`);
  }
  if (readmeText.indexOf(CATALOG_START_MARKER, startIdx + CATALOG_START_MARKER.length) !== -1) {
    throw new Error(`Duplicate catalog start marker: ${CATALOG_START_MARKER}`);
  }
  if (readmeText.indexOf(CATALOG_END_MARKER, endIdx + CATALOG_END_MARKER.length) !== -1) {
    throw new Error(`Duplicate catalog end marker: ${CATALOG_END_MARKER}`);
  }
  if (endIdx < startIdx) {
    throw new Error("Catalog end marker appears before start marker.");
  }

  const before = readmeText.slice(0, startIdx + CATALOG_START_MARKER.length);
  const after = readmeText.slice(endIdx);
  return `${before}\n${renderedSection.trim()}\n${after}`;
}
