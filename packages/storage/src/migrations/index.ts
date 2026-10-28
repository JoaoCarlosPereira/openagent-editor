import { migration001InitialSchema } from "./001-initial-schema.js";
import { migration002WorkspaceSessionRun } from "./002-workspace-session-run.js";
import { migration003EventLog } from "./003-event-log.js";
import { migration004CasBlobs } from "./004-cas-blobs.js";
import { migration005MessageToolQueueAgent } from "./005-message-tool-queue-agent.js";
import type { StorageMigration } from "../migration-runner.js";

/** Migrações ordenadas por version (crescente). */
export const STORAGE_MIGRATIONS: StorageMigration[] = [
  migration001InitialSchema,
  migration002WorkspaceSessionRun,
  migration003EventLog,
  migration004CasBlobs,
  migration005MessageToolQueueAgent,
];
