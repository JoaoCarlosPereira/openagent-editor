import { ProtocolError } from "./errors.js";
import type { MutableCommandEnvelope } from "./types.js";
import { validateMutableCommandEnvelope } from "./validator.js";
import { validateUserInput } from "./user-input-validator.js";
import {
  RPC_METHOD,
  RPC_METHOD_SPECS,
  RPC_PROTOCOL_VERSION,
  type AgentMode,
  type RpcMethod,
  type RpcParamsMap,
  isRpcMethod,
} from "./rpc-methods.js";

export interface RpcRequestEnvelope<M extends RpcMethod = RpcMethod>
  extends MutableCommandEnvelope<RpcParamsMap[M]> {
  method: M;
  rpcVersion?: typeof RPC_PROTOCOL_VERSION;
}

export type RpcRequestValidationResult<M extends RpcMethod = RpcMethod> =
  | {
      valid: true;
      value: RpcRequestEnvelope<M>;
      workspaceId: string;
      workspaceBindings: readonly string[];
    }
  | {
      valid: false;
      code: "INVALID_STATE";
      errors: string[];
    };

const AGENT_MODES: readonly AgentMode[] = ["ask", "plan", "agent", "debug"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateAgentMode(value: unknown, field: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!AGENT_MODES.includes(value as AgentMode)) {
    errors.push(`Campo '${field}' deve ser um dos modos: ${AGENT_MODES.join(", ")}.`);
  }
}

function validateParamsForMethod(method: RpcMethod, params: unknown): string[] {
  const errors: string[] = [];

  if (!isRecord(params)) {
    return ["Payload RPC deve ser um objeto JSON não-nulo."];
  }

  switch (method) {
    case RPC_METHOD.SESSION_CREATE:
      validateAgentMode(params["mode"], "mode", errors);
      break;
    case RPC_METHOD.SESSION_LIST:
      if (
        params["limit"] !== undefined &&
        (typeof params["limit"] !== "number" ||
          !Number.isInteger(params["limit"]) ||
          params["limit"] < 1)
      ) {
        errors.push("Campo 'limit' deve ser inteiro >= 1 quando presente.");
      }
      if (params["cursor"] !== undefined && typeof params["cursor"] !== "string") {
        errors.push("Campo 'cursor' deve ser string quando presente.");
      }
      break;
    case RPC_METHOD.SESSION_SEARCH:
      if (!isNonEmptyString(params["query"])) {
        errors.push("Campo obrigatório 'query' ausente ou inválido.");
      }
      break;
    case RPC_METHOD.SESSION_EXPORT:
      if (
        params["format"] !== undefined &&
        params["format"] !== "text" &&
        params["format"] !== "json"
      ) {
        errors.push("Campo 'format' deve ser 'text' ou 'json' quando presente.");
      }
      break;
    case RPC_METHOD.SESSION_DELETE:
      break;
    case RPC_METHOD.SESSION_FORK:
      if (params["branchId"] !== undefined && typeof params["branchId"] !== "string") {
        errors.push("Campo 'branchId' deve ser string quando presente.");
      }
      break;
    case RPC_METHOD.RUN_START:
      validateAgentMode(params["mode"], "mode", errors);
      if (!("input" in params)) {
        errors.push("Campo obrigatório 'input' ausente em run.start.");
      } else {
        const inputResult = validateUserInput(params["input"]);
        if (!inputResult.valid) {
          errors.push(...inputResult.errors.map((msg) => `input: ${msg}`));
        }
      }
      break;
    case RPC_METHOD.RUN_CANCEL:
      if (params["agentId"] !== undefined && !isNonEmptyString(params["agentId"])) {
        errors.push("Campo 'agentId' deve ser string não-vazia quando presente.");
      }
      break;
    case RPC_METHOD.RUN_RESUME:
      if (params["checkpointId"] !== undefined && !isNonEmptyString(params["checkpointId"])) {
        errors.push("Campo 'checkpointId' deve ser string não-vazia quando presente.");
      }
      break;
    case RPC_METHOD.RUN_QUEUE_ADD:
      if (!("input" in params)) {
        errors.push("Campo obrigatório 'input' ausente em run.queue.add.");
      } else {
        const inputResult = validateUserInput(params["input"]);
        if (!inputResult.valid) {
          errors.push(...inputResult.errors.map((msg) => `input: ${msg}`));
        }
      }
      if (
        params["ordinal"] !== undefined &&
        (typeof params["ordinal"] !== "number" ||
          !Number.isInteger(params["ordinal"]) ||
          params["ordinal"] < 0)
      ) {
        errors.push("Campo 'ordinal' deve ser inteiro >= 0 quando presente.");
      }
      break;
    case RPC_METHOD.RUN_QUEUE_REMOVE:
      if (!isNonEmptyString(params["queueItemId"])) {
        errors.push("Campo obrigatório 'queueItemId' ausente ou inválido.");
      }
      break;
    case RPC_METHOD.PERMISSION_DECIDE:
      if (!isNonEmptyString(params["permissionRequestId"])) {
        errors.push("Campo obrigatório 'permissionRequestId' ausente ou inválido.");
      }
      if (params["decision"] !== "allow" && params["decision"] !== "deny") {
        errors.push("Campo obrigatório 'decision' deve ser 'allow' ou 'deny'.");
      }
      break;
    case RPC_METHOD.TOOL_INVOKE:
      if (!isNonEmptyString(params["tool"])) {
        errors.push("Campo obrigatório 'tool' ausente ou inválido.");
      }
      if (!isNonEmptyString(params["target"])) {
        errors.push("Campo obrigatório 'target' ausente ou inválido.");
      }
      if (!isRecord(params["arguments"])) {
        errors.push("Campo obrigatório 'arguments' deve ser um objeto.");
      }
      break;
    case RPC_METHOD.CHECKPOINT_CREATE:
      if (!isRecord(params["baseHashes"])) {
        errors.push("Campo obrigatório 'baseHashes' deve ser um objeto.");
      }
      if (!isRecord(params["resultHashes"])) {
        errors.push("Campo obrigatório 'resultHashes' deve ser um objeto.");
      }
      if (typeof params["patchText"] !== "string" || params["patchText"].trim().length === 0) {
        errors.push("Campo obrigatório 'patchText' ausente ou inválido.");
      }
      if (params["label"] !== undefined && typeof params["label"] !== "string") {
        errors.push("Campo 'label' deve ser string quando presente.");
      }
      break;
    case RPC_METHOD.CHECKPOINT_RESTORE:
      if (!isNonEmptyString(params["checkpointId"])) {
        errors.push("Campo obrigatório 'checkpointId' ausente ou inválido.");
      }
      break;
    case RPC_METHOD.AGENT_SPAWN:
      if (!isNonEmptyString(params["objective"])) {
        errors.push("Campo obrigatório 'objective' ausente ou inválido.");
      }
      break;
    case RPC_METHOD.AGENT_CANCEL:
      if (!isNonEmptyString(params["agentId"])) {
        errors.push("Campo obrigatório 'agentId' ausente ou inválido.");
      }
      break;
    case RPC_METHOD.PROJECT_CREATE:
      if (!isNonEmptyString(params["objective"])) {
        errors.push("Campo obrigatório 'objective' ausente ou inválido.");
      }
      break;
    case RPC_METHOD.PROJECT_ACCEPT:
    case RPC_METHOD.PROJECT_REJECT:
      if (!isNonEmptyString(params["nodeId"])) {
        errors.push("Campo obrigatório 'nodeId' ausente ou inválido.");
      }
      break;
    case RPC_METHOD.CONTEXT_ATTACH:
      if (!Array.isArray(params["attachments"]) || params["attachments"].length === 0) {
        errors.push("Campo obrigatório 'attachments' deve ser array não-vazio.");
      }
      if (
        params["messageText"] !== undefined &&
        typeof params["messageText"] !== "string"
      ) {
        errors.push("Campo 'messageText' deve ser string quando presente.");
      }
      break;
    case RPC_METHOD.CONTEXT_INDEX:
      if (
        params["paths"] !== undefined &&
        (!Array.isArray(params["paths"]) ||
          !params["paths"].every((path) => isNonEmptyString(path)))
      ) {
        errors.push("Campo 'paths' deve ser array de strings não-vazias quando presente.");
      }
      break;
    case RPC_METHOD.CONTEXT_SEARCH:
      if (!isNonEmptyString(params["query"])) {
        errors.push("Campo obrigatório 'query' ausente ou inválido.");
      }
      break;
    case RPC_METHOD.CONTEXT_CLEAR:
      if (
        params["scope"] !== undefined &&
        params["scope"] !== "session" &&
        params["scope"] !== "workspace"
      ) {
        errors.push("Campo 'scope' deve ser 'session' ou 'workspace' quando presente.");
      }
      if (params["previewToken"] !== undefined && !isNonEmptyString(params["previewToken"])) {
        errors.push("Campo 'previewToken' deve ser string não-vazia quando presente.");
      }
      break;
    case RPC_METHOD.CONTEXT_EXCLUSIONS_GET:
    case RPC_METHOD.CONTEXT_CLEAR_PREVIEW:
      break;
    case RPC_METHOD.CONTEXT_EXCLUSIONS_SET:
      if (!Array.isArray(params["patterns"]) || !params["patterns"].every(isNonEmptyString)) {
        errors.push("Campo 'patterns' deve ser array de padrões não-vazios.");
      }
      break;
    case RPC_METHOD.EXTENSION_INSTALL:
      if (!isNonEmptyString(params["packageRef"])) {
        errors.push("Campo obrigatório 'packageRef' ausente ou inválido.");
      }
      break;
    case RPC_METHOD.EXTENSION_ENABLE:
    case RPC_METHOD.EXTENSION_DISABLE:
      if (!isNonEmptyString(params["extensionId"])) {
        errors.push("Campo obrigatório 'extensionId' ausente ou inválido.");
      }
      break;
    default:
      errors.push(`Método RPC não suportado: ${method}`);
  }

  return errors;
}

/**
 * Valida uma chamada RPC completa: método conhecido, envelope mutável e payload tipado.
 * O workspaceId do envelope ancora provedor, modo, regras, MCP e sessões (CLI-01).
 */
export function validateRpcRequest<M extends RpcMethod = RpcMethod>(
  raw: unknown,
): RpcRequestValidationResult<M> {
  if (!isRecord(raw)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Requisição RPC deve ser um objeto JSON não-nulo."],
    };
  }

  const method = raw["method"];
  if (!isRpcMethod(method)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Campo obrigatório 'method' ausente ou não pertence ao catálogo RPC."],
    };
  }

  if (
    raw["rpcVersion"] !== undefined &&
    raw["rpcVersion"] !== RPC_PROTOCOL_VERSION
  ) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: [`Campo 'rpcVersion' deve ser ${RPC_PROTOCOL_VERSION} quando presente.`],
    };
  }

  const envelopeResult = validateMutableCommandEnvelope(raw);
  if (!envelopeResult.valid) {
    return envelopeResult;
  }

  const spec = RPC_METHOD_SPECS[method];
  if (envelopeResult.value.capability !== spec.capability) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: [
        `Capability '${envelopeResult.value.capability}' incompatível com o método '${method}' (esperado '${spec.capability}').`,
      ],
    };
  }

  const paramErrors = validateParamsForMethod(method, envelopeResult.value.payload ?? {});
  if (paramErrors.length > 0) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: paramErrors,
    };
  }

  const value = {
    ...envelopeResult.value,
    method,
    ...(raw["rpcVersion"] !== undefined
      ? { rpcVersion: RPC_PROTOCOL_VERSION }
      : {}),
  } as RpcRequestEnvelope<M>;

  return {
    valid: true,
    value,
    workspaceId: envelopeResult.value.workspaceId,
    workspaceBindings: spec.workspaceBindings,
  };
}

export function assertRpcRequest<M extends RpcMethod = RpcMethod>(
  raw: unknown,
): asserts raw is RpcRequestEnvelope<M> {
  const result = validateRpcRequest<M>(raw);
  if (!result.valid) {
    throw new ProtocolError(
      result.code,
      `Requisição RPC inválida: ${result.errors.join("; ")}`,
      result.errors,
    );
  }
}
