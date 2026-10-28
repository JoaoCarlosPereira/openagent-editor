import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  OUT_OF_SCOPE_PATH_LOG_MESSAGE,
  resolveCanonicalWorkspacePath,
} from "@openagent/policy";
import { ProtocolError } from "@openagent/protocol";

export { OUT_OF_SCOPE_PATH_LOG_MESSAGE };

export const DEBUG_FOLDER_REQUIRED_MESSAGE =
  "Pasta raiz obrigatória para a depuração DAP.";
export const DEBUG_NO_SESSION_MESSAGE =
  "Nenhuma sessão de depuração ativa no workbench.";
export const DEBUG_TARGET_PATH_REQUIRED_MESSAGE =
  "Caminho do arquivo para depuração é obrigatório.";
export const DEBUG_BREAKPOINT_PATH_REQUIRED_MESSAGE =
  "Caminho do arquivo para breakpoint é obrigatório.";
export const DEBUG_BREAKPOINT_LINE_INVALID_MESSAGE =
  "Linha de breakpoint inválida (deve ser um inteiro maior que zero).";
export const DEBUG_BREAKPOINT_NOT_FOUND_MESSAGE =
  "Breakpoint não encontrado na sessão de depuração.";
export const DEBUG_SESSION_TERMINATED_MESSAGE =
  "A sessão de depuração já foi encerrada.";

export type DebugStatus = "idle" | "running" | "stopped" | "terminated";

export interface DebugBreakpoint {
  id: string;
  relativePath: string;
  line: number;
  verified: boolean;
}

export interface IntegratedDebugSession {
  id: string;
  workspaceRoot: string;
  targetRelativePath: string;
  dapVersion: string;
  status: DebugStatus;
  stopReason: string | null;
  currentLine: number | null;
  breakpoints: readonly DebugBreakpoint[];
  output: string;
}

export interface StartDebugInput {
  targetPath: string;
}

function assertNonEmptyRoot(rootFolder: unknown): string {
  if (typeof rootFolder !== "string" || rootFolder.trim() === "") {
    throw new ProtocolError("INVALID_STATE", DEBUG_FOLDER_REQUIRED_MESSAGE, [
      `rootFolder=${String(rootFolder)}`,
    ]);
  }
  return path.resolve(rootFolder.trim());
}

function assertValidRelativePath(raw: unknown, field: string): string {
  const errMsg =
    field === "targetPath"
      ? DEBUG_TARGET_PATH_REQUIRED_MESSAGE
      : DEBUG_BREAKPOINT_PATH_REQUIRED_MESSAGE;
  if (raw === undefined || raw === null || raw === "") {
    throw new ProtocolError("INVALID_STATE", errMsg, [`${field}=empty`]);
  }
  if (typeof raw !== "string") {
    throw new ProtocolError("INVALID_STATE", errMsg, [`${field}=not_string`]);
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new ProtocolError("INVALID_STATE", errMsg, [`${field}=empty`]);
  }
  if (path.isAbsolute(trimmed) || trimmed.startsWith("/")) {
    throw new ProtocolError("INVALID_STATE", errMsg, [`${field}=absolute`]);
  }
  return trimmed.split(path.sep).join("/");
}

function assertValidLine(line: unknown): number {
  if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
    throw new ProtocolError("INVALID_STATE", DEBUG_BREAKPOINT_LINE_INVALID_MESSAGE, [
      `line=${String(line)}`,
    ]);
  }
  return line;
}

function assertConfinedPath(rootFolder: string, relativePath: string): string {
  const requested = path.join(rootFolder, relativePath);
  const resolved = resolveCanonicalWorkspacePath(rootFolder, requested);
  if (!resolved.ok) {
    throw resolved.error;
  }
  return relativePath;
}

/**
 * Abre uma nova sessão DAP de depuração sob a pasta raiz do workspace (LOC-01 / task_124).
 */
export function openIntegratedDebugSession(
  rootFolder: unknown,
  input: StartDebugInput,
): IntegratedDebugSession {
  const root = assertNonEmptyRoot(rootFolder);
  const relativeTarget = assertValidRelativePath(input.targetPath, "targetPath");
  assertConfinedPath(root, relativeTarget);

  return {
    id: randomUUID(),
    workspaceRoot: root,
    targetRelativePath: relativeTarget,
    dapVersion: "dap/1.0",
    status: "idle",
    stopReason: null,
    currentLine: null,
    breakpoints: [],
    output: "",
  };
}

/**
 * Inicia a execução da sessão de depuração (idle/stopped -> running).
 */
export function startIntegratedDebugSession(
  session: IntegratedDebugSession,
): IntegratedDebugSession {
  if (session.status === "terminated") {
    throw new ProtocolError("INVALID_STATE", DEBUG_SESSION_TERMINATED_MESSAGE, []);
  }
  return {
    ...session,
    status: "running",
    stopReason: null,
    currentLine: null,
  };
}

/**
 * Encerra a sessão de depuração (-> terminated).
 */
export function stopIntegratedDebugSession(
  session: IntegratedDebugSession,
): IntegratedDebugSession {
  if (session.status === "terminated") {
    throw new ProtocolError("INVALID_STATE", DEBUG_SESSION_TERMINATED_MESSAGE, []);
  }
  return {
    ...session,
    status: "terminated",
    stopReason: "stop",
    currentLine: null,
  };
}

/**
 * Adiciona um breakpoint na sessão (LOC-01 / task_124).
 * Caminho fora do escopo -> OUT_OF_SCOPE.
 * Linha ou caminho inválido -> INVALID_STATE.
 */
export function setIntegratedBreakpoint(
  session: IntegratedDebugSession,
  rootFolder: string,
  relativePath: unknown,
  line: unknown,
): IntegratedDebugSession {
  if (session.status === "terminated") {
    throw new ProtocolError("INVALID_STATE", DEBUG_SESSION_TERMINATED_MESSAGE, []);
  }
  const relPath = assertValidRelativePath(relativePath, "breakpointPath");
  const bpLine = assertValidLine(line);
  assertConfinedPath(rootFolder, relPath);

  const newBp: DebugBreakpoint = {
    id: randomUUID(),
    relativePath: relPath,
    line: bpLine,
    verified: true,
  };

  return {
    ...session,
    breakpoints: [...session.breakpoints, newBp],
  };
}

/**
 * Remove um breakpoint existente na sessão.
 */
export function removeIntegratedBreakpoint(
  session: IntegratedDebugSession,
  breakpointId: unknown,
): IntegratedDebugSession {
  if (session.status === "terminated") {
    throw new ProtocolError("INVALID_STATE", DEBUG_SESSION_TERMINATED_MESSAGE, []);
  }
  if (typeof breakpointId !== "string" || breakpointId.trim() === "") {
    throw new ProtocolError("INVALID_STATE", DEBUG_BREAKPOINT_NOT_FOUND_MESSAGE, [
      `breakpointId=${String(breakpointId)}`,
    ]);
  }
  const trimmedId = breakpointId.trim();
  const exists = session.breakpoints.some((bp) => bp.id === trimmedId);
  if (!exists) {
    throw new ProtocolError("INVALID_STATE", DEBUG_BREAKPOINT_NOT_FOUND_MESSAGE, [
      `breakpointId=${trimmedId}`,
    ]);
  }

  return {
    ...session,
    breakpoints: session.breakpoints.filter((bp) => bp.id !== trimmedId),
  };
}

/**
 * Continua a execução até atingir o próximo breakpoint (ou pausar).
 */
export function continueIntegratedDebug(
  session: IntegratedDebugSession,
): IntegratedDebugSession {
  if (session.status === "terminated") {
    throw new ProtocolError("INVALID_STATE", DEBUG_SESSION_TERMINATED_MESSAGE, []);
  }
  const firstBp = session.breakpoints[0];
  if (firstBp) {
    return {
      ...session,
      status: "stopped",
      stopReason: "breakpoint",
      currentLine: firstBp.line,
    };
  }
  return {
    ...session,
    status: "running",
    stopReason: null,
    currentLine: null,
  };
}

/**
 * Avança por linha (step over) na sessão de depuração.
 */
export function stepOverIntegratedDebug(
  session: IntegratedDebugSession,
): IntegratedDebugSession {
  if (session.status === "terminated") {
    throw new ProtocolError("INVALID_STATE", DEBUG_SESSION_TERMINATED_MESSAGE, []);
  }
  const nextLine = (session.currentLine ?? 0) + 1;
  return {
    ...session,
    status: "stopped",
    stopReason: "step",
    currentLine: nextLine,
  };
}
