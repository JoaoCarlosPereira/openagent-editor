export {
  STORAGE_SCHEMA_VERSION,
  openWorkspaceDatabase,
  resolveWorkspaceDatabasePath,
  type OpenWorkspaceDatabaseOptions,
  type SessionResumeRecord,
  type WorkspaceDatabase,
} from "./workspace-database.js";

export { WORKSPACE_ID_PATTERN, assertValidWorkspaceId } from "./workspace-id.js";

export {
  runStorageMigrations,
  type RunStorageMigrationsResult,
  type StorageMigration,
} from "./migration-runner.js";

export { STORAGE_MIGRATIONS } from "./migrations/index.js";

export {
  appendHarnessEvent,
  listHarnessEvents,
  type AppendHarnessEventInput,
} from "./event-log.js";

export {
  CAS_CONTENT_REF_PREFIX,
  formatCasContentRef,
  parseCasContentRef,
  putCasBlob,
  readCasBlob,
  sha256Hex,
  type PutCasBlobResult,
} from "./cas.js";

export {
  collectUnreferencedCasBlobs,
  releaseCasBlobRef,
  type CollectUnreferencedCasBlobsResult,
} from "./cas-gc.js";

export { deleteSessionStorage, type DeleteSessionStorageResult } from "./delete.js";

export {
  applyHarnessEventToProjections,
  rebuildProjectionsFromEventLog,
  syncSessionResumeProjection,
  type ApplyContext,
  type RebuildProjectionsFromEventLogResult,
} from "./event-log-projections.js";

export {
  insertStoredAgentNode,
  insertStoredMessage,
  insertStoredQueueItem,
  insertStoredToolInvocation,
  listStoredAgentNodes,
  listStoredMessages,
  listStoredQueueItems,
  listStoredToolInvocations,
  removePendingQueueItem,
  type RemovePendingQueueItemResult,
  type StoredAgentNode,
  type StoredMessage,
  type StoredQueueItem,
  type StoredToolInvocation,
} from "./session-projections.js";
