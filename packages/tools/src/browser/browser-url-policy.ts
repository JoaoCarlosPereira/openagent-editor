import { fileURLToPath } from "node:url";

import { resolveCanonicalWorkspacePath } from "@openagent/policy";
import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import type { BrowserUrlPolicyOptions } from "./types.js";

const SUPPORTED_SCHEMES = new Set(["http:", "https:", "file:", "about:"]);
const DEFAULT_ALLOWED_SCHEMES = ["http:", "https:", "file:", "about:"] as const;

/**
 * AUT-01: Valida URL para navegação de navegador em target isolado.
 * Retorna URL normalizada ou lança ProtocolError (INVALID_STATE ou OUT_OF_SCOPE).
 */
export function validateBrowserUrl(
  rawUrl: unknown,
  options?: BrowserUrlPolicyOptions,
): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "URL do navegador ausente ou inválida.",
      ["URL deve ser uma string não vazia."],
    );
  }

  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Formato de URL inválido.",
      ["Formato de URL não pôde ser analisado."],
    );
  }

  const configuredSchemes = options?.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  const allowedSchemes = configuredSchemes.filter((scheme) =>
    SUPPORTED_SCHEMES.has(scheme),
  );
  if (!allowedSchemes.includes(parsed.protocol)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
      "Esquema de URL não permitido pelo navegador.",
      [`Esquema não autorizado: ${parsed.protocol}`],
    );
  }

  if (parsed.username || parsed.password) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
      "URLs com credenciais embutidas não são permitidas.",
    );
  }

  if (parsed.protocol === "about:" && parsed.href !== "about:blank") {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
      "Somente about:blank é permitido.",
    );
  }

  if (parsed.protocol === "file:") {
    let filePath: string;
    try {
      filePath = fileURLToPath(parsed.href);
    } catch {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Caminho da URL file:// inválido.",
      );
    }

    if (!options?.workspaceRoot) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
        "URLs file:// exigem um workspace aprovado.",
      );
    }
    const pathResolution = resolveCanonicalWorkspacePath(
      options.workspaceRoot,
      filePath,
    );
    if (!pathResolution.ok) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
        "URL local file:// fora do escopo do workspace.",
        [`Caminho fora do workspace: ${filePath}`],
      );
    }
  }

  if (options?.allowedOrigins && options.allowedOrigins.length > 0 && parsed.protocol !== "about:") {
    if (!options.allowedOrigins.includes(parsed.origin)) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
        "Origem de URL fora do escopo autorizado.",
        [`Origem não autorizada: ${parsed.origin}`],
      );
    }
  }

  if (options?.allowedUrlPrefixes && options.allowedUrlPrefixes.length > 0) {
    const matchesPrefix = options.allowedUrlPrefixes.some((rawPrefix) => {
      try {
        const prefix = new URL(rawPrefix);
        if (prefix.origin !== parsed.origin || !parsed.href.startsWith(prefix.href)) {
          return false;
        }
        const nextCharacter = parsed.href[prefix.href.length];
        return (
          prefix.href.endsWith("/") ||
          nextCharacter === undefined ||
          nextCharacter === "/" ||
          nextCharacter === "?" ||
          nextCharacter === "#"
        );
      } catch {
        return false;
      }
    });
    if (!matchesPrefix) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
        "URL fora do escopo de prefixos autorizados.",
        ["URL não inicia com nenhum dos prefixos autorizados."],
      );
    }
  }

  return parsed.href;
}
