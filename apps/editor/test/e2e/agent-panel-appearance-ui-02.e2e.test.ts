import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProtocolError } from "@openagent/protocol";

import { createAgentHistoryMessage } from "../../src/agent/agent-history.js";
import {
  AGENT_PANEL_THEME_TOKENS,
  AGENT_PANEL_WIDTH_DEFAULT_PX,
  AGENT_PANEL_WIDTH_MAX_PX,
  AGENT_PANEL_WIDTH_MIN_PX,
  AgentPanelController,
} from "../../src/agent/agent-panel.js";

describe("UI-02 e2e — largura do painel e tema preservam a conversa", () => {
  it("alternar tema claro/escuro e largura preserva mensagens e mantém controles legíveis", () => {
    const history = [
      createAgentHistoryMessage("user", "Olá agente", "msg-user-1"),
      createAgentHistoryMessage(
        "assistant",
        "Olá! Como posso ajudar?",
        "msg-asst-1",
      ),
    ];
    const panel = new AgentPanelController();
    const opened = panel.open({
      sessionId: "sess-ui-132",
      initialHistory: history,
      theme: "light",
      panelWidthPx: AGENT_PANEL_WIDTH_DEFAULT_PX,
    });

    assert.equal(opened.accessible.theme, "light");
    assert.equal(opened.accessible.panelWidthPx, AGENT_PANEL_WIDTH_DEFAULT_PX);
    assert.deepEqual([...opened.accessible.historyMessageIds], [
      "msg-user-1",
      "msg-asst-1",
    ]);
    assert.equal(opened.accessible.historyCount, 2);
    assert.match(opened.html, /data-theme="light"/);
    assert.match(opened.html, /data-panel-width="360"/);
    assert.match(opened.html, /data-message-id="msg-user-1"/);
    assert.match(opened.html, /data-message-id="msg-asst-1"/);
    assert.match(opened.html, /Olá agente/);
    assert.match(opened.html, /Olá! Como posso ajudar\?/);
    assert.match(
      opened.html,
      new RegExp(`--agent-panel-fg:${AGENT_PANEL_THEME_TOKENS.light.foreground}`),
    );
    assert.match(opened.html, /aria-label="Modo do agente"/);
    assert.match(opened.html, /aria-label="Modelo"/);
    assert.match(opened.html, /aria-label="Composer do agente"/);
    assert.match(
      opened.html,
      /agent-mode-selector[^>]*style="[^"]*var\(--agent-panel-control-fg\)/,
    );

    const afterDark = panel.setTheme("dark");
    assert.equal(afterDark.accessible.theme, "dark");
    assert.deepEqual([...afterDark.accessible.historyMessageIds], [
      "msg-user-1",
      "msg-asst-1",
    ]);
    assert.equal(afterDark.accessible.historyCount, 2);
    assert.match(afterDark.html, /data-theme="dark"/);
    assert.match(afterDark.html, /data-message-id="msg-user-1"/);
    assert.match(afterDark.html, /data-message-id="msg-asst-1"/);
    assert.match(afterDark.html, /Olá agente/);
    assert.match(
      afterDark.html,
      new RegExp(`--agent-panel-bg:${AGENT_PANEL_THEME_TOKENS.dark.background}`),
    );
    assert.match(
      afterDark.html,
      new RegExp(
        `--agent-panel-control-fg:${AGENT_PANEL_THEME_TOKENS.dark.controlForeground}`,
      ),
    );

    const wider = panel.setPanelWidth(480);
    assert.equal(wider.accessible.panelWidthPx, 480);
    assert.match(wider.html, /data-panel-width="480"/);
    assert.match(wider.html, /width:480px/);
    assert.deepEqual([...wider.accessible.historyMessageIds], [
      "msg-user-1",
      "msg-asst-1",
    ]);
    assert.match(wider.html, /data-message-id="msg-user-1"/);
    assert.match(wider.html, /data-message-id="msg-asst-1"/);
    assert.equal(wider.accessible.theme, "dark");

    const narrower = panel.setPanelWidth(AGENT_PANEL_WIDTH_MIN_PX);
    assert.equal(narrower.accessible.panelWidthPx, AGENT_PANEL_WIDTH_MIN_PX);
    assert.deepEqual([...narrower.accessible.historyMessageIds], [
      "msg-user-1",
      "msg-asst-1",
    ]);
    assert.match(narrower.html, /aria-label="Modo do agente"/);
    assert.match(narrower.html, /aria-label="Revisão de alterações"/);

    panel.setTheme("light");
    assert.equal(panel.snapshot.accessible.theme, "light");
    assert.deepEqual([...panel.snapshot.accessible.historyMessageIds], [
      "msg-user-1",
      "msg-asst-1",
    ]);
    assert.match(panel.snapshot.html, /Olá! Como posso ajudar\?/);
  });

  it("caminho de erro: tema ou largura inválidos retornam INVALID_STATE sem efeito colateral", () => {
    const panel = new AgentPanelController();
    panel.open({
      sessionId: "sess-ui-132-err",
      initialHistory: [
        createAgentHistoryMessage("user", "Mensagem preservada", "msg-keep"),
      ],
      theme: "dark",
      panelWidthPx: 400,
    });
    const beforeIds = [...panel.snapshot.accessible.historyMessageIds];
    const beforeTheme = panel.snapshot.accessible.theme;
    const beforeWidth = panel.snapshot.accessible.panelWidthPx;

    assert.throws(
      () => panel.setTheme("sepia"),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
    assert.equal(panel.snapshot.accessible.theme, beforeTheme);
    assert.equal(panel.snapshot.accessible.panelWidthPx, beforeWidth);
    assert.deepEqual([...panel.snapshot.accessible.historyMessageIds], beforeIds);
    assert.match(panel.snapshot.html, /data-message-id="msg-keep"/);

    assert.throws(
      () => panel.setPanelWidth(AGENT_PANEL_WIDTH_MAX_PX + 1),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
    assert.throws(
      () => panel.setPanelWidth(AGENT_PANEL_WIDTH_MIN_PX - 1),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
    assert.throws(
      () => panel.setPanelWidth(360.5),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
    assert.throws(
      () => panel.setPanelWidth("wide"),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );

    assert.equal(panel.snapshot.accessible.theme, "dark");
    assert.equal(panel.snapshot.accessible.panelWidthPx, 400);
    assert.deepEqual([...panel.snapshot.accessible.historyMessageIds], [
      "msg-keep",
    ]);
    assert.match(panel.snapshot.html, /Mensagem preservada/);
    assert.match(panel.snapshot.html, /data-theme="dark"/);
    assert.match(panel.snapshot.html, /data-panel-width="400"/);
  });
});
