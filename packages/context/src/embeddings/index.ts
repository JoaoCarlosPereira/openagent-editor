export {
  embedTextWithLocalModel,
  cosineSimilarity,
} from "./deterministic-local-embedder.js";
export {
  createIncrementalChunkEmbeddingIndex,
  reindexPathEmbeddingsOnSave,
  searchIncrementalChunkEmbeddings,
  type IncrementalChunkEmbeddingIndex,
} from "./incremental-chunk-embedding-index.js";
export {
  loadRedistributableLocalEmbeddingModel,
  resolveEmbeddingsModuleDirectory,
} from "./load-redistributable-embedding-model.js";
export type {
  ChunkEmbeddingVector,
  EmbeddingSearchHit,
  IndexedPathEmbeddings,
  LocalEmbeddingModelLicense,
  LocalEmbeddingModelManifest,
  RegisteredLocalEmbeddingModel,
  ReindexPathEmbeddingsOnSaveInput,
  ReindexPathEmbeddingsOnSaveResult,
} from "./types.js";
