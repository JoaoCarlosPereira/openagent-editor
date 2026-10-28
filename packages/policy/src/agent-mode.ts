import { permissionDeniedError, ProtocolError, type AgentMode } from "@openagent/protocol";

import { isMutatingPolicyCapability } from "./execution-mode.js";
import type { PolicyCapability, PolicyValidationResult } from "./types.js";

/** Mensagem exibida quando AGT-01 bloqueia mutação no modo Ask. */
export const AGENT_MODE_ASK_BLOCKED_MESSAGE = "Bloqueado pelo modo Ask." as const;

export const POLICY_AGENT_MODES: readonly AgentMode[] = ["ask", "plan", "agent", "debug"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validatePolicyAgentMode(raw: unknown): PolicyValidationResult<AgentMode> {
  if (!isNonEmptyString(raw)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Campo 'mode' ausente ou inválido."],
    };
  }
  const mode = raw.trim() as AgentMode;
  if (!(POLICY_AGENT_MODES as readonly string[]).includes(mode)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: [`Modo '${mode}' não é suportado.`],
    };
  }
  return { valid: true, value: mode };
}

export function askAgentModeBlockedError(): ProtocolError {
  return permissionDeniedError(AGENT_MODE_ASK_BLOCKED_MESSAGE, [AGENT_MODE_ASK_BLOCKED_MESSAGE]);
}

/** Capabilities de agente (Git CLI) bloqueadas no modo Ask — distintas de leitura de arquivo. */
const ASK_BLOCKED_NON_FILE_READ_CAPABILITIES: ReadonlySet<PolicyCapability> = new Set([
  "git.status",
  "git.diff",
]);

function isBlockedInAskAgentMode(capability: PolicyCapability): boolean {
  if (isMutatingPolicyCapability(capability)) {
    return true;
  }
  return ASK_BLOCKED_NON_FILE_READ_CAPABILITIES.has(capability);
}

/**
 * AGT-01: em Ask, recusa gravação de arquivo, comando e demais capabilities mutáveis;
 * leitura e busca permanecem permitidas.
 */
export function assertCapabilityAllowedForAgentMode(
  agentMode: AgentMode,
  capability: PolicyCapability,
): void {
  if (agentMode !== "ask") {
    return;
  }
  if (!isBlockedInAskAgentMode(capability)) {
    return;
  }
  throw askAgentModeBlockedError();
}
