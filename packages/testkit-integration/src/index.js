"use strict";

const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const TERMINATION_GRACE_MS = 250;

async function withTempDir(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openagent-integration-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runProcess(command, args = [], { cwd, timeoutMs = 5000, terminationGraceMs = TERMINATION_GRACE_MS } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs deve ser um número positivo.");
  }
  if (!Number.isFinite(terminationGraceMs) || terminationGraceMs < 0) {
    throw new RangeError("terminationGraceMs deve ser um número não negativo.");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let forceKillTimer;
    let forceKillComplete = false;
    let closeResult;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    const signalTree = (signal) => {
      if (process.platform === "win32") {
        if (!child.pid) return Promise.resolve();
        return new Promise((done, fail) => {
          const args = ["/PID", String(child.pid), "/T"];
          if (signal !== "SIGTERM") args.push("/F");
          const killer = spawn("taskkill", args, { stdio: "ignore" });
          killer.once("error", fail);
          killer.once("close", (code) => {
            if (code === 0 || signal === "SIGTERM") done();
            else fail(new Error(`taskkill terminou com código ${code}.`));
          });
        });
      }

      if (!child.pid) return Promise.resolve();
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") return Promise.reject(error);
      }
      return Promise.resolve();
    };

    const finish = () => {
      if (settled || !closeResult || (timedOut && !forceKillComplete)) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") {
            reject(error);
            return;
          }
        }
      }
      resolve({ ...closeResult, pid: child.pid, stdout, stderr, timedOut });
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(error);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      signalTree("SIGTERM").then(() => {
        forceKillTimer = setTimeout(() => {
          signalTree("SIGKILL").then(() => {
            forceKillComplete = true;
            finish();
          }, fail);
        }, terminationGraceMs);
      }, fail);
    }, timeoutMs);

    child.once("error", fail);
    child.once("close", (code, signal) => {
      closeResult = { code, signal };
      finish();
    });
  });
}

module.exports = { runProcess, withTempDir };
