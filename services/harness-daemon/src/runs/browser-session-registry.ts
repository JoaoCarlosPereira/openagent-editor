import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";
import { AuthorizedBrowserSession, type BrowserWorkerProcess } from "@openagent/tools";

export interface BrowserSessionRecord {
  runId: string;
  sessionId: string;
  session: AuthorizedBrowserSession;
  worker: BrowserWorkerProcess;
  /** Target CDP já aberto por esta sessão; vazio até a abertura ser concluída. */
  targetId: string;
  /** Última URL autorizada/aberta nesta sessão; usada para validar tool.invoke de clique subsequente. */
  lastUrl: string;
}

/**
 * Registro das sessões de navegador autorizado ativas por run, por conexão RPC (AUT-01).
 * Permite que `run.cancel` encerre o worker real do navegador, impeça novos dispatches (ADR-006)
 * e que `tool.invoke browser.click` reutilize a mesma sessão/target já autorizado.
 */
export class BrowserSessionRegistry {
  private readonly byRunId = new Map<string, BrowserSessionRecord>();

  /** Rejeita registro duplicado para o mesmo runId em vez de sobrescrever silenciosamente a sessão ativa. */
  register(record: BrowserSessionRecord): void {
    if (this.byRunId.has(record.runId)) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Já existe uma sessão de navegador ativa para esta execução.",
      );
    }
    this.byRunId.set(record.runId, record);
  }

  get(runId: string): BrowserSessionRecord | undefined {
    return this.byRunId.get(runId);
  }

  /** Atualiza o target e a URL conhecidos da sessão após a abertura ser concluída. */
  updateTarget(runId: string, targetId: string, url: string): void {
    const record = this.byRunId.get(runId);
    if (!record) return;
    record.targetId = targetId;
    record.lastUrl = url;
  }

  /** Encerra todas as sessões registradas (fim da conexão RPC): nenhum worker sobrevive à conexão. */
  async closeAll(): Promise<void> {
    const runIds = [...this.byRunId.keys()];
    await Promise.allSettled(runIds.map((runId) => this.closeForRun(runId)));
  }

  /** Encerra e remove a sessão de navegador da run, se existir. Idempotente. */
  async closeForRun(runId: string): Promise<boolean> {
    const record = this.byRunId.get(runId);
    if (!record) {
      return false;
    }
    this.byRunId.delete(runId);
    try {
      await record.session.close();
    } finally {
      await record.worker.terminate();
    }
    return true;
  }
}
