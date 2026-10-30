/**
 * Smoke e2e do pacote Linux (task_183 / LOC-01): build, checksum, instalação
 * em prefixo local, daemon do pacote responde handshake e worker embutido
 * executa ferramenta. Checksum corrompido falha estavelmente.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import test from "node:test";
import assert from "node:assert/strict";

import {
  OPENAGENT_DAEMON_PROTOCOL_VERSION,
  connectHarnessClient,
  type WorkspaceTransportHello,
} from "@openagent/protocol";

import { buildPackageLinux } from "../../linux/build-package-linux.mjs";

const SAMPLE_WORKSPACE_HELLO = {
  type: "workspace.hello" as const,
  workspaceId: "ws-openagent-package-183",
  workspaceRoot: "/tmp/openagent-package-183-workspace",
  providerProfileId: "provider-local-cliproxy",
  mode: "ask" as const,
  rulesRef: "rules:project/default",
  mcpServerIds: [],
  sessionIds: [],
};

interface BuiltPackage {
  tarballPath: string;
  stagedDir: string;
}

function buildPackage(tarballDir: string): BuiltPackage {
  const result = buildPackageLinux({ outRoot: tarballDir });
  assert.ok(fs.existsSync(result.tarballPath), "tarball gerado");
  const stagedDir = path.join(result.staging, "openagent-editor");
  const tree = fs.readdirSync(stagedDir, { withFileTypes: true }).map((d) => d.name);
  for (const required of ["sha256sums.txt", "install.sh", "package-manifest.json", "bin", "workers", "sidecars", "editor"]) {
    assert.ok(tree.includes(required), `pacote contém ${required}`);
  }
  const daemonFile = path.join(stagedDir, "bin", "openagent-daemon.mjs");
  assert.ok(fs.existsSync(daemonFile), "daemon empacotado presente");
  assert.ok(fs.existsSync(path.join(stagedDir, "sidecars", "cliproxyapi", "pin-manifest.json")), "pin do sidecar presente");
  assert.ok(fs.existsSync(path.join(stagedDir, "workers", "tools-worker.mjs")), "worker de ferramentas presente");
  return { tarballPath: result.tarballPath, stagedDir };
}

function installPackage(pkg: BuiltPackage, prefix: string): void {
  const result = spawnSync("sh", [path.join(pkg.stagedDir, "install.sh"), "--prefix", prefix], {
    encoding: "utf8" as const,
  });
  assert.equal(result.status, 0, `install.sh conclui: ${result.stderr ?? ""}`);
  assert.match(result.stdout ?? "", /instalado em/);
  const manifest = JSON.parse(fs.readFileSync(path.join(prefix, "package-manifest.json"), "utf8"));
  assert.equal(manifest.packageName, "openagent-editor");
}

test("[LOC-01] pacote Linux contém daemon, workers e sidecar com checksums válidos", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oa-183-pkg-"));
  try {
    buildPackage(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("[LOC-01] daemon do pacote responde handshake workspace.ack", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oa-183-dae-"));
  let daemon: ChildProcess | undefined;
  try {
    const pkg = buildPackage(dir);
    const prefix = path.join(dir, "installed", "OpenAgent");
    installPackage(pkg, prefix);
    const dataRoot = path.join(dir, "data-root");
    const runtimeDir = path.join(dataRoot, "runtime");
    fs.mkdirSync(dataRoot, { recursive: true });
    daemon = spawn(process.execPath, [
      path.join(prefix, "bin", "openagent-daemon.mjs"),
      "--data-root", dataRoot,
      "--runtime-dir", runtimeDir,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let daemonStderr = "";
    daemon.stderr?.on("data", (c: Buffer) => { daemonStderr += String(c); });
    // aguarda socket (deadline curto; daemon empacotado normalmente responde em <2s)
    const socket = path.join(runtimeDir, "openagent-harness-default.sock");
    const deadline = Date.now() + 12000;
    while (!fs.existsSync(socket) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(fs.existsSync(socket), `socket do daemon criado; stderr=${daemonStderr.slice(0, 400)}`);
    const client = await connectHarnessClient({
      address: socket,
      workspaceHello: SAMPLE_WORKSPACE_HELLO,
      clientId: "oa-183-smoke",
    });
    assert.ok(client, "cliente conectado ao daemon empacotado");
    // encerra o cliente (mantém o daemon vivo até o teste terminar).
    if (typeof (client as { stop?: unknown }).stop === "function") {
      await (client as { stop(): Promise<void> }).stop();
    } else if (typeof (client as { close?: unknown }).close === "function") {
      (client as { close(): void }).close();
    }
  } finally {
    if (daemon?.pid) {
      try { process.kill(daemon.pid, "SIGTERM"); } catch { /* já encerrado */ }
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("[LOC-01] worker de ferramentas embutido no pacote responde (eco)", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oa-183-wrk-"));
  try {
    const pkg = buildPackage(dir);
    const workerPath = path.join(pkg.stagedDir, "workers", "tools-worker.mjs");
    const worker = new Worker(workerPath);
    const responses: unknown[] = [];
    worker.on("message", (m: unknown) => responses.push(m));
    worker.postMessage({ kind: "bootstrap", tools: ["echo"] });
    worker.postMessage({ kind: "invoke", requestId: "r1", tool: "echo", input: { hi: "pacote" } });
    const deadline = Date.now() + 5000;
    while (responses.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await worker.terminate();
    assert.ok(responses.length >= 2, "bootstrap e invoke respondidos");
    const invoke = responses.find((m) => (m as { requestId?: string }).requestId === "r1") as
      | { kind: string; output: unknown }
      | undefined;
    assert.ok(invoke, "resposta do invoke presente");
    assert.deepEqual(invoke!.output, { hi: "pacote" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("[LOC-01] checksum corrompido no pacote falha estável sem instalar", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oa-183-bad-"));
  try {
    const pkg = buildPackage(dir);
    const target = path.join(pkg.stagedDir, "bin", "openagent-daemon.mjs");
    fs.appendFileSync(target, "// corruption\n");
    const prefix = path.join(dir, "installed", "OpenAgent");
    const run = spawn("sh", [path.join(pkg.stagedDir, "install.sh"), "--prefix", prefix], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8" as const,
    });
    let stderr = "";
    run.stderr?.on("data", (c: Buffer) => { stderr += String(c); });
    const code = await new Promise<number | null>((resolve) => run.once("close", resolve));
    assert.equal(code, 3, "install.sh falha com checksum inválido");
    assert.ok(!fs.existsSync(path.join(prefix, "bin")), "nada instalado com checksum inválido");
    assert.match(stderr, /checksum/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
