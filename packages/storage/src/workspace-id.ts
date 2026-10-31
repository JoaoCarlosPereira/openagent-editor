import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

/** Identificador seguro para diretório por workspace (um arquivo SQLite por workspace). */
export const WORKSPACE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function assertValidWorkspaceId(workspaceId: string): void {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "workspaceId inválido para storage local.",
      ["workspaceId deve ser alfanumérico com . _ - e até 128 caracteres."],
    );
  }
}
