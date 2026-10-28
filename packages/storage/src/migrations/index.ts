import { migration001InitialSchema } from "./001-initial-schema.js";
import { migration002WorkspaceSessionRun } from "./002-workspace-session-run.js";
import { migration003EventLog } from "./003-event-log.js";
import { migration004CasBlobs } from "./004-cas-blobs.js";
import { migration005MessageToolQueueAgent } from "./005-message-tool-queue-agent.js";
import { migration006ProviderProfile } from "./006-provider-profile.js";
import { migration007MessageFts5 } from "./007-message-fts5.js";
import type { StorageMigration } from "../migration-runner.js";

/** Migrações ordenadas por version (crescente). */
export const STORAGE_MIGRATIONS: StorageMigration[] = [
  migration001InitialSchema,
  migration002WorkspaceSessionRun,
  migration003EventLog,
  migration004CasBlobs,
  migration005MessageToolQueueAgent,
  migration006ProviderProfile,
  migration007MessageFts5,
];
