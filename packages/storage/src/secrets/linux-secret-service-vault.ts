import { spawn } from "node:child_process";
import type { SystemSecretVault } from "./types.js";

class SecretToolError extends Error {
  readonly exitCode: number | null;

  constructor(exitCode: number | null, stderr: string) {
    super(`secret-tool exit ${exitCode ?? "unknown"}: ${stderr}`);
    this.name = "SecretToolError";
    this.exitCode = exitCode;
  }
}

export type SecretToolRunner = (
  args: string[],
  input?: string,
) => Promise<{ stdout: string; stderr: string }>;

function runSecretToolProcess(args: string[], input?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("secret-tool", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new SecretToolError(code, stderr.trim()));
    });
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

/**
 * Adapter Linux via `secret-tool` (libsecret / freedesktop Secret Service).
 */
export function createLinuxSecretServiceVault(options?: {
  runSecretTool?: SecretToolRunner;
}): SystemSecretVault {
  const run = options?.runSecretTool ?? runSecretToolProcess;

  return {
    backend: "linux-secret-service",
    async store(service, account, secret) {
      await run(
        ["store", "--label=OpenAgent Editor", "service", service, "account", account],
        secret,
      );
    },
    async read(service, account) {
      try {
        const { stdout } = await run(["lookup", "service", service, "account", account]);
        const value = stdout.trimEnd();
        return value.length > 0 ? value : null;
      } catch (err) {
        if (err instanceof SecretToolError && err.exitCode === 1) {
          return null;
        }
        throw err;
      }
    },
    async delete(service, account) {
      await run(["clear", "service", service, "account", account]);
    },
  };
}
