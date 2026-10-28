import { ProtocolError } from "@openagent/protocol";

import type {
  LocalHookAction,
  LocalHookHandlerOutcome,
  RegisteredLocalHook,
} from "./types.js";

/** Teto por handler local — alinhado a PER-02 (cancelamento em ~2s). */
export const DEFAULT_LOCAL_HOOK_HANDLER_TIMEOUT_MS = 2_000;

export interface LocalHookEngineOptions {
  handlerTimeoutMs?: number;
}

export type RegisteredHookInvocation =
  | { kind: "completed"; outcome: LocalHookHandlerOutcome }
  | { kind: "timeout" };

export function resolveHandlerTimeoutMs(options?: LocalHookEngineOptions): number {
  const raw = options?.handlerTimeoutMs;
  if (raw === undefined) {
    return DEFAULT_LOCAL_HOOK_HANDLER_TIMEOUT_MS;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new ProtocolError("INVALID_STATE", "Configuração de hook inválida.", [
      "Campo 'handlerTimeoutMs' deve ser um número positivo.",
    ]);
  }
  return Math.floor(raw);
}

export async function invokeRegisteredHookHandler(
  hook: RegisteredLocalHook,
  action: LocalHookAction,
  timeoutMs: number,
): Promise<RegisteredHookInvocation> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      Promise.resolve(hook.handler(action)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("LOCAL_HOOK_HANDLER_TIMEOUT"));
        }, timeoutMs);
      }),
    ]);
    return { kind: "completed", outcome };
  } catch (error) {
    if (error instanceof Error && error.message === "LOCAL_HOOK_HANDLER_TIMEOUT") {
      return { kind: "timeout" };
    }
    throw error;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
