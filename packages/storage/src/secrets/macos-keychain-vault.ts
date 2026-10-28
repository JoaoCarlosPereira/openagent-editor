import { spawn } from "node:child_process";
import type { SystemSecretVault } from "./types.js";

class SecurityCommandError extends Error {
  readonly exitCode: number | null;

  constructor(exitCode: number | null, stderr: string) {
    super(`security exit ${exitCode ?? "unknown"}: ${stderr}`);
    this.name = "SecurityCommandError";
    this.exitCode = exitCode;
  }
}

export type MacOsSecurityRunner = (
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

function runSecurityProcess(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("security", args, { stdio: ["ignore", "pipe", "pipe"] });
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
      reject(new SecurityCommandError(code, stderr.trim()));
    });
  });
}

/**
 * Adapter macOS via utilitário `security` (Keychain / generic password).
 */
export function createMacOsKeychainVault(options?: {
  runSecurity?: MacOsSecurityRunner;
}): SystemSecretVault {
  const run = options?.runSecurity ?? runSecurityProcess;

  return {
    backend: "macos-keychain",
    async store(service, account, secret) {
      await run([
        "add-generic-password",
        "-s",
        service,
        "-a",
        account,
        "-w",
        secret,
        "-U",
      ]);
    },
    async read(service, account) {
      try {
        const { stdout } = await run([
          "find-generic-password",
          "-s",
          service,
          "-a",
          account,
          "-w",
        ]);
        const value = stdout.trimEnd();
        return value.length > 0 ? value : null;
      } catch (err) {
        if (err instanceof SecurityCommandError && err.exitCode === 44) {
          return null;
        }
        throw err;
      }
    },
    async delete(service, account) {
      try {
        await run(["delete-generic-password", "-s", service, "-a", account]);
      } catch (err) {
        if (err instanceof SecurityCommandError && err.exitCode === 44) {
          return;
        }
        throw err;
      }
    },
  };
}
