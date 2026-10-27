"use strict";

const { spawnSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const path = require("node:path");

const testDirectory = path.join(__dirname, "../packages/testkit-integration/test/integration");
const testFiles = readdirSync(testDirectory)
  .filter((file) => file.endsWith(".test.js"))
  .map((file) => path.join(testDirectory, file));
const result = spawnSync(
  process.execPath,
  ["--test", ...testFiles],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
