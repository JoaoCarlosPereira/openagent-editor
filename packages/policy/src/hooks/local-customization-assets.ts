import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import type { PolicyCapability } from "../types.js";

/** Tipo de ativo local invocável (CUS-02). */
export type LocalCustomizationAssetKind = "command" | "skill" | "plugin";

export type LocalCustomizationAssetLayer = "user" | "project";

export interface LocalCustomizationAssetManifest {
  name: string;
  version?: string;
  description?: string;
}

export interface LoadedLocalCustomizationAsset {
  id: string;
  kind: LocalCustomizationAssetKind;
  layer: LocalCustomizationAssetLayer;
  /** Caminho exibível da origem (ex.: `.cursor/skills/commit/SKILL.md`). */
  origin: string;
  instruction: string;
  manifest?: LocalCustomizationAssetManifest;
  /**
   * Capabilities declaradas no manifesto do plugin (informativas).
   * A invocação nunca registra grants automaticamente (ADR-006 / CUS-02).
   */
  requestedCapabilities?: readonly PolicyCapability[];
  /** Maior valor = maior precedência na mesclagem. */
  precedence: number;
}

export interface LocalCustomizationInvokeDisplay {
  assetId: string;
  kind: LocalCustomizationAssetKind;
  layer: LocalCustomizationAssetLayer;
  origin: string;
  manifest?: LocalCustomizationAssetManifest;
}

export interface LocalCustomizationInvokeResult {
  invokeRef: string;
  instruction: string;
  display: LocalCustomizationInvokeDisplay;
}

/** Evento observável ao invocar comando/skill/plugin local (CUS-02). */
export const LOCAL_CUSTOMIZATION_INVOKED_EVENT_TYPE = "local.customization.invoked" as const;

export type LocalCustomizationInvokedEmission = {
  type: typeof LOCAL_CUSTOMIZATION_INVOKED_EVENT_TYPE;
  sessionId: string;
  invokeRef: string;
  instruction: string;
  display: LocalCustomizationInvokeDisplay;
  /** Capabilities declaradas pelo plugin; vazio para command/skill. */
  declaredPluginCapabilities: readonly PolicyCapability[];
  emittedAt: number;
};

export type LocalCustomizationInvocationOutcome = {
  result: LocalCustomizationInvokeResult;
  invoked: LocalCustomizationInvokedEmission;
};

const INVOKE_REF_PATTERN = /^(skill|command|plugin):[a-zA-Z0-9._-]+$/;

export function parseLocalCustomizationInvokeRef(
  invokeRef: string,
): { kind: LocalCustomizationAssetKind; assetId: string } {
  const trimmed = invokeRef.trim();
  if (!INVOKE_REF_PATTERN.test(trimmed)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Referência de invocação inválida.",
      ["Use skill:{id}, command:{id} ou plugin:{id}."],
    );
  }
  const separator = trimmed.indexOf(":");
  const kind = trimmed.slice(0, separator) as LocalCustomizationAssetKind;
  const assetId = trimmed.slice(separator + 1);
  if (!assetId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Referência de invocação inválida.",
      ["Identificador do ativo ausente."],
    );
  }
  return { kind, assetId };
}

/**
 * Mescla ativos de usuário e projeto: projeto sobrescreve usuário com o mesmo kind+id
 * (CUS-02).
 */
export function mergeLocalCustomizationAssetsByPrecedence(
  userAssets: readonly LoadedLocalCustomizationAsset[],
  projectAssets: readonly LoadedLocalCustomizationAsset[],
): LoadedLocalCustomizationAsset[] {
  const merged = new Map<string, LoadedLocalCustomizationAsset>();
  const key = (asset: LoadedLocalCustomizationAsset) => `${asset.kind}:${asset.id}`;

  for (const asset of userAssets) {
    merged.set(key(asset), { ...asset, precedence: 1, layer: "user" });
  }
  for (const asset of projectAssets) {
    merged.set(key(asset), { ...asset, precedence: 2, layer: "project" });
  }

  return [...merged.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.precedence - right.precedence ||
      left.id.localeCompare(right.id),
  );
}

/** Aplica instrução declarada e retorna origem para exibição (CUS-02). */
export function applyLocalCustomizationInvocation(
  assets: readonly LoadedLocalCustomizationAsset[],
  invokeRef: string,
): LocalCustomizationInvokeResult {
  const { kind, assetId } = parseLocalCustomizationInvokeRef(invokeRef);
  const match = assets.find((asset) => asset.kind === kind && asset.id === assetId);
  if (!match) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Ativo local não encontrado.",
      [`Nenhum ${kind} '${assetId}' carregado para este workspace.`],
    );
  }

  return {
    invokeRef: invokeRef.trim(),
    instruction: match.instruction,
    display: {
      assetId: match.id,
      kind: match.kind,
      layer: match.layer,
      origin: match.origin,
      manifest: match.manifest,
    },
  };
}

/** Monta emissão estruturada de invocação com origem (CUS-02). */
export function buildLocalCustomizationInvokedEmission(input: {
  sessionId: string;
  result: LocalCustomizationInvokeResult;
  declaredPluginCapabilities?: readonly PolicyCapability[];
  emittedAt?: number;
}): LocalCustomizationInvokedEmission {
  return {
    type: LOCAL_CUSTOMIZATION_INVOKED_EVENT_TYPE,
    sessionId: input.sessionId.trim(),
    invokeRef: input.result.invokeRef,
    instruction: input.result.instruction,
    display: input.result.display,
    declaredPluginCapabilities: [...(input.declaredPluginCapabilities ?? [])],
    emittedAt: input.emittedAt ?? Date.now(),
  };
}

function findLoadedAsset(
  assets: readonly LoadedLocalCustomizationAsset[],
  invokeRef: string,
): LoadedLocalCustomizationAsset {
  const { kind, assetId } = parseLocalCustomizationInvokeRef(invokeRef);
  const match = assets.find((asset) => asset.kind === kind && asset.id === assetId);
  if (!match) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Ativo local não encontrado.",
      [`Nenhum ${kind} '${assetId}' carregado para este workspace.`],
    );
  }
  return match;
}

/**
 * Aplica instrução declarada, expõe origem e garante que plugin não amplia grant
 * (capabilities declaradas permanecem informativas; PER-01 continua obrigatório).
 */
export function invokeLocalCustomizationWithGrantPolicy(
  assets: readonly LoadedLocalCustomizationAsset[],
  invokeRef: string,
  input: { sessionId: string; emittedAt?: number },
): LocalCustomizationInvocationOutcome {
  const match = findLoadedAsset(assets, invokeRef);
  const result = applyLocalCustomizationInvocation(assets, invokeRef);
  const declaredPluginCapabilities =
    match.kind === "plugin" ? (match.requestedCapabilities ?? []) : [];

  const invoked = buildLocalCustomizationInvokedEmission({
    sessionId: input.sessionId,
    result,
    declaredPluginCapabilities,
    emittedAt: input.emittedAt,
  });

  return { result, invoked };
}
