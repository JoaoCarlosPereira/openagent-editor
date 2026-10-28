/**
 * validator.ts — Validador determinístico da fixture da superfície congelada.
 *
 * Esta função valida se um objeto superficial satisfaz o contrato congelado
 * da API de extensões Cursor 3.24.18.
 *
 * Regras:
 *   - Nenhuma escrita em disco, nenhuma chamada de rede.
 *   - Caminho de erro retorna código estável sem efeito colateral.
 *   - Cada asserção verifica tipo, presença e valor esperado.
 *
 * Estratégia de proveniência: behavioral-reimplementation (ADR-002).
 */

import type { FrozenExtensionApiSurface } from "./frozen-surface.js";
import {
  FROZEN_EXTENSION_API_VERSION,
  EXPECTED_SURFACE_KEYS,
  EXPECTED_SURFACE_TYPES,
} from "./frozen-surface.js";

// ─── Código de erro estável ──────────────────────────────────────────────────────

/**
 * Código de erro retornado quando a superfície não satisfaz o contrato.
 * Mapeado para o pacote @openagent/protocol.
 *
 * INVALID_STATE = 1 — superfície inválida (chave ausente, tipo errado, versão divergente).
 * MISSING_FIELD = 2 — campo obrigatório faltando.
 */
export enum ValidationError {
  INVALID_STATE = 1,
  MISSING_FIELD = 2,
  TYPE_MISMATCH = 3,
  VERSION_MISMATCH = 4,
}

// ─── Resultado do validador ──────────────────────────────────────────────────────

/**
 * Resultado do validador da superfície congelada.
 * Contém detalhes do erro para diagnóstico sem efeito colateral.
 */
export interface ValidationIssue {
  key: string;
  reason: string;
  code: ValidationError;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

// ─── Validador principal ─────────────────────────────────────────────────────────

/**
 * Valida se uma superfície satisfaz o contrato congelado da API de extensões 3.24.18.
 *
 * @param surface — objeto a ser validado (deve implementar FrozenExtensionApiSurface)
 * @returns ValidationResult com issues (erros) quando inválido
 *
 * Sem efeito colateral: nenhuma escrita, nenhuma chamada de rede.
 */
export function validateFrozenSurface(
  surface: FrozenExtensionApiSurface
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // 1. Verificar versão obrigatoriamente
  const versionKey = "version" as keyof FrozenExtensionApiSurface;
  const versionValue = surface[versionKey];
  if (versionValue !== FROZEN_EXTENSION_API_VERSION) {
    issues.push({
      key: "version",
      reason: `esperado "${FROZEN_EXTENSION_API_VERSION}", obtido "${versionValue}"`,
      code: ValidationError.VERSION_MISMATCH,
    });
  }

  // 2. Verificar cada chave esperada
  for (const key of EXPECTED_SURFACE_KEYS) {
    // 2a. Verificar presença (usar unknown como intermediate cast)
    const value = (surface as unknown as Record<string, unknown>)[key];

    // 2b. Verificar presença
    if (value === undefined || value === null) {
      issues.push({
        key,
        reason: `chave "${key}" ausente na superfície`,
        code: ValidationError.MISSING_FIELD,
      });
      continue;
    }

    // 2c. Verificar tipo esperado (todos os namespaces devem ser objetos)
    const expectedType = EXPECTED_SURFACE_TYPES[key];
    const actualType = typeof value;

    if (expectedType !== undefined && actualType !== expectedType) {
      issues.push({
        key,
        reason: `tipo esperado "${expectedType}", obtido "${actualType}" para chave "${key}"`,
        code: ValidationError.TYPE_MISMATCH,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Atalho: retorna true se a superfície é válida, false caso contrário.
 * Para testes simples de caminho feliz.
 */
export function isFrozenSurfaceValid(surface: FrozenExtensionApiSurface): boolean {
  return validateFrozenSurface(surface).valid;
}
