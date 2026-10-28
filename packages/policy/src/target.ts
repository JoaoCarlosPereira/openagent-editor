import type { PolicyTarget, PolicyValidationResult } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validatePolicyTarget(raw: unknown): PolicyValidationResult<PolicyTarget> {
  if (!isRecord(raw)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Alvo da permissão deve ser um objeto com campo 'kind'."],
    };
  }

  const kind = raw["kind"];
  if (kind === "path") {
    if (!isNonEmptyString(raw["path"])) {
      return {
        valid: false,
        code: "INVALID_STATE",
        errors: ["Alvo 'path' exige campo 'path' não-vazio."],
      };
    }
    return { valid: true, value: { kind: "path", path: raw["path"].trim() } };
  }

  if (kind === "url") {
    if (!isNonEmptyString(raw["url"])) {
      return {
        valid: false,
        code: "INVALID_STATE",
        errors: ["Alvo 'url' exige campo 'url' não-vazio."],
      };
    }
    return { valid: true, value: { kind: "url", url: raw["url"].trim() } };
  }

  if (kind === "command") {
    if (!isNonEmptyString(raw["command"])) {
      return {
        valid: false,
        code: "INVALID_STATE",
        errors: ["Alvo 'command' exige campo 'command' não-vazio."],
      };
    }
    return { valid: true, value: { kind: "command", command: raw["command"].trim() } };
  }

  if (kind === "resource") {
    if (!isNonEmptyString(raw["label"])) {
      return {
        valid: false,
        code: "INVALID_STATE",
        errors: ["Alvo 'resource' exige campo 'label' não-vazio."],
      };
    }
    return { valid: true, value: { kind: "resource", label: raw["label"].trim() } };
  }

  if (kind === "tool") {
    if (!isNonEmptyString(raw["tool"]) || !isNonEmptyString(raw["target"])) {
      return {
        valid: false,
        code: "INVALID_STATE",
        errors: ["Alvo 'tool' exige campos 'tool' e 'target' não-vazios."],
      };
    }
    return {
      valid: true,
      value: {
        kind: "tool",
        tool: raw["tool"].trim(),
        target: raw["target"].trim(),
      },
    };
  }

  return {
    valid: false,
    code: "INVALID_STATE",
    errors: ["Campo 'kind' de alvo inválido ou ausente."],
  };
}

export function formatPolicyTargetDisplay(target: PolicyTarget): string {
  switch (target.kind) {
    case "path":
      return target.path;
    case "url":
      return target.url;
    case "command":
      return target.command;
    case "resource":
      return target.label;
    case "tool":
      return `${target.tool} → ${target.target}`;
    default: {
      const _exhaustive: never = target;
      return String(_exhaustive);
    }
  }
}
