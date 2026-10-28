import { mkdtemp, rm } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectHarnessClient } from "../packages/protocol/src/index.ts";
import {
  ensureHarnessDaemonReady,
  readUserDaemonLockPath,
} from "../services/harness-daemon/src/index.ts";

const dataRoot = await mkdtemp(path.join(os.tmpdir(), "dbg-ondemand-"));
const runtimeDirectory = path.join(dataRoot, "runtime");
try {
  const ready = await ensureHarnessDaemonReady({
    dataRoot,
    runtimeDirectory,
    connectTimeoutMs: 15_000,
  });
  console.log("ready", ready);
  const lockPath = readUserDaemonLockPath(runtimeDirectory);
  console.log("lock", fs.readFileSync(lockPath, "utf8"));
  const hello = {
    type: "workspace.hello",
    workspaceId: "ws-openagent-daemon-39",
    workspaceRoot: "/tmp/openagent-workspace-39",
    providerProfileId: "provider-local-ollama",
    mode: "agent",
    rulesRef: "rules:project/default",
    mcpServerIds: ["mem0-local", "filesystem"],
    sessionIds: ["ses-main", "ses-side"],
  };
  const client = await connectHarnessClient({
    address: ready.address,
    workspaceHello: hello,
  });
  console.log("client ok", client.binding.providerProfileId);
  client.close();
} catch (error) {
  console.error("ERR", error);
  process.exitCode = 1;
} finally {
  const lockPath = readUserDaemonLockPath(runtimeDirectory);
  if (fs.existsSync(lockPath)) {
    const rec = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    try {
      process.kill(rec.pid, "SIGTERM");
    } catch {
      // ignore
    }
  }
  await rm(dataRoot, { recursive: true, force: true });
}
