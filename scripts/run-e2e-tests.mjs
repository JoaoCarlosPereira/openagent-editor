import { glob } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const patterns = ["apps/*/test/e2e/**/*.ts"];
const files = [];

for (const pattern of patterns) {
  for await (const file of glob(pattern)) {
    files.push(file);
  }
}

if (files.length === 0) {
  console.log("Nenhum teste e2e encontrado; gate e2e ignorado.");
  process.exitCode = 0;
} else {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", ...files],
    { stdio: "inherit", env: childEnv },
  );
  process.exitCode = result.status ?? 1;
}
