import { spawn } from "node:child_process";
import type { SystemSecretVault } from "./types.js";

class CmdKeyError extends Error {
  readonly exitCode: number | null;

  constructor(exitCode: number | null, stderr: string) {
    super(`cmdkey exit ${exitCode ?? "unknown"}: ${stderr}`);
    this.name = "CmdKeyError";
    this.exitCode = exitCode;
  }
}

export type CmdKeyRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

export type WindowsCredentialReadRunner = (target: string) => Promise<string | null>;

function credentialTarget(service: string, account: string): string {
  return `${service}/${account}`;
}

function runCmdKeyProcess(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("cmdkey", args, { stdio: ["ignore", "pipe", "pipe"] });
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
      reject(new CmdKeyError(code, stderr.trim()));
    });
  });
}

const CRED_READ_PS = String.raw`
param([Parameter(Mandatory)][string]$Target)
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class OpenAgentNativeCred {
  public enum CredType { Generic = 1 }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct NativeCredential {
    public int Flags;
    public CredType Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public long LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }
  [DllImport("Advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredRead(string target, CredType type, int reservedFlag, out IntPtr credentialPtr);
  [DllImport("Advapi32.dll", SetLastError = true)]
  public static extern bool CredFree(IntPtr cred);
}
'@
$ptr = [IntPtr]::Zero
if (-not [OpenAgentNativeCred]::CredRead($Target, [OpenAgentNativeCred+CredType]::Generic, 0, [ref]$ptr)) {
  exit 2
}
try {
  $nc = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][OpenAgentNativeCred+NativeCredential])
  $size = $nc.CredentialBlobSize
  if ($size -le 0) { exit 3 }
  $bytes = New-Object byte[] $size
  [Runtime.InteropServices.Marshal]::Copy($nc.CredentialBlob, $bytes, 0, $size)
  [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
} finally {
  [void][OpenAgentNativeCred]::CredFree($ptr)
}
`.trim();

function readCredentialViaPowerShell(target: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", CRED_READ_PS, "-Target", target],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
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
        const value = stdout.trimEnd();
        resolve(value.length > 0 ? value : null);
        return;
      }
      if (code === 2) {
        resolve(null);
        return;
      }
      reject(new Error(`powershell CredRead exit ${code ?? "unknown"}: ${stderr.trim()}`));
    });
  });
}

/**
 * Adapter Windows via Credential Manager (`cmdkey` + CredRead).
 */
export function createWindowsCredentialManagerVault(options?: {
  runCmdKey?: CmdKeyRunner;
  readCredential?: WindowsCredentialReadRunner;
}): SystemSecretVault {
  const runCmdKey = options?.runCmdKey ?? runCmdKeyProcess;
  const readCredential = options?.readCredential ?? readCredentialViaPowerShell;

  return {
    backend: "win32-credential-manager",
    async store(service, account, secret) {
      const target = credentialTarget(service, account);
      await runCmdKey(["/generic:" + target, "/user:" + account, "/pass:" + secret]);
    },
    async read(service, account) {
      const target = credentialTarget(service, account);
      return readCredential(target);
    },
    async delete(service, account) {
      const target = credentialTarget(service, account);
      try {
        await runCmdKey(["/delete:" + target]);
      } catch (err) {
        if (err instanceof CmdKeyError && err.exitCode === 1) {
          return;
        }
        throw err;
      }
    },
  };
}
