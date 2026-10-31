export {
  embedTextWithLocalModel,
  cosineSimilarity,
} from "./deterministic-local-embedder.js";
export {
  clearContextChunkVectors,
  ensureContextChunkVectorSchema,
  formatEmbeddingVectorRef,
  EMBEDDING_VECTOR_REF_PREFIX,
  reindexPersistedPathEmbeddingsOnSave,
  removeContextChunkVectorsForPath,
  searchPersistedChunkEmbeddings,
  upsertContextChunkVectorRef,
} from "./chunk-vector-store.js";
export {
  searchHybridContextIndex,
  type SearchHybridContextIndexInput,
} from "./hybrid-context-retrieval.js";
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
