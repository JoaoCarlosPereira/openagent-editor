import { ProtocolError } from "@openagent/protocol";

import { formatPolicyTargetDisplay } from "./target.js";
import type {
  GrantScopeKind,
  PermissionExecutionGate,
  PolicyCapability,
  PolicyTarget,
  ToolPermissionRequest,
} from "./types.js";

/** Contexto mínimo para calcular expiração de grants session/workspace. */
export interface PermissionGrantContext {
  nowMs: number;
  sessionId: string;
  workspaceId: string;
  /** Fim esperado da sessão (epoch ms); usado para escopo session. */
  sessionExpiresAtMs?: number;
  /** TTL padrão de workspace quando não houver política externa (ms). */
  workspaceGrantTtlMs?: number;
}

export interface PermissionGrant {
  grantId: string;
  scope: GrantScopeKind;
  capability: PolicyCapability;
  /** Chave estável do alvo (PER-01 / matching de ferramenta). */
  targetPattern: string;
  decision: "allow";
  createdAtMs: number;
  /** null = sem expiração por tempo (somente revogação/consumo). */
  expiresAtMs: number | null;
  sessionId: string;
  workspaceId: string;
  /** Escopo once: invalidado após o primeiro uso bem-sucedido. */
  consumed: boolean;
}

export interface IssuePermissionGrantInput {
  grantId: string;
  request: ToolPermissionRequest;
  scope: GrantScopeKind;
  context: PermissionGrantContext;
}

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_WORKSPACE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function buildTargetPattern(target: PolicyTarget): string {
  return formatPolicyTargetDisplay(target);
}

export function computeGrantExpiresAtMs(
  scope: GrantScopeKind,
  createdAtMs: number,
  context: Pick<PermissionGrantContext, "sessionExpiresAtMs" | "workspaceGrantTtlMs">,
): number | null {
  switch (scope) {
    case "once":
      // once: sem TTL temporal — só consumo/revogação (PER-01).
      return null;
    case "session":
      return context.sessionExpiresAtMs ?? createdAtMs + DEFAULT_SESSION_TTL_MS;
    case "workspace":
      return createdAtMs + (context.workspaceGrantTtlMs ?? DEFAULT_WORKSPACE_TTL_MS);
    default: {
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}

export function validatePermissionGrantContext(
  raw: unknown,
): raw is PermissionGrantContext {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const value = raw as Record<string, unknown>;
  return (
    typeof value["nowMs"] === "number" &&
    Number.isFinite(value["nowMs"]) &&
    typeof value["sessionId"] === "string" &&
    value["sessionId"].trim().length > 0 &&
    typeof value["workspaceId"] === "string" &&
    value["workspaceId"].trim().length > 0
  );
}

export function issuePermissionGrant(input: IssuePermissionGrantInput): PermissionGrant {
  const grantId = input.grantId.trim();
  if (grantId.length === 0) {
    throw new ProtocolError("INVALID_STATE", "grantId não pode ser vazio.", []);
  }
  if (input.request.offeredScopes.includes(input.scope) === false) {
    throw new ProtocolError(
      "INVALID_STATE",
      "Escopo do grant não está entre os escopos oferecidos.",
      [`scope=${input.scope}`],
    );
  }

  const createdAtMs = input.context.nowMs;
  return {
    grantId,
    scope: input.scope,
    capability: input.request.capability,
    targetPattern: buildTargetPattern(input.request.target),
    decision: "allow",
    createdAtMs,
    expiresAtMs: computeGrantExpiresAtMs(input.scope, createdAtMs, input.context),
    sessionId: input.context.sessionId.trim(),
    workspaceId: input.context.workspaceId.trim(),
    consumed: false,
  };
}

export function issuePermissionGrantFromGate(
  gate: Extract<PermissionExecutionGate, { phase: "resolved" }>,
  grantId: string,
  context: PermissionGrantContext,
): PermissionGrant {
  if (gate.decision !== "allow") {
    throw new ProtocolError(
      "INVALID_STATE",
      "Grants só são emitidos após aceite explícito (allow).",
      [`decision=${gate.decision}`],
    );
  }
  return issuePermissionGrant({
    grantId,
    request: gate.request,
    scope: gate.selectedScope,
    context,
  });
}

export function isGrantExpired(grant: PermissionGrant, nowMs: number): boolean {
  if (grant.consumed) {
    return true;
  }
  if (grant.expiresAtMs === null) {
    return false;
  }
  return nowMs > grant.expiresAtMs;
}

export function grantMatchesRequest(
  grant: PermissionGrant,
  capability: PolicyCapability,
  target: PolicyTarget,
  context: PermissionGrantContext,
): boolean {
  if (grant.decision !== "allow") {
    return false;
  }
  if (grant.capability !== capability) {
    return false;
  }
  if (grant.targetPattern !== buildTargetPattern(target)) {
    return false;
  }
  if (isGrantExpired(grant, context.nowMs)) {
    return false;
  }

  switch (grant.scope) {
    case "once":
    case "session":
      return grant.sessionId === context.sessionId.trim();
    case "workspace":
      return grant.workspaceId === context.workspaceId.trim();
    default: {
      const _exhaustive: never = grant.scope;
      return _exhaustive;
    }
  }
}

/** Marca grant once como consumido após execução bem-sucedida. */
export function consumeOnceGrant(grant: PermissionGrant): PermissionGrant {
  if (grant.scope !== "once") {
    throw new ProtocolError(
      "INVALID_STATE",
      "Somente grants once podem ser consumidos.",
      [`scope=${grant.scope}`],
    );
  }
  if (grant.consumed) {
    throw new ProtocolError("INVALID_STATE", "Grant once já foi consumido.", [`grantId=${grant.grantId}`]);
  }
  return { ...grant, consumed: true };
}

export class InMemoryGrantRegistry {
  private readonly grants = new Map<string, PermissionGrant>();

  register(grant: PermissionGrant): void {
    this.grants.set(grant.grantId, grant);
  }

  get(grantId: string): PermissionGrant | undefined {
    return this.grants.get(grantId);
  }

  findActiveGrant(
    capability: PolicyCapability,
    target: PolicyTarget,
    context: PermissionGrantContext,
  ): PermissionGrant | undefined {
    for (const grant of this.grants.values()) {
      if (grantMatchesRequest(grant, capability, target, context)) {
        return grant;
      }
    }
    return undefined;
  }

  update(grant: PermissionGrant): void {
    this.grants.set(grant.grantId, grant);
  }
}
