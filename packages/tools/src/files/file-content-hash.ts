import { createHash } from "node:crypto";

/** SHA-256 hex de conteúdo UTF-8 (paridade com CAS local). */
export function sha256HexUtf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value.trim());
}
