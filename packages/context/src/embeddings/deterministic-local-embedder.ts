import type { RegisteredLocalEmbeddingModel } from "./types.js";

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizeVector(vector: Float32Array): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const value = vector[i] ?? 0;
    sumSquares += value * value;
  }
  if (sumSquares === 0) {
    return vector;
  }
  const scale = 1 / Math.sqrt(sumSquares);
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] = (vector[i] ?? 0) * scale;
  }
  return vector;
}

/**
 * Runtime determinístico local até o ONNX empacotado (mesmas dimensões do manifesto).
 */
export function embedTextWithLocalModel(
  model: RegisteredLocalEmbeddingModel,
  text: string,
): Float32Array {
  const dimensions = model.manifest.dimensions;
  const vector = new Float32Array(dimensions);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    const bucket = fnv1a32(token, 0x811c9dc5) % dimensions;
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }

  return normalizeVector(vector);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}
