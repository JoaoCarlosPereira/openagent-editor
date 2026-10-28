import type { ProtocolErrorCode } from "@openagent/protocol";

export type GrantScopeKind = "once" | "session" | "workspace";

export type PolicyTargetKind = "path" | "url" | "command" | "resource" | "tool";

export type PolicyTarget =
  | { kind: "path"; path: string }
  | { kind: "url"; url: string }
  | { kind: "command"; command: string }
  | { kind: "resource"; label: string }
  | { kind: "tool"; tool: string; target: string };

/** Capability estável alinhada ao envelope RPC (ex.: file.write). */
export type PolicyCapability = string;

export type SandboxIsolationLevel = "native" | "degraded";

export interface PermissionPrompt {
  /** Ação humana exibida ao usuário (PER-01). */
  action: string;
  /** Alvo legível da operação. */
  target: string;
  /** Escopo oferecido para aceite (once/session/workspace). */
  scope: GrantScopeKind;
  /** Nível de isolamento da execução da ferramenta (ADR-006), quando conhecido. */
  sandboxIsolationLevel?: SandboxIsolationLevel;
  /** Aviso de degradação exibido antes do aceite quando o isolamento não é nativo. */
  degradationNotice?: string;
}

export interface ToolPermissionRequest {
  requestId: string;
  capability: PolicyCapability;
  target: PolicyTarget;
  /** Escopos que o usuário pode escolher ao aceitar. */
  offeredScopes: readonly GrantScopeKind[];
  /** Escopo sugerido na UI quando informado na criação do pedido. */
  defaultScope?: GrantScopeKind;
}

export type PolicyValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; code: Extract<ProtocolErrorCode, "INVALID_STATE">; errors: string[] };

export type PermissionDecision = "allow" | "deny";

export type PermissionExecutionGate =
  | {
      phase: "pending";
      request: ToolPermissionRequest;
      prompt: PermissionPrompt;
    }
  | {
      phase: "resolved";
      request: ToolPermissionRequest;
      prompt: PermissionPrompt;
      decision: PermissionDecision;
      selectedScope: GrantScopeKind;
    };
