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
