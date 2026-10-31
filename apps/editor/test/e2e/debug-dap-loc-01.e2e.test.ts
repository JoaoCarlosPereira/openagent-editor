import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ProtocolError } from "@openagent/protocol";

import {
  ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE,
  ElectronMainController,
  OPENAGENT_PRODUCT_NAME,
} from "../../src/main/electron-main.js";
import {
  DEBUG_BREAKPOINT_LINE_INVALID_MESSAGE,
  DEBUG_BREAKPOINT_NOT_FOUND_MESSAGE,
  DEBUG_BREAKPOINT_PATH_REQUIRED_MESSAGE,
  DEBUG_NO_SESSION_MESSAGE,
  DEBUG_SESSION_TERMINATED_MESSAGE,
  DEBUG_TARGET_PATH_REQUIRED_MESSAGE,
  OUT_OF_SCOPE_PATH_LOG_MESSAGE,
  WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE,
  WorkbenchShellController,
} from "../../src/workbench/workbench-shell.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function createFixtureWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "openagent-debug-dap-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "README.md"), "# debug fixture\n", "utf8");
  writeFileSync(
    path.join(root, "src", "index.ts"),
    "const a = 1;\nconst b = 2;\nconsole.log(a + b);\n",
    "utf8",
  );
  return root;
}

describe("LOC-01 e2e — Depuração com breakpoint via DAP", () => {
  it("main abre sessão de depuração DAP, adiciona breakpoints e controla execução observável", () => {
    const fixture = createFixtureWorkspace();
    try {
      const main = new ElectronMainController();
      main.launch({ platform: "linux", repoRoot: REPO_ROOT });
      main.openFolder(fixture);

      // Baseline: sem sessão de debug aberta
      assert.equal(main.shell.snapshot.accessible.debug.open, false);
      assert.match(main.shell.snapshot.html, /Abra uma sessão de depuração na pasta do workspace/);
      assert.match(main.shell.snapshot.html, /data-debug-open="false"/);

      // Abre sessão de debug apontando para src/index.ts
      const opened = main.openDebug("src/index.ts");
      assert.ok(opened.session.id.length > 0);
      assert.equal(opened.session.workspaceRoot, path.resolve(fixture));
      assert.equal(opened.session.targetRelativePath, "src/index.ts");
      assert.equal(opened.session.dapVersion, "dap/1.0");
      assert.equal(opened.session.status, "idle");
      assert.equal(opened.session.stopReason, null);
      assert.equal(opened.session.currentLine, null);
      assert.equal(opened.session.breakpoints.length, 0);

      // Observabilidade no snapshot / HTML
      assert.equal(opened.view.accessible.productName, OPENAGENT_PRODUCT_NAME);
      assert.equal(opened.view.accessible.debug.open, true);
      assert.equal(opened.view.accessible.debug.targetRelativePath, "src/index.ts");
      assert.equal(opened.view.accessible.debug.dapVersion, "dap/1.0");
      assert.equal(opened.view.accessible.debug.status, "idle");
      assert.equal(opened.view.accessible.debug.breakpointCount, 0);
      assert.match(opened.view.html, /data-testid="workbench-slot-debug"/);
      assert.match(opened.view.html, /data-debug-open="true"/);
      assert.match(opened.view.html, /data-dap-version="dap\/1\.0"/);
      assert.match(opened.view.html, /data-target="src\/index\.ts"/);
      assert.match(opened.view.html, /data-testid="debug-target"/);
      assert.match(opened.view.html, /data-testid="debug-status"/);

      // Adiciona breakpoint 1
      const withBp1 = main.setDebugBreakpoint("src/index.ts", 1);
      assert.equal(withBp1.session.breakpoints.length, 1);
      const bp1 = withBp1.session.breakpoints[0];
      assert.ok(bp1);
      assert.equal(bp1.relativePath, "src/index.ts");
      assert.equal(bp1.line, 1);
      assert.equal(bp1.verified, true);
      assert.equal(withBp1.view.accessible.debug.breakpointCount, 1);
      assert.match(withBp1.view.html, /data-testid="debug-breakpoint-/);
      assert.match(withBp1.view.html, /src\/index\.ts:1/);

      // Adiciona breakpoint 2
      const withBp2 = main.setDebugBreakpoint("src/index.ts", 3);
      assert.equal(withBp2.session.breakpoints.length, 2);
      const bp2 = withBp2.session.breakpoints[1];
      assert.ok(bp2);
      assert.equal(bp2.line, 3);
      assert.equal(withBp2.view.accessible.debug.breakpointCount, 2);

      // Inicia a execução
      const running = main.startDebug();
      assert.equal(running.session.status, "running");
      assert.equal(running.view.accessible.debug.status, "running");
      assert.match(running.view.html, /data-status="running"/);

      // Continua até breakpoint
      const stopped = main.continueDebug();
      assert.equal(stopped.session.status, "stopped");
      assert.equal(stopped.session.stopReason, "breakpoint");
      assert.equal(stopped.session.currentLine, 1);
      assert.equal(stopped.view.accessible.debug.status, "stopped");
      assert.equal(stopped.view.accessible.debug.stopReason, "breakpoint");
      assert.equal(stopped.view.accessible.debug.currentLine, 1);
      assert.match(stopped.view.html, /data-testid="debug-stop-reason"[^>]*>breakpoint</);
      assert.match(stopped.view.html, /data-testid="debug-current-line"[^>]*>1</);

      // Avança linha (step over)
      const stepped = main.stepOverDebug();
      assert.equal(stepped.session.status, "stopped");
      assert.equal(stepped.session.stopReason, "step");
      assert.equal(stepped.session.currentLine, 2);
      assert.match(stepped.view.html, /data-testid="debug-stop-reason"[^>]*>step</);
      assert.match(stepped.view.html, /data-testid="debug-current-line"[^>]*>2</);

      // Remove breakpoint 2
      const withBpRemoved = main.removeDebugBreakpoint(bp2.id);
      assert.equal(withBpRemoved.session.breakpoints.length, 1);
      assert.equal(withBpRemoved.session.breakpoints[0]?.id, bp1.id);
      assert.equal(withBpRemoved.view.accessible.debug.breakpointCount, 1);

      // Encerra a sessão
      const stoppedSession = main.stopDebug();
      assert.equal(stoppedSession.session.status, "terminated");
      assert.equal(stoppedSession.session.stopReason, "stop");
      assert.equal(stoppedSession.session.currentLine, null);
      assert.equal(stoppedSession.view.accessible.debug.status, "terminated");

      // Sessão terminada recusa novas operações
      assert.throws(
        () => main.startDebug(),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_SESSION_TERMINATED_MESSAGE,
      );
      assert.throws(
        () => main.setDebugBreakpoint("src/index.ts", 10),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_SESSION_TERMINATED_MESSAGE,
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("caminho de erro: estado inválido e fora do escopo sem efeito colateral", () => {
    const fixture = createFixtureWorkspace();
    try {
      const main = new ElectronMainController();

      // Sem launch()
      assert.throws(
        () => main.openDebug("src/index.ts"),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE,
      );
      assert.throws(
        () => main.startDebug(),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE,
      );

      main.launch({ platform: "linux", repoRoot: REPO_ROOT });

      // Sem openFolder()
      assert.throws(
        () => main.openDebug("src/index.ts"),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE,
      );

      main.openFolder(fixture);

      // Operações sem sessão de debug aberta
      assert.throws(
        () => main.startDebug(),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_NO_SESSION_MESSAGE,
      );
      assert.throws(
        () => main.stopDebug(),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_NO_SESSION_MESSAGE,
      );
      assert.throws(
        () => main.continueDebug(),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_NO_SESSION_MESSAGE,
      );
      assert.throws(
        () => main.stepOverDebug(),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_NO_SESSION_MESSAGE,
      );
      assert.throws(
        () => main.setDebugBreakpoint("src/index.ts", 1),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_NO_SESSION_MESSAGE,
      );
      assert.throws(
        () => main.removeDebugBreakpoint("any-id"),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_NO_SESSION_MESSAGE,
      );

      // Alvo inválido no openDebug
      assert.throws(
        () => main.openDebug(""),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_TARGET_PATH_REQUIRED_MESSAGE,
      );
      assert.throws(
        () => main.openDebug(null),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_TARGET_PATH_REQUIRED_MESSAGE,
      );
      assert.throws(
        () => main.openDebug("/absoluto/path.ts"),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_TARGET_PATH_REQUIRED_MESSAGE,
      );
      assert.throws(
        () => main.openDebug("../fora.ts"),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "OUT_OF_SCOPE" &&
          err.message === OUT_OF_SCOPE_PATH_LOG_MESSAGE,
      );

      // Estado observável intacto após erros de abertura
      assert.equal(main.shell.openDebugSession, null);
      assert.equal(main.shell.snapshot.accessible.debug.open, false);

      // Abre sessão válida
      const validOpened = main.openDebug("src/index.ts");
      assert.equal(validOpened.session.breakpoints.length, 0);

      // Breakpoint com path fora do escopo
      assert.throws(
        () => main.setDebugBreakpoint("../fora.ts", 1),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "OUT_OF_SCOPE" &&
          err.message === OUT_OF_SCOPE_PATH_LOG_MESSAGE,
      );

      // Breakpoint com path inválido
      assert.throws(
        () => main.setDebugBreakpoint("", 1),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_BREAKPOINT_PATH_REQUIRED_MESSAGE,
      );
      assert.throws(
        () => main.setDebugBreakpoint("/abs/path.ts", 1),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_BREAKPOINT_PATH_REQUIRED_MESSAGE,
      );

      // Breakpoint com linha inválida
      assert.throws(
        () => main.setDebugBreakpoint("src/index.ts", 0),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_BREAKPOINT_LINE_INVALID_MESSAGE,
      );
      assert.throws(
        () => main.setDebugBreakpoint("src/index.ts", -5),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_BREAKPOINT_LINE_INVALID_MESSAGE,
      );
      assert.throws(
        () => main.setDebugBreakpoint("src/index.ts", "dez"),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_BREAKPOINT_LINE_INVALID_MESSAGE,
      );

      // Breakpoint inexistente ao remover
      assert.throws(
        () => main.removeDebugBreakpoint("inexistente-uuid"),
        (err: unknown) =>
          err instanceof ProtocolError &&
          err.code === "INVALID_STATE" &&
          err.message === DEBUG_BREAKPOINT_NOT_FOUND_MESSAGE,
      );

      // Estado continua com 0 breakpoints sem corrupção
      assert.equal(validOpened.session.breakpoints.length, 0);
      assert.equal(main.shell.snapshot.accessible.debug.breakpointCount, 0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("caminho de erro: shell sem pasta aberta retorna INVALID_STATE", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux", repoRoot: REPO_ROOT });

    assert.throws(
      () => shell.openDebug("src/index.ts"),
      (err: unknown) =>
        err instanceof ProtocolError &&
        err.code === "INVALID_STATE" &&
        err.message === WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE,
    );
    assert.throws(
      () => shell.startDebug(),
      (err: unknown) =>
        err instanceof ProtocolError &&
        err.code === "INVALID_STATE" &&
        err.message === WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE,
    );
    assert.throws(
      () => shell.setDebugBreakpoint("src/index.ts", 1),
      (err: unknown) =>
        err instanceof ProtocolError &&
        err.code === "INVALID_STATE" &&
        err.message === WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE,
    );
    assert.equal(shell.snapshot.accessible.debug.open, false);
  });
});
