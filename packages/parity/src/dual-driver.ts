import { normalizeCapture, type Capture, type EffectKind, type JsonValue } from "./capture.js";
import { requirementIds } from "./catalog.js";

/** Versão do Cursor usada pela paridade diferencial, congelada (VAL-01). */
export const FROZEN_CURSOR_VERSION = "3.24.18";

/** Versão do produto OpenAgent registrada nas capturas do lado OpenAgent. */
export const OPENAGENT_VERSION = "0.3.0";

export interface CaptureEffect {
  kind: EffectKind;
  name: string;
  value: JsonValue;
}

/** Efeitos observáveis por passo da superfície do produto (dry-drive, dados puros). */
export type EffectTable = Record<string, readonly CaptureEffect[]>;

export interface CaptureSurface {
  product: Capture["product"];
  productVersion: string;
  platform: Capture["platform"];
  model: string | null;
  provider: string | null;
  effects: EffectTable;
}

export interface DualScenario {
  scenarioId: string;
  requirementId: string;
  steps: readonly string[];
  cursor: CaptureSurface;
  openagent: CaptureSurface;
}

export type DualCaptureResult =
  | { ok: true; cursor: Capture; openagent: Capture }
  | { ok: false; code: "INVALID_STATE" };

const scenarioKeys = ["scenarioId", "requirementId", "steps", "cursor", "openagent"];
const surfaceKeys = ["product", "productVersion", "platform", "model", "provider", "effects"];
const effectKeys = ["kind", "name", "value"];
const platforms = new Set(["linux", "windows", "macos"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const invalid: () => DualCaptureResult = () => ({ ok: false, code: "INVALID_STATE" });

function validSteps(steps: unknown): steps is string[] {
  return Array.isArray(steps) && steps.length > 0 &&
    steps.every((step) => typeof step === "string" && text(step)) &&
    new Set(steps).size === steps.length;
}

function validSurface(surface: unknown, product: Capture["product"]): surface is CaptureSurface {
  if (!record(surface) || !hasKeys(surface, surfaceKeys)) return false;
  const versionText = text(surface.productVersion);
  const platformValid = typeof surface.platform === "string" && platforms.has(surface.platform);
  const model = surface.model === null || text(surface.model);
  const provider = surface.provider === null || text(surface.provider);
  if (surface.product !== product || !versionText || !platformValid || !model || !provider) return false;
  if (surface.product === "cursor" && surface.productVersion !== FROZEN_CURSOR_VERSION) return false;
  return record(surface.effects);
}

function driveSurface(
  scenarioId: string,
  requirementId: string,
  steps: readonly string[],
  surface: CaptureSurface,
): Capture | null {
  const effects: Capture["effects"] = [];
  for (const step of steps) {
    const found = surface.effects[step];
    if (!Array.isArray(found)) return null;
    for (const effect of found) {
      if (!record(effect) || !hasKeys(effect, effectKeys)) return null;
      effects.push({
        kind: effect.kind as EffectKind,
        name: effect.name as string,
        value: effect.value as JsonValue,
      });
    }
  }
  const normalized = normalizeCapture({
    schemaVersion: 1,
    scenarioId,
    requirementId,
    product: surface.product,
    productVersion: surface.productVersion,
    platform: surface.platform,
    model: surface.model,
    provider: surface.provider,
    effects,
  });
  return normalized.ok ? normalized.capture : null;
}

/**
 * Dry-drive do mesmo cenário nas duas superfícies e geração de captura dual
 * validada pelo contrato de captura v1 (task_188). Superfícies são tabelas de
 * efeitos puros (dados), sem acoplamento a marca ou binários do Cursor.
 * Entrada ou estado inválido retorna INVALID_STATE sem efeito colateral.
 */
export function driveDualCapture(input: unknown): DualCaptureResult {
  try {
    if (!record(input) || !hasKeys(input, scenarioKeys)) return invalid();
    const scenarioId = input.scenarioId;
    const requirementId = input.requirementId;
    if (!text(scenarioId) || typeof requirementId !== "string") return invalid();
    if (!requirementIds.includes(requirementId)) return invalid();
    if (!validSteps(input.steps)) return invalid();
    const cursor = input.cursor;
    const openagent = input.openagent;
    if (!validSurface(cursor, "cursor") || !validSurface(openagent, "openagent")) return invalid();
    if (cursor.platform !== openagent.platform) return invalid();
    const cursorCapture = driveSurface(scenarioId, requirementId, input.steps, cursor);
    if (cursorCapture === null) return invalid();
    const openagentCapture = driveSurface(scenarioId, requirementId, input.steps, openagent);
    if (openagentCapture === null) return invalid();
    return { ok: true, cursor: cursorCapture, openagent: openagentCapture };
  } catch {
    return invalid();
  }
}
