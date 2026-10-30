import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HARNESS_EVENT_SCHEMA_VERSION, ProtocolError } from "@openagent/protocol";

import {
  BROWSER_OPEN_FAILED_EVENT,
  TOOL_RESULT_EVENT,
  BrowserPanelController,
  type BrowserPanelPushResult,
  type BrowserPanelResultPort,
} from "../../src/browser/browser-panel.js";

const RUN_ID = "run-aut-01-browser-panel";
const SESSION_ID = "sess-aut-01-browser-panel";
const TARGET_URL = "http://127.0.0.1:8001/formulario";

function harnessEvent(sequence: number, type: string, payloadRef: string) {
  return {
    sequence,
    runId: RUN_ID,
    type,
    schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
    payloadRef,
    timestamp: 1_729_100_000_000 + sequence,
  };
}

function toolResultPayload(input: {
  invocationId: string;
  tool: "browser.open" | "browser.click";
  target: string;
  resultRef: string;
  state?: string;
}) {
  return {
    type: TOOL_RESULT_EVENT,
    runId: RUN_ID,
    invocation: {
      id: input.invocationId,
      tool: input.tool,
      target: input.target,
      capability: "browser.open",
      state: input.state ?? "completed",
      resultRef: input.resultRef,
    },
  };
}

function browserEvidence(input: {
  tool: "browser.open" | "browser.click";
  url: string;
  screenshot: string;
  consoleLogs: Array<{ type: string; text: string; timestamp: number }>;
}) {
  return {
    capability: "browser.open",
    tool: input.tool,
    url: input.url,
    targetId: "target-e2e-1",
    title: "Formulário de teste",
    screenshot: input.screenshot,
    screenshotMimeType: "image/png",
    screenshotLength: input.screenshot.length,
    consoleLogCount: input.consoleLogs.length,
    consoleLogs: input.consoleLogs,
  };
}

/** Porta falsa: editor principal lê o blob do CAS por resultRef. */
function fakeEvidencePort(
  contents: Map<string, { tool: "browser.open" | "browser.click"; url: string; screenshot: string; consoleLogs: Array<{ type: string; text: string; timestamp: number }> }>,
  options: { failOn?: (resultRef: string) => boolean } = {},
): BrowserPanelResultPort {
  return {
    async loadToolResult(resultRef: string) {
      if (options.failOn?.(resultRef) === true) {
        throw new ProtocolError("INVALID_STATE", "Resultado do navegador indisponível.");
      }
      const evidence = contents.get(resultRef);
      if (!evidence) {
        throw new ProtocolError("INVALID_STATE", "Resultado do navegador indisponível.");
      }
      return { kind: "tool_result", result: browserEvidence(evidence) };
    },
  };
}

const SCREENSHOT_OPEN = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBASecY42cAAAAAElFTkSuQmCC";
const SCREENSHOT_AFTER_CLICK = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wFTAJ+6AAAAAElFTkSuQmCC";

describe("AUT-01 e2e — Painel do navegador com captura e console", () => {
  it("autorizar o navegador abre a URL indicada, executa a interação autorizada e mostra a captura e o console", async () => {
    // 1. Instanciação: painel ocioso observável.
    const panel = new BrowserPanelController({ runId: RUN_ID, sessionId: SESSION_ID });
    assert.match(panel.snapshot.html, /data-testid="browser-panel"/);
    assert.equal(panel.snapshot.accessible.phase, "idle");
    assert.equal(panel.snapshot.accessible.canOpen, true);
    assert.equal(panel.snapshot.accessible.screenshotPresent, false);
    assert.equal(panel.snapshot.accessible.consoleEntryCount, 0);
    assert.match(panel.snapshot.html, /data-testid="browser-url-input"/);
    assert.match(panel.snapshot.html, /data-testid="browser-open-button"/);
    assert.match(panel.snapshot.html, /Nenhuma captura do navegador/);

    // 2. Pedido de UI: abrir URL autorizada via tool.invoke browser.open.
    const opened = panel.requestOpen(TARGET_URL);
    assert.equal(opened.rpc.method, "tool.invoke");
    assert.deepEqual(opened.rpc.params, {
      tool: "browser.open",
      target: TARGET_URL,
      arguments: {},
    });

    // 3. Autorização: pending do daemon exibe ação/alvo/escopo e botões de decisão.
    const permit = panel.acceptPermissionPrompt("perm-aut-01-open", {
      action: "Abrir URL no navegador",
      target: TARGET_URL,
      scopeLabel: "Uma vez",
    });
    assert.equal(permit.view.accessible.phase, "pending");
    assert.equal(permit.view.accessible.pendingPermissionRequestId, "perm-aut-01-open");
    assert.match(permit.view.html, /data-testid="browser-permission-prompt"/);
    assert.match(permit.view.html, /Abrir URL no navegador/);
    assert.match(permit.view.html, /data-testid="browser-allow-button"/);
    assert.match(permit.view.html, /data-testid="browser-deny-button"/);

    // 4. Decisão da pessoa: permitir (após aceite; do pending para permission.decide).
    const decision = panel.submitDecision("allow");
    assert.equal(decision.rpc.method, "permission.decide");
    assert.deepEqual(decision.rpc.params, {
      permissionRequestId: "perm-aut-01-open",
      decision: "allow",
      scope: "once",
    });

    // 5. Eco do daemon: tool.result com resultRef; captura e console carregados.
    const evidenceContents = new Map([
      [
        "sha256:browser-open-e2e",
        {
          tool: "browser.open" as const,
          url: TARGET_URL,
          screenshot: SCREENSHOT_OPEN,
          consoleLogs: [
            { type: "log", text: "página carregada", timestamp: 3 },
            { type: "error", text: "boom de validação", timestamp: 4 },
          ],
        },
      ],
    ]);
    const pushResult: BrowserPanelPushResult = panel.push({
      event: harnessEvent(1, TOOL_RESULT_EVENT, "sha256:tool-result-open"),
      payload: toolResultPayload({
        invocationId: `perm-aut-01-open:open`,
        tool: "browser.open",
        target: TARGET_URL,
        resultRef: "sha256:browser-open-e2e",
      }),
    });
    assert.equal(pushResult.view.accessible.phase, "loading");
    assert.equal(pushResult.resultRef, "sha256:browser-open-e2e");

    const loaded = await panel.loadEvidence(
      fakeEvidencePort(evidenceContents),
      "sha256:browser-open-e2e",
    );
    assert.equal(loaded.view.accessible.phase, "evidence");
    assert.equal(loaded.view.accessible.screenshotPresent, true);
    assert.equal(loaded.view.accessible.consoleEntryCount, 2);
    assert.equal(loaded.view.accessible.lastUrl, TARGET_URL);
    assert.ok(
      loaded.view.html.includes(
        `data-testid="browser-screenshot" data-dataset="browser.open" src="data:image/png;base64,${SCREENSHOT_OPEN}"`,
      ),
    );
    assert.match(loaded.view.html, /data-testid="browser-console-entry" data-log-type="log">[^<]*página carregada/);
    assert.match(loaded.view.html, /data-testid="browser-console-entry" data-log-type="error">[^<]*boom de validação/);
    assert.match(loaded.view.html, /data-testid="browser-open-url"/);
    assert.ok(loaded.view.html.includes(`data-url="${TARGET_URL}"`));

    // 6. INTERAÇÃO autorizada no mesmo target: browser.click (AUT-01).
    const clicked = panel.requestClick("button.confirmar");
    assert.equal(clicked.rpc.method, "tool.invoke");
    assert.deepEqual(clicked.rpc.params, {
      tool: "browser.click",
      target: TARGET_URL,
      arguments: { selector: "button.confirmar" },
    });

    const secondPrompt = panel.acceptPermissionPrompt("perm-aut-01-click", {
      action: "Interagir no navegador",
      target: TARGET_URL,
      scopeLabel: "Uma vez",
    });
    assert.equal(secondPrompt.view.accessible.phase, "pending");
    const secondDecision = panel.submitDecision("allow");
    assert.deepEqual(secondDecision.rpc.params, {
      permissionRequestId: "perm-aut-01-click",
      decision: "allow",
      scope: "once",
    });

    const clickContents = new Map([
      [
        "sha256:browser-click-e2e",
        {
          tool: "browser.click" as const,
          url: TARGET_URL,
          screenshot: SCREENSHOT_AFTER_CLICK,
          consoleLogs: [
            { type: "log", text: "clique aplicado", timestamp: 9 },
          ],
        },
      ],
    ]);
    panel.push({
      event: harnessEvent(2, TOOL_RESULT_EVENT, "sha256:tool-result-click"),
      payload: toolResultPayload({
        invocationId: "perm-aut-01-click",
        tool: "browser.click",
        target: TARGET_URL,
        resultRef: "sha256:browser-click-e2e",
      }),
    });
    const clickedEvidence = await panel.loadEvidence(
      fakeEvidencePort(clickContents),
      "sha256:browser-click-e2e",
    );
    assert.equal(clickedEvidence.view.accessible.phase, "evidence");
    assert.equal(clickedEvidence.view.accessible.lastInteraction, "browser.click");
    assert.equal(clickedEvidence.view.accessible.consoleEntryCount, 1);
    assert.match(clickedEvidence.view.html, /data-dataset="browser.click"/);
    assert.ok(
      clickedEvidence.view.html.includes(`src="data:image/png;base64,${SCREENSHOT_AFTER_CLICK}"`),
    );
    assert.match(clickedEvidence.view.html, /clique aplicado/);
  });

  it("recusa explícita da pessoa impede a execução e mostra recusa", () => {
    const panel = new BrowserPanelController({ runId: RUN_ID, sessionId: SESSION_ID });
    panel.requestOpen("http://127.0.0.1:8001/recusa");
    panel.acceptPermissionPrompt("perm-deny", {
      action: "Abrir URL no navegador",
      target: "http://127.0.0.1:8001/recusa",
      scopeLabel: "Uma vez",
    });
    const denied = panel.submitDecision("deny");
    assert.equal(denied.rpc.method, "permission.decide");
    assert.equal(denied.rpc.params.decision, "deny");
    assert.equal(denied.view.accessible.phase, "denied");
    assert.match(denied.view.html, /data-testid="browser-denied"/);
    assert.match(denied.view.html, /Autorização recusada/);
    // Sem captura exibida (nada foi executado).
    assert.equal(denied.view.accessible.screenshotPresent, false);
  });

  it("falha da execução (browser.open.failed) preserva a evidência anterior e mostra o erro", () => {
    const panel = new BrowserPanelController({ runId: RUN_ID, sessionId: SESSION_ID });
    // Evidência prévia carregada.
    panel.requestOpen("http://127.0.0.1:8001/antes");
    panel.acceptPermissionPrompt("perm-1", {
      action: "Abrir URL no navegador",
      target: "http://127.0.0.1:8001/antes",
      scopeLabel: "Uma vez",
    });
    panel.submitDecision("allow");
    const evidenceContents = new Map([
      [
        "sha256:antes",
        {
          tool: "browser.open" as const,
          url: "http://127.0.0.1:8001/antes",
          screenshot: SCREENSHOT_OPEN,
          consoleLogs: [{ type: "log", text: "antes", timestamp: 1 }],
        },
      ],
    ]);
    panel.push({
      event: harnessEvent(1, TOOL_RESULT_EVENT, "sha256:r1"),
      payload: toolResultPayload({
        invocationId: "perm-1:open",
        tool: "browser.open",
        target: "http://127.0.0.1:8001/antes",
        resultRef: "sha256:antes",
      }),
    });
    return Promise.resolve(panel.loadEvidence(fakeEvidencePort(evidenceContents), "sha256:antes")).then((evidence) => {
      assert.equal(evidence.view.accessible.phase, "evidence");

      // Falha depois: nenhuma exceção (erro da run já persistido no daemon).
      const failed = panel.push({
        event: harnessEvent(2, BROWSER_OPEN_FAILED_EVENT, "sha256:fail"),
        payload: { type: BROWSER_OPEN_FAILED_EVENT, message: "Tempo limite de carregamento excedido." },
      });
      assert.equal(failed.view.accessible.phase, "failed");
      assert.match(failed.view.html, /data-testid="browser-failed"/);
      assert.match(failed.view.html, /Tempo limite de carregamento excedido\./);
      // Evidência anterior é PRESERVADA para inspeção (não some da tela).
      assert.equal(failed.view.accessible.screenshotPresent, true);
      assert.ok(failed.view.html.includes(`data:image/png;base64,${SCREENSHOT_OPEN}`));
      assert.equal(failed.view.accessible.consoleEntryCount, 1);
      assert.match(failed.view.html, /antes/);
    });
  });

  it("caminho de erro: entrada ou estado inválidos retornam código estável sem efeito colateral", () => {
    const panel = new BrowserPanelController({ runId: RUN_ID, sessionId: SESSION_ID });
    const baseline = panel.snapshot;

    // URL inválida: sem RPC, snapshot inalterado.
    assert.throws(
      () => panel.requestOpen(""),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.deepEqual(panel.snapshot, baseline);

    assert.throws(
      () => panel.requestOpen("javascript:alert(1)"),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "OUT_OF_SCOPE");
        return true;
      },
    );
    assert.deepEqual(panel.snapshot, baseline);

    assert.throws(
      () => panel.requestOpen("não é uma url"),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.deepEqual(panel.snapshot, baseline);

    // Interação sem sessão aberta: INVALID_STATE.
    assert.throws(
      () => panel.requestClick("button.confirmar"),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.deepEqual(panel.snapshot, baseline);

    // Decisão duplicada do mesmo pedido: INVALID_STATE (pedido consumido único).
    panel.requestOpen("http://127.0.0.1:8001/dupla");
    panel.acceptPermissionPrompt("perm-dupla", {
      action: "Abrir URL no navegador",
      target: "http://127.0.0.1:8001/dupla",
      scopeLabel: "Uma vez",
    });
    panel.submitDecision("allow");
    const afterFirstDecision = panel.snapshot;
    assert.throws(
      () => panel.submitDecision("allow"),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.pendingPermissionRequestId, null);
    assert.deepEqual(panel.snapshot, afterFirstDecision);

    // Evento de run divergente: INVALID_STATE (sem efeito colateral).
    const divergent = { ...harnessEvent(1, TOOL_RESULT_EVENT, "sha256:outro"), runId: "run-outro" };
    assert.throws(
      () => panel.push({ event: divergent, payload: toolResultPayload({ invocationId: "x", tool: "browser.open", target: TARGET_URL, resultRef: "sha256:x" }) }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.deepEqual(panel.snapshot, afterFirstDecision);

    // Tipo de evento não suportado: INVALID_STATE.
    assert.throws(
      () => panel.push({ event: harnessEvent(1, "run.cancelled", "sha256:cancel") }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.deepEqual(panel.snapshot, afterFirstDecision);

    // Resultado indisponível na porta: erro é reportado, sem corromper o painel.
    return Promise.resolve(
      panel
        .loadEvidence(fakeEvidencePort(new Map()), "sha256:inexistente")
        .then(
          () => {
            throw new Error("deveria ter falhado");
          },
          (error: unknown) => {
            assert.ok(error instanceof ProtocolError);
            assert.equal(error.code, "INVALID_STATE");
            assert.deepEqual(panel.snapshot, afterFirstDecision);
          },
        ),
    );
  });
});
