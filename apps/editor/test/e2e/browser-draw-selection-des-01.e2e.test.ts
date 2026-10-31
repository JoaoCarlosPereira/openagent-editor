import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HARNESS_EVENT_SCHEMA_VERSION,
  ProtocolError,
} from "@openagent/protocol";

import { AgentPanelController } from "../../src/agent/agent-panel.js";
import {
  BrowserPanelController,
  type BrowserPanelPushResult,
  type BrowserPanelResultPort,
  TOOL_RESULT_EVENT,
} from "../../src/browser/browser-panel.js";

const RUN_ID = "run-des-01-draw";
const SESSION_ID = "sess-des-01-draw";
const TARGET_URL = "http://127.0.0.1:8001/formulario";
const SELECTOR = "button.confirmar";
const CODE_SNIPPET = ".form-confirmar { padding: 8px 16px; }";

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
}) {
  return {
    type: TOOL_RESULT_EVENT,
    runId: RUN_ID,
    invocation: {
      id: input.invocationId,
      tool: input.tool,
      target: input.target,
      capability: "browser.open",
      state: "completed",
      resultRef: input.resultRef,
    },
  };
}

const SCREENSHOT = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBASecY42cAAAAAElFTkSuQmCC";

/** Porta falsa: editor principal lê o blob do CAS por resultRef. */
function fakeEvidencePort(
  contents: Map<string, { url: string; screenshot: string }>,
): BrowserPanelResultPort {
  return {
    async loadToolResult(resultRef: string) {
      const evidence = contents.get(resultRef);
      if (!evidence) {
        throw new ProtocolError("INVALID_STATE", "Resultado do navegador indisponível.");
      }
      return {
        kind: "tool_result",
        result: {
          capability: "browser.open",
          tool: "browser.open",
          url: evidence.url,
          targetId: "target-des-01",
          title: "Formulário de teste",
          screenshot: evidence.screenshot,
          screenshotMimeType: "image/png",
          consoleLogs: [],
        },
      };
    },
  };
}

async function evidencePanel(): Promise<BrowserPanelController> {
  const panel = new BrowserPanelController({ runId: RUN_ID, sessionId: SESSION_ID });
  panel.requestOpen(TARGET_URL);
  panel.acceptPermissionPrompt("perm-des-01-open", {
    action: "Abrir URL no navegador",
    target: TARGET_URL,
    scopeLabel: "Uma vez",
  });
  panel.submitDecision("allow");
  const pushResult: BrowserPanelPushResult = panel.push({
    event: harnessEvent(1, TOOL_RESULT_EVENT, "sha256:tool-result-des-01"),
    payload: toolResultPayload({
      invocationId: "perm-des-01-open:open",
      tool: "browser.open",
      target: TARGET_URL,
      resultRef: "sha256:des-01-evidence",
    }),
  });
  assert.equal(pushResult.view.accessible.phase, "loading");
  await panel.loadEvidence(fakeEvidencePort(new Map([["sha256:des-01-evidence", { url: TARGET_URL, screenshot: SCREENSHOT }]])), "sha256:des-01-evidence");
  assert.equal(panel.snapshot.accessible.phase, "evidence");
  return panel;
}

describe("DES-01 e2e — Modo desenho: elemento e código anexados à próxima mensagem", () => {
  it("seleção de elemento no navegador anexa identidade e trecho de código à mensagem seguinte (e só a ela)", async () => {
    // 1. Painel do agente e navegador autorizado com captura exibida.
    const agentPanel = new AgentPanelController();
    agentPanel.open({ sessionId: SESSION_ID });
    const panel = await evidencePanel();
    assert.equal(agentPanel.snapshot.accessible.historyCount, 0);

    // 2. Modo desenho ativo sobre a captura exibida.
    const draw = panel.setDrawMode(true);
    assert.equal(draw.view.accessible.drawMode, true);
    assert.equal(draw.view.accessible.canSelectElement, true);
    assert.match(draw.view.html, /data-testid="browser-draw-mode-active"/);

    // 3. Seleção de elemento: identidade (seletor) e trecho de código visíveis
    //    no painel como rascunho para a PRÓXIMA mensagem — nada é enviado aqui.
    const selection = panel.selectElement({ selector: SELECTOR, codeSnippet: CODE_SNIPPET });
    assert.equal(selection.view.accessible.pendingSelection?.selector, SELECTOR);
    assert.equal(selection.view.accessible.pendingSelection?.codeSnippetPresent, true);
    assert.match(selection.view.html, /data-testid="browser-draw-selection"/);
    assert.ok(
      selection.view.html.includes(
        `data-testid="browser-draw-code-snippet"><code>${CODE_SNIPPET}</code>`,
      ),
    );
    assert.match(selection.view.html, /Anexo da próxima mensagem/);
    // Nada é enviado sem a mensagem: histórico do agente permanece intacto.
    assert.equal(agentPanel.snapshot.accessible.historyCount, 0);

    // 4. Anexo com identidade do elemento e código, consumido uma única vez
    //    para a próxima mensagem do agente.
    const taken = panel.takeSelectionAttachment();
    assert.equal(taken.attachment.kind, "selection");
    assert.equal(taken.attachment.path, `${TARGET_URL}#${SELECTOR}`);
    assert.equal(taken.attachment.previewText, CODE_SNIPPET);
    // Consumo único: o anexo vai apenas para a mensagem seguinte.
    assert.throws(
      () => panel.takeSelectionAttachment(),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.pendingSelection, null);
    assert.doesNotMatch(panel.snapshot.html, /data-testid="browser-draw-selection"/);

    // 5. Composer do agente recebe o anexo; envio da PRÓXIMA mensagem carrega o ref.
    agentPanel.setContextAttachments([taken.attachment]);
    agentPanel.setComposerText("Explique esse elemento e como estilizá-lo");
    const submitted = agentPanel.submitComposer();
    assert.equal(submitted.userInput.attachments?.[0]?.ref, taken.attachment.id);
    assert.equal(submitted.userInput.attachments?.length, 1);
    assert.equal(submitted.history.at(-1)?.role, "user");

    // 6. A próxima mensagem só: mensagem seguinte sem nova seleção NÃO repete o anexo.
    agentPanel.setContextAttachments([]);
    agentPanel.setComposerText("Agora liste os estilos aplicados");
    const second = agentPanel.submitComposer();
    assert.equal(second.userInput.attachments, undefined);
    assert.equal(second.history.at(-1)?.role, "user");
  });

  it("campos inválidos ou estado inválido retornam código estável sem efeito colateral", async () => {
    const panel = await evidencePanel();
    const baseline = panel.snapshot;

    // Modo desenho sem navegador autorizado → INVALID_STATE (estado base).
    const closed = new BrowserPanelController({ runId: RUN_ID, sessionId: "sess-outro" });
    const closedBaseline = closed.snapshot;
    assert.throws(
      () => closed.setDrawMode(true),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.deepEqual(closed.snapshot, closedBaseline);

    // Seleção sem modo desenho ativo → INVALID_STATE, sem anexo pendente.
    assert.throws(
      () => panel.selectElement({ selector: SELECTOR, codeSnippet: CODE_SNIPPET }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.deepEqual(panel.snapshot, baseline);

    // Modo desenho ativo duplicado → INVALID_STATE.
    panel.setDrawMode(true);
    assert.throws(
      () => panel.setDrawMode(true),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );

    // Seleção inválida: seletor vazio, código vazio, campos ausentes → INVALID_STATE
    // sem criar anexo pendente e com modo desenho preservado.
    const withModeActive = panel.snapshot;
    assert.throws(
      () => panel.selectElement({ selector: "   ", codeSnippet: CODE_SNIPPET }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.deepEqual(panel.snapshot, withModeActive);
    assert.throws(
      () => panel.selectElement({ selector: SELECTOR, codeSnippet: "  " }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.deepEqual(panel.snapshot, withModeActive);
    assert.throws(
      () => panel.selectElement({ selector: SELECTOR }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.deepEqual(panel.snapshot, withModeActive);
    assert.throws(
      () => panel.selectElement(null),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.deepEqual(panel.snapshot, withModeActive);
    assert.equal(panel.snapshot.accessible.drawMode, true);

    // Consumo sem seleção prévia → INVALID_STATE.
    assert.throws(
      () => panel.takeSelectionAttachment(),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.deepEqual(panel.snapshot, withModeActive);

    // Saída duplicada do modo desenho → INVALID_STATE.
    panel.setDrawMode(false);
    assert.throws(
      () => panel.setDrawMode(false),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.drawMode, false);
  });
});
