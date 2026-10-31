import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HARNESS_EVENT_SCHEMA_VERSION,
  ProtocolError,
} from "@openagent/protocol";

import {
  CANVAS_OPEN_EVENT,
  CanvasPanelController,
  RUN_COMPLETED_EVENT,
  type CanvasPanelSessionState,
} from "../../src/canvas/canvas-panel.js";

const RUN_ID = "run-can-01";
const NEXT_RUN_ID = "run-can-01-next";
const SESSION_ID = "sess-can-01";
const CANVAS_ID = "canvas-can-01";
const CONTENT_REF = "sha256:canvas-can-01";
const TITLE = "Plano do componente";
const CONTENT = "<div>Métricas do agente</div>\nexport const X = 1;";

function harnessEvent(sequence: number, type: string, payloadRef: string) {
  return {
    sequence,
    runId: RUN_ID,
    type,
    schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
    payloadRef,
    timestamp: 1_729_200_000_000 + sequence,
  };
}

function canvasOpenedPayload(): Record<string, string> {
  return {
    canvasId: CANVAS_ID,
    title: TITLE,
    contentRef: CONTENT_REF,
  };
}

/** Registro do CAS lido pela porta de conteúdo do canvas. */
function casCanvasRegister(extra: unknown = null): unknown {
  if (extra !== null) {
    return extra;
  }
  return {
    kind: "canvas_artifact",
    artifact: {
      id: CANVAS_ID,
      title: TITLE,
      content: CONTENT,
      createdAt: 1_729_199_000_000,
      updatedAt: 1_729_199_000_000,
    },
  };
}

function fakeArtifactPort(register: unknown = casCanvasRegister()) {
  return {
    loadCanvasArtifact(contentRef: string) {
      if (contentRef !== CONTENT_REF) {
        throw new ProtocolError("INVALID_STATE", "Blob indisponível no CAS.");
      }
      return register;
    },
  };
}

function invalidStateError(error: unknown): boolean {
  assert.ok(error instanceof ProtocolError);
  assert.equal(error.code, "INVALID_STATE");
  return true;
}

describe("CAN-01 e2e — Canvas no painel persistido após o fim da resposta", () => {
  it("canvas aberto pelo agente aparece no painel e permanece visível após o fim da resposta", async () => {
    // 1. Painel do canvas monitora a execução.
    const panel = new CanvasPanelController({ runId: RUN_ID, sessionId: SESSION_ID });
    assert.equal(panel.snapshot.accessible.canvasOpen, false);
    assert.match(panel.snapshot.html, /data-testid="canvas-empty"/);

    // 2. Agente abre um canvas durante a execução (canvas.open + conteúdo no CAS).
    const pushed = panel.push({
      event: harnessEvent(1, CANVAS_OPEN_EVENT, "sha256:canvas-open-payload"),
      payload: canvasOpenedPayload(),
    });
    assert.equal(pushed.view.accessible.phase, "loading");
    assert.match(pushed.view.html, /data-testid="canvas-loading"/);

    // 3. Conteúdo carregado do CAS aparece no painel, focável por teclado.
    await panel.loadArtifact(fakeArtifactPort(), CONTENT_REF);
    assert.equal(panel.snapshot.accessible.phase, "open");
    assert.equal(panel.snapshot.accessible.canvasOpen, true);
    assert.equal(panel.snapshot.accessible.activeCanvasId, CANVAS_ID);
    assert.equal(panel.snapshot.accessible.activeCanvasTitle, TITLE);
    assert.equal(panel.snapshot.accessible.activeCanvasContentPresent, true);
    assert.match(panel.snapshot.html, /data-testid="canvas-artifact"/);
    assert.match(panel.snapshot.html, /data-testid="canvas-title"/);
    assert.match(
      panel.snapshot.html,
      /data-testid="canvas-content"><code>&lt;div&gt;Métricas/,
    );
    assert.equal(panel.snapshot.accessible.canFocusCanvas, true);

    // 4. Fim da resposta (run.completed): o canvas PERMANECE visível no painel,
    //    com o mesmo conteúdo — nada é ocultado ou removido.
    const ended = panel.push({
      event: harnessEvent(2, RUN_COMPLETED_EVENT, "sha256:run-complete"),
    });
    assert.equal(ended.view.accessible.responseEnded, true);
    assert.equal(ended.view.accessible.phase, "open");
    assert.equal(ended.view.accessible.canvasOpen, true);
    assert.equal(ended.view.accessible.activeCanvasId, CANVAS_ID);
    assert.equal(ended.view.accessible.activeCanvasContentPresent, true);
    assert.match(ended.view.html, /data-testid="canvas-artifact"/);
    assert.match(ended.view.html, /data-testid="canvas-content"/);
    assert.equal(ended.view.accessible.artifactCount, 1);

    // 5. Persistência na sessão: conteúdo segue disponível no histórico e a
    //    próxima execução desta sessão restaura o painel sem serviços remotos.
    const exported: CanvasPanelSessionState = panel.exportSessionState();
    assert.equal(exported.artifacts.length, 1);
    assert.equal(exported.artifacts[0]?.content, CONTENT);
    assert.equal(exported.artifacts[0]?.title, TITLE);
    assert.equal(exported.pendingReopen, false);
  });

  it("canvas fechado durante a resposta reabre ao prompt da próxima mensagem com o histórico preservado", async () => {
    const panel = new CanvasPanelController({ runId: RUN_ID, sessionId: SESSION_ID });
    panel.push({
      event: harnessEvent(1, CANVAS_OPEN_EVENT, "sha256:canvas-open-payload"),
      payload: canvasOpenedPayload(),
    });
    await panel.loadArtifact(fakeArtifactPort(), CONTENT_REF);

    // 1. Canvas fechado ainda durante a resposta: conteúdo segue no histórico.
    const closed = panel.closeCanvas();
    assert.equal(closed.view.accessible.phase, "closed");
    assert.match(closed.view.html, /data-testid="canvas-history-entry"/);
    assert.equal(panel.exportSessionState().pendingReopen, true);

    // 2. Fim da resposta com o canvas fechado: estado terminal estável.
    panel.push({
      event: harnessEvent(2, RUN_COMPLETED_EVENT, "sha256:run-complete"),
    });
    assert.equal(panel.snapshot.accessible.responseEnded, true);
    assert.equal(panel.snapshot.accessible.phase, "closed");

    // 3. Prompt da próxima mensagem: nova execução da sessão restaura o
    //    painel e o canvas REAPARECE com o conteúdo preservado no histórico.
    const nextState: CanvasPanelSessionState = panel.exportSessionState();
    const nextRunPanel = new CanvasPanelController({
      runId: NEXT_RUN_ID,
      sessionId: SESSION_ID,
      restored: nextState,
    });
    assert.equal(nextRunPanel.snapshot.accessible.phase, "open");
    assert.equal(nextRunPanel.snapshot.accessible.canvasOpen, true);
    assert.equal(nextRunPanel.snapshot.accessible.activeCanvasId, CANVAS_ID);
    assert.equal(
      nextRunPanel.snapshot.accessible.activeCanvasId,
      nextState.artifacts.at(-1)?.id,
    );
    assert.equal(nextRunPanel.snapshot.accessible.activeCanvasContentPresent, true);
    assert.match(nextRunPanel.snapshot.html, /data-testid="canvas-artifact"/);
    assert.equal(nextRunPanel.snapshot.accessible.artifactCount, 1);
    assert.equal(nextRunPanel.exportSessionState().pendingReopen, false);
  });

  it("histórico da sessão preserva vários canvases, navegação por teclado e reabertura de canvas fechado", async () => {
    const panel = new CanvasPanelController({ runId: RUN_ID, sessionId: SESSION_ID });
    panel.push({
      event: harnessEvent(1, CANVAS_OPEN_EVENT, "sha256:canvas-open-1"),
      payload: canvasOpenedPayload(),
    });
    await panel.loadArtifact(fakeArtifactPort(), CONTENT_REF);

    // Segundo canvas na mesma execução: entra no histórico e se torna ativo.
    panel.push({
      event: harnessEvent(2, CANVAS_OPEN_EVENT, "sha256:canvas-open-2"),
      payload: {
        canvasId: "canvas-can-01-b",
        title: "Rascunho do README",
        contentRef: "sha256:canvas-can-01-b",
      },
    });
    await panel.loadArtifact(
      {
        loadCanvasArtifact(contentRef: string) {
          if (contentRef !== "sha256:canvas-can-01-b") {
            throw new ProtocolError("INVALID_STATE", "Blob indisponível no CAS.");
          }
          return casCanvasRegister({
            kind: "canvas_artifact",
            artifact: {
              id: "canvas-can-01-b",
              title: "Rascunho do README",
              content: "README provisório do OpenAgent Editor",
              createdAt: 1_729_199_001_000,
              updatedAt: 1_729_199_001_000,
            },
          });
        },
      },
      "sha256:canvas-can-01-b",
    );
    assert.equal(panel.snapshot.accessible.artifactCount, 2);
    assert.deepEqual(panel.snapshot.accessible.artifactIds, [CANVAS_ID, "canvas-can-01-b"]);
    assert.equal(panel.snapshot.accessible.activeCanvasId, "canvas-can-01-b");

    // Navegação por teclado entre os alvos focáveis com canvas aberto.
    assert.equal(panel.snapshot.accessible.focused, "canvas-open-view");
    panel.handleKeyboard({ key: "Tab" });
    assert.equal(panel.snapshot.accessible.focused, "canvas-history-list");
    panel.handleKeyboard({ key: "Tab" });
    assert.equal(panel.snapshot.accessible.focused, "canvas-close-button");
    panel.handleKeyboard({ key: "Tab" });
    assert.equal(panel.snapshot.accessible.focused, "canvas-open-view");
    panel.handleKeyboard({ key: "ArrowUp" });
    assert.equal(panel.snapshot.accessible.focused, "canvas-close-button");
    panel.setFocusedControl("canvas-history-list");
    assert.equal(panel.snapshot.accessible.focused, "canvas-history-list");

    // Tecla inválida → INVALID_STATE, foco inalterado.
    const beforeInvalidKey = panel.snapshot;
    assert.throws(
      () => panel.handleKeyboard({ key: "Enter" }),
      invalidStateError,
    );
    assert.deepEqual(panel.snapshot, beforeInvalidKey);

    // Fim da resposta: canvas visível mantido; um fechado reabre pelo histórico.
    panel.push({
      event: harnessEvent(3, RUN_COMPLETED_EVENT, "sha256:run-complete"),
    });
    panel.closeCanvas();
    assert.equal(panel.snapshot.accessible.phase, "closed");
    const reopened = panel.openFromHistory(CANVAS_ID);
    assert.equal(reopened.view.accessible.phase, "open");
    assert.equal(reopened.view.accessible.activeCanvasId, CANVAS_ID);
    assert.equal(reopened.view.accessible.activeCanvasContentPresent, true);
    assert.match(reopened.view.html, /data-testid="canvas-content"/);
  });

  it("entrada ou estado inválido retornam INVALID_STATE sem efeito colateral", async () => {
    const panel = new CanvasPanelController({ runId: RUN_ID, sessionId: SESSION_ID });
    const idle = panel.snapshot;

    // Evento inválido (campos ausentes) → INVALID_STATE, painel inalterado.
    assert.throws(
      () =>
        panel.push({
          event: {
            sequence: 0,
            runId: RUN_ID,
            type: CANVAS_OPEN_EVENT,
            schemaVersion: 1,
            payloadRef: "",
            timestamp: 1,
          },
        }),
      invalidStateError,
    );
    assert.deepEqual(panel.snapshot, idle);

    // runId divergente → INVALID_STATE.
    assert.throws(
      () =>
        panel.push({
          event: {
            sequence: 1,
            runId: "run-canvas-outro",
            type: CANVAS_OPEN_EVENT,
            schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
            payloadRef: "sha256:x",
            timestamp: 1,
          },
          payload: canvasOpenedPayload(),
        }),
      invalidStateError,
    );
    assert.deepEqual(panel.snapshot, idle);

    // canvas.open com payload inválido → INVALID_STATE sem consumir a
    // sequência do stream e sem alterar o painel.
    const missingCanvasId = canvasOpenedPayload();
    delete missingCanvasId["canvasId"];
    assert.throws(
      () =>
        panel.push({
          event: harnessEvent(1, CANVAS_OPEN_EVENT, "sha256:x"),
          payload: missingCanvasId,
        }),
      invalidStateError,
    );
    assert.deepEqual(panel.snapshot, idle);
    assert.throws(
      () =>
        panel.push({
          event: harnessEvent(1, CANVAS_OPEN_EVENT, "sha256:x"),
          payload: null,
        }),
      invalidStateError,
    );
    assert.deepEqual(panel.snapshot, idle);

    // Fim da resposta sem canvas: terminal sem criar ou ocultar conteúdo.
    const afterComplete = panel.push({
      event: harnessEvent(1, RUN_COMPLETED_EVENT, "sha256:complete"),
    });
    assert.equal(afterComplete.view.accessible.responseEnded, true);
    assert.equal(afterComplete.view.accessible.canvasOpen, false);
    assert.equal(afterComplete.view.accessible.artifactCount, 0);

    // Ações exigindo canvas em fase "open" → INVALID_STATE.
    assert.throws(() => panel.closeCanvas(), invalidStateError);
    assert.throws(() => panel.openFromHistory(CANVAS_ID), invalidStateError);
    assert.throws(() => panel.setFocusedControl("canvas-inexistente"), invalidStateError);
    assert.equal(panel.snapshot.accessible.responseEnded, true);
    assert.equal(panel.exportSessionState().artifacts.length, 0);

    // Leitura de conteúdo sem canvas pendente → INVALID_STATE.
    await assert.rejects(
      () => panel.loadArtifact(fakeArtifactPort(), CONTENT_REF),
      invalidStateError,
    );

    // Painel com canvas aberto: falhas de leitura não corrompem o estado.
    const live = new CanvasPanelController({ runId: RUN_ID, sessionId: SESSION_ID });
    live.push({
      event: harnessEvent(1, CANVAS_OPEN_EVENT, "sha256:canvas-open-payload"),
      payload: canvasOpenedPayload(),
    });
    assert.equal(live.snapshot.accessible.phase, "loading");

    // contentRef divergente do canvas aberto → INVALID_STATE.
    await assert.rejects(
      () => live.loadArtifact(fakeArtifactPort(), "sha256:outro"),
      invalidStateError,
    );
    assert.equal(live.snapshot.accessible.phase, "loading");

    // Registro do CAS inválido → INVALID_STATE; histórico permanece vazio.
    await assert.rejects(
      () => live.loadArtifact(fakeArtifactPort(casCanvasRegister({ kind: "tool_result" })), CONTENT_REF),
      invalidStateError,
    );
    await assert.rejects(
      () =>
        live.loadArtifact(
          fakeArtifactPort(
            casCanvasRegister({
              kind: "canvas_artifact",
              artifact: { id: CANVAS_ID, title: TITLE, content: "" },
            }),
          ),
          CONTENT_REF,
        ),
      invalidStateError,
    );
    await assert.rejects(
      () =>
        live.loadArtifact(
          fakeArtifactPort(
            casCanvasRegister({
              kind: "canvas_artifact",
              artifact: { id: "canvas-discrepante", title: TITLE, content: CONTENT },
            }),
          ),
          CONTENT_REF,
        ),
      invalidStateError,
    );
    assert.equal(live.snapshot.accessible.phase, "loading");
    assert.equal(live.exportSessionState().artifacts.length, 0);

    // Abertura duplicada em andamento → INVALID_STATE (antes de qualquer leitura).
    const loadingSnapshot = live.snapshot;
    assert.throws(
      () =>
        live.push({
          event: harnessEvent(2, CANVAS_OPEN_EVENT, "sha256:dup"),
          payload: canvasOpenedPayload(),
        }),
      invalidStateError,
    );
    assert.deepEqual(live.snapshot, loadingSnapshot);

    // Leitura correta depois de falhas anteriores ainda funciona.
    await live.loadArtifact(fakeArtifactPort(), CONTENT_REF);
    assert.equal(live.snapshot.accessible.phase, "open");
    assert.equal(live.snapshot.accessible.canvasOpen, true);

    // Fim da resposta encerra a execução monitorada: novos canvas → INVALID_STATE.
    live.push({
      event: harnessEvent(2, RUN_COMPLETED_EVENT, "sha256:complete"),
    });
    const completed = live.snapshot;
    assert.equal(completed.accessible.responseEnded, true);
    assert.throws(
      () =>
        live.push({
          event: harnessEvent(3, CANVAS_OPEN_EVENT, "sha256:after"),
          payload: canvasOpenedPayload(),
        }),
      invalidStateError,
    );
    assert.deepEqual(live.snapshot, completed);
    assert.throws(
      () =>
        live.push({
          event: harnessEvent(3, "tool.result", "sha256:after"),
        }),
      invalidStateError,
    );
    assert.deepEqual(live.snapshot, completed);

    // Replay fora de ordem → INVALID_STATE sem alterar o painel.
    assert.throws(
      () =>
        live.push({
          event: harnessEvent(1, RUN_COMPLETED_EVENT, "sha256:replay"),
        }),
      invalidStateError,
    );
    assert.deepEqual(live.snapshot, completed);
  });
});
