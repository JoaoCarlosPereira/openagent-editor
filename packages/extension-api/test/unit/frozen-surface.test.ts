/**
 * frozen-surface.test.ts — Testes unitários para a superfície congelada da API
 * de extensões Cursor 3.24.18.
 *
 * Cobertura:
 *   (a) A fixture declara exatamente a superfície congelada esperada.
 *   (b) O validador aceita a superfície congelada.
 *   (c) Caminho de erro: superfície inválida retorna código estável, sem efeito colateral.
 *
 * Cada asserção ataca valor (regra de conjunção/payload).
 *
 * Estratégia de proveniência: behavioral-reimplementation (ADR-002).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  createFrozenSurface,
  FROZEN_EXTENSION_API_VERSION,
  EXPECTED_SURFACE_KEYS,
  type FrozenExtensionApiSurface,
  type CommandsNamespace,
  type WindowNamespace,
  type EnvironmentNamespace,
  type StatusBarItem,
} from "../../src/frozen-surface.js";

import {
  validateFrozenSurface,
  type ValidationIssue,
  type ValidationResult,
  ValidationError,
  isFrozenSurfaceValid,
} from "../../src/validator.js";

// ─── Utilitário helper para acessar campos via keyof ──────────────────────────────

function get(surface: FrozenExtensionApiSurface, key: string): unknown {
  return (surface as unknown as Record<string, unknown>)[key];
}

function set(surface: FrozenExtensionApiSurface, key: string, value: unknown): void {
  (surface as unknown as Record<string, unknown>)[key] = value;
}

// ─── Testes: superfície congelada ────────────────────────────────────────────────

test("[FROZEN-SURFACE] createFrozenSurface deve criar a superfície com todas as 8 chaves", function () {
  const surface = createFrozenSurface();
  const keys = EXPECTED_SURFACE_KEYS.filter((key: string) => {
    return get(surface, key) !== undefined;
  });

  assert.equal(keys.length, 8, "deve conter exatamente 8 chaves");
  assert.deepStrictEqual(keys.sort(), EXPECTED_SURFACE_KEYS.slice().sort(), "chaves devem corresponder à lista esperada");
});

test("[FROZEN-SURFACE] deve ter versão exatamente igual a 3.24.18", function () {
  const surface = createFrozenSurface();
  const actualVersion = get(surface, "version") as string;
  assert.strictEqual(actualVersion, FROZEN_EXTENSION_API_VERSION, "versão deve ser exatamente 3.24.18");
  assert.strictEqual(actualVersion, "3.24.18", "versão deve ser literalmente 3.24.18");
});

test("[FROZEN-SURFACE] namespace commands deve ser um objeto", function () {
  const surface = createFrozenSurface();
  const commands = get(surface, "commands");
  assert.strictEqual(typeof commands, "object", "namespace commands deve ser objeto");
});

test("[FROZEN-SURFACE] namespace window deve ser um objeto", function () {
  const surface = createFrozenSurface();
  const windowNs = get(surface, "window");
  assert.strictEqual(typeof windowNs, "object", "namespace window deve ser objeto");
});

test("[FROZEN-SURFACE] namespace workspace deve ser um objeto", function () {
  const surface = createFrozenSurface();
  const workspaceNs = get(surface, "workspace");
  assert.strictEqual(typeof workspaceNs, "object", "namespace workspace deve ser objeto");
});

test("[FROZEN-SURFACE] namespace languages deve ser um objeto", function () {
  const surface = createFrozenSurface();
  const languagesNs = get(surface, "languages");
  assert.strictEqual(typeof languagesNs, "object", "namespace languages deve ser objeto");
});

test("[FROZEN-SURFACE] namespace env deve ser um objeto", function () {
  const surface = createFrozenSurface();
  const envNs = get(surface, "env");
  assert.strictEqual(typeof envNs, "object", "namespace env deve ser objeto");
});

test("[FROZEN-SURFACE] namespace memento deve ser um objeto", function () {
  const surface = createFrozenSurface();
  const mementoNs = get(surface, "memento");
  assert.strictEqual(typeof mementoNs, "object", "namespace memento deve ser objeto");
});

test("[FROZEN-SURFACE] namespace output deve ser um objeto", function () {
  const surface = createFrozenSurface();
  const outputNs = get(surface, "output");
  assert.strictEqual(typeof outputNs, "object", "namespace output deve ser objeto");
});

test("[FROZEN-SURFACE] commands.registerCommand deve retornar CommandRegistration válida", function () {
  const surface = createFrozenSurface();
  const commands = surface.commands as CommandsNamespace;
  const reg = commands.registerCommand("test.cmd", () => {});
  assert.notStrictEqual(reg, undefined, "registerCommand deve retornar valor");
  assert.strictEqual(typeof reg.commandId, "string", "commandId deve ser string");
  assert.strictEqual(typeof reg.callback, "function", "callback deve ser função");
});

test("[FROZEN-SURFACE] window.createStatusBarItem deve retornar StatusBarItem válida", function () {
  const surface = createFrozenSurface();
  const windowNs = surface.window as WindowNamespace;
  const item = windowNs.createStatusBarItem("test.status", "right") as StatusBarItem;
  assert.notStrictEqual(item, undefined, "createStatusBarItem deve retornar valor");
  assert.strictEqual(item.id, "test.status", "id deve corresponder ao fornecido");
  assert.strictEqual(item.alignment, "right", "alignment deve corresponder ao fornecido");
});

test("[FROZEN-SURFACE] env.version deve refletir a versão congelada", function () {
  const surface = createFrozenSurface();
  const envNs = surface.env as EnvironmentNamespace;
  assert.strictEqual(envNs.version, FROZEN_EXTENSION_API_VERSION, "env.version deve refletir a versão congelada");
});

// ─── Testes: validador — caminho feliz ────────────────────────────────────────────

test("[VALIDATOR] deve validar superfície criada por createFrozenSurface", function () {
  const surface = createFrozenSurface();
  const result: ValidationResult = validateFrozenSurface(surface);

  assert.strictEqual(result.valid, true, "superfície deve ser válida");
  assert.deepStrictEqual(result.issues, [], "não deve haver issues em superfície válida");
});

test("[VALIDATOR] isFrozenSurfaceValid deve retornar true para superfície válida", function () {
  const surface = createFrozenSurface();
  const valid = isFrozenSurfaceValid(surface);
  assert.strictEqual(valid, true, "isFrozenSurfaceValid deve retornar true");
});

// ─── Testes: validador — caminho de erro ──────────────────────────────────────────

test("[VALIDATOR] deve rejeitar superfície com versão incorreta", function () {
  const surface = createFrozenSurface();
  set(surface, "version", "3.25.0");
  const result: ValidationResult = validateFrozenSurface(surface);

  assert.strictEqual(result.valid, false, "superfície com versão errada deve ser inválida");
  const firstIssue = result.issues[0];
  assert.ok(firstIssue !== undefined, "deve haver pelo menos 1 issue");
  assert.strictEqual(firstIssue.code, ValidationError.VERSION_MISMATCH, "code deve ser VERSION_MISMATCH");
});

test("[VALIDATOR] deve rejeitar superfície com namespace commands ausente", function () {
  const surface = createFrozenSurface();
  set(surface, "commands", undefined);
  const result: ValidationResult = validateFrozenSurface(surface);

  assert.strictEqual(result.valid, false, "superfície sem commands deve ser inválida");
  assert.ok(result.issues.length >= 1, "deve haver pelo menos 1 issue");
  const hasMissing = result.issues.some(
    (i: ValidationIssue) => i.code === ValidationError.MISSING_FIELD && i.key === "commands"
  );
  assert.ok(hasMissing, "deve haver issue MISSING_FIELD para commands");
});

test("[VALIDATOR] deve rejeitar superfície com namespace window como string", function () {
  const surface = createFrozenSurface();
  set(surface, "window", "not-an-object");
  const result: ValidationResult = validateFrozenSurface(surface);

  assert.strictEqual(result.valid, false, "namespace window como string deve ser inválido");
  const hasTypeMismatch = result.issues.some(
    (i: ValidationIssue) => i.code === ValidationError.TYPE_MISMATCH && i.key === "window"
  );
  assert.ok(hasTypeMismatch, "deve haver issue TYPE_MISMATCH para window");
});

test("[VALIDATOR] deve rejeitar superfície com múltiplos erros simultâneos", function () {
  const surface = createFrozenSurface();
  set(surface, "commands", undefined);
  set(surface, "workspace", undefined);
  set(surface, "version", "3.25.0");
  const result: ValidationResult = validateFrozenSurface(surface);

  assert.strictEqual(result.valid, false, "superfície multi-erros deve ser inválida");
  assert.strictEqual(result.issues.length, 3, "deve haver exatamente 3 issues (version + 2 namespaces)");
});

test("[VALIDATOR] deve retornar 7 issues para superfície com apenas versão", function () {
  const surface = { version: "3.24.18" } as FrozenExtensionApiSurface;
  const result: ValidationResult = validateFrozenSurface(surface);

  assert.strictEqual(result.valid, false, "superfície vazia deve ser inválida");
  assert.strictEqual(result.issues.length, 7, "deve haver 7 issues para superfície com apenas versão");
});
