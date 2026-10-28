import { ProtocolError } from "./errors.js";
import {
  USER_INPUT_EMPTY_MESSAGE,
  type UserContextAttachment,
  type UserInput,
  type UserInputValidationResult,
} from "./user-input.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonEmptyText(text: unknown): boolean {
  return typeof text === "string" && text.trim().length > 0;
}

function parseAttachments(raw: unknown): UserContextAttachment[] | null {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  const parsed: UserContextAttachment[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item["ref"] !== "string" || item["ref"].trim().length === 0) {
      return null;
    }
    parsed.push({ ref: item["ref"].trim() });
  }
  return parsed;
}

/**
 * Valida UserInput antes de enfileirar ou iniciar run.
 * Recusa envio sem texto e sem anexo com a mensagem exata do PRD (VAL-01).
 */
export function validateUserInput(raw: unknown): UserInputValidationResult {
  if (!isRecord(raw)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["UserInput deve ser um objeto JSON não-nulo."],
    };
  }

  const errors: string[] = [];

  if ("text" in raw && raw["text"] !== undefined && typeof raw["text"] !== "string") {
    errors.push("Campo 'text' deve ser string quando presente.");
  }

  const attachments = parseAttachments(raw["attachments"]);
  if (attachments === null) {
    errors.push(
      "Campo 'attachments' deve ser um array de objetos com 'ref' string não-vazia quando presente.",
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors,
    };
  }

  const text = raw["text"];
  const hasText = hasNonEmptyText(text);
  const hasAttachments = (attachments ?? []).length > 0;

  if (!hasText && !hasAttachments) {
    return {
      valid: false,
      code: "INVALID_STATE",
      userMessage: USER_INPUT_EMPTY_MESSAGE,
      errors: [USER_INPUT_EMPTY_MESSAGE],
    };
  }

  const value: UserInput = {};
  if (typeof text === "string") {
    value.text = text;
  }
  if (hasAttachments && attachments) {
    value.attachments = attachments;
  }

  return { valid: true, value };
}

export function assertUserInput(raw: unknown): asserts raw is UserInput {
  const result = validateUserInput(raw);
  if (!result.valid) {
    const message =
      result.userMessage ??
      `UserInput inválido: ${result.errors.join("; ")}`;
    throw new ProtocolError(result.code, message, result.errors);
  }
}
