import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

export const ASK_LOOP_INPUT_KEY = "askLoop";

export type AskLoopToolCall =
  | {
      invocationId: string;
      tool: "file.read";
      permissionRequestId: string;
      relativePath: string;
    }
  | {
      invocationId: string;
      tool: "file.search";
      permissionRequestId: string;
      query: string;
    };

export type AskLoopModelTurn = {
  toolCalls: AskLoopToolCall[];
};

export type AskLoopPlan = {
  turns: AskLoopModelTurn[];
};

function invalidAskLoopPlan(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseToolCall(raw: unknown): AskLoopToolCall {
  if (typeof raw !== "object" || raw === null) {
    invalidAskLoopPlan("toolCall inválido no askLoop.");
  }
  const record = raw as Record<string, unknown>;
  if (!isNonEmptyString(record.invocationId) || !isNonEmptyString(record.permissionRequestId)) {
    invalidAskLoopPlan("toolCall exige invocationId e permissionRequestId.");
  }
  const tool = record.tool;
  if (tool === "file.read") {
    if (!isNonEmptyString(record.relativePath)) {
      invalidAskLoopPlan("file.read exige relativePath.");
    }
    return {
      invocationId: record.invocationId.trim(),
      tool: "file.read",
      permissionRequestId: record.permissionRequestId.trim(),
      relativePath: record.relativePath.trim(),
    };
  }
  if (tool === "file.search") {
    if (!isNonEmptyString(record.query)) {
      invalidAskLoopPlan("file.search exige query.");
    }
    return {
      invocationId: record.invocationId.trim(),
      tool: "file.search",
      permissionRequestId: record.permissionRequestId.trim(),
      query: record.query.trim(),
    };
  }
  invalidAskLoopPlan("Ferramenta não permitida no askLoop (somente leitura e busca).", [
    String(tool),
  ]);
}

function parseModelTurn(raw: unknown): AskLoopModelTurn {
  if (typeof raw !== "object" || raw === null) {
    invalidAskLoopPlan("Turno de modelo inválido no askLoop.");
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.toolCalls) || record.toolCalls.length === 0) {
    invalidAskLoopPlan("Turno de modelo exige toolCalls não vazias.");
  }
  return {
    toolCalls: record.toolCalls.map(parseToolCall),
  };
}

export function parseAskLoopPlan(raw: unknown): AskLoopPlan {
  if (typeof raw !== "object" || raw === null) {
    invalidAskLoopPlan("askLoop inválido.");
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.turns) || record.turns.length === 0) {
    invalidAskLoopPlan("askLoop exige turns não vazios.");
  }
  return {
    turns: record.turns.map(parseModelTurn),
  };
}

/** Extrai plano AGT-01 embutido no texto do UserInput (fixture de modelo para testes e bootstrap). */
export function tryExtractAskLoopPlanFromUserText(text: string | undefined): AskLoopPlan | null {
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
  if (!(ASK_LOOP_INPUT_KEY in envelope)) {
    return null;
  }
  return parseAskLoopPlan(envelope[ASK_LOOP_INPUT_KEY]);
}
