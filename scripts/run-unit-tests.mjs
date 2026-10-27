import { glob } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const patterns = [
  "packages/*/test/**/*.test.ts",
  "services/*/test/unit/**/*.test.ts",
];
const files = [];

for (const pattern of patterns) {
  for await (const file of glob(pattern)) {
    files.push(file);
  }
}

if (files.length === 0) {
  console.error("Nenhum teste unitário encontrado.");
  process.exitCode = 1;
} else {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", ...files],
    { stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
}
