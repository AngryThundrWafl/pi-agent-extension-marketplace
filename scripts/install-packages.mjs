#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { discoverWorkspacePackages } from "./lib/catalog.mjs";
import { resolvePiBin } from "./lib/pi-sandbox.mjs";

export const VALID_PROFILES = ["extension", "skill", "prompt", "theme", "core"];

const HELP_TEXT = `Usage: node scripts/install-packages.mjs [options] [package...]

Install or remove catalog workspace packages into Pi via "pi install" / "pi remove".

Selectors (at least one required):
  --all                    Select all workspace packages
  --profile <name>         Select packages by profile (repeatable):
                             extension | skill | prompt | theme | core
  <package...>             Positional package dirName, packages/<dir>, or manifest name

Options:
  -l, --local              Pass --local to Pi (.pi/settings.json)
  -a, --approve            Pass --approve to Pi (trust project-local config)
  --remove                 Run "pi remove" instead of "pi install"
  --dry-run                Print exact pi commands and exit 0 without spawning Pi
  --root <dir>             Workspace root directory (default: current working directory)
  -h, --help               Show this help text
`;

function normalizePackageSelector(raw) {
  return raw
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function matchesProfile(pkg, profile, allPackages) {
  if (profile === "extension") {
    return pkg.resources.extensions.length > 0;
  }
  if (profile === "skill") {
    return pkg.resources.skills.length > 0;
  }
  if (profile === "prompt") {
    return pkg.resources.prompts.length > 0;
  }
  if (profile === "theme") {
    return pkg.resources.themes.length > 0;
  }
  if (profile === "core") {
    const isTaggedCore = (candidate) =>
      (Array.isArray(candidate.manifest?.piCatalog?.profiles) &&
        candidate.manifest.piCatalog.profiles.includes("core")) ||
      candidate.manifest?.pi?.profile === "core" ||
      (Array.isArray(candidate.manifest?.keywords) &&
        candidate.manifest.keywords.includes("core"));
    const hasExplicitCore = allPackages.some(isTaggedCore);
    if (hasExplicitCore) {
      return isTaggedCore(pkg);
    }
    return (
      pkg.resources.extensions.length > 0 ||
      pkg.resources.skills.length > 0 ||
      pkg.resources.prompts.length > 0
    );
  }
  return false;
}

/**
 * Parse CLI arguments for `install-packages.mjs`.
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
  let all = false;
  const profiles = [];
  const positional = [];
  let local = false;
  let approve = false;
  let remove = false;
  let dryRun = false;
  let help = false;
  let rootDir = process.cwd();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "-l" || arg === "--local") {
      local = true;
    } else if (arg === "-a" || arg === "--approve") {
      approve = true;
    } else if (arg === "--remove") {
      remove = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--profile") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --profile.");
      }
      profiles.push(value);
      i += 1;
    } else if (arg.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length);
      if (!value) {
        throw new Error("Missing value for --profile.");
      }
      profiles.push(value);
    } else if (arg === "--root") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --root.");
      }
      rootDir = path.resolve(value);
      i += 1;
    } else if (arg.startsWith("--root=")) {
      const value = arg.slice("--root=".length);
      if (!value) {
        throw new Error("Missing value for --root.");
      }
      rootDir = path.resolve(value);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  for (const profile of profiles) {
    if (!VALID_PROFILES.includes(profile)) {
      throw new Error(
        `Invalid profile "${profile}". Expected one of: ${VALID_PROFILES.join(", ")}.`,
      );
    }
  }

  return {
    all,
    profiles,
    positional,
    local,
    approve,
    remove,
    dryRun,
    help,
    rootDir,
  };
}

/**
 * Resolve the ordered, deduplicated list of workspace packages to operate on.
 * @param {ReturnType<typeof discoverWorkspacePackages>} packages
 * @param {{ all: boolean, profiles: string[], positional: string[] }} selection
 */
export function resolveTargetPackages(packages, selection) {
  const { all, profiles, positional } = selection;
  const selectedByAbsDir = new Map();

  if (all) {
    for (const pkg of packages) {
      selectedByAbsDir.set(pkg.absDir, pkg);
    }
  }

  for (const profile of profiles) {
    for (const pkg of packages) {
      if (matchesProfile(pkg, profile, packages)) {
        selectedByAbsDir.set(pkg.absDir, pkg);
      }
    }
  }

  for (const rawSelector of positional) {
    const normalized = normalizePackageSelector(rawSelector);
    const match = packages.find(
      (pkg) =>
        pkg.dirName === normalized ||
        pkg.relDir === normalized ||
        pkg.manifest?.name === rawSelector,
    );
    if (!match) {
      throw new Error(`Unknown workspace package: ${rawSelector}`);
    }
    selectedByAbsDir.set(match.absDir, match);
  }

  return packages.filter((pkg) => selectedByAbsDir.has(pkg.absDir));
}

/**
 * Build Pi CLI argument vector for a single package.
 * @param {{ relDir: string }} pkg
 * @param {{ local?: boolean, approve?: boolean, remove?: boolean }} options
 * @returns {string[]}
 */
export function buildPiArgs(pkg, options = {}) {
  const args = [options.remove ? "remove" : "install"];
  if (options.local) {
    args.push("--local");
  }
  if (options.approve) {
    args.push("--approve");
  }
  args.push(`./${pkg.relDir}`);
  return args;
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

function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error('Run with "--help" for usage.');
    process.exit(1);
  }

  if (options.help) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  if (!options.all && options.profiles.length === 0 && options.positional.length === 0) {
    console.error("Error: specify --all, --profile <name>, or one or more package names.");
    console.error('Run with "--help" for usage.');
    process.exit(1);
  }

  const allPackages = discoverWorkspacePackages(options.rootDir);
  let targetPackages;
  try {
    targetPackages = resolveTargetPackages(allPackages, options);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  if (targetPackages.length === 0) {
    console.log("No matching workspace packages found.");
    process.exit(0);
  }

  const piBin = options.dryRun ? "pi" : resolvePiBin(options.rootDir);

  for (const pkg of targetPackages) {
    const piArgs = buildPiArgs(pkg, options);
    if (options.dryRun) {
      console.log(`pi ${piArgs.join(" ")}`);
      continue;
    }

    console.log(`Running: ${piBin} ${piArgs.join(" ")}`);
    const result = spawnSync(piBin, piArgs, {
      cwd: options.rootDir,
      env: process.env,
      stdio: "inherit",
    });

    if (result.error) {
      console.error(`Error spawning Pi for ${pkg.relDir}: ${result.error.message}`);
      process.exit(1);
    }
    if (result.status !== 0) {
      console.error(`Pi exited with code ${result.status ?? 1} for ${pkg.relDir}.`);
      process.exit(result.status ?? 1);
    }
  }
}

if (isExecutedDirectly()) {
  main();
}
