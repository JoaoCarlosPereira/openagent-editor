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

export { deleteSessionStorage, type DeleteSessionStorageResult } from "./delete/index.js";

export {
  exportSessionTextFile,
  type ExportSessionTextFileInput,
  type ExportSessionTextFileResult,
} from "./export/index.js";

export {
  indexMessageFts,
  lexicalTextFromContentRef,
  removeMessageFtsForSession,
  searchSessionMessages,
  type MessageFtsIndexInput,
  type SearchSessionMessagesInput,
  type SearchSessionMessagesResult,
  type SessionMessageSearchHit,
} from "./search/index.js";

export {
  applyHarnessEventToProjections,
  rebuildProjectionsFromEventLog,
  syncSessionResumeProjection,
  type ApplyContext,
  type RebuildProjectionsFromEventLogResult,
} from "./event-log-projections.js";

export {
  listSessionIdsWithCommittedEventLog,
  recoverWorkspaceStorageAfterCrash,
  type RecoverWorkspaceStorageResult,
} from "./storage-recovery.js";

export {
  createWorkspaceStorageBackup,
  restoreWorkspaceStorageBackup,
  type CreateWorkspaceStorageBackupInput,
  type CreateWorkspaceStorageBackupResult,
  type RestoreWorkspaceStorageBackupInput,
  type RestoreWorkspaceStorageBackupResult,
  type WorkspaceStorageBackupManifest,
} from "./storage-backup.js";

export {
  createInMemorySystemSecretVault,
  createLinuxSecretServiceVault,
  createMacOsKeychainVault,
  formatStandardLogToolAction,
  formatSecretRef,
  getStoredProviderProfile,
  OPENAGENT_SECRET_SERVICE,
  parseSecretRef,
  probeOpenAiCompatibleProvider,
  providerAccount,
  providerProfileSqliteContainsPlaintext,
  readProviderCredentialFromVault,
  redactForStandardLog,
  registerProviderCredential,
  registerProviderProfile,
  resolveSystemSecretVault,
  STANDARD_LOG_REDACTED,
  upsertStoredProviderProfile,
  type ProviderCapabilities,
  type RegisterProviderCredentialInput,
  type RegisterProviderCredentialResult,
  type RegisterProviderProfileResult,
  type MacOsSecurityRunner,
  type SecretToolRunner,
  type StandardLogToolActionInput,
  type StoredProviderProfile,
  type SystemSecretVault,
  type SystemSecretVaultBackend,
} from "./secrets/index.js";

export {
  createStoredSession,
  forkStoredSession,
  listStoredSessionsByWorkspace,
  type CreateStoredSessionInput,
  type ForkStoredSessionInput,
  type ForkStoredSessionResult,
  type StoredSession,
  type StoredSessionWithResume,
} from "./sessions/index.js";

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
