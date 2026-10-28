import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadAndValidateProvenanceFile } from "@openagent/provenance";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import type { LocalEmbeddingModelManifest, RegisteredLocalEmbeddingModel } from "./types.js";

const EMBEDDINGS_DIR = fileURLToPath(new URL(".", import.meta.url));

function modelInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function readManifest(): LocalEmbeddingModelManifest {
  const manifestPath = fileURLToPath(new URL("./local-embedding-model.json", import.meta.url));
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    modelInvalid("Manifesto do modelo local de embeddings ilegível.");
  }
  if (!parsed || typeof parsed !== "object") {
    modelInvalid("Manifesto do modelo local de embeddings malformado.");
  }
  const manifest = parsed as LocalEmbeddingModelManifest;
  if (manifest.schemaVersion !== 1) {
    modelInvalid("Manifesto do modelo local de embeddings: schemaVersion não suportada.");
  }
  if (typeof manifest.modelId !== "string" || !manifest.modelId.trim()) {
    modelInvalid("Manifesto do modelo local de embeddings: modelId inválido.");
  }
  if (!Number.isInteger(manifest.dimensions) || manifest.dimensions <= 0) {
    modelInvalid("Manifesto do modelo local de embeddings: dimensions inválidas.");
  }
  if (manifest.license?.redistributable !== true) {
    modelInvalid("Manifesto do modelo local de embeddings: licença não redistribuível.");
  }
  if (typeof manifest.license?.spdx !== "string" || !manifest.license.spdx.trim()) {
    modelInvalid("Manifesto do modelo local de embeddings: SPDX inválido.");
  }
  if (manifest.provenanceModule !== "packages/context/src/embeddings") {
    modelInvalid("Manifesto do modelo local de embeddings: provenanceModule divergente.");
  }
  return manifest;
}

/**
 * Carrega o modelo local redistribuível e valida proveniência registrada (ADR-002/ADR-004).
 */
export async function loadRedistributableLocalEmbeddingModel(): Promise<RegisteredLocalEmbeddingModel> {
  const provenancePath = fileURLToPath(new URL("./provenance.json", import.meta.url));
  const provenance = await loadAndValidateProvenanceFile(provenancePath);
  if (provenance.module !== "packages/context/src/embeddings") {
    modelInvalid("Proveniência do modelo local de embeddings: module divergente.", [
      provenance.module,
    ]);
  }
  if (provenance.containsCursorBrandAssets !== false) {
    modelInvalid("Proveniência do modelo local de embeddings: marca Cursor proibida.");
  }

  const manifest = readManifest();
  if (manifest.provenanceModule !== provenance.module) {
    modelInvalid("Manifesto e proveniência do modelo local de embeddings não correspondem.");
  }

  return {
    manifest,
    provenanceModule: provenance.module,
  };
}

/** Caminho do diretório de embeddings (útil para empacotamento futuro). */
export function resolveEmbeddingsModuleDirectory(): string {
  return EMBEDDINGS_DIR;
}
