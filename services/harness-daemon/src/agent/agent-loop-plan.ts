import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

export const AGENT_LOOP_INPUT_KEY = "agentLoop";

export type AgentLoopWriteOperation = {
  relativePath: string;
  expectedContentHashHex: string;
  newContent: string;
};

export type AgentLoopToolCall =
  | {
      invocationId: string;
      tool: "file.write.batch";
      permissionRequestId: string;
      operations: AgentLoopWriteOperation[];
    }
  | {
      invocationId: string;
      tool: "shell.exec";
      permissionRequestId: string;
      command: string;
    };

export type AgentLoopModelTurn = {
  toolCalls: AgentLoopToolCall[];
};

export type AgentLoopPlan = {
  turns: AgentLoopModelTurn[];
};

function invalidAgentLoopPlan(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseWriteOperation(raw: unknown): AgentLoopWriteOperation {
  if (typeof raw !== "object" || raw === null) {
    invalidAgentLoopPlan("Operação de escrita inválida no agentLoop.");
  }
  const record = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(record.relativePath) ||
    !isNonEmptyString(record.expectedContentHashHex) ||
    typeof record.newContent !== "string"
  ) {
    invalidAgentLoopPlan("Operação de escrita inválida no agentLoop.");
  }
  return {
    relativePath: record.relativePath.trim(),
    expectedContentHashHex: record.expectedContentHashHex.trim(),
    newContent: record.newContent,
  };
}

function parseToolCall(raw: unknown): AgentLoopToolCall {
  if (typeof raw !== "object" || raw === null) {
    invalidAgentLoopPlan("toolCall inválido no agentLoop.");
  }
  const record = raw as Record<string, unknown>;
  if (!isNonEmptyString(record.invocationId) || !isNonEmptyString(record.permissionRequestId)) {
    invalidAgentLoopPlan("toolCall exige invocationId e permissionRequestId.");
  }
  const tool = record.tool;
  if (tool === "file.write.batch") {
    if (!Array.isArray(record.operations) || record.operations.length === 0) {
      invalidAgentLoopPlan("file.write.batch exige operations não vazias.");
    }
    return {
      invocationId: record.invocationId.trim(),
      tool: "file.write.batch",
      permissionRequestId: record.permissionRequestId.trim(),
      operations: record.operations.map(parseWriteOperation),
    };
  }
  if (tool === "shell.exec") {
    if (!isNonEmptyString(record.command)) {
      invalidAgentLoopPlan("shell.exec exige command.");
    }
    return {
      invocationId: record.invocationId.trim(),
      tool: "shell.exec",
      permissionRequestId: record.permissionRequestId.trim(),
      command: record.command.trim(),
    };
  }
  invalidAgentLoopPlan("Ferramenta não suportada no agentLoop.", [String(tool)]);
}

function parseModelTurn(raw: unknown): AgentLoopModelTurn {
  if (typeof raw !== "object" || raw === null) {
    invalidAgentLoopPlan("Turno de modelo inválido no agentLoop.");
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.toolCalls) || record.toolCalls.length === 0) {
    invalidAgentLoopPlan("Turno de modelo exige toolCalls não vazias.");
  }
  return {
    toolCalls: record.toolCalls.map(parseToolCall),
  };
}

export function parseAgentLoopPlan(raw: unknown): AgentLoopPlan {
  if (typeof raw !== "object" || raw === null) {
    invalidAgentLoopPlan("agentLoop inválido.");
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.turns) || record.turns.length === 0) {
    invalidAgentLoopPlan("agentLoop exige turns não vazios.");
  }
  return {
    turns: record.turns.map(parseModelTurn),
  };
}

/** Extrai plano AGT-03 embutido no texto do UserInput (fixture de modelo para testes e bootstrap). */
export function tryExtractAgentLoopPlanFromUserText(text: string | undefined): AgentLoopPlan | null {
  if (!text || !text.trim().startsWith("{")) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const envelope = parsed as Record<string, unknown>;
  if (!(AGENT_LOOP_INPUT_KEY in envelope)) {
    return null;
  }
  return parseAgentLoopPlan(envelope[AGENT_LOOP_INPUT_KEY]);
}
