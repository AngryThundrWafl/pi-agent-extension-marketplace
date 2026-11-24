#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();

/**
 * Discover test files under `tests/` and `packages/<pkg>/tests/`.
 * @param {string} rootDir
 * @returns {string[]}
 */
function discoverTestFiles(rootDir) {
  const discovered = [];

  const rootTestsDir = path.join(rootDir, "tests");
  if (fs.existsSync(rootTestsDir) && fs.statSync(rootTestsDir).isDirectory()) {
    for (const entry of fs.readdirSync(rootTestsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
        discovered.push(path.join(rootTestsDir, entry.name));
      }
    }
  }

  const packagesDir = path.join(rootDir, "packages");
  if (fs.existsSync(packagesDir) && fs.statSync(packagesDir).isDirectory()) {
    for (const pkgEntry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!pkgEntry.isDirectory() || pkgEntry.name.startsWith(".")) {
        continue;
      }
      const pkgTestsDir = path.join(packagesDir, pkgEntry.name, "tests");
      if (fs.existsSync(pkgTestsDir) && fs.statSync(pkgTestsDir).isDirectory()) {
        for (const testEntry of fs.readdirSync(pkgTestsDir, { withFileTypes: true })) {
          if (testEntry.isFile() && testEntry.name.endsWith(".test.mjs")) {
            discovered.push(path.join(pkgTestsDir, testEntry.name));
          }
        }
      }
    }
  }

  return discovered
    .map((filePath) => path.relative(rootDir, filePath).split(path.sep).join("/"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const testFiles = discoverTestFiles(repoRoot);
if (testFiles.length === 0) {
  console.log("No test files found under tests/*.test.mjs or packages/*/tests/*.test.mjs.");
  process.exit(0);
}

const extraArgs = process.argv.slice(2);
const result = spawnSync(process.execPath, ["--test", ...extraArgs, ...testFiles], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
