import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProtocolError } from "@openagent/protocol";

import {
  WorkbenchShellController,
  WORKBENCH_HEALTH_SUBSYSTEMS,
  WORKBENCH_HEALTH_INVALID_MESSAGE,
} from "../../src/workbench/index.js";
import { ElectronMainController } from "../../src/main/index.js";

describe("LOC-01 e2e — Indicador de saúde de daemon, sandbox, índice e CLIProxyAPI", () => {
  it("exibe o estado padrão de saúde dos 4 subsistemas no snapshot e no HTML acessível", () => {
    const shell = new WorkbenchShellController();
    const view = shell.bootstrap({ platform: "linux" });

    assert.match(view.html, /data-testid="workbench-health-indicators"/);
    for (const subsystem of WORKBENCH_HEALTH_SUBSYSTEMS) {
      assert.match(
        view.html,
        new RegExp(`data-testid="health-indicator-${subsystem}"`),
      );
      assert.match(
        view.html,
        new RegExp(`data-health-subsystem="${subsystem}"`),
      );
    }

    assert.equal(shell.health.daemon.status, "disconnected");
    assert.equal(shell.health.sandbox.status, "degraded");
    assert.equal(shell.health.index.status, "offline");
    assert.equal(shell.health.cliproxyapi.status, "offline");

    assert.equal(view.accessible.health.daemon.status, "disconnected");
    assert.equal(view.accessible.health.sandbox.status, "degraded");
    assert.equal(view.accessible.health.index.status, "offline");
    assert.equal(view.accessible.health.cliproxyapi.status, "offline");
  });

  it("atualiza observavelmente a saúde de cada subsistema com estados canônicos", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux" });

    // 1. Daemon: conectado / ready
    shell.setSubsystemHealth("daemon", "ready", "Daemon operacional");
    assert.equal(shell.health.daemon.status, "ready");
    assert.equal(shell.health.daemon.message, "Daemon operacional");
    assert.match(
      shell.snapshot.html,
      /data-testid="health-indicator-daemon"[^>]*data-health-status="ready"/,
    );

    // 2. Sandbox: pronta nativamente
    shell.setSubsystemHealth("sandbox", "ready", "Isolamento nativo ativo");
    assert.equal(shell.health.sandbox.status, "ready");
    assert.match(
      shell.snapshot.html,
      /data-testid="health-indicator-sandbox"[^>]*data-health-status="ready"/,
    );

    // 3. Índice: pronto / sincronizado
    shell.setSubsystemHealth("index", "ready", "FTS5 e embeddings sincronizados");
    assert.equal(shell.health.index.status, "ready");
    assert.match(
      shell.snapshot.html,
      /data-testid="health-indicator-index"[^>]*data-health-status="ready"/,
    );

    // 4. CLIProxyAPI: pronta
    shell.setSubsystemHealth("cliproxyapi", "ready", "Sidecar v8.0.45 operacional");
    assert.equal(shell.health.cliproxyapi.status, "ready");
    assert.match(
      shell.snapshot.html,
      /data-testid="health-indicator-cliproxyapi"[^>]*data-health-status="ready"/,
    );

    // Transição de falha ou degradação
    shell.setSubsystemHealth("cliproxyapi", "degraded", "Sidecar com alta latência");
    assert.equal(shell.health.cliproxyapi.status, "degraded");
    assert.match(
      shell.snapshot.html,
      /data-testid="health-indicator-cliproxyapi"[^>]*data-health-status="degraded"/,
    );
  });

  it("conectar daemon via setDaemonConnected sincroniza o indicador de saúde do daemon", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux" });
    assert.equal(shell.health.daemon.status, "disconnected");

    shell.setDaemonConnected(true);
    assert.equal(shell.health.daemon.status, "connected");
    assert.match(
      shell.snapshot.html,
      /data-testid="health-indicator-daemon"[^>]*data-health-status="connected"/,
    );

    shell.setDaemonConnected(false);
    assert.equal(shell.health.daemon.status, "disconnected");
    assert.match(
      shell.snapshot.html,
      /data-testid="health-indicator-daemon"[^>]*data-health-status="disconnected"/,
    );
  });

  it("permite atualização através do ElectronMainController lançado", () => {
    const main = new ElectronMainController();
    main.launch({ platform: "linux" });

    const view = main.setSubsystemHealth("sandbox", "ready", "Sandbox OK");
    assert.equal(main.health.sandbox.status, "ready");
    assert.match(
      view.html,
      /data-testid="health-indicator-sandbox"[^>]*data-health-status="ready"/,
    );
  });

  it("caminho de erro: subsistema desconhecido retorna INVALID_STATE sem efeito colateral", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux" });
    const previousHealth = JSON.stringify(shell.health);
    const previousHtml = shell.snapshot.html;

    assert.throws(
      () => shell.setSubsystemHealth("banco_externo", "ready", "Tudo ok"),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKBENCH_HEALTH_INVALID_MESSAGE,
    );

    assert.equal(JSON.stringify(shell.health), previousHealth);
    assert.equal(shell.snapshot.html, previousHtml);
  });

  it("caminho de erro: status inválido retorna INVALID_STATE sem efeito colateral", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux" });
    const previousHealth = JSON.stringify(shell.health);

    assert.throws(
      () => shell.setSubsystemHealth("daemon", "quebrado_total", "Erro"),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKBENCH_HEALTH_INVALID_MESSAGE,
    );

    assert.equal(JSON.stringify(shell.health), previousHealth);
  });

  it("caminho de erro: mensagem inválida retorna INVALID_STATE sem efeito colateral", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux" });
    const previousHealth = JSON.stringify(shell.health);

    assert.throws(
      () => shell.setSubsystemHealth("index", "ready", "   "),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKBENCH_HEALTH_INVALID_MESSAGE,
    );

    assert.equal(JSON.stringify(shell.health), previousHealth);
  });

  it("caminho de erro: setSubsystemHealth no ElectronMain sem launch retorna INVALID_STATE", () => {
    const main = new ElectronMainController();
    assert.throws(
      () => main.setSubsystemHealth("daemon", "ready", "OK"),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE",
    );
  });
});
