import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ProvenanceDocument,
  ValidationErrorDetail,
  ValidationResult,
} from "./types.js";

const require = createRequire(import.meta.url);

type AjvErrorObject = {
  keyword: string;
  instancePath: string;
  schemaPath: string;
  message?: string;
  params?: Record<string, unknown>;
};

type AjvValidateFunction = {
  (data: unknown): boolean;
  errors?: AjvErrorObject[] | null;
};

type Ajv2020Constructor = new (options?: Record<string, unknown>) => {
  compile: (schema: unknown) => AjvValidateFunction;
};

// Carrega a classe Ajv draft 2020-12
const Ajv2020: Ajv2020Constructor = require("ajv/dist/2020.js");

let cachedSchema: Record<string, unknown> | null = null;
let cachedValidateFn: AjvValidateFunction | null = null;

function resolveSchemaPath(): string {
  // Localizado em schemas/provenance.schema.json na raiz do repositório
  return resolve(
    fileURLToPath(new URL("../../../schemas/provenance.schema.json", import.meta.url)),
  );
}

/**
 * Carrega em memória o objeto do JSON Schema draft 2020-12 de proveniência.
 */
export function loadProvenanceSchema(): Record<string, unknown> {
  if (cachedSchema) {
    return cachedSchema;
  }
  const path = resolveSchemaPath();
  const raw = readFileSync(path, "utf8");
  cachedSchema = JSON.parse(raw) as Record<string, unknown>;
  return cachedSchema;
}

function getCompiledValidator(): AjvValidateFunction {
  if (cachedValidateFn) {
    return cachedValidateFn;
  }
  const schema = loadProvenanceSchema();
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });
  cachedValidateFn = ajv.compile(schema);
  return cachedValidateFn;
}

/**
 * Erro estruturado lançado quando um documento de proveniência viola o schema.
 */
export class ProvenanceValidationError extends Error {
  readonly code = "INVALID_PROVENANCE_SCHEMA";
  readonly details: ValidationErrorDetail[];

  constructor(message: string, details: ValidationErrorDetail[]) {
    super(message);
    this.name = "ProvenanceValidationError";
    this.details = details;
  }
}

/**
 * Valida um dado arbitrário contra o schema de proveniência de forma pura (sem lançar erro).
 */
export function validateProvenance(data: unknown): ValidationResult {
  const validator = getCompiledValidator();
  const valid = validator(data);

  if (valid) {
    return {
      valid: true,
      data: data as ProvenanceDocument,
      errors: [],
    };
  }

  const rawErrors = validator.errors ?? [];
  const errors: ValidationErrorDetail[] = rawErrors.map((err) => ({
    keyword: err.keyword,
    instancePath: err.instancePath,
    schemaPath: err.schemaPath,
    message: err.message,
    params: err.params,
  }));

  return {
    valid: false,
    errors,
  };
}

/**
 * Assegura que o dado fornecido é um ProvenanceDocument válido. Lança ProvenanceValidationError em caso de falha.
 */
export function assertProvenance(data: unknown): asserts data is ProvenanceDocument {
  const result = validateProvenance(data);
  if (!result.valid) {
    const summary = result.errors
      .map((e) => `${e.instancePath || "/"}: ${e.message ?? e.keyword}`)
      .join("; ");
    throw new ProvenanceValidationError(
      `Documento de proveniência inválido: ${summary}`,
      result.errors,
    );
  }
}

/**
 * Lê um arquivo do disco, analisa o JSON e valida contra o schema de proveniência.
 */
export async function loadAndValidateProvenanceFile(
  filePath: string,
): Promise<ProvenanceDocument> {
  const content = await readFile(filePath, "utf8");
  const parsed = JSON.parse(content) as unknown;
  assertProvenance(parsed);
  return parsed;
}
