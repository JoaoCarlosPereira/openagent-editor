import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

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
