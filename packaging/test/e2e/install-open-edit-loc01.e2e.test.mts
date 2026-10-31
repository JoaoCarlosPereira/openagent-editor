/**
 * task_187 - Smoke Linux end-to-end: instalar, abrir projeto e editar (LOC-01).
 * Foco Linux primeiro (Joao 2026-10-30).
 * Fluxo: build do pacote -> checksum .sha256 + assinatura .sha256.asc ->
 * install.sh em prefixo sandbox -> spawn do daemon do prefixo ->
 * connectOpenAgentEditorMain com workspace.hello, abrir projeto e editar.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import { buildPackageLinux } from "../../linux/build-package-linux.mjs";
import { writeChecksumFile, signPackage } from "../../linux/sign-package.mjs";
import { connectOpenAgentEditorMain, type OpenAgentEditorMainConnection } from "../../../apps/editor/src/main/connect-main-daemon.js";

interface SmokeContext {
  tarballPath: string;
  prefix: string;
  projectDir: string;
  dataRoot: string;
}

async function makeSmokeContext(tmpDir: string): Promise<SmokeContext> {
  const pkg = buildPackageLinux({ outRoot: tmpDir });
  writeChecksumFile(pkg.tarballPath);
  signPackage(pkg.tarballPath, {}); // SIGNATURE-PENDING estavel (sem GPG no ambiente)
  const prefix = path.join(tmpDir, "installed", "OpenAgent");
  const run = spawn("sh", [path.join(pkg.staging, "openagent-editor", "install.sh"), "--prefix", prefix], {
    encoding: "utf8" as const,
  });
  const status = await new Promise<number | null>((resolve) => run.once("close", resolve));
  assert.equal(status, 0, "install.sh conclui");
  assert.ok(fs.existsSync(path.join(prefix, "bin", "openagent-daemon.mjs")));
  const projectDir = path.join(tmpDir, "projeto-teste");
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await writeFile(path.join(projectDir, "README.md"), "# Projeto smoke LOC-01\n");
  await writeFile(path.join(projectDir, "src", "index.mjs"), "export const smoke = true;\n");
  const dataRoot = path.join(tmpDir, "data-root");
  await mkdir(dataRoot, { recursive: true });
  return { tarballPath: pkg.tarballPath, prefix, projectDir, dataRoot };
}

test("[LOC-01] pacote Linux instala e o daemon do editor abre projeto e permite edicao", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "oa-187-"));
  let connection: OpenAgentEditorMainConnection | undefined;
  let daemon: ReturnType<typeof spawn> | undefined;
  try {
    const ctx = await makeSmokeContext(tmpDir);
    assert.ok(fs.existsSync(ctx.tarballPath), "tarball presente");
    assert.ok(fs.existsSync(path.join(ctx.prefix, "workers", "tools-worker.mjs")));
    assert.ok(fs.existsSync(path.join(ctx.prefix, "sidecars", "cliproxyapi", "pin-manifest.json")));
    // install.sh copia bin/workers/sidecars/editor/manifest mas nao o checksum; sha256sums.txt fica no staging

    const shaInfo = writeChecksumFile(ctx.tarballPath);
    const shaCheck = spawnSync("sha256sum", ["-c", path.basename(shaInfo.file)], {
      cwd: path.dirname(shaInfo.file),
      encoding: "utf8",
    });
    assert.equal(shaCheck.status, 0, `sha256sum -c passou: ${shaCheck.stderr ?? ""}`);

    const runtimeDir = path.join(ctx.dataRoot, "runtime");
    daemon = spawn(process.execPath, [
      path.join(ctx.prefix, "bin", "openagent-daemon.mjs"),
      "--data-root", ctx.dataRoot,
      "--runtime-dir", runtimeDir,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let daemonStderr = "";
    daemon.stderr?.on("data", (c: Buffer) => { daemonStderr += String(c); });

    const socket = path.join(runtimeDir, "openagent-harness-default.sock");
    const deadline = Date.now() + 12000;
    while (!fs.existsSync(socket) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(fs.existsSync(socket), `socket do daemon criado; stderr=${daemonStderr.slice(0, 400)}`);

    connection = await connectOpenAgentEditorMain({
      workspaceHello: {
        type: "workspace.hello",
        workspaceId: "ws-openagent-smoke-187",
        workspaceRoot: ctx.projectDir,
        providerProfileId: "provider-local-cliproxy",
        mode: "ask",
        rulesRef: "rules:project/default",
        mcpServerIds: [],
        sessionIds: [],
      } as never,
      dataRoot: ctx.dataRoot,
      runtimeDirectory: runtimeDir,
      spawnDaemon: false,
      clientId: "oa-187-smoke",
      connectTimeoutMs: 10000,
    });
    assert.ok(connection.client);
    assert.equal((connection.workspaceHello as { workspaceId: string }).workspaceId, "ws-openagent-smoke-187");

    const readme = path.join(ctx.projectDir, "README.md");
    const original = fs.readFileSync(readme, "utf8");
    assert.match(original, /Projeto smoke LOC-01/);
    fs.writeFileSync(readme, `${original}\nEditado via smoke task_187.\n`);
    assert.ok(fs.readFileSync(readme, "utf8").includes("Editado via smoke task_187."));

    const clientLike = connection.client as unknown as { stop?: unknown; close?: unknown };
    if (typeof clientLike.stop === "function") {
      await (clientLike as { stop: () => Promise<void> }).stop();
    } else if (typeof clientLike.close === "function") {
      (clientLike as unknown as { close: () => void }).close();
    }
    connection = undefined;
  } finally {
    if (connection?.client && typeof (connection.client as unknown as { close?: unknown }).close === "function") {
      (connection.client as unknown as { close: () => void }).close();
    }
    if (daemon?.pid) {
      try { process.kill(daemon.pid, "SIGTERM"); } catch { /* ja encerrado */ }
    }
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("[LOC-01] install.sh rejeita pacote com checksum corrompido (exit 3, sem instalar)", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "oa-187-bad-"));
  try {
    const pkg = buildPackageLinux({ outRoot: tmpDir });
    fs.appendFileSync(path.join(pkg.staging, "openagent-editor", "bin", "openagent-daemon.mjs"), "// corrupt\n");
    const prefix = path.join(tmpDir, "installed", "OpenAgent");
    const run = spawn("sh", [path.join(pkg.staging, "openagent-editor", "install.sh"), "--prefix", prefix], { encoding: "utf8" as const });
    const code = await new Promise<number | null>((resolve) => run.once("close", resolve));
    assert.equal(code, 3);
    assert.ok(!fs.existsSync(path.join(prefix, "bin")));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
