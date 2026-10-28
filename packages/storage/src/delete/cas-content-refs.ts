import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { CAS_CONTENT_REF_PREFIX } from "../cas.js";

function refInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

export function collectContentRefs(value: unknown, refs: string[]): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    if (value.startsWith(CAS_CONTENT_REF_PREFIX)) {
      refs.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectContentRefs(item, refs);
    }
    return;
  }
  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectContentRefs(entry, refs);
    }
  }
}

export function contentRefsFromJsonField(jsonText: string, fieldLabel: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    refInvalid(`JSON inválido em ${fieldLabel}.`);
  }
  const refs: string[] = [];
  collectContentRefs(parsed, refs);
  return refs;
}

export function dedupeContentRefs(refs: string[]): string[] {
  return [...new Set(refs)];
}
