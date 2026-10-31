import { ProtocolError } from "@openagent/protocol";

import {
  formatStandardLogToolAction,
  redactForStandardLog,
  type StandardLogToolActionInput,
} from "./redaction.js";
import type { PolicyValidationResult } from "./types.js";

export const STRUCTURED_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type StructuredLogLevel = (typeof STRUCTURED_LOG_LEVELS)[number];

/** Campos de correlação do log local (TechSpec — Monitoramento). */
export type LocalStructuredLogContext = {
  traceId?: string;
  sessionId?: string;
  runId?: string;
  agentId?: string;
};

export type StructuredLogWriteInput = LocalStructuredLogContext & {
  level: StructuredLogLevel;
  message: string;
  tool?: string;
  durationMs?: number;
  state?: string;
  errorCode?: string;
  [key: string]: unknown;
};

export type StructuredLogSink = (line: string) => void;

export type LocalStructuredLogger = {
  readonly context: Readonly<LocalStructuredLogContext>;
  withContext(partial: LocalStructuredLogContext): LocalStructuredLogger;
  formatEntry(input: StructuredLogWriteInput): Record<string, unknown>;
  write(input: StructuredLogWriteInput): void;
  writeToolAction(
    input: StandardLogToolActionInput & Partial<LocalStructuredLogContext>,
  ): void;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pickContextFields(
  record: Record<string, unknown>,
): LocalStructuredLogContext {
  const context: LocalStructuredLogContext = {};
  for (const key of ["traceId", "sessionId", "runId", "agentId"] as const) {
    const value = record[key];
    if (isNonEmptyString(value)) {
      context[key] = value.trim();
    }
  }
  return context;
}

export function validateStructuredLogWriteInput(
  raw: unknown,
): PolicyValidationResult<StructuredLogWriteInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Entrada de log estruturado inválida (objeto esperado)."],
    };
  }
  const record = raw as Record<string, unknown>;
  const level = record.level;
  if (
    !isNonEmptyString(level) ||
    !(STRUCTURED_LOG_LEVELS as readonly string[]).includes(level.trim())
  ) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Campo 'level' ausente ou inválido (debug|info|warn|error)."],
    };
  }
  if (!isNonEmptyString(record.message)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Campo 'message' ausente ou inválido (string não-vazia)."],
    };
  }
  return {
    valid: true,
    value: {
      ...record,
      level: level.trim() as StructuredLogLevel,
      message: record.message.trim(),
      ...pickContextFields(record),
    } as StructuredLogWriteInput,
  };
}

function mergeLogContext(
  base: LocalStructuredLogContext,
  input: LocalStructuredLogContext,
): LocalStructuredLogContext {
  return {
    traceId: input.traceId ?? base.traceId,
    sessionId: input.sessionId ?? base.sessionId,
    runId: input.runId ?? base.runId,
    agentId: input.agentId ?? base.agentId,
  };
}

function buildStructuredLogRecord(
  context: LocalStructuredLogContext,
  input: StructuredLogWriteInput,
): Record<string, unknown> {
  const validated = validateStructuredLogWriteInput(input);
  if (!validated.valid) {
    throw new ProtocolError(
      validated.code,
      validated.errors[0] ?? "Entrada inválida.",
      validated.errors,
    );
  }
  const mergedContext = mergeLogContext(context, validated.value);
  const { level, message, ...rest } = validated.value;
  return redactForStandardLog({
    kind: "structured_log",
    level,
    message,
    ...mergedContext,
    ...rest,
  });
}

function createLoggerInstance(
  context: LocalStructuredLogContext,
  sink: StructuredLogSink,
): LocalStructuredLogger {
  return {
    context,
    withContext(partial) {
      return createLoggerInstance(mergeLogContext(context, partial), sink);
    },
    formatEntry(input) {
      return buildStructuredLogRecord(context, input);
    },
    write(input) {
      sink(JSON.stringify(buildStructuredLogRecord(context, input)));
    },
    writeToolAction(input) {
      const toolFields = formatStandardLogToolAction(input);
      const mergedContext = mergeLogContext(context, pickContextFields(input));
      sink(
        JSON.stringify(
          redactForStandardLog({
            ...mergedContext,
            ...toolFields,
          }),
        ),
      );
    },
  };
}

/** PRV-02: logger estruturado local que sempre redige campos sensíveis antes de emitir. */
export function createLocalStructuredLogger(
  context: LocalStructuredLogContext = {},
  sink: StructuredLogSink = (line) => {
    process.stderr.write(`${line}\n`);
  },
): LocalStructuredLogger {
  return createLoggerInstance({ ...context }, sink);
}
