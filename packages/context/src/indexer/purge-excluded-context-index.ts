import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { evaluateContextPathExclusion } from "../exclusions/rules.js";
import type { ContextExclusionRuleset } from "../exclusions/types.js";
import { removeContextFileIndex } from "./remove-context-file-index.js";
import { ensureContextIndexSchema } from "./schema.js";

export interface PurgeExcludedContextIndexInput {
  exclusionRuleset: ContextExclusionRuleset;
}

export interface PurgeExcludedContextIndexResult {
  removedPathCount: number;
}

function purgeInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

/**
 * ERR-04: remove trechos de paths que passaram a estar excluídos antes da próxima busca.
 */
export function purgeExcludedContextIndexPaths(
  database: DatabaseSync,
  input: PurgeExcludedContextIndexInput,
): PurgeExcludedContextIndexResult {
  ensureContextIndexSchema(database);

  const rows = database
    .prepare("SELECT path FROM context_index_file")
    .all() as { path: string }[];

  let removedPathCount = 0;
  for (const row of rows) {
    const exclusion = evaluateContextPathExclusion({
      ruleset: input.exclusionRuleset,
      requestedPath: row.path,
    });
    if ("error" in exclusion) {
      purgeInvalid(exclusion.error.message, exclusion.error.details);
    }
    if (!exclusion.included) {
      removeContextFileIndex(database, row.path);
      removedPathCount += 1;
    }
  }

  return { removedPathCount };
}
