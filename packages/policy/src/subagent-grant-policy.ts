import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  type InMemoryGrantRegistry,
  issuePermissionGrant,
  type PermissionGrantContext,
} from "./grants.js";
import {
  prepareRunToolPermission,
  type BeginRunToolPermissionInput,
  type RunToolPermissionPrepareResult,
} from "./run-permission.js";
import type { GrantScopeKind, PolicyCapability, PolicyTarget } from "./types.js";

const GRANT_CHECK_PREFIX = "[grant-check:";
const RUN_GRANT_SEED_PREFIX = "[run-grant-seed:";
const DECLARED_CAPS_PREFIX = "[declared-caps:";

export type SubagentGrantCheckSpec = {
  capability: PolicyCapability;
  target: PolicyTarget;
  requestId: string;
};

export type SubagentRunGrantSeed = {
  scope: GrantScopeKind;
  capability: PolicyCapability;
  target: PolicyTarget;
  grantId: string;
};

function parseCapabilityTargetPair(
  capabilityRaw: string,
  targetRaw: string,
): { capability: PolicyCapability; target: PolicyTarget } {
  const capability = capabilityRaw.trim();
  const targetText = targetRaw.trim();
  if (capability.length === 0 || targetText.length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Marcador de grant de subagente inválido.",
    );
  }
  if (capability === "shell.exec") {
    return { capability, target: { kind: "command", command: targetText } };
  }
  if (capability === "file.write" || capability === "file.read") {
    return { capability, target: { kind: "path", path: targetText } };
  }
  throw new ProtocolError(
    PROTOCOL_ERROR_CODES.INVALID_STATE,
    "Capability não suportada em marcador de subagente.",
    [capability],
  );
}

function extractBracketMarker(objective: string, prefix: string): string | null {
  const start = objective.indexOf(prefix);
  if (start < 0) {
    return null;
  }
  const end = objective.indexOf("]", start);
  if (end < 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Marcador de subagente malformado.",
      [prefix],
    );
  }
  return objective.slice(start + prefix.length, end);
}

export function parseSubagentGrantCheck(objective: string): SubagentGrantCheckSpec | null {
  const inner = extractBracketMarker(objective, GRANT_CHECK_PREFIX);
  if (inner === null) {
    return null;
  }
  const parts = inner.split(":");
  if (parts.length < 2) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "grant-check exige capability e alvo.",
    );
  }
  const capability = parts[0]?.trim() ?? "";
  const targetRaw = parts.slice(1).join(":").trim();
  const parsed = parseCapabilityTargetPair(capability, targetRaw);
  return {
    ...parsed,
    requestId: `subagent-grant-check-${parsed.capability}-${parsed.target.kind}`,
  };
}

export function parseSubagentRunGrantSeeds(objective: string): SubagentRunGrantSeed[] {
  const seeds: SubagentRunGrantSeed[] = [];
  let cursor = 0;
  while (cursor < objective.length) {
    const start = objective.indexOf(RUN_GRANT_SEED_PREFIX, cursor);
    if (start < 0) {
      break;
    }
    const end = objective.indexOf("]", start);
    if (end < 0) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "run-grant-seed malformado.",
      );
    }
    const inner = objective.slice(start + RUN_GRANT_SEED_PREFIX.length, end);
    const parts = inner.split(":");
    if (parts.length < 3) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "run-grant-seed exige escopo, capability e alvo.",
      );
    }
    const scopeRaw = parts[0]?.trim() ?? "";
    const capability = parts[1]?.trim() ?? "";
    const targetRaw = parts.slice(2).join(":").trim();
    if (scopeRaw !== "once" && scopeRaw !== "session" && scopeRaw !== "workspace") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Escopo de run-grant-seed inválido.",
        [scopeRaw],
      );
    }
    const parsed = parseCapabilityTargetPair(capability, targetRaw);
    seeds.push({
      scope: scopeRaw,
      ...parsed,
      grantId: `seed-${scopeRaw}-${parsed.capability}-${seeds.length}`,
    });
    cursor = end + 1;
  }
  return seeds;
}

/** Capabilities declaradas no objetivo são informativas e não ampliam grant (PER-01). */
export function parseSubagentDeclaredCapabilities(objective: string): PolicyCapability[] {
  const inner = extractBracketMarker(objective, DECLARED_CAPS_PREFIX);
  if (inner === null) {
    return [];
  }
  return inner
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function stripSubagentObjectiveMarkers(objective: string): string {
  return objective
    .replace(/\[delay:\d+\]\s*/g, "")
    .replace(/\[grant-check:[^\]]+\]\s*/g, "")
    .replace(/\[run-grant-seed:[^\]]+\]\s*/g, "")
    .replace(/\[declared-caps:[^\]]+\]\s*/g, "")
    .trim();
}

export function seedRunGrantsFromSubagentObjective(
  objective: string,
  registry: InMemoryGrantRegistry,
  grantContext: PermissionGrantContext,
): void {
  for (const seed of parseSubagentRunGrantSeeds(objective)) {
    const grant = issuePermissionGrant({
      grantId: seed.grantId,
      scope: seed.scope,
      context: grantContext,
      request: {
        requestId: seed.grantId,
        capability: seed.capability,
        target: seed.target,
        offeredScopes: ["once", "session", "workspace"],
        defaultScope: seed.scope,
      },
    });
    registry.register(grant);
  }
}

/**
 * Subagente consulta grants do run pai; não emite grants novos por capabilities declaradas.
 */
export function prepareInheritedSubagentToolPermission(
  input: BeginRunToolPermissionInput,
  options: {
    parentGrants: InMemoryGrantRegistry;
    grantContext: PermissionGrantContext;
    /** Informativo (PER-01): não amplia grants do run pai. */
    declaredCapabilities?: readonly PolicyCapability[];
  },
): RunToolPermissionPrepareResult {
  void options.declaredCapabilities;
  return prepareRunToolPermission(input, {
    grants: options.parentGrants,
    grantContext: options.grantContext,
  });
}
