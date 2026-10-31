import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProtocolError } from "@openagent/protocol";

import {
  WORKBENCH_THEME_DEFAULT,
  WORKBENCH_THEME_TOKENS,
  WORKBENCH_PANEL_WIDTH_DEFAULT_PX,
  WORKBENCH_PANEL_WIDTH_MIN_PX,
  WORKBENCH_PANEL_WIDTH_MAX_PX,
  assertWorkbenchTheme,
  assertWorkbenchPanelWidthPx,
  themeTokensCssVariables,
  WorkbenchShellController,
} from "../../src/workbench/index.js";

describe("UI-02 e2e — temas claro e escuro com tokens próprios no workbench", () => {
  it("alternar tema claro/escuro e largura mantém controles legíveis e preserva mensagens", () => {
    const shell = new WorkbenchShellController();
    const bootstrapped = shell.bootstrap({ platform: "linux" });

    // Estado inicial padrão
    assert.equal(shell.theme, WORKBENCH_THEME_DEFAULT);
    assert.equal(shell.panelWidthPx, WORKBENCH_PANEL_WIDTH_DEFAULT_PX);
    assert.equal(bootstrapped.accessible.theme, "light");
    assert.equal(bootstrapped.accessible.panelWidthPx, 360);
    assert.match(bootstrapped.html, /data-theme="light"/);
    assert.match(bootstrapped.html, /data-panel-width="360"/);
    assert.match(bootstrapped.html, new RegExp(`--workbench-bg:${WORKBENCH_THEME_TOKENS.light.background}`));
    assert.match(bootstrapped.html, new RegExp(`--workbench-fg:${WORKBENCH_THEME_TOKENS.light.foreground}`));
    assert.match(bootstrapped.html, new RegExp(`--workbench-control-bg:${WORKBENCH_THEME_TOKENS.light.controlBackground}`));
    assert.match(bootstrapped.html, new RegExp(`--workbench-control-fg:${WORKBENCH_THEME_TOKENS.light.controlForeground}`));

    // Alternar para tema escuro
    const afterDark = shell.setTheme("dark");
    assert.equal(shell.theme, "dark");
    assert.equal(afterDark.accessible.theme, "dark");
    assert.match(afterDark.html, /data-theme="dark"/);
    assert.match(afterDark.html, new RegExp(`--workbench-bg:${WORKBENCH_THEME_TOKENS.dark.background}`));
    assert.match(afterDark.html, new RegExp(`--workbench-fg:${WORKBENCH_THEME_TOKENS.dark.foreground}`));
    assert.match(afterDark.html, new RegExp(`--workbench-control-bg:${WORKBENCH_THEME_TOKENS.dark.controlBackground}`));
    assert.match(afterDark.html, new RegExp(`--workbench-control-fg:${WORKBENCH_THEME_TOKENS.dark.controlForeground}`));

    // Controles e slots continuam acessíveis e legíveis
    for (const slot of bootstrapped.accessible.capabilitySlots) {
      assert.match(afterDark.html, new RegExp(`data-testid="workbench-slot-${slot}"`));
      assert.match(afterDark.html, new RegExp(`data-capability="${slot}"`));
    }

    // Alterar largura do painel
    const wider = shell.setPanelWidth(500);
    assert.equal(shell.panelWidthPx, 500);
    assert.equal(wider.accessible.panelWidthPx, 500);
    assert.equal(wider.accessible.theme, "dark");
    assert.match(wider.html, /data-panel-width="500"/);

    // Ajustar para largura mínima
    const narrower = shell.setPanelWidth(WORKBENCH_PANEL_WIDTH_MIN_PX);
    assert.equal(shell.panelWidthPx, WORKBENCH_PANEL_WIDTH_MIN_PX);
    assert.equal(narrower.accessible.panelWidthPx, WORKBENCH_PANEL_WIDTH_MIN_PX);
    assert.match(narrower.html, /data-panel-width="280"/);

    // Voltar para tema claro
    const backLight = shell.setTheme("light");
    assert.equal(shell.theme, "light");
    assert.equal(backLight.accessible.theme, "light");
    assert.equal(backLight.accessible.panelWidthPx, WORKBENCH_PANEL_WIDTH_MIN_PX);
    assert.match(backLight.html, /data-theme="light"/);
  });

  it("caminho de erro: tema inválido retorna INVALID_STATE sem efeito colateral", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux" });
    const beforeTheme = shell.theme;
    const beforeWidth = shell.panelWidthPx;
    const beforeHtml = shell.snapshot.html;

    assert.throws(
      () => shell.setTheme("neon"),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message.includes("Tema do workbench inválido"),
    );

    assert.throws(
      () => shell.setTheme(123),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );

    assert.throws(
      () => shell.setTheme(null),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );

    // Estado inalterado
    assert.equal(shell.theme, beforeTheme);
    assert.equal(shell.panelWidthPx, beforeWidth);
    assert.equal(shell.snapshot.html, beforeHtml);
  });

  it("caminho de erro: largura inválida retorna INVALID_STATE sem efeito colateral", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux" });
    const beforeTheme = shell.theme;
    const beforeWidth = shell.panelWidthPx;
    const beforeHtml = shell.snapshot.html;

    // Abaixo do mínimo (280)
    assert.throws(
      () => shell.setPanelWidth(WORKBENCH_PANEL_WIDTH_MIN_PX - 1),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message.includes("fora do intervalo"),
    );

    // Acima do máximo (720)
    assert.throws(
      () => shell.setPanelWidth(WORKBENCH_PANEL_WIDTH_MAX_PX + 1),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message.includes("fora do intervalo"),
    );

    // Não-inteiro
    assert.throws(
      () => shell.setPanelWidth(350.5),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message.includes("deve ser um inteiro"),
    );

    // Tipo inválido
    assert.throws(
      () => shell.setPanelWidth("400"),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message.includes("deve ser um inteiro"),
    );

    // Estado inalterado
    assert.equal(shell.theme, beforeTheme);
    assert.equal(shell.panelWidthPx, beforeWidth);
    assert.equal(shell.snapshot.html, beforeHtml);
  });

  it("funções utilitárias validam tema e largura canonicamente", () => {
    assert.equal(assertWorkbenchTheme("light"), "light");
    assert.equal(assertWorkbenchTheme("dark"), "dark");
    assert.equal(assertWorkbenchPanelWidthPx(360), 360);
    assert.equal(assertWorkbenchPanelWidthPx(280), 280);
    assert.equal(assertWorkbenchPanelWidthPx(720), 720);

    const cssVars = themeTokensCssVariables("dark");
    assert.match(cssVars, /--workbench-bg:/);
    assert.match(cssVars, /--workbench-fg:/);
    assert.match(cssVars, /--workbench-border:/);
    assert.match(cssVars, /--workbench-control-bg:/);
    assert.match(cssVars, /--workbench-control-fg:/);
  });
});
