import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Resolve the Pi CLI binary, preferring the workspace-local installation.
 * @param {string} [repoRoot]
 * @returns {string}
 */
export function resolvePiBin(repoRoot = process.cwd()) {
  const binName = process.platform === "win32" ? "pi.cmd" : "pi";
  const localBin = path.join(repoRoot, "node_modules", ".bin", binName);
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return process.env.PI_BIN || "pi";
}

/**
 * Create an isolated temporary sandbox for running Pi without touching `~/.pi` or `~/.agents`.
 * @param {string} [prefix]
 * @returns {{
 *   rootDir: string,
 *   agentDir: string,
 *   homeDir: string,
 *   sessionDir: string,
 *   workDir: string,
 *   env: NodeJS.ProcessEnv,
 *   cleanup: () => void,
 * }}
 */
export function createPiSandbox(prefix = "pi-sandbox-") {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const agentDir = path.join(rootDir, "agent");
  const homeDir = path.join(rootDir, "home");
  const sessionDir = path.join(rootDir, "sessions");
  const workDir = path.join(rootDir, "work");

  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    HOME: homeDir,
    PI_CODING_AGENT_SESSION_DIR: sessionDir,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
  };

  return {
    rootDir,
    agentDir,
    homeDir,
    sessionDir,
    workDir,
    env,
    cleanup() {
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

/**
 * Execute Pi CLI with isolated sandbox environment variables.
 * @param {string[]} args
 * @param {{
 *   repoRoot?: string,
 *   sandbox?: ReturnType<typeof createPiSandbox>,
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   input?: string,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function runPi(args, options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const piBin = resolvePiBin(repoRoot);
  const hasExplicitIsolation = Boolean(
    options.sandbox || (options.env?.PI_CODING_AGENT_DIR && options.env?.HOME),
  );
  const ephemeralSandbox = hasExplicitIsolation ? null : createPiSandbox("pi-run-");

  try {
    const baseEnv = options.sandbox
      ? options.sandbox.env
      : ephemeralSandbox
        ? ephemeralSandbox.env
        : process.env;
    const env = options.env ? { ...baseEnv, ...options.env } : { ...baseEnv };
    const cwd =
      options.cwd ??
      options.sandbox?.workDir ??
      ephemeralSandbox?.workDir ??
      repoRoot;

    const result = spawnSync(piBin, args, {
      cwd,
      env,
      input: options.input,
      timeout: options.timeoutMs ?? 30_000,
      encoding: "utf8",
    });

    const stderr =
      result.stderr || (result.error ? String(result.error.message || result.error) : "");

    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr,
    };
  } finally {
    ephemeralSandbox?.cleanup();
  }
}
