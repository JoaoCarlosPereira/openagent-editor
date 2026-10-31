import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  type PermissionDecideParams,
} from "@openagent/protocol";
import {
  WorkspaceGrantStore,
  issuePermissionGrantFromGate,
  openPermissionExecutionGate,
  resolvePermissionExecutionGate,
  validateGrantScope,
  type GrantScopeKind,
  type PermissionExecutionGate,
  type ToolPermissionRequest,
} from "@openagent/policy";

export type PendingPermissionRecord = {
  gate: PermissionExecutionGate;
  sessionId: string;
  workspaceId: string;
};

export class PermissionService {
  private readonly pending = new Map<string, PendingPermissionRecord>();
  private readonly grantStore: WorkspaceGrantStore;

  constructor(
    private readonly dataRoot: string,
    workspaceId: string,
  ) {
    this.grantStore = new WorkspaceGrantStore(dataRoot, workspaceId);
  }

  registerPendingRequest(
    request: ToolPermissionRequest,
    sessionId: string,
    workspaceId: string,
    preferredScope?: GrantScopeKind,
  ): PermissionExecutionGate {
    const gate = openPermissionExecutionGate(request, preferredScope);
    if (gate.phase !== "pending") {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Gate de permissão inválido.");
    }
    this.pending.set(request.requestId, { gate, sessionId, workspaceId });
    return gate;
  }

  decide(params: PermissionDecideParams, context: { sessionId: string; workspaceId: string; nowMs?: number }): {
    persisted: boolean;
    grantId?: string;
  } {
    const pending = this.pending.get(params.permissionRequestId);
    if (!pending) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Pedido de permissão não encontrado ou já decidido.",
        [`permissionRequestId=${params.permissionRequestId}`],
      );
    }

    if (pending.sessionId !== context.sessionId.trim()) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Pedido de permissão pertence a outra sessão.",
      );
    }

    if (pending.workspaceId !== context.workspaceId.trim()) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Pedido de permissão pertence a outro workspace.",
      );
    }

    const scopeRaw = params.scope ?? pending.gate.request.offeredScopes[0];
    const scopeResult = validateGrantScope(scopeRaw);
    if (!scopeResult.valid) {
      throw new ProtocolError(scopeResult.code, scopeResult.errors.join(" "));
    }

    const resolved = resolvePermissionExecutionGate(
      pending.gate,
      params.decision,
      scopeResult.value,
    );
    this.pending.delete(params.permissionRequestId);

    if (resolved.phase !== "resolved" || resolved.decision !== "allow") {
      return { persisted: false };
    }

    const nowMs = context.nowMs ?? Date.now();
    const grant = issuePermissionGrantFromGate(resolved, params.permissionRequestId, {
      nowMs,
      sessionId: context.sessionId,
      workspaceId: context.workspaceId,
    });
    this.grantStore.persistGrant(grant);
    return { persisted: true, grantId: grant.grantId };
  }

  getPersistedGrant(grantId: string) {
    return this.grantStore.getGrant(grantId);
  }
}

const serviceCache = new Map<string, PermissionService>();

function cacheKey(dataRoot: string, workspaceId: string): string {
  return `${dataRoot}\0${workspaceId}`;
}

export function getPermissionService(dataRoot: string, workspaceId: string): PermissionService {
  const key = cacheKey(dataRoot, workspaceId);
  let service = serviceCache.get(key);
  if (!service) {
    service = new PermissionService(dataRoot, workspaceId);
    serviceCache.set(key, service);
  }
  return service;
}

/** Registro de pedido pendente para testes de integração e futuros dispatchers de ferramenta. */
export function registerPendingToolPermission(
  dataRoot: string,
  workspaceId: string,
  request: ToolPermissionRequest,
  sessionId: string,
  preferredScope?: GrantScopeKind,
): PermissionExecutionGate {
  return getPermissionService(dataRoot, workspaceId).registerPendingRequest(
    request,
    sessionId,
    workspaceId,
    preferredScope,
  );
}

export function resetPermissionServicesForTest(): void {
  serviceCache.clear();
}
