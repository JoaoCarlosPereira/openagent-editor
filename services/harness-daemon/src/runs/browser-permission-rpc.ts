import { DatabaseSync } from "node:sqlite";
import {
  RunToolPermissionFlow,
  persistHarnessEventWithPayload,
  persistPermissionDecidedEvent,
  persistPermissionRequestedEvent,
} from "@openagent/policy";
import {
  ProtocolError,
  PROTOCOL_ERROR_CODES,
  RPC_METHOD,
  type AgentMode,
  type PermissionDecideParams,
  type RpcRequestEnvelope,
  type RpcResultMap,
  type ToolInvokeParams,
} from "@openagent/protocol";
import { openWorkspaceDatabase, type WorkspaceDatabase } from "@openagent/storage";
import {
  AuthorizedBrowserSession,
  CdpTargetManager,
  launchBrowserWorker,
  persistToolInvocationResult,
  preparePolicyBrowserOpen,
  type BrowserWorkerProcess,
} from "@openagent/tools";
import type { DaemonRpcContext } from "./run-rpc-handler.js";

/** Ações de navegador despachávei por tool.invoke (AUT-01). "click" exige sessão já aberta no mesmo target. */
type BrowserToolName = "browser.open" | "browser.click";

type PendingOpen = { kind: "open"; runId: string; sessionId: string; flow: RunToolPermissionFlow; url: string };
type PendingClick = {
  kind: "click";
  runId: string;
  sessionId: string;
  flow: RunToolPermissionFlow;
  selector: string;
  /** requestId original do tool.invoke, usado por AuthorizedBrowserSession.execute(). */
  toolInvokeRequestId: string;
};
type Pending = PendingOpen | PendingClick;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * AUT-01: prepara e decide a abertura e a interação autorizada de navegador via RPC
 * (tool.invoke/permission.decide), despachando o worker real do navegador (ADR-006) na abertura
 * e reaproveitando a mesma sessão/target já autorizado para interações subsequentes (clique).
 */
export class BrowserPermissionRpc {
  private readonly pending = new Map<string, Pending>();

  async dispatch(context: DaemonRpcContext, request: RpcRequestEnvelope):
    Promise<RpcResultMap[typeof RPC_METHOD.TOOL_INVOKE | typeof RPC_METHOD.PERMISSION_DECIDE]> {
    if (request.workspaceId !== context.binding.workspaceId) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Workspace incompatível.");
    }
    const db = openWorkspaceDatabase({ dataRoot: context.dataRoot, workspaceId: request.workspaceId });
    try {
      this.assertRunActive(db, request.runId, request.sessionId);
      if (request.method === RPC_METHOD.TOOL_INVOKE) {
        return this.handleToolInvoke(context, db, request);
      }
      return await this.handlePermissionDecide(context, db, request);
    } finally {
      db.close();
    }
  }

  private assertRunActive(db: WorkspaceDatabase, runId: string, sessionId: string): void {
    const sqlite = new DatabaseSync(db.databasePath);
    try {
      const run = sqlite.prepare("SELECT state FROM run WHERE id = ? AND session_id = ?")
        .get(runId, sessionId) as { state: string } | undefined;
      if (run?.state !== "running") {
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Execução inexistente, terminal ou de outra sessão.");
      }
    } finally {
      sqlite.close();
    }
  }

  private handleToolInvoke(
    context: DaemonRpcContext,
    db: WorkspaceDatabase,
    request: RpcRequestEnvelope,
  ): RpcResultMap[typeof RPC_METHOD.TOOL_INVOKE] {
    const payload = request.payload as ToolInvokeParams;
    if (this.pending.has(request.requestId)) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Identificador de pedido reutilizado.");
    }
    const tool = payload.tool as BrowserToolName;
    if (tool !== "browser.open" && tool !== "browser.click") {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Invocação de navegador inválida ou não suportada.");
    }
    if (payload.expectedHash !== undefined) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Invocação de navegador inválida ou não suportada.");
    }

    const flow = new RunToolPermissionFlow();
    if (tool === "browser.open") {
      if (Object.keys(payload.arguments).length !== 0) {
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Invocação de navegador inválida ou não suportada.");
      }
      const prepared = preparePolicyBrowserOpen(flow, {
        agentMode: context.binding.mode as AgentMode,
        executionMode: "standard",
      }, { runId: request.runId, sessionId: request.sessionId, requestId: request.requestId, url: payload.target });
      if (prepared.permission.phase !== "pending") {
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Pedido de permissão inválido.");
      }
      persistPermissionRequestedEvent(db, request, prepared.permission.request, prepared.permission.gate);
      this.pending.set(request.requestId, {
        kind: "open", runId: request.runId, sessionId: request.sessionId, flow, url: String(payload.target),
      });
      return { pending: true, permissionRequestId: request.requestId, prompt: prepared.permission.prompt };
    }

    // browser.click: exige uma sessão de navegador já aberta e autorizada para este runId,
    // e reusa o target/URL já validado por ela (não é possível clicar fora do target autorizado).
    const record = context.browserSessions.get(request.runId);
    if (!record || record.sessionId !== request.sessionId) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Nenhum navegador autorizado aberto para esta execução.");
    }
    const selector = (payload.arguments as Record<string, unknown>)["selector"];
    if (!isNonEmptyString(selector) || payload.target !== record.lastUrl) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Invocação de navegador inválida ou não suportada.");
    }
    const prepared = record.session.prepare(request.requestId, {
      type: "click", targetId: record.targetId, url: record.lastUrl, selector,
    });
    if (prepared.permission.phase !== "pending") {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Pedido de permissão inválido.");
    }
    persistPermissionRequestedEvent(db, request, prepared.permission.request, prepared.permission.gate);
    this.pending.set(request.requestId, {
      kind: "click", runId: request.runId, sessionId: request.sessionId, flow, selector,
      toolInvokeRequestId: request.requestId,
    });
    return { pending: true, permissionRequestId: request.requestId, prompt: prepared.permission.prompt };
  }

  private async handlePermissionDecide(
    context: DaemonRpcContext,
    db: WorkspaceDatabase,
    request: RpcRequestEnvelope,
  ): Promise<RpcResultMap[typeof RPC_METHOD.PERMISSION_DECIDE]> {
    const payload = request.payload as PermissionDecideParams;
    const pending = this.pending.get(payload.permissionRequestId);
    if (!pending || pending.runId !== request.runId || pending.sessionId !== request.sessionId ||
        (payload.scope !== undefined && payload.scope !== "once")) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Pedido inexistente ou fora do contexto.");
    }
    this.pending.delete(payload.permissionRequestId);

    if (pending.kind === "open") {
      const result = pending.flow.decide(payload.permissionRequestId, payload.decision, "once");
      persistPermissionDecidedEvent(db, request, result.gate);
      if (result.canExecute) {
        // Autorização concedida: dispara o worker real do navegador e executa a abertura (AUT-01 + ADR-006).
        await this.executeAuthorizedOpen(context, db, request, pending);
      }
      return { persisted: true };
    }

    // click: decide direto na sessão já registrada (ela já guarda o pedido preparado por requestId).
    const record = context.browserSessions.get(request.runId);
    if (!record || record.sessionId !== request.sessionId) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Nenhum navegador autorizado aberto para esta execução.");
    }
    const result = record.session.decide(payload.permissionRequestId, payload.decision);
    persistPermissionDecidedEvent(db, request, result.gate);
    if (result.canExecute) {
      await this.executeAuthorizedClick(context, db, request, record, pending.toolInvokeRequestId);
    }
    return { persisted: true };
  }

  private async executeAuthorizedOpen(
    context: DaemonRpcContext,
    db: WorkspaceDatabase,
    request: RpcRequestEnvelope,
    pending: PendingOpen,
  ): Promise<void> {
    let worker: BrowserWorkerProcess | undefined;
    try {
      worker = await launchBrowserWorker();
      const session = new AuthorizedBrowserSession(
        request.runId,
        request.sessionId,
        { agentMode: context.binding.mode as AgentMode, executionMode: "standard" },
        new CdpTargetManager(worker.transport),
      );
      // Registrado antes da execução (e não só após ela) para que, se o processamento serial
      // desta conexão RPC algum dia deixar de ser estritamente sequencial, um run.cancel que
      // chegue entre o lançamento do worker e a conclusão de execute("open") ainda encontre a
      // sessão e o worker registrados, evitando órfãos. Hoje serveRpcOnConnection processa uma
      // requisição por vez por conexão e DaemonRpcContext.browserSessions não é compartilhado
      // entre conexões, então essa janela não é alcançável externamente; o registro antecipado é
      // uma garantia defensiva e correta mesmo assim.
      context.browserSessions.register({
        runId: request.runId,
        sessionId: request.sessionId,
        session,
        worker,
        targetId: "",
        lastUrl: pending.url,
      });

      const openRequestId = `${request.requestId}:open`;
      session.prepare(openRequestId, { type: "open", url: pending.url });
      session.decide(openRequestId, "allow");
      const evidence = await session.execute(openRequestId);
      context.browserSessions.updateTarget(request.runId, evidence.targetId, evidence.url);

      persistToolInvocationResult(db, {
        runId: request.runId,
        invocation: {
          id: request.requestId,
          tool: "browser.open",
          target: pending.url,
          capability: "browser.open",
          state: "completed",
        },
        result: {
          capability: "browser.open",
          tool: "browser.open",
          url: evidence.url,
          targetId: evidence.targetId,
          screenshot: evidence.screenshot,
          screenshotMimeType: evidence.screenshotMimeType,
          screenshotLength: evidence.screenshot.length,
          consoleLogCount: evidence.consoleLogs.length,
          consoleLogs: evidence.consoleLogs,
        },
      });
    } catch (error) {
      // A execução falhou após autorização: a run continua ativa, mas o worker não deve ficar pendurado.
      await context.browserSessions.closeForRun(request.runId);
      const message = error instanceof Error ? error.message : String(error);
      persistHarnessEventWithPayload(db, request.runId, "browser.open.failed", {
        type: "browser.open.failed",
        runId: request.runId,
        sessionId: request.sessionId,
        message,
      });
      throw error instanceof ProtocolError
        ? error
        : new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message);
    }
  }

  private async executeAuthorizedClick(
    context: DaemonRpcContext,
    db: WorkspaceDatabase,
    request: RpcRequestEnvelope,
    record: { runId: string; sessionId: string; session: AuthorizedBrowserSession },
    toolInvokeRequestId: string,
  ): Promise<void> {
    try {
      const evidence = await record.session.execute(toolInvokeRequestId);
      persistToolInvocationResult(db, {
        runId: request.runId,
        invocation: {
          id: request.requestId,
          tool: "browser.click",
          target: evidence.url,
          capability: "browser.open",
          state: "completed",
        },
        result: {
          capability: "browser.open",
          tool: "browser.click",
          url: evidence.url,
          targetId: evidence.targetId,
          screenshot: evidence.screenshot,
          screenshotMimeType: evidence.screenshotMimeType,
          screenshotLength: evidence.screenshot.length,
          consoleLogCount: evidence.consoleLogs.length,
          consoleLogs: evidence.consoleLogs,
        },
      });
    } catch (error) {
      // A interação falhou após autorização: preserva evidência anterior e encerra o worker,
      // mantendo a run ativa (ela pode decidir cancelar ou seguir sem o navegador).
      await context.browserSessions.closeForRun(request.runId);
      const message = error instanceof Error ? error.message : String(error);
      persistHarnessEventWithPayload(db, request.runId, "browser.open.failed", {
        type: "browser.open.failed",
        runId: request.runId,
        sessionId: request.sessionId,
        message,
      });
      throw error instanceof ProtocolError
        ? error
        : new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message);
    }
  }
}
