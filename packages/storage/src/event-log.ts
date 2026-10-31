import type { DatabaseSync } from "node:sqlite";
import {
  HARNESS_EVENT_SCHEMA_VERSION,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  validateHarnessEvent,
  type HarnessEvent,
} from "@openagent/protocol";

export type AppendHarnessEventInput = {
  runId: string;
  type: string;
  payloadRef: string;
  timestamp: number;
};

type HarnessEventRow = {
  sequence: number;
  runId: string;
  type: string;
  schemaVersion: number;
  payloadRef: string;
  timestamp: number;
};

function eventInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function harnessEventFromRow(row: HarnessEventRow): HarnessEvent {
  return {
    sequence: row.sequence,
    runId: row.runId,
    type: row.type,
    schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
    payloadRef: row.payloadRef,
    timestamp: row.timestamp,
  };
}

function nextSequence(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT COALESCE(MAX(sequence), 0) AS maxSeq FROM harness_event")
    .get() as { maxSeq: number };
  return row.maxSeq + 1;
}

function runExists(database: DatabaseSync, runId: string): boolean {
  const row = database
    .prepare("SELECT id FROM run WHERE id = ?")
    .get(runId) as { id?: string } | undefined;
  return row?.id === runId;
}

/**
 * Insere um evento append-only com sequence monotônico atribuído pelo storage.
 */
function validateAppendInput(input: AppendHarnessEventInput): void {
  const probe: HarnessEvent = {
    sequence: 1,
    runId: input.runId,
    type: input.type,
    schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
    payloadRef: input.payloadRef,
    timestamp: input.timestamp,
  };
  const validation = validateHarnessEvent(probe);
  if (!validation.valid) {
    eventInvalid("entrada de evento inválida.", validation.errors);
  }
}

export function appendHarnessEvent(
  database: DatabaseSync,
  input: AppendHarnessEventInput,
): HarnessEvent {
  validateAppendInput(input);

  if (!runExists(database, input.runId)) {
    eventInvalid("runId inexistente para append de evento.", [input.runId]);
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    const sequence = nextSequence(database);
    const event: HarnessEvent = {
      sequence,
      runId: input.runId,
      type: input.type,
      schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
      payloadRef: input.payloadRef,
      timestamp: input.timestamp,
    };

    database
      .prepare(
        `INSERT INTO harness_event(
          sequence, run_id, type, schema_version, payload_ref, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.sequence,
        event.runId,
        event.type,
        event.schemaVersion,
        event.payloadRef,
        event.timestamp,
      );
    database.exec("COMMIT");
    return event;
  } catch (cause) {
    database.exec("ROLLBACK");
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof ProtocolError) {
      throw cause;
    }
    eventInvalid("falha ao persistir evento no log.", [detail]);
  }
}

export function listHarnessEvents(
  database: DatabaseSync,
  runId?: string,
): HarnessEvent[] {
  const rows = runId
    ? (database
        .prepare(
          `SELECT
            sequence,
            run_id AS runId,
            type,
            schema_version AS schemaVersion,
            payload_ref AS payloadRef,
            timestamp
          FROM harness_event
          WHERE run_id = ?
          ORDER BY sequence`,
        )
        .all(runId) as HarnessEventRow[])
    : (database
        .prepare(
          `SELECT
            sequence,
            run_id AS runId,
            type,
            schema_version AS schemaVersion,
            payload_ref AS payloadRef,
            timestamp
          FROM harness_event
          ORDER BY sequence`,
        )
        .all() as HarnessEventRow[]);

  return rows.map(harnessEventFromRow);
}
