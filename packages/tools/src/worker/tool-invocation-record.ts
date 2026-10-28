import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  type HarnessEvent,
} from "@openagent/protocol";
import {
  createLocalStructuredLogger,
  persistHarnessEventWithPayload,
  type LocalStructuredLogger,
  type StandardLogToolActionInput,
} from "@openagent/policy";

export const TOOL_RESULT_EVENT = "tool.result";

export type ToolInvocationRecord = {
  id: string;
  tool: string;
  target: string;
  capability: string;
  state: string;
  resultRef: string | null;
};

export type ToolInvocationResultPayload = {
  runId: string;
  invocation: ToolInvocationRecord;
};

export type PersistToolInvocationInput = {
  runId: unknown;
  invocation: {
    id: unknown;
    tool: unknown;
    target: unknown;
    capability: unknown;
    state: unknown;
  };
  result: unknown;
  durationMs?: number;
  /** Campos extras redigidos no log padrão (PRV-02). */
  log?: StandardLogToolActionInput;
};

export interface ToolInvocationRecordWriter {
  putCasBlob(data: Buffer): { contentRef: string };
  appendHarnessEvent(input: {
    runId: string;
    type: string;
    payloadRef: string;
    timestamp: number;
  }): HarnessEvent;
  applyHarnessEventToProjections?(event: HarnessEvent): void;
}

export type PersistToolInvocationResult = {
  event: HarnessEvent;
  invocation: ToolInvocationRecord;
  resultRef: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidToolInvocationRecord(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function validatePersistInput(input: PersistToolInvocationInput): {
  runId: string;
  invocation: ToolInvocationRecord;
} {
  const errors: string[] = [];
  if (!isNonEmptyString(input.runId)) {
    errors.push("Campo 'runId' ausente ou inválido.");
  }
  const raw = input.invocation;
  if (!raw || typeof raw !== "object") {
    errors.push("Campo 'invocation' inválido.");
  } else {
    for (const field of ["id", "tool", "target", "capability", "state"] as const) {
      if (!isNonEmptyString(raw[field])) {
        errors.push(`Campo 'invocation.${field}' ausente ou inválido.`);
      }
    }
  }
  if (input.result === undefined) {
    errors.push("Campo 'result' ausente.");
  }
  if (errors.length > 0) {
    invalidToolInvocationRecord("Registro de ToolInvocation inválido.", errors);
  }

  const inv = input.invocation as Record<string, unknown>;
  return {
    runId: (input.runId as string).trim(),
    invocation: {
      id: (inv.id as string).trim(),
      tool: (inv.tool as string).trim(),
      target: (inv.target as string).trim(),
      capability: (inv.capability as string).trim(),
      state: (inv.state as string).trim(),
      resultRef: null,
    },
  };
}

function serializeToolResult(result: unknown): Buffer {
  try {
    return Buffer.from(JSON.stringify({ kind: "tool_result", result }), "utf8");
  } catch {
    invalidToolInvocationRecord("result não serializável para CAS.");
  }
}

export function buildToolResultEventPayload(
  runId: string,
  invocation: ToolInvocationRecord,
): ToolInvocationResultPayload {
  return { runId, invocation };
}

export function persistToolInvocationResult(
  writer: ToolInvocationRecordWriter,
  input: PersistToolInvocationInput,
  options?: {
    timestamp?: number;
    logger?: LocalStructuredLogger;
    logSink?: (line: string) => void;
  },
): PersistToolInvocationResult {
  const { runId, invocation: baseInvocation } = validatePersistInput(input);
  const resultPut = writer.putCasBlob(serializeToolResult(input.result));
  const invocation: ToolInvocationRecord = {
    ...baseInvocation,
    resultRef: resultPut.contentRef,
  };

  const payload = buildToolResultEventPayload(runId, invocation);
  const timestamp = options?.timestamp ?? Date.now();
  const event = persistHarnessEventWithPayload(
    writer,
    runId,
    TOOL_RESULT_EVENT,
    payload as unknown as Record<string, unknown>,
    timestamp,
  );
  writer.applyHarnessEventToProjections?.(event);

  const logger =
    options?.logger ??
    createLocalStructuredLogger({ runId }, options?.logSink ?? (() => {}));
  logger.writeToolAction({
    tool: invocation.tool,
    target: invocation.target,
    state: invocation.state,
    durationMs: input.durationMs,
    resultRef: invocation.resultRef,
    ...(input.log ?? {}),
  });

  return { event, invocation, resultRef: resultPut.contentRef };
}
