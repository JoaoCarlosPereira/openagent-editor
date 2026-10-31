import { permissionDeniedError, ProtocolError } from "@openagent/protocol";

import type { PolicyCapability, PolicyValidationResult } from "./types.js";

/** Mensagem exibida quando PER-03 bloqueia mutação em Somente leitura. */
export const EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE =
  "Bloqueado pelo modo de execução." as const;

export type ExecutionMode = "standard" | "read_only";

export const EXECUTION_MODES: readonly ExecutionMode[] = ["standard", "read_only"];

const READ_ONLY_BLOCKED_CAPABILITIES: ReadonlySet<PolicyCapability> = new Set([
  "file.write",
  "shell.exec",
  // AUT-02: uso do computador é mutável — bloqueado em Somente leitura (PER-03).
  "computer.use",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateExecutionMode(raw: unknown): PolicyValidationResult<ExecutionMode> {
  if (!isNonEmptyString(raw)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Campo 'executionMode' ausente ou inválido."],
    };
  }
  const mode = raw.trim();
  if (!(EXECUTION_MODES as readonly string[]).includes(mode)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: [`Modo de execução '${mode}' não é suportado.`],
    };
  }
  return { valid: true, value: mode as ExecutionMode };
}

/** Capabilities mutáveis bloqueadas enquanto o modo de execução for Somente leitura (PER-03). */
export function isMutatingPolicyCapability(capability: PolicyCapability): boolean {
  if (READ_ONLY_BLOCKED_CAPABILITIES.has(capability)) {
    return true;
  }
  const segments = capability.split(".");
  const action = segments[segments.length - 1] ?? "";
  return (
    action === "write" ||
    action === "exec" ||
    action === "install" ||
    action === "manage" ||
    action === "spawn" ||
    action === "queue"
  );
}

export function readOnlyExecutionModeBlockedError(): ProtocolError {
  return permissionDeniedError(EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE, [
    EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE,
  ]);
}

/**
 * PER-03: em Somente leitura, recusa gravação de arquivo, comando e demais capabilities mutáveis.
 */
export function assertCapabilityAllowedForExecutionMode(
  executionMode: ExecutionMode,
  capability: PolicyCapability,
): void {
  if (executionMode !== "read_only") {
    return;
  }
  if (!isMutatingPolicyCapability(capability)) {
    return;
  }
  throw readOnlyExecutionModeBlockedError();
}
