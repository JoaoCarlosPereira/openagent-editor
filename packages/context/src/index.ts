export {
  buildContextSendPreview,
  type BuildContextSendPreviewInput,
} from "./attachments/preview.js";
export { buildExternalContextUserContent } from "./attachments/external-payload.js";
export {
  DEFAULT_CONTEXT_TOKEN_LIMIT,
  estimateContextTokens,
  resolveContextTokenLimit,
  resolveStoredWorkspaceContextLimit,
  validateContextTokenLimitInput,
} from "./attachments/tokens.js";
export {
  CONTEXT_ATTACHMENT_KINDS,
  type ContextAttachmentDraft,
  type ContextAttachmentKind,
  type ContextAttachmentSource,
  type ContextAttachmentValidationResult,
  type ContextExternalSendParams,
  type ContextExternalSendResult,
  type ContextSendPreview,
  type ContextTokenLimitValidationResult,
} from "./attachments/types.js";
export {
  parseContextAttachmentDrafts,
  validateContextAttachmentDraft,
  type ContextAttachmentListValidationResult,
} from "./attachments/validate.js";
export {
  executeContextAttachRpc,
  type ExecuteContextAttachRpcOptions,
} from "./rpc/context-attach.js";
export {
  executeContextSendRpc,
  type ExecuteContextSendRpcOptions,
} from "./rpc/context-send.js";
export {
  executeContextIndexRpc,
  type ExecuteContextIndexRpcOptions,
} from "./rpc/context-index.js";
export {
  executeContextSearchRpc,
  type ExecuteContextSearchRpcOptions,
} from "./rpc/context-search.js";
export {
  executeContextClearRpc,
} from "./rpc/context-clear.js";
export {
  clearWorkspaceContextIndex,
  type ClearWorkspaceContextIndexResult,
} from "./indexer/clear-context-index.js";
export {
  describeContextIndexSize,
  type ContextIndexSizeSnapshot,
} from "./indexer/describe-context-index.js";
export {
  buildContextExclusionRules,
  evaluateContextPathExclusion,
  filterIncludedContextAttachmentDrafts,
  filterIncludedContextPaths,
  resolveContextExclusionRuleset,
  loadProjectGitignorePatterns,
  parseWorkspaceExclusionPatterns,
  type BuildContextExclusionRulesInput,
  type EvaluateContextPathExclusionInput,
  type WorkspaceExclusionParseResult,
} from "./exclusions/rules.js";
export { parseGitignoreLines } from "./exclusions/gitignore.js";
export {
  CONTEXT_EXCLUSION_SOURCES,
  type ContextExclusionCheckResult,
  type ContextExclusionPattern,
  type ContextExclusionRuleset,
  type ContextExclusionSource,
} from "./exclusions/types.js";
export {
  chunkContextFileText,
  DEFAULT_CONTEXT_INDEX_CHUNK_SIZE,
} from "./indexer/chunk-text.js";
export { hashContextFileContent } from "./indexer/content-hash.js";
export { indexContextFile } from "./indexer/index-context-file.js";
export {
  purgeExcludedContextIndexPaths,
  type PurgeExcludedContextIndexInput,
  type PurgeExcludedContextIndexResult,
} from "./indexer/purge-excluded-context-index.js";
export { removeContextFileIndex } from "./indexer/remove-context-file-index.js";
export {
  clearContextChunkVectors,
  EMBEDDING_VECTOR_REF_PREFIX,
  formatEmbeddingVectorRef,
  loadRedistributableLocalEmbeddingModel,
  reindexPersistedPathEmbeddingsOnSave,
  searchHybridContextIndex,
  searchPersistedChunkEmbeddings,
} from "./embeddings/index.js";
export { reindexContextFileOnSave } from "./indexer/reindex-context-file-on-save.js";
export type { ReindexContextFileOnSaveInput } from "./indexer/reindex-context-file-on-save.js";
export { ensureContextIndexSchema } from "./indexer/schema.js";
export { searchContextIndex } from "./indexer/search-context-index.js";
export type {
  ContextIndexChunk,
  ContextIndexSearchHit,
  IndexContextFileInput,
  IndexContextFileResult,
  SearchContextIndexInput,
  SearchContextIndexResult,
} from "./indexer/types.js";
