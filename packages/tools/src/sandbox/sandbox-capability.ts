/**
 * Nível de isolamento disponível no SO (ADR-006). Degradação explícita antes do consentimento.
 */
export type SandboxIsolationLevel = "native" | "degraded";

export interface SandboxCapabilitySnapshot {
  level: SandboxIsolationLevel;
  /** Mensagem para UI quando não há primitive nativa completa. */
  degradationNotice?: string;
}

/**
 * Snapshot conservador: worker em thread separada; sandbox OS completa virá em tarefas posteriores.
 */
export function describeSandboxCapability(): SandboxCapabilitySnapshot {
  return {
    level: "degraded",
    degradationNotice:
      "Isolamento via worker thread; sandbox nativa do SO ainda não vinculada neste pacote.",
  };
}
