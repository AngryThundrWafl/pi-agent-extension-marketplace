#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { discoverWorkspacePackages } from "./lib/catalog.mjs";
import { createPiSandbox, runPi } from "./lib/pi-sandbox.mjs";

const GLOBAL_PI_SDK_PATH = "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
const RPC_GET_COMMANDS_INPUT = `${JSON.stringify({ id: "1", type: "get_commands" })}\n`;
const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

const HELP_TEXT = `Usage: node scripts/verify-install.mjs [options]

Verify Pi package installation, resource loading, tarball hygiene, and catalog matrix checks
inside isolated temporary sandboxes (never touching ~/.pi or ~/.agents).

Options:
  --package <dirName>      Verify a single workspace package (skips full-catalog matrix checks)
  --root <dir>             Workspace root directory (default: current working directory)
  -h, --help               Show this help text
`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function stripAnsi(text) {
  return String(text ?? "").replace(ANSI_ESCAPE_RE, "");
}

function canonicalizePath(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function isPathInsideOrEqual(parentDir, targetPath) {
  const rel = path.relative(parentDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizePackageSelector(raw) {
  return raw
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

/**
 * Parse CLI arguments for `verify-install.mjs`.
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
  let packageName = null;
  let rootDir = process.cwd();
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--package") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --package.");
      }
      packageName = value;
      i += 1;
    } else if (arg.startsWith("--package=")) {
      const value = arg.slice("--package=".length);
      if (!value) {
        throw new Error("Missing value for --package.");
      }
      packageName = value;
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
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  return { packageName, rootDir, help };
}

/**
 * Resolve Pi SDK exports from workspace node_modules with global fallback.
 * @param {string} rootDir
 */
async function loadPiSdk(rootDir) {
  const localSdkPath = path.join(
    rootDir,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "index.js",
  );
  const sdkPath = fs.existsSync(localSdkPath) ? localSdkPath : GLOBAL_PI_SDK_PATH;
  if (!fs.existsSync(sdkPath)) {
    throw new Error(`Unable to locate Pi SDK at ${localSdkPath} or ${GLOBAL_PI_SDK_PATH}`);
  }
  return import(pathToFileURL(sdkPath).href);
}

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

/**
 * Load resources via Pi's DefaultResourceLoader inside the isolated sandbox.
 * @param {ReturnType<typeof createPiSandbox>} sandbox
 * @param {Awaited<ReturnType<typeof loadPiSdk>>} sdk
 * @param {{ cwd?: string, projectTrusted?: boolean }} [options]
 */
async function loadResourcesInSandbox(sandbox, sdk, options = {}) {
  const cwd = options.cwd ?? sandbox.workDir;
  const projectTrusted = options.projectTrusted ?? false;
  return withSandboxEnv(sandbox, async () => {
    const settingsManager = sdk.SettingsManager.create(cwd, sandbox.agentDir, { projectTrusted });
    const loader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir: sandbox.agentDir,
      settingsManager,
    });
    await loader.reload();
    return {
      extensions: loader.getExtensions(),
      skills: loader.getSkills(),
      prompts: loader.getPrompts(),
      themes: loader.getThemes(),
    };
  });
}

function parseRpcGetCommandsResponse(stdout, contextLabel) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed && parsed.type === "response" && parsed.id === "1") {
      assert(
        parsed.success === true,
        `${contextLabel}: RPC get_commands failed: ${JSON.stringify(parsed)}`,
      );
      assert(
        Array.isArray(parsed.data?.commands),
        `${contextLabel}: RPC get_commands response missing data.commands array`,
      );
      return parsed;
    }
  }

  throw new Error(`${contextLabel}: missing RPC JSON response for id "1" in stdout: ${stdout}`);
}

function assertNoStderr(result, commandLabel) {
  assert(
    result.status === 0,
    `${commandLabel} exited with ${result.status}. stderr:\n${result.stderr}\nstdout:\n${result.stdout}`,
  );
  assert(
    result.stderr.trim() === "",
    `${commandLabel} produced unexpected stderr:\n${result.stderr}`,
  );
}

function countLoadedResourcesInPackage(loaded, pkgRealDir) {
  const extensions = loaded.extensions.extensions.filter((ext) => {
    const extPath = ext.resolvedPath || ext.path;
    return extPath && isPathInsideOrEqual(pkgRealDir, canonicalizePath(extPath));
  });
  const skills = loaded.skills.skills.filter(
    (skill) => skill.filePath && isPathInsideOrEqual(pkgRealDir, canonicalizePath(skill.filePath)),
  );
  const prompts = loaded.prompts.prompts.filter(
    (prompt) => prompt.filePath && isPathInsideOrEqual(pkgRealDir, canonicalizePath(prompt.filePath)),
  );
  const themes = loaded.themes.themes.filter(
    (theme) => theme.sourcePath && isPathInsideOrEqual(pkgRealDir, canonicalizePath(theme.sourcePath)),
  );
  return { extensions, skills, prompts, themes };
}

function assertCleanLoaderDiagnostics(loaded, contextLabel) {
  assert(
    loaded.extensions.errors.length === 0,
    `${contextLabel}: extension load errors: ${JSON.stringify(loaded.extensions.errors)}`,
  );

  for (const [kind, diagnostics] of [
    ["skills", loaded.skills.diagnostics],
    ["prompts", loaded.prompts.diagnostics],
    ["themes", loaded.themes.diagnostics],
  ]) {
    const bad = diagnostics.filter((d) => d.type === "collision" || d.type === "error");
    assert(
      bad.length === 0,
      `${contextLabel}: ${kind} diagnostics contained collision/error entries: ${JSON.stringify(bad)}`,
    );
  }
}

function verifyOneShotPackage(pkg, rootDir) {
  const sandbox = createPiSandbox(`pi-verify-oneshot-${pkg.dirName}-`);
  try {
    const relSource = `./${pkg.relDir}`;

    const helpResult = runPi(["-e", relSource, "--help"], {
      repoRoot: rootDir,
      sandbox,
      cwd: rootDir,
    });
    assertNoStderr(helpResult, `pi -e ${relSource} --help`);

    for (const relTheme of pkg.resources.themes) {
      const themePath = path.join(pkg.absDir, relTheme);
      const themeJson = JSON.parse(fs.readFileSync(themePath, "utf8"));
      assert(
        typeof themeJson?.name === "string" && themeJson.name.trim().length > 0,
        `${pkg.relDir}/${relTheme}: theme JSON missing non-empty "name" field`,
      );
      const themeHelpResult = runPi(
        ["-e", relSource, "--use-theme", themeJson.name, "--help"],
        { repoRoot: rootDir, sandbox, cwd: rootDir },
      );
      assertNoStderr(
        themeHelpResult,
        `pi -e ${relSource} --use-theme ${themeJson.name} --help`,
      );
    }

    const hasCommandResources =
      pkg.resources.extensions.length > 0 ||
      pkg.resources.skills.length > 0 ||
      pkg.resources.prompts.length > 0;

    if (hasCommandResources) {
      const rpcResult = runPi(["-e", relSource, "--mode", "rpc", "--no-session"], {
        repoRoot: rootDir,
        sandbox,
        cwd: rootDir,
        input: RPC_GET_COMMANDS_INPUT,
      });
      assertNoStderr(rpcResult, `pi -e ${relSource} --mode rpc --no-session`);
      parseRpcGetCommandsResponse(rpcResult.stdout, `one-shot RPC (${pkg.relDir})`);
    }
  } finally {
    sandbox.cleanup();
  }
}

async function verifyPersonalInstallAndSdk(pkg, rootDir, sdk) {
  const sandbox = createPiSandbox(`pi-verify-install-${pkg.dirName}-`);
  try {
    const relSource = `./${pkg.relDir}`;
    const pkgRealDir = canonicalizePath(pkg.absDir);

    const installResult = runPi(["install", relSource], {
      repoRoot: rootDir,
      sandbox,
      cwd: rootDir,
    });
    assert(
      installResult.status === 0,
      `pi install ${relSource} failed (${installResult.status}): ${installResult.stderr || installResult.stdout}`,
    );

    const listResult = runPi(["list"], {
      repoRoot: rootDir,
      sandbox,
      cwd: rootDir,
    });
    assert(
      listResult.status === 0,
      `pi list failed (${listResult.status}): ${listResult.stderr}`,
    );
    const listText = stripAnsi(listResult.stdout);
    assert(
      !listText.includes("No packages installed.") &&
        (listText.includes(pkg.absDir) || listText.includes(pkgRealDir) || listText.includes(pkg.dirName)),
      `pi list did not show ${pkg.relDir}. Output:\n${listText}`,
    );

    const verboseHelpResult = runPi(["--verbose", "--help"], {
      repoRoot: rootDir,
      sandbox,
      cwd: rootDir,
    });
    assertNoStderr(verboseHelpResult, `pi --verbose --help (${pkg.relDir})`);

    const loaded = await loadResourcesInSandbox(sandbox, sdk);
    assertCleanLoaderDiagnostics(loaded, `SDK load (${pkg.relDir})`);

    const counts = countLoadedResourcesInPackage(loaded, pkgRealDir);
    for (const type of ["extensions", "skills", "prompts", "themes"]) {
      if (pkg.resources[type].length > 0) {
        assert(
          counts[type].length >= 1,
          `${pkg.relDir}: declared ${pkg.resources[type].length} ${type}, but DefaultResourceLoader loaded 0 from ${pkgRealDir}`,
        );
      }
    }
  } finally {
    sandbox.cleanup();
  }
}

function verifyTarballHygiene(pkg, rootDir) {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "-w", pkg.relDir], {
    cwd: rootDir,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert(
    !result.error && result.status === 0,
    `npm pack --dry-run --json -w ${pkg.relDir} failed: ${result.error?.message || result.stderr || result.stdout}`,
  );

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`Failed to parse npm pack JSON for ${pkg.relDir}: ${err.message}`);
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.files)
      ? [parsed]
      : parsed && typeof parsed === "object"
        ? Object.values(parsed)
        : [];
  const files = entries.flatMap((entry) => (Array.isArray(entry?.files) ? entry.files : []));
  assert(files.length > 0, `npm pack --dry-run --json -w ${pkg.relDir} reported 0 files.`);

  for (const file of files) {
    const filePath = String(file?.path ?? "").replace(/\\/g, "/");
    assert(
      !filePath.startsWith("tests/") && !filePath.startsWith("node_modules/"),
      `${pkg.relDir}: tarball includes forbidden path "${filePath}"`,
    );
  }
}

async function verifyCoLoadCollisions(packages, rootDir, sdk) {
  const sandbox = createPiSandbox("pi-verify-coload-");
  try {
    for (const pkg of packages) {
      const installResult = runPi(["install", `./${pkg.relDir}`], {
        repoRoot: rootDir,
        sandbox,
        cwd: rootDir,
      });
      assert(
        installResult.status === 0,
        `co-load pi install ./${pkg.relDir} failed: ${installResult.stderr || installResult.stdout}`,
      );
    }

    const verboseHelp = runPi(["--verbose", "--help"], {
      repoRoot: rootDir,
      sandbox,
      cwd: rootDir,
    });
    assertNoStderr(verboseHelp, "co-load pi --verbose --help");

    const rpcResult = runPi(["--mode", "rpc", "--no-session"], {
      repoRoot: rootDir,
      sandbox,
      cwd: rootDir,
      input: RPC_GET_COMMANDS_INPUT,
    });
    assertNoStderr(rpcResult, "co-load pi --mode rpc --no-session");

    const rpcResponse = parseRpcGetCommandsResponse(rpcResult.stdout, "co-load RPC");
    const collidedCommands = rpcResponse.data.commands.filter(
      (cmd) =>
        typeof cmd?.name === "string" &&
        (cmd.name.endsWith(":1") || cmd.name.endsWith(":2")),
    );
    assert(
      collidedCommands.length === 0,
      `co-load command collision(s) detected: ${JSON.stringify(collidedCommands)}`,
    );

    const loaded = await loadResourcesInSandbox(sandbox, sdk);
    assertCleanLoaderDiagnostics(loaded, "co-load SDK");
  } finally {
    sandbox.cleanup();
  }
}

async function verifyLocalTrustFlow(firstPkg, rootDir, sdk) {
  const sandbox = createPiSandbox("pi-verify-local-");
  try {
    const pkgRealDir = canonicalizePath(firstPkg.absDir);

    const localInstall = runPi(["install", "-l", firstPkg.absDir, "--approve"], {
      repoRoot: rootDir,
      sandbox,
      cwd: sandbox.workDir,
    });
    assert(
      localInstall.status === 0,
      `pi install -l ${firstPkg.absDir} --approve failed: ${localInstall.stderr || localInstall.stdout}`,
    );

    const projectSettingsPath = path.join(sandbox.workDir, ".pi", "settings.json");
    assert(
      fs.existsSync(projectSettingsPath),
      `Expected project settings file at ${projectSettingsPath}`,
    );

    const untrustedList = runPi(["list", "--no-approve"], {
      repoRoot: rootDir,
      sandbox,
      cwd: sandbox.workDir,
    });
    assert(
      untrustedList.status === 0,
      `pi list --no-approve failed: ${untrustedList.stderr}`,
    );
    const untrustedListText = stripAnsi(untrustedList.stdout);
    assert(
      untrustedListText.includes("No packages installed."),
      `Expected "No packages installed." with --no-approve, got:\n${untrustedListText}`,
    );

    const untrustedRpc = runPi(["--no-approve", "--mode", "rpc", "--no-session"], {
      repoRoot: rootDir,
      sandbox,
      cwd: sandbox.workDir,
      input: RPC_GET_COMMANDS_INPUT,
    });
    assertNoStderr(untrustedRpc, "pi --no-approve --mode rpc --no-session");
    const untrustedRpcResponse = parseRpcGetCommandsResponse(
      untrustedRpc.stdout,
      "untrusted local RPC",
    );
    const leakedProjectCmds = untrustedRpcResponse.data.commands.filter(
      (cmd) =>
        cmd?.sourceInfo?.scope === "project" ||
        (cmd?.sourceInfo?.path &&
          isPathInsideOrEqual(pkgRealDir, canonicalizePath(cmd.sourceInfo.path))),
    );
    assert(
      leakedProjectCmds.length === 0,
      `Untrusted run loaded project-local commands: ${JSON.stringify(leakedProjectCmds)}`,
    );

    const untrustedLoaded = await loadResourcesInSandbox(sandbox, sdk, {
      cwd: sandbox.workDir,
      projectTrusted: false,
    });
    const untrustedCounts = countLoadedResourcesInPackage(untrustedLoaded, pkgRealDir);
    const totalUntrusted =
      untrustedCounts.extensions.length +
      untrustedCounts.skills.length +
      untrustedCounts.prompts.length +
      untrustedCounts.themes.length;
    assert(
      totalUntrusted === 0,
      `DefaultResourceLoader with projectTrusted=false loaded ${totalUntrusted} resource(s) from ${firstPkg.relDir}`,
    );

    const trustedList = runPi(["list", "--approve"], {
      repoRoot: rootDir,
      sandbox,
      cwd: sandbox.workDir,
    });
    assert(
      trustedList.status === 0,
      `pi list --approve failed: ${trustedList.stderr}`,
    );
    const trustedListText = stripAnsi(trustedList.stdout);
    assert(
      trustedListText.includes("Project packages") &&
        (trustedListText.includes(firstPkg.absDir) ||
          trustedListText.includes(pkgRealDir) ||
          trustedListText.includes(firstPkg.dirName)),
      `Expected Project packages listing for ${firstPkg.relDir} with --approve, got:\n${trustedListText}`,
    );
  } finally {
    sandbox.cleanup();
  }
}

async function verifyResourceFiltering(firstPkg, sdk) {
  const sandbox = createPiSandbox("pi-verify-filter-");
  try {
    const pkgRealDir = canonicalizePath(firstPkg.absDir);
    const settingsPath = path.join(sandbox.agentDir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          packages: [
            {
              source: firstPkg.absDir,
              extensions: [],
              skills: [],
              prompts: [],
              themes: [],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const loaded = await loadResourcesInSandbox(sandbox, sdk);
    assertCleanLoaderDiagnostics(loaded, `filtered SDK load (${firstPkg.relDir})`);

    const counts = countLoadedResourcesInPackage(loaded, pkgRealDir);
    const totalLoaded =
      counts.extensions.length +
      counts.skills.length +
      counts.prompts.length +
      counts.themes.length;
    assert(
      totalLoaded === 0,
      `Expected 0 resources when all resource arrays are [] for ${firstPkg.relDir}, but loaded ${totalLoaded}`,
    );
  } finally {
    sandbox.cleanup();
  }
}

/**
 * Run installation matrix verification for one package or the full catalog.
 * @param {{ rootDir?: string, packageName?: string | null }} [options]
 */
export async function verifyInstallMatrix(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const allPackages = discoverWorkspacePackages(rootDir);

  let targetPackages = allPackages;
  if (options.packageName) {
    const normalized = normalizePackageSelector(options.packageName);
    const match = allPackages.find(
      (pkg) => pkg.dirName === normalized || pkg.relDir === normalized,
    );
    if (!match) {
      throw new Error(`Unknown workspace package: ${options.packageName}`);
    }
    targetPackages = [match];
  } else if (allPackages.length === 0) {
    return { verifiedPackages: 0, matrixChecked: false };
  }

  const sdk = await loadPiSdk(rootDir);

  for (const pkg of targetPackages) {
    console.log(`Verifying package ${pkg.relDir}...`);
    verifyOneShotPackage(pkg, rootDir);
    await verifyPersonalInstallAndSdk(pkg, rootDir, sdk);
    verifyTarballHygiene(pkg, rootDir);
  }

  const matrixChecked = !options.packageName && allPackages.length >= 1;
  if (matrixChecked) {
    console.log(`Verifying co-load collisions across ${allPackages.length} package(s)...`);
    await verifyCoLoadCollisions(allPackages, rootDir, sdk);

    console.log(`Verifying --local + project trust flow using ${allPackages[0].relDir}...`);
    await verifyLocalTrustFlow(allPackages[0], rootDir, sdk);

    console.log(`Verifying settings resource filtering using ${allPackages[0].relDir}...`);
    await verifyResourceFiltering(allPackages[0], sdk);
  }

  return { verifiedPackages: targetPackages.length, matrixChecked };
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

async function main() {
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

  try {
    const result = await verifyInstallMatrix(options);
    if (result.verifiedPackages === 0) {
      console.log("No workspace packages to verify.");
      process.exit(0);
    }
    const suffix = result.matrixChecked ? " (including full-catalog matrix checks)" : "";
    console.log(
      `Install verification passed for ${result.verifiedPackages} package(s)${suffix}.`,
    );
  } catch (err) {
    console.error(`Install verification failed: ${err.message}`);
    process.exit(1);
  }
}

if (isExecutedDirectly()) {
  await main();
}
