import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

function searchInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

export function buildContextFtsMatchExpression(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    searchInvalid("query inválida para busca.");
  }
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" AND ");
}

export function snippetFromLexicalText(
  lexicalText: string,
  query: string,
  maxLen = 120,
): string {
  const lowerText = lexicalText.toLowerCase();
  const firstToken = query.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const index = firstToken.length > 0 ? lowerText.indexOf(firstToken) : 0;
  const start = index >= 0 ? Math.max(0, index - 20) : 0;
  const slice = lexicalText.slice(start, start + maxLen);
  const prefix = start > 0 ? "…" : "";
  const suffix = start + maxLen < lexicalText.length ? "…" : "";
  return `${prefix}${slice}${suffix}`;
}
