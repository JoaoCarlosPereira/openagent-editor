import { requirementIds } from "./catalog.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type EffectKind = "state" | "event" | "ui" | "diff" | "error" | "accessibility";

export interface Capture {
  schemaVersion: 1;
  scenarioId: string;
  requirementId: string;
  product: "cursor" | "openagent";
  productVersion: string;
  platform: "linux" | "windows" | "macos";
  model: string | null;
  provider: string | null;
  effects: { kind: EffectKind; name: string; value: JsonValue }[];
}

export type CaptureResult =
  | { ok: true; capture: Capture }
  | { ok: false; code: "INVALID_STATE" };

const kinds = new Set(["state", "event", "ui", "diff", "error", "accessibility"]);
const captureKeys = ["schemaVersion", "scenarioId", "requirementId", "product", "productVersion", "platform", "model", "provider", "effects"];
const effectKeys = ["kind", "name", "value"];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function dataKeys(value: object): string[] | null {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return null;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
  }
  return keys as string[];
}

function hasKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = dataKeys(value);
  return keys !== null && keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeJson(value: unknown, parents: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null || parents.has(value)) throw new Error("invalid JSON");
  parents.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error("invalid array prototype");
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || keys[value.length] !== "length") throw new Error("invalid array");
      const result: JsonValue[] = [];
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error("invalid array");
        result.push(normalizeJson(descriptor.value, parents));
      }
      return result;
    }
    if (!record(value)) throw new Error("invalid object");
    const keys = dataKeys(value);
    if (!keys) throw new Error("invalid properties");
    const result: Record<string, JsonValue> = {};
    for (const key of keys.sort()) {
      Object.defineProperty(result, key, {
        value: normalizeJson(value[key], parents), enumerable: true, writable: true, configurable: true,
      });
    }
    return result;
  } finally {
    parents.delete(value);
  }
}

export function normalizeCapture(input: unknown): CaptureResult {
  try {
    if (!record(input) || !hasKeys(input, captureKeys) || input.schemaVersion !== 1 ||
      !text(input.scenarioId) || !text(input.requirementId) || !requirementIds.includes(input.requirementId) ||
      (input.product !== "cursor" && input.product !== "openagent") || !text(input.productVersion) ||
      (input.product === "cursor" && input.productVersion !== "3.24.18") ||
      (input.platform !== "linux" && input.platform !== "windows" && input.platform !== "macos") ||
      !(input.model === null || text(input.model)) || !(input.provider === null || text(input.provider)) ||
      !Array.isArray(input.effects) || input.effects.length === 0) return { ok: false, code: "INVALID_STATE" };

    const normalized = normalizeJson(input.effects, new Set());
    if (!Array.isArray(normalized)) return { ok: false, code: "INVALID_STATE" };
    const effects: Capture["effects"] = [];
    for (const effect of normalized) {
      if (!record(effect) || !hasKeys(effect, effectKeys) || typeof effect.kind !== "string" ||
        !kinds.has(effect.kind) || !text(effect.name) || !("value" in effect)) {
        return { ok: false, code: "INVALID_STATE" };
      }
      effects.push({ kind: effect.kind as EffectKind, name: effect.name, value: effect.value as JsonValue });
    }
    return { ok: true, capture: {
      schemaVersion: 1, scenarioId: input.scenarioId, requirementId: input.requirementId,
      product: input.product, productVersion: input.productVersion, platform: input.platform,
      model: input.model, provider: input.provider, effects,
    } };
  } catch {
    return { ok: false, code: "INVALID_STATE" };
  }
}
