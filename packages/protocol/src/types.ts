/**
 * Contrato de Envelope de comando mutável para o OpenAgent Protocol.
 * Conforme definido no PRD e na TechSpec (seção "Interfaces Principais").
 *
 * Todo comando mutável contém:
 * - requestId: Identificador único e idempotente da requisição
 * - workspaceId: Workspace associado (rastreabilidade CLI-01 e SES-01)
 * - sessionId: Sessão ativa do agente (rastreabilidade SES-01)
 * - runId: Execução atômica atual dentro da sessão
 * - expectedVersion: Versão inteira não-negativa para controle otimista de concorrência
 * - capability: String identificando a capability requerida (ex: file.write, shell.exec)
 * - payload: Dados opcionais tipados da operação
 * - timestamp: Timestamp opcional da requisição em milissegundos
 * - metadata: Metadados arbitrários opcionais
 */
export interface MutableCommandEnvelope<T = unknown> {
  requestId: string;
  workspaceId: string;
  sessionId: string;
  runId: string;
  expectedVersion: number;
  capability: string;
  payload?: T;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export type CommandEnvelope<T = unknown> = MutableCommandEnvelope<T>;

export type EnvelopeValidationResult<T = unknown> =
  | {
      valid: true;
      value: MutableCommandEnvelope<T>;
    }
  | {
      valid: false;
      code: "INVALID_STATE";
      errors: string[];
    };
