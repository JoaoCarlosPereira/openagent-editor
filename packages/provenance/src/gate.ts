import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import type {
  ProvenanceGateOptions,
  ProvenanceGateReport,
  ProvenanceViolation,
  ProvenanceViolationCode,
} from "./types.js";
import { validateProvenance } from "./validator.js";

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/schemas/examples/**",
];

function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/");
  let re = "";
  let i = 0;
  while (i < normalized.length) {
    const c = normalized[i];
    if (c === "*" && normalized[i + 1] === "*" && normalized[i + 2] === "/") {
      re += "(?:.*/)?";
      i += 3;
    } else if (c === "*" && normalized[i + 1] === "*") {
      re += ".*";
      i += 2;
    } else if (c === "*") {
      re += "[^/]*";
      i += 1;
    } else if (
      c === "." ||
      c === "?" ||
      c === "+" ||
      c === "(" ||
      c === ")" ||
      c === "[" ||
      c === "]" ||
      c === "{" ||
      c === "}" ||
      c === "^" ||
      c === "$" ||
      c === "|"
    ) {
      re += "\\" + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

async function collectProvenanceFiles(
  dir: string,
  baseDir: string,
  ignoreRegexes: RegExp[],
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(baseDir, fullPath).replace(/\\/g, "/");

    if (ignoreRegexes.some((regex) => regex.test(relPath) || regex.test(`${relPath}/`))) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...(await collectProvenanceFiles(fullPath, baseDir, ignoreRegexes)));
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".provenance.json")) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function calculateSha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export class ProvenanceGateError extends Error {
  readonly code = "PROVENANCE_GATE_FAILED";
  readonly report: ProvenanceGateReport;

  constructor(report: ProvenanceGateReport) {
    super(
      `Gate de proveniência reprovado com ${report.violations.length} violação(ões):\n${report.summary}`,
    );
    this.name = "ProvenanceGateError";
    this.report = report;
  }
}

/**
 * Executa a verificação do gate de proveniência no sistema de arquivos sob a raiz informada.
 */
export async function checkProvenanceGate(
  options?: ProvenanceGateOptions,
): Promise<ProvenanceGateReport> {
  const rootDir = resolve(options?.rootDir ?? process.cwd());
  const ignorePatterns = options?.ignore ?? DEFAULT_IGNORE;
  const ignoreRegexes = ignorePatterns.map((p) => globToRegex(p));
  const verifyDocumentHash = options?.verifyDocumentHash ?? true;

  const files = await collectProvenanceFiles(rootDir, rootDir, ignoreRegexes);
  files.sort();

  const violations: ProvenanceViolation[] = [];
  const filesWithViolations = new Set<string>();

  function recordViolation(
    file: string,
    code: ProvenanceViolationCode,
    message: string,
    details?: unknown,
  ): void {
    violations.push({ file, code, message, details });
    filesWithViolations.add(file);
  }

  for (const file of files) {
    const relFile = relative(rootDir, file).replace(/\\/g, "/");
    let content: string;

    try {
      content = await readFile(file, "utf8");
    } catch (err) {
      recordViolation(
        relFile,
        "FILE_READ_ERROR",
        `Falha ao ler arquivo de proveniência: ${(err as Error).message}`,
      );
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      recordViolation(
        relFile,
        "INVALID_SCHEMA",
        `JSON malformado em arquivo de proveniência: ${(err as Error).message}`,
      );
      continue;
    }

    const valResult = validateProvenance(parsed);
    if (!valResult.valid) {
      recordViolation(
        relFile,
        "INVALID_SCHEMA",
        `Violação de schema no arquivo de proveniência: ${valResult.errors
          .map((e) => `${e.instancePath || "/"}: ${e.message ?? e.keyword}`)
          .join("; ")}`,
        valResult.errors,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawObj = parsed as any;

    if (rawObj?.containsCursorBrandAssets === true) {
      recordViolation(
        relFile,
        "CURSOR_BRAND_ASSETS_FORBIDDEN",
        "containsCursorBrandAssets é true; ativos de marca do Cursor são estritamente proibidos.",
      );
    }

    if (rawObj?.strategy === "direct-authorized") {
      const auth = rawObj.authorization;
      if (!auth || typeof auth !== "object" || typeof auth.documentRef !== "string" || !auth.documentRef.trim()) {
        recordViolation(
          relFile,
          "MISSING_AUTHORIZATION",
          "Estratégia direct-authorized exige bloco authorization com documentRef válido.",
        );
      } else {
        const docRef: string = auth.documentRef;
        const fromRoot = resolve(rootDir, docRef);
        const fromDir = resolve(dirname(file), docRef);

        let resolvedAuthFile: string | null = null;
        if (existsSync(fromRoot)) {
          resolvedAuthFile = fromRoot;
        } else if (existsSync(fromDir)) {
          resolvedAuthFile = fromDir;
        }

        if (!resolvedAuthFile) {
          recordViolation(
            relFile,
            "AUTHORIZATION_DOCUMENT_NOT_FOUND",
            `Documento de autorização referenciado não foi encontrado no sistema de arquivos: ${docRef}`,
          );
        } else if (verifyDocumentHash && typeof auth.documentSha256 === "string" && auth.documentSha256.trim()) {
          try {
            const authContent = await readFile(resolvedAuthFile);
            const actualSha = calculateSha256(authContent);
            if (actualSha.toLowerCase() !== auth.documentSha256.toLowerCase()) {
              recordViolation(
                relFile,
                "AUTHORIZATION_HASH_MISMATCH",
                `Hash SHA-256 do documento referenciado (${actualSha}) diverge do esperado (${auth.documentSha256}).`,
                { expected: auth.documentSha256, actual: actualSha },
              );
            }
          } catch (err) {
            recordViolation(
              relFile,
              "FILE_READ_ERROR",
              `Falha ao ler documento de autorização em ${resolvedAuthFile}: ${(err as Error).message}`,
            );
          }
        }
      }
    }
  }

  const ok = violations.length === 0;
  const filesPassed = files.length - filesWithViolations.size;

  let summary = `Gate de Proveniência: ${files.length} arquivo(s) analisado(s), ${filesPassed} aprovado(s), ${violations.length} violação(ões).`;
  if (violations.length > 0) {
    const details = violations
      .map((v) => `  - [${v.code}] ${v.file}: ${v.message}`)
      .join("\n");
    summary += `\nViolações encontradas:\n${details}`;
  }

  return {
    ok,
    rootDir,
    filesScanned: files.length,
    filesPassed,
    violations,
    summary,
  };
}

/**
 * Assegura que todos os arquivos de proveniência cumprem a política. Lança ProvenanceGateError em caso de violação.
 */
export async function assertProvenanceGate(
  options?: ProvenanceGateOptions,
): Promise<ProvenanceGateReport> {
  const report = await checkProvenanceGate(options);
  if (!report.ok) {
    throw new ProvenanceGateError(report);
  }
  return report;
}

/**
 * Função utilitária para CLI e scripts de build. Emite relatório no console e retorna o exit code (0 ou 1).
 */
export async function runProvenanceGateCli(
  options?: ProvenanceGateOptions,
): Promise<number> {
  const report = await checkProvenanceGate(options);

  if (!options?.silent) {
    if (report.ok) {
      console.log(`[PASS] ${report.summary}`);
    } else {
      console.error(`[FAIL] ${report.summary}`);
    }
  }

  const exitCode = report.ok ? 0 : 1;
  process.exitCode = exitCode;
  return exitCode;
}
