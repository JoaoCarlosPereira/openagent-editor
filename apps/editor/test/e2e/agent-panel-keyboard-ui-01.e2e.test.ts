import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProtocolError } from "@openagent/protocol";

import {
  AGENT_PANEL_FOCUS_TARGETS,
  AgentPanelController,
} from "../../src/agent/agent-panel.js";

describe("UI-01 e2e — navegação por teclado e acessibilidade do painel", () => {
  it("abre o painel com todos os controles alcançáveis e foco no primeiro", () => {
    const panel = new AgentPanelController();
    const view = panel.open({ sessionId: "sess-ui-131" });

    assert.deepEqual([...view.accessible.focusOrder], [...AGENT_PANEL_FOCUS_TARGETS]);
    assert.equal(view.accessible.focusedControl, "agent-mode-selector");
    assert.match(view.html, /data-focused-control="agent-mode-selector"/);
    assert.match(
      view.html,
      /data-testid="agent-mode-selector"[^>]*tabindex="0"[^>]*data-focused="true"/,
    );

    for (const target of AGENT_PANEL_FOCUS_TARGETS) {
      assert.match(view.html, new RegExp(`data-testid="${target}"`));
    }
    assert.match(view.html, /aria-label="Modo do agente"/);
    assert.match(view.html, /aria-label="Modelo"/);
    assert.match(view.html, /aria-label="Contexto anexado"/);
    assert.match(view.html, /aria-label="Composer do agente"/);
    assert.match(view.html, /aria-label="Revisão de alterações"/);
  });

  it("percorre todos os controles com Tab e volta com Shift+Tab", () => {
    const panel = new AgentPanelController();
    panel.open({ sessionId: "sess-tab-cycle" });

    const visited: string[] = [panel.snapshot.accessible.focusedControl];
    for (let i = 0; i < AGENT_PANEL_FOCUS_TARGETS.length - 1; i += 1) {
      panel.handleKeyboard({ key: "Tab" });
      visited.push(panel.snapshot.accessible.focusedControl);
    }
    assert.deepEqual(visited, [...AGENT_PANEL_FOCUS_TARGETS]);

    for (const target of AGENT_PANEL_FOCUS_TARGETS) {
      assert.match(
        panel.snapshot.html,
        new RegExp(
          `data-testid="${target}"[^>]*(?:tabindex="0"[^>]*data-focused="true"|data-focused="true"[^>]*tabindex="0"|tabindex="-1")`,
        ),
      );
    }
    assert.match(
      panel.snapshot.html,
      /data-testid="agent-review-slot"[^>]*data-focused="true"/,
    );

    panel.handleKeyboard({ key: "Tab", shiftKey: true });
    assert.equal(panel.snapshot.accessible.focusedControl, "agent-composer-send");

    panel.handleKeyboard({ key: "ArrowLeft" });
    assert.equal(panel.snapshot.accessible.focusedControl, "agent-composer-input");

    panel.setFocusedControl("agent-context-slot");
    assert.equal(panel.snapshot.accessible.focusedControl, "agent-context-slot");
    assert.match(
      panel.snapshot.html,
      /data-testid="agent-context-slot"[^>]*data-focused="true"/,
    );

    panel.focusNext();
    assert.equal(panel.snapshot.accessible.focusedControl, "agent-history");
    panel.focusPrevious();
    assert.equal(panel.snapshot.accessible.focusedControl, "agent-context-slot");
  });

  it("caminho de erro: controle ou tecla inválidos retornam INVALID_STATE sem efeito", () => {
    const panel = new AgentPanelController();
    panel.open({ sessionId: "sess-kb-error" });
    panel.setFocusedControl("agent-history");
    const before = panel.snapshot.accessible.focusedControl;

    assert.throws(
      () => panel.setFocusedControl("agent-unknown-slot"),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
    assert.equal(panel.snapshot.accessible.focusedControl, before);

    assert.throws(
      () => panel.handleKeyboard({ key: "Enter" }),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
    assert.equal(panel.snapshot.accessible.focusedControl, before);
    assert.match(panel.snapshot.html, /data-focused-control="agent-history"/);
  });
});
