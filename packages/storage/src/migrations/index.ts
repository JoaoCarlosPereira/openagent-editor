import { migration001InitialSchema } from "./001-initial-schema.js";
import { migration002WorkspaceSessionRun } from "./002-workspace-session-run.js";
import type { StorageMigration } from "../migration-runner.js";

/** Migrações ordenadas por version (crescente). */
export const STORAGE_MIGRATIONS: StorageMigration[] = [
  migration001InitialSchema,
  migration002WorkspaceSessionRun,
];
