#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");

const runnerCode = `
import { validateRequirementCatalog, formatParityReport } from "./packages/parity/src/report.js";

const result = validateRequirementCatalog();
console.log(formatParityReport(result));

if (!result.valid) {
  process.exit(1);
}
`;

const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--input-type=module", "-e", runnerCode],
  {
    cwd: rootDir,
    stdio: "inherit",
    env: childEnv,
  }
);

process.exit(result.status ?? 1);
