import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

export const RENDERER_TOOLS_FORBIDDEN_MESSAGE =
  "O renderer do editor OpenAgent não pode invocar ferramentas; use o processo main ligado ao daemon.";

export type EditorProcessRole = "main" | "renderer";

export type RendererToolInvokeAttempt = {
  processRole: EditorProcessRole;
  toolName?: string;
};

/**
 * Fronteira LOC-01: ferramentas só via processo main → daemon.
 * Tentativa a partir do renderer retorna PERMISSION_DENIED sem efeito colateral.
 */
export function assertRendererMayNotInvokeTool(attempt: RendererToolInvokeAttempt): void {
  if (attempt.processRole !== "renderer") {
    return;
  }
  const details = [
    `processRole=${attempt.processRole}`,
    ...(attempt.toolName ? [`toolName=${attempt.toolName}`] : []),
  ];
  throw new ProtocolError(
    PROTOCOL_ERROR_CODES.PERMISSION_DENIED,
    RENDERER_TOOLS_FORBIDDEN_MESSAGE,
    details,
  );
}

export type RendererToolBridge = {
  readonly processRole: "renderer";
  readonly mayInvokeTools: false;
  /** Sempre nega — contrato observável do renderer sem ferramentas. */
  invokeTool(toolName: string): never;
};

/** Ponte exposta ao renderer: sem nodeIntegration de ferramentas / sem HarnessClient. */
export function createRendererToolBridge(): RendererToolBridge {
  return {
    processRole: "renderer",
    mayInvokeTools: false,
    invokeTool(toolName: string): never {
      assertRendererMayNotInvokeTool({ processRole: "renderer", toolName });
      throw new Error("unreachable");
    },
  };
}
