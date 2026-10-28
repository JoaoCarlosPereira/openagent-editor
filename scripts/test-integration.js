"use strict";

const { spawnSync } = require("node:child_process");
const { readdirSync, statSync } = require("node:fs");
const path = require("node:path");

function collectTestFiles(directory) {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTestFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".test.js") || entry.name.endsWith(".test.ts"))
      ? [entryPath]
      : [];
  });
}

function discoverIntegrationTests(root = path.resolve(__dirname, "..")) {
  const testFiles = [];
  for (const layer of ["packages", "services"]) {
    const layerDirectory = path.join(root, layer);
    if (!statSync(layerDirectory, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const packageEntry of readdirSync(layerDirectory, { withFileTypes: true })) {
      if (!packageEntry.isDirectory()) continue;
      testFiles.push(...collectTestFiles(path.join(layerDirectory, packageEntry.name, "test", "integration")));
    }
  }
  return testFiles.sort();
}

function main(root = path.resolve(__dirname, "..")) {
  const testFiles = discoverIntegrationTests(root);
  if (testFiles.length === 0) {
    console.error("Nenhum teste de integração encontrado nos diretórios packages/*/test/integration/** ou services/*/test/integration/**.");
    return 1;
  }

  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const usesTypeScript = testFiles.some((file) => file.endsWith(".test.ts"));
  const commandArgs = usesTypeScript
    ? ["--import", "tsx", "--test", ...testFiles]
    : ["--test", ...testFiles];
  const result = spawnSync(process.execPath, commandArgs, { stdio: "inherit", env: childEnv });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { discoverIntegrationTests, main };
