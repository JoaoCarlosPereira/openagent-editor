import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProtocolError, USER_INPUT_EMPTY_MESSAGE } from "@openagent/protocol";

import {
  AgentPanelController,
  USER_INPUT_EMPTY_MESSAGE as PANEL_EMPTY_MESSAGE,
} from "../../src/agent/agent-panel.js";

describe("UI-01 e2e — painel com composer e histórico", () => {
  it("exibe painel, histórico e composer alcançáveis por teclado", () => {
    const panel = new AgentPanelController();
    const view = panel.open({
      sessionId: "sess-ui-127",
      initialHistory: [
        { id: "h1", role: "assistant", content: "Olá! Como posso ajudar?" },
      ],
    });

    assert.match(view.html, /data-testid="agent-panel"/);
    assert.match(view.html, /data-testid="agent-history"/);
    assert.match(view.html, /data-testid="agent-composer-input"/);
    assert.match(view.html, /data-testid="agent-composer-send"/);
    assert.equal(view.accessible.historyCount, 1);
    assert.deepEqual(view.accessible.focusOrder, [
      "agent-mode-selector",
      "agent-model-selector",
      "agent-context-slot",
      "agent-history",
      "agent-composer-input",
      "agent-composer-send",
      "agent-review-slot",
    ]);
    assert.match(view.html, /tabindex="0"/);
    assert.match(view.html, /data-testid="agent-mode-selector"/);
    assert.match(view.html, /data-testid="agent-model-selector"/);
    assert.match(view.html, /data-testid="agent-context-slot"/);
    assert.match(view.html, /data-testid="agent-review-slot"/);
  });

  it("envia mensagem válida e atualiza histórico", () => {
    const panel = new AgentPanelController();
    panel.open({ sessionId: "sess-send" });
    panel.setComposerText("Implementar painel do agente.");
    const result = panel.submitComposer();

    assert.equal(result.userInput.text, "Implementar painel do agente.");
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0]?.role, "user");
    assert.equal(result.view.accessible.composerText, "");
    assert.match(result.view.html, /Implementar painel do agente/);
  });

  it("caminho de erro: composer vazio retorna INVALID_STATE sem alterar histórico", () => {
    const panel = new AgentPanelController();
    panel.open({
      sessionId: "sess-empty",
      initialHistory: [{ id: "keep", role: "assistant", content: "Preservar" }],
    });
    panel.setComposerText("   ");

    assert.throws(
      () => panel.submitComposer(),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === USER_INPUT_EMPTY_MESSAGE,
    );
    assert.equal(panel.snapshot.accessible.historyCount, 1);
    assert.equal(
      panel.snapshot.accessible.composerValidationMessage,
      USER_INPUT_EMPTY_MESSAGE,
    );
    assert.match(panel.snapshot.html, /data-testid="agent-composer-validation"/);
    assert.equal(PANEL_EMPTY_MESSAGE, USER_INPUT_EMPTY_MESSAGE);
  });
});
