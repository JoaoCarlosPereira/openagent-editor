import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProtocolError } from "@openagent/protocol";

import { AgentPanelController } from "../../src/agent/agent-panel.js";

describe("UI-01 e2e — seletores de modo e modelo", () => {
  it("exibe seletores habilitados com opções e ordem de foco por teclado", () => {
    const panel = new AgentPanelController();
    const view = panel.open({
      sessionId: "sess-ui-128",
      mode: "plan",
      modelId: "gpt-test",
      availableModels: [
        { id: "gpt-test", label: "GPT Test" },
        { id: "default", label: "Padrão" },
      ],
    });

    assert.match(view.html, /data-testid="agent-mode-selector"/);
    assert.match(view.html, /data-testid="agent-model-selector"/);
    assert.doesNotMatch(view.html, /agent-mode-selector"[^>]*disabled/);
    assert.doesNotMatch(view.html, /agent-model-selector"[^>]*disabled/);
    assert.match(view.html, /<option value="ask"/);
    assert.match(view.html, /<option value="plan" selected/);
    assert.match(view.html, /<option value="gpt-test" selected/);
    assert.equal(view.accessible.mode, "plan");
    assert.equal(view.accessible.modelId, "gpt-test");
    assert.deepEqual(view.accessible.focusOrder.slice(0, 2), [
      "agent-mode-selector",
      "agent-model-selector",
    ]);
  });

  it("atualiza modo e modelo selecionados via controller", () => {
    const panel = new AgentPanelController();
    panel.open({ sessionId: "sess-change" });

    panel.setMode("debug");
    assert.equal(panel.snapshot.accessible.mode, "debug");
    assert.match(panel.snapshot.html, /<option value="debug" selected/);

    panel.setModel("default");
    assert.equal(panel.snapshot.accessible.modelId, "default");
    assert.match(panel.snapshot.html, /<option value="default" selected/);
  });

  it("propaga modo e modelo no envio válido do composer", () => {
    const panel = new AgentPanelController();
    panel.open({ sessionId: "sess-submit", mode: "ask" });
    panel.setModel("default");
    panel.setComposerText("Testar seletores.");
    const result = panel.submitComposer();

    assert.equal(result.mode, "ask");
    assert.equal(result.modelId, "default");
    assert.equal(result.userInput.text, "Testar seletores.");
  });

  it("caminho de erro: modo inválido retorna INVALID_STATE sem alterar seleção", () => {
    const panel = new AgentPanelController();
    panel.open({ sessionId: "sess-invalid-mode", mode: "agent" });

    assert.throws(
      () => panel.setMode("turbo"),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message.includes("mode"),
    );
    assert.equal(panel.snapshot.accessible.mode, "agent");
  });

  it("caminho de erro: modelo fora da lista retorna INVALID_STATE", () => {
    const panel = new AgentPanelController();
    panel.open({
      sessionId: "sess-invalid-model",
      availableModels: [{ id: "only-one", label: "Único" }],
      modelId: "only-one",
    });

    assert.throws(
      () => panel.setModel("missing-model"),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
    assert.equal(panel.snapshot.accessible.modelId, "only-one");
  });
});
