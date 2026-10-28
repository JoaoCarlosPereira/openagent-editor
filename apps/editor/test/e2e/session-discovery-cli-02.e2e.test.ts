import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError, RPC_METHOD } from "@openagent/protocol";

import {
  SessionDiscoveryController,
  type HeadlessSessionItem,
  type SessionDiscoveryListPort,
} from "../../src/agents/session-discovery.js";

const TEST_SESSION_ID = "ses-headless-cli-02";
const TEST_WORKSPACE_ID = "ws-test-cli-02";

describe("CLI-02 e2e — Sessão headless da CLI aparece no editor", () => {
  it("[CLI-02] quando execução headless da CLI terminar, mostra essa sessão ao abrir o mesmo workspace no editor", async () => {
    // 1. Instanciação inicial: baseline observável
    const controller = new SessionDiscoveryController(TEST_SESSION_ID, TEST_WORKSPACE_ID);
    assert.equal(controller.sessionId, TEST_SESSION_ID);
    assert.equal(controller.workspaceId, TEST_WORKSPACE_ID);
    assert.equal(controller.snapshot.accessible.phase, "idle");
    assert.equal(controller.snapshot.accessible.headlessSessionCount, 0);
    assert.match(controller.snapshot.html, /data-testid="session-discovery-panel"/);
    assert.match(controller.snapshot.html, /data-phase="idle"/);
    assert.match(controller.snapshot.html, /Sessões headless da CLI aparecem/);

    // 2. requestList dispara RPC session.list e entra em pending
    const pending = controller.requestList();
    assert.equal(pending.rpc.method, RPC_METHOD.SESSION_LIST);
    assert.deepEqual(pending.rpc.params, { limit: 100 });
    assert.equal(pending.view.accessible.phase, "pending");
    assert.match(pending.view.html, /data-phase="pending"/);
    assert.match(pending.view.html, /Buscando sessões headless/);

    // 3. acceptResults recebe sessões e exibe a sessão headless no editor (CLI-02)
    const rawSessions: HeadlessSessionItem[] = [
      {
        sessionId: "ses-cli-headless-001",
        mode: "agent",
        messageCount: 5,
      },
      {
        sessionId: "ses-cli-headless-002",
        mode: "plan",
        messageCount: 3,
      },
    ];

    const resultsView = controller.acceptResults({ sessions: rawSessions });
    assert.equal(resultsView.accessible.phase, "results");
    assert.equal(resultsView.accessible.headlessSessionCount, 2);
    assert.deepEqual(resultsView.accessible.headlessSessionIds, [
      "ses-cli-headless-001",
      "ses-cli-headless-002",
    ]);
    assert.match(resultsView.html, /data-phase="results"/);
    assert.match(resultsView.html, /data-session-id="ses-cli-headless-001"/);
    assert.match(resultsView.html, /data-session-id="ses-cli-headless-002"/);
    assert.match(resultsView.html, /2 sessão\(s\) headless encontrada\(s\)/);

    // 4. Integração ponta a ponta via SessionDiscoveryListPort (simula consulta do daemon)
    const mockMessages = [
      { id: "msg-1", role: "user", content: "Execute os testes em background" },
      { id: "msg-2", role: "assistant", content: "Execução headless concluída com sucesso." },
    ];
    const port: SessionDiscoveryListPort = {
      async listSessionMessages(input) {
        assert.equal(input.sessionId, TEST_SESSION_ID);
        return {
          sessionId: input.sessionId,
          messages: mockMessages,
        };
      },
    };

    const freshController = new SessionDiscoveryController(TEST_SESSION_ID, TEST_WORKSPACE_ID);
    const viaPortResult = await freshController.listViaPort(port);
    assert.equal(viaPortResult.rpc.method, RPC_METHOD.SESSION_LIST);
    assert.equal(viaPortResult.sessions.length, 1);
    const firstSession = viaPortResult.sessions.at(0);
    assert.ok(firstSession !== undefined);
    assert.equal(firstSession.sessionId, TEST_SESSION_ID);
    assert.equal(firstSession.messageCount, 2);
    assert.equal(viaPortResult.view.accessible.phase, "results");
    assert.equal(viaPortResult.view.accessible.headlessSessionCount, 1);
    assert.match(viaPortResult.view.html, new RegExp(TEST_SESSION_ID));

    // 5. Botão "Atualizar" (refresh) redefine para idle e permite nova busca
    const refreshed = freshController.refresh();
    assert.equal(refreshed.accessible.phase, "idle");
    assert.match(refreshed.html, /data-phase="idle"/);
  });

  it("[CLI-02] quando nenhuma sessão headless existir no workspace, exibe estado vazio sem erros", async () => {
    const controller = new SessionDiscoveryController(TEST_SESSION_ID, TEST_WORKSPACE_ID);
    controller.requestList();

    const emptyResult = controller.acceptResults({ sessions: [] });
    assert.equal(emptyResult.accessible.phase, "results");
    assert.equal(emptyResult.accessible.headlessSessionCount, 0);
    assert.match(emptyResult.html, /data-testid="headless-sessions-empty"/);
    assert.match(emptyResult.html, /Nenhuma sessão headless encontrada/);
  });

  it("[CLI-02] caminhos de erro: entrada/estado inválidos (INVALID_STATE) e fora de escopo (OUT_OF_SCOPE) sem efeito colateral", async () => {
    const controller = new SessionDiscoveryController(TEST_SESSION_ID, TEST_WORKSPACE_ID);
    const baseline = controller.snapshot;

    // 1. Construtor com sessionId vazio ou em branco lança INVALID_STATE
    assert.throws(
      () => new SessionDiscoveryController("   ", TEST_WORKSPACE_ID),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    // 2. Construtor com workspaceId vazio lança INVALID_STATE
    assert.throws(
      () => new SessionDiscoveryController(TEST_SESSION_ID, "   "),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    // 3. requestList com escopo divergente lança OUT_OF_SCOPE
    assert.throws(
      () =>
        controller.requestList({
          targetWorkspaceId: "ws-alvo",
          allowedWorkspaceId: "ws-outro",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
        return true;
      },
    );
    assert.equal(controller.snapshot.accessible.phase, "idle");

    // 4. acceptResults chamado sem requestList pendente lança INVALID_STATE
    assert.throws(
      () => controller.acceptResults({ sessions: [] }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    // Baseline preservado
    assert.equal(controller.snapshot.accessible.phase, baseline.accessible.phase);
    assert.equal(controller.snapshot.html, baseline.html);

    // 5. requestList chamado quando já está em pending lança INVALID_STATE
    controller.requestList();
    assert.throws(
      () => controller.requestList(),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.equal(controller.snapshot.accessible.phase, "pending");

    // 6. acceptResults com payload inválido restaura estado anterior sem corromper
    assert.throws(
      () => controller.acceptResults("not an object"),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    // Permanece em pending (ou estado restaurado)
    assert.equal(controller.snapshot.accessible.phase, "pending");

    // 7. acceptResults com item corrompido (sem sessionId ou messageCount negativo) lança INVALID_STATE
    assert.throws(
      () =>
        controller.acceptResults({
          sessions: [{ sessionId: "ses-1", mode: "agent", messageCount: -1 }],
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    // 8. Falha na porta (transporte) transiciona para phase error com mensagem sem travar
    const failingPort: SessionDiscoveryListPort = {
      async listSessionMessages() {
        throw new Error("Erro de conexão RPC com daemon local");
      },
    };
    const freshController = new SessionDiscoveryController(TEST_SESSION_ID, TEST_WORKSPACE_ID);
    await assert.rejects(
      () => freshController.listViaPort(failingPort),
      /Erro de conexão RPC com daemon local/,
    );
    assert.equal(freshController.snapshot.accessible.phase, "error");
    assert.match(freshController.snapshot.html, /data-phase="error"/);
    assert.match(freshController.snapshot.html, /Erro de conexão RPC com daemon local/);

    // 9. Tratamento canônico de INVALID_STATE e OUT_OF_SCOPE
    const handlerController = new SessionDiscoveryController(TEST_SESSION_ID, TEST_WORKSPACE_ID);
    const invalidStateView = handlerController.handleInvalidState();
    assert.equal(invalidStateView.accessible.phase, "error");
    assert.match(invalidStateView.html, /Estado inválido/);

    const outOfScopeView = handlerController.handleOutOfScope();
    assert.equal(outOfScopeView.accessible.phase, "error");
    assert.match(outOfScopeView.html, /Sessão fora do escopo/);
  });
});
