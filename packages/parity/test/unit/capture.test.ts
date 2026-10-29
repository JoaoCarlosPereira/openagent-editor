import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCapture } from "../../src/capture.js";

const fixture = (requirementId: string) => ({
  schemaVersion: 1, scenarioId: "synthetic", requirementId,
  product: "cursor", productVersion: "3.24.18", platform: "linux",
  model: null, provider: null,
  effects: [
    { kind: "state", name: "workspace", value: { z: [2, 1], a: { path: "/workspace" } } },
    { kind: "ui", name: "controls", value: ["agent", "mode", "model", "context", "history", "review"] },
    { kind: "accessibility", name: "keyboard", value: true },
  ],
});

test("LOC-01 preserva efeitos e metadados sintéticos, sem comprovar instalação", () => {
  const input = fixture("LOC-01");
  const before = structuredClone(input);
  const result = normalizeCapture(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(input, before);
  assert.deepEqual(result.capture.effects[0]?.value, { a: { path: "/workspace" }, z: [2, 1] });
  assert.equal(result.capture.productVersion, "3.24.18");
  assert.equal(result.capture.platform, "linux");
  assert.deepEqual(normalizeCapture(result.capture), result);
});

test("UI-01 mantém controles e acessibilidade sintéticos e diferenças relevantes", () => {
  const input = fixture("UI-01");
  const original = normalizeCapture(input);
  const changed = fixture("UI-01");
  const controlEffect = changed.effects[1];
  assert.ok(controlEffect);
  controlEffect.value = ["review", "history"];
  const other = normalizeCapture(changed);
  assert.equal(original.ok, true);
  assert.equal(other.ok, true);
  assert.notDeepEqual(original, other);
});

test("normalização ordena chaves recursivamente e conserva sequência de efeitos", () => {
  const first = fixture("LOC-01");
  const second = fixture("LOC-01");
  const workspaceEffect = second.effects[0];
  assert.ok(workspaceEffect);
  workspaceEffect.value = { a: { path: "/workspace" }, z: [2, 1] };
  assert.deepEqual(normalizeCapture(first), normalizeCapture(second));
  second.effects.reverse();
  assert.notDeepEqual(normalizeCapture(first), normalizeCapture(second));
});

test("entrada inválida retorna INVALID_STATE sem alterar os dados", () => {
  for (const invalid of [
    { ...fixture("LOC-01"), schemaVersion: 2 },
    { ...fixture("LOC-01"), productVersion: "3.25" },
    { ...fixture("UNKNOWN") },
    { ...fixture("UI-01"), effects: [] },
    { ...fixture("UI-01"), extra: true },
    { ...fixture("UI-01"), effects: [{ kind: "error", name: "x", value: NaN }] },
    { ...fixture("UI-01"), effects: [{ kind: "error", name: "x", value: undefined }] },
    { ...fixture("UI-01"), effects: [{ kind: "error", name: "x", value: 0, extra: 1 }] },
  ]) {
    const before = structuredClone(invalid);
    assert.deepEqual(normalizeCapture(invalid), { ok: false, code: "INVALID_STATE" });
    assert.deepEqual(invalid, before);
  }
});

test("rejeita ciclos, arrays esparsos, acessores e valores não JSON", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const sparse = Array(2);
  const accessor = Object.defineProperty({}, "hidden", { enumerable: true, get: () => 1 });
  for (const value of [circular, sparse, accessor, new Date(), Infinity, 1n]) {
    const input = { ...fixture("LOC-01"), effects: [{ kind: "state", name: "x", value }] };
    assert.deepEqual(normalizeCapture(input), { ok: false, code: "INVALID_STATE" });
  }
});

test("rejeita arrays com protótipos não suportados sem mutar entrada", () => {
  class CustomArray<T> extends Array<T> {
    toJSON() { return "custom"; }
  }

  const subclass = new CustomArray(1, 2);
  const altered = [1, 2];
  const alteredPrototype = Object.create(Array.prototype) as object;
  Object.setPrototypeOf(altered, alteredPrototype);
  for (const value of [subclass, altered]) {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const input = { ...fixture("LOC-01"), effects: [{ kind: "state", name: "x", value }] };
    assert.deepEqual(normalizeCapture(input), { ok: false, code: "INVALID_STATE" });
    assert.equal(Object.getPrototypeOf(value), prototype);
    assert.deepEqual(Object.getOwnPropertyDescriptors(value), descriptors);
    assert.equal(input.effects[0]?.value, value);
  }

  const effects = new CustomArray({ kind: "state", name: "x", value: 1 });
  const effectsDescriptors = Object.getOwnPropertyDescriptors(effects);
  const input = { ...fixture("LOC-01"), effects };
  assert.deepEqual(normalizeCapture(input), { ok: false, code: "INVALID_STATE" });
  assert.equal(input.effects, effects);
  assert.equal(Object.getPrototypeOf(effects), CustomArray.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptors(effects), effectsDescriptors);

  const alteredEffects = [{ kind: "state", name: "x", value: 1 }];
  Object.setPrototypeOf(alteredEffects, alteredPrototype);
  const alteredDescriptors = Object.getOwnPropertyDescriptors(alteredEffects);
  const alteredInput = { ...fixture("UI-01"), effects: alteredEffects };
  assert.deepEqual(normalizeCapture(alteredInput), { ok: false, code: "INVALID_STATE" });
  assert.equal(alteredInput.effects, alteredEffects);
  assert.equal(Object.getPrototypeOf(alteredEffects), alteredPrototype);
  assert.deepEqual(Object.getOwnPropertyDescriptors(alteredEffects), alteredDescriptors);
});
