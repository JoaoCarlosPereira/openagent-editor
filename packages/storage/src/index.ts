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
