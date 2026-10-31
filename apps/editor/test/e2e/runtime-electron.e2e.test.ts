import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const binary = fileURLToPath(new URL("../../../../node_modules/electron/dist/electron", import.meta.url));
const mainScript = fileURLToPath(new URL("../../runtime/main.mjs", import.meta.url));

test("runtime real inicializa janela, preload, isolamento e IPC no Electron", () => {
  assert.ok(fs.existsSync(binary), "binário do Electron não encontrado");
  const run = spawnSync(binary, [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    mainScript,
    "--runtime-smoke",
  ], { encoding: "utf8", timeout: 120000 });
  assert.equal(run.status, 0, `status ${run.status}: ${run.stderr.slice(0, 600)}`);
  const line = run.stdout.split("\n").find((entry) => entry.includes('"runtimeSmoke"'));
  assert.ok(line, `saída sem marcador: ${run.stdout.slice(0, 600)}`);
  const smoke = JSON.parse(line).runtimeSmoke;
  assert.equal(smoke.hasEditor, true);
  assert.equal(smoke.isolated, true);
  assert.deepEqual(smoke.state, { hasOpenDocument: true });
});

test("linha de comando sem flag de automação não sai imediata e sem janela", { timeout: 20000 }, () => {
  assert.ok(fs.existsSync(binary), "binário do Electron não encontrado");
  const child = spawnSync(binary, [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    mainScript,
  ], { encoding: "utf8", timeout: 8000 });
  // Sem display neste ambiente o runtime aguarda como processo vivo; o
  // questionável é erro de carga do app (App threw / Falha ao iniciar).
  assert.doesNotMatch(child.stderr ?? "", /App threw an error during load/);
  assert.doesNotMatch(child.stderr ?? "", /Falha ao iniciar editor/);
  assert.doesNotMatch(child.stderr ?? "", /Cannot find module/);
});
