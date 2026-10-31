import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  AgentsWindowController,
  type AgentParallelExecution,
  type AgentsWindowPort,
  type AgentsWindowViewSnapshot,
} from "../../src/agents/agents-window.js";

const TEST_SESSION_ID = "ses-agents-ui-04";
const TEST_WORKSPACE_ID = "ws-openagent-ui-04";

describe("UI-04 e2e — Janela de agentes com execuções paralelas e volta ao editor", () => {
  it("[UI-04] abre a janela de agentes, lista execuções locais em paralelo e volta ao editor no mesmo workspace", async () => {
    const parallelRuns: AgentParallelExecution[] = [
      {
        agentId: "agent-sub-001",
        name: "Subagente Testes Unitários",
        status: "active",
        summary: "Executando suite de testes",
      },
      {
        agentId: "agent-sub-002",
        name: "Subagente Análise Estática",
        status: "completed",
        summary: "Linters e typecheck concluídos",
      },
      {
        agentId: "agent-sub-003",
        name: "Subagente Indexação de Código",
        status: "failed",
        summary: "Timeout de leitura em arquivo bloqueado",
      },
    ];

    // 1. Instanciação inicial: baseline observável no editor
    const controller = new AgentsWindowController(
      TEST_SESSION_ID,
      TEST_WORKSPACE_ID,
      parallelRuns,
    );
    assert.equal(controller.sessionId, TEST_SESSION_ID);
    assert.equal(controller.workspaceId, TEST_WORKSPACE_ID);
    assert.equal(controller.currentView, "editor");
    assert.equal(controller.snapshot.accessible.currentView, "editor");
    assert.equal(controller.snapshot.accessible.workspaceId, TEST_WORKSPACE_ID);
    assert.match(controller.snapshot.html, /data-testid="agents-workbench-view"/);
    assert.match(controller.snapshot.html, /data-current-view="editor"/);
    assert.match(controller.snapshot.html, /data-testid="open-agents-window-button"/);
    assert.match(controller.snapshot.html, /1 agente\(s\) em execução paralela/);

    // 2. Observer reativo recebe atualizações a cada transição
    const observerSnapshots: AgentsWindowViewSnapshot[] = [];
    const unsubscribe = controller.subscribe((snapshot) => {
      observerSnapshots.push(snapshot);
    });

    // 3. Abrir a janela de agentes (UI-04): lista execuções paralelas e oferece voltar ao editor
    const windowSnapshot = controller.openAgentsWindow();
    assert.equal(controller.currentView, "agents_window");
    assert.equal(windowSnapshot.accessible.currentView, "agents_window");
    assert.equal(windowSnapshot.accessible.workspaceId, TEST_WORKSPACE_ID);
    assert.equal(windowSnapshot.accessible.activeCount, 1);
    assert.equal(windowSnapshot.accessible.completedCount, 1);
    assert.equal(windowSnapshot.accessible.failedCount, 1);
    assert.equal(windowSnapshot.accessible.totalCount, 3);

    // Efeito observável no HTML
    assert.match(windowSnapshot.html, /data-testid="agents-window-panel"/);
    assert.match(windowSnapshot.html, /data-current-view="agents_window"/);
    assert.match(windowSnapshot.html, /data-active-count="1"/);
    assert.match(windowSnapshot.html, /data-total-count="3"/);
    assert.match(windowSnapshot.html, /data-testid="return-to-editor-button"/);
    assert.match(windowSnapshot.html, /Voltar ao editor/);
    assert.match(windowSnapshot.html, /data-testid="parallel-agents-list"/);
    assert.match(windowSnapshot.html, /data-agent-id="agent-sub-001"/);
    assert.match(windowSnapshot.html, /Subagente Testes Unitários/);
    assert.match(windowSnapshot.html, /Ativo/);
    assert.match(windowSnapshot.html, /data-agent-id="agent-sub-002"/);
    assert.match(windowSnapshot.html, /Concluído/);
    assert.match(windowSnapshot.html, /data-agent-id="agent-sub-003"/);
    assert.match(windowSnapshot.html, /Falha/);

    // 4. Comando de voltar ao editor no mesmo workspace (UI-04)
    const backSnapshot = controller.returnToEditor();
    assert.equal(controller.currentView, "editor");
    assert.equal(backSnapshot.accessible.currentView, "editor");
    // O workspace é estritamente preservado
    assert.equal(backSnapshot.accessible.workspaceId, TEST_WORKSPACE_ID);
    assert.equal(controller.workspaceId, TEST_WORKSPACE_ID);
    assert.match(backSnapshot.html, /data-testid="agents-workbench-view"/);
    assert.match(backSnapshot.html, /data-current-view="editor"/);
    assert.match(backSnapshot.html, new RegExp(`Workspace ${TEST_WORKSPACE_ID}`));

    // Observer registrou 2 transições
    assert.equal(observerSnapshots.length, 2);
    unsubscribe();
  });

  it("[UI-04] porta injetável consulta execuções paralelas assincronamente e lida com lista vazia", async () => {
    const mockPort: AgentsWindowPort = {
      async listParallelExecutions(input) {
        assert.equal(input.workspaceId, TEST_WORKSPACE_ID);
        return [
          {
            agentId: "agent-port-01",
            name: "Agente de Refatoração",
            status: "active",
          },
          {
            agentId: "agent-port-02",
            name: "Agente de Documentação",
            status: "completed",
          },
        ];
      },
    };

    const controller = new AgentsWindowController(
      TEST_SESSION_ID,
      TEST_WORKSPACE_ID,
      [],
      "agents_window",
    );

    const snapshot = await controller.listViaPort(mockPort);
    assert.equal(snapshot.accessible.totalCount, 2);
    assert.equal(snapshot.accessible.activeCount, 1);
    assert.equal(snapshot.accessible.completedCount, 1);
    assert.match(snapshot.html, /Agente de Refatoração/);
    assert.match(snapshot.html, /Agente de Documentação/);

    // Estado vazio
    controller.setExecutions([]);
    assert.equal(controller.snapshot.accessible.totalCount, 0);
    assert.match(controller.snapshot.html, /data-testid="parallel-agents-empty"/);
    assert.match(controller.snapshot.html, /Nenhuma execução de agente encontrada no workspace/);
  });

  it("[UI-04] mutações de execução (upsert, update status, remove) notificam observers e refletem status", () => {
    const controller = new AgentsWindowController(
      TEST_SESSION_ID,
      TEST_WORKSPACE_ID,
      [],
      "agents_window",
    );

    let notificationCount = 0;
    controller.subscribe(() => {
      notificationCount += 1;
    });

    // Upsert novo
    controller.upsertExecution({
      agentId: "agent-x",
      name: "Agente X",
      status: "active",
      summary: "Iniciando tarefa",
    });
    assert.equal(controller.snapshot.accessible.totalCount, 1);
    assert.equal(controller.snapshot.accessible.activeCount, 1);
    assert.equal(notificationCount, 1);

    // Atualiza status para completed
    controller.updateExecutionStatus("agent-x", "completed", "Tarefa finalizada com êxito");
    assert.equal(controller.snapshot.accessible.activeCount, 0);
    assert.equal(controller.snapshot.accessible.completedCount, 1);
    assert.equal(notificationCount, 2);
    assert.match(controller.snapshot.html, /Tarefa finalizada com êxito/);

    // Remove
    controller.removeExecution("agent-x");
    assert.equal(controller.snapshot.accessible.totalCount, 0);
    assert.equal(notificationCount, 3);
  });

  it("[UI-04] caminhos de erro: entrada/estado inválidos (INVALID_STATE) e fora de escopo (OUT_OF_SCOPE) sem efeito colateral", () => {
    const controller = new AgentsWindowController(
      TEST_SESSION_ID,
      TEST_WORKSPACE_ID,
      [
        {
          agentId: "agent-base",
          name: "Agente Base",
          status: "active",
        },
      ],
      "editor",
    );

    const baselineSnapshot = controller.snapshot;

    // 1. Construtor com sessionId vazio ou whitespace lança INVALID_STATE
    assert.throws(
      () => new AgentsWindowController("   ", TEST_WORKSPACE_ID),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    // 2. Construtor com workspaceId vazio ou whitespace lança INVALID_STATE
    assert.throws(
      () => new AgentsWindowController(TEST_SESSION_ID, ""),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    // 3. Construtor com modo inicial inválido lança INVALID_STATE
    assert.throws(
      () =>
        new AgentsWindowController(
          TEST_SESSION_ID,
          TEST_WORKSPACE_ID,
          [],
          // @ts-expect-error validação em runtime
          "modo_invalido",
        ),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    // 4. Construtor com item de execução malformado lança INVALID_STATE
    assert.throws(
      () =>
        new AgentsWindowController(TEST_SESSION_ID, TEST_WORKSPACE_ID, [
          { agentId: "   ", name: "Nome", status: "active" },
        ]),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    // 5. returnToEditor quando já está no editor lança INVALID_STATE sem efeito colateral
    assert.throws(
      () => controller.returnToEditor(),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.deepEqual(controller.snapshot, baselineSnapshot);

    // 6. Atualizar status de agente inexistente lança INVALID_STATE sem efeito colateral
    assert.throws(
      () => controller.updateExecutionStatus("agente-fantasma", "completed"),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.deepEqual(controller.snapshot, baselineSnapshot);

    // 7. Navegação com workspace divergente do autorizado lança OUT_OF_SCOPE sem efeito colateral
    assert.throws(
      () =>
        controller.openAgentsWindow({
          targetWorkspaceId: "ws-outro",
          allowedWorkspaceId: "ws-autorizado",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
        return true;
      },
    );
    assert.deepEqual(controller.snapshot, baselineSnapshot);

    // 8. Navegação para workspace diferente do workspace do controller lança OUT_OF_SCOPE sem efeito colateral
    assert.throws(
      () =>
        controller.openAgentsWindow({
          targetWorkspaceId: "ws-diferente",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
        return true;
      },
    );
    assert.deepEqual(controller.snapshot, baselineSnapshot);

    // 9. Abrir janela e tentar returnToEditor com workspace divergente lança OUT_OF_SCOPE sem mudar de view
    controller.openAgentsWindow();
    assert.equal(controller.currentView, "agents_window");
    const windowSnapshot = controller.snapshot;

    assert.throws(
      () =>
        controller.returnToEditor({
          targetWorkspaceId: "ws-outro",
          allowedWorkspaceId: "ws-autorizado",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
        return true;
      },
    );
    assert.equal(controller.currentView, "agents_window");
    assert.deepEqual(controller.snapshot, windowSnapshot);
  });
});
