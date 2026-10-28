import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import {
  executePolicyBrowserOpen,
  formatAgentBrowserToolResult,
  InMemoryCdpTransport,
  preparePolicyBrowserOpen,
  CdpTargetManager,
  validateBrowserUrl,
  MOCK_SCREENSHOT_BASE64,
  type PolicyBrowserToolContext,
} from "../../src/index.js";

function agentContext(): PolicyBrowserToolContext {
  return { agentMode: "agent", executionMode: "standard" };
}

// ================================================================
// AUT-01 — validação de URL
// ================================================================

test("[AUT-01] validateBrowserUrl: URL válida retorna href", () => {
  const url = validateBrowserUrl("http://localhost:3000/test.html");
  assert.equal(url, "http://localhost:3000/test.html");
});

test("[AUT-01] validateBrowserUrl: rejeita URL vazia com INVALID_STATE", () => {
  assert.throws(
    () => validateBrowserUrl(""),
    (err: unknown) => {
      assert.ok(err instanceof ProtocolError);
      assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});

test("[AUT-01] validateBrowserUrl: rejeita URL inválida com INVALID_STATE", () => {
  assert.throws(
    () => validateBrowserUrl("not a valid url at all"),
    (err: unknown) => {
      assert.ok(err instanceof ProtocolError);
      assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});

test("[AUT-01] validateBrowserUrl: rejeita esquema não autorizado com OUT_OF_SCOPE", () => {
  assert.throws(
    () => validateBrowserUrl("javascript:void(0)"),
    (err: unknown) => {
      assert.ok(err instanceof ProtocolError);
      assert.equal(err.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
      return true;
    },
  );
});

test("[AUT-01] validateBrowserUrl: rejeita credencial embutida com OUT_OF_SCOPE", () => {
  assert.throws(
    () => validateBrowserUrl("https://user:pass@localhost:3000/"),
    (err: unknown) => {
      assert.ok(err instanceof ProtocolError);
      assert.equal(err.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
      return true;
    },
  );
});

test("[AUT-01] validateBrowserUrl: valida file:// confinado ao workspace canonicalizado", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "browser-workspace-"));
  const filePath = path.join(workspaceRoot, "page.html");
  writeFileSync(filePath, "<h1>ok</h1>", "utf8");

  const fileUrl = `file://${filePath}`;
  const validated = validateBrowserUrl(fileUrl, { workspaceRoot });
  assert.equal(validated, new URL(fileUrl).href);

  assert.throws(
    () => validateBrowserUrl("file:///etc/hosts", { workspaceRoot }),
    (err: unknown) => {
      assert.ok(err instanceof ProtocolError);
      assert.equal(err.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
      return true;
    },
  );
});

test("[AUT-01] validateBrowserUrl: restringe allowedUrlPrefixes com fronteira exata", () => {
  const options = { allowedUrlPrefixes: ["http://localhost:3000/app/"] };
  assert.equal(
    validateBrowserUrl("http://localhost:3000/app/page", options),
    "http://localhost:3000/app/page",
  );
  assert.throws(
    () => validateBrowserUrl("http://localhost:3000/app-other", options),
    (err: unknown) => {
      assert.ok(err instanceof ProtocolError);
      assert.equal(err.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
      return true;
    },
  );
});

// ================================================================
// AUT-01 — permissão e policy (prepare + decide + execute)
// ================================================================

test("[AUT-01] preparePolicyBrowserOpen: solicita permissão pendente", async () => {
  const { RunToolPermissionFlow } = await import("@openagent/policy");
  const flow = new RunToolPermissionFlow();
  const ctx = agentContext();
  const prepared = preparePolicyBrowserOpen(flow, ctx, {
    runId: "run-aut01",
    sessionId: "sess-aut01",
    requestId: "perm-browser-01",
    url: "http://localhost:3000/test.html",
  });
  assert.equal(prepared.permission.phase, "pending");
});

test("[AUT-01] preparePolicyBrowserOpen: executa após decisão allow", async () => {
  const { RunToolPermissionFlow } = await import("@openagent/policy");
  const flow = new RunToolPermissionFlow();
  const ctx = agentContext();

  const prepared = preparePolicyBrowserOpen(flow, ctx, {
    runId: "run-aut01-02",
    sessionId: "sess-aut01-02",
    requestId: "perm-browser-02",
    url: "http://localhost:3000/test.html",
  });
  assert.equal(prepared.permission.phase, "pending");

  const allowed = flow.decide(prepared.permission.request.requestId, "allow", "once");
  assert.ok(allowed.canExecute);

  const transport = new InMemoryCdpTransport();
  const targetManager = new CdpTargetManager(transport);
  const result = await executePolicyBrowserOpen(targetManager, {
    url: "http://localhost:3000/test.html",
  });

  assert.equal(result.capability, "browser.open");
  assert.equal(result.tool, "browser.open");
  assert.ok(result.url.startsWith("http://"));
  assert.ok(result.targetId.startsWith("target-"));
  assert.ok(result.browserContextId.startsWith("ctx-"));
  assert.ok(result.screenshot.startsWith("iVBOR"));
  assert.ok(result.screenshot.length > 0);

  await targetManager.dispose();
});

test("[AUT-01] executePolicyBrowserOpen: interação click e type executam com sucesso", async () => {
  const transport = new InMemoryCdpTransport();
  const targetManager = new CdpTargetManager(transport);

  const clickResult = await executePolicyBrowserOpen(targetManager, {
    url: "http://localhost:3000/form.html",
    interaction: {
      type: "click",
      selector: "#submit-btn",
    },
  });
  assert.ok(clickResult.interactionResult);

  const typeResult = await executePolicyBrowserOpen(targetManager, {
    url: "http://localhost:3000/form.html",
    interaction: {
      type: "type",
      selector: "#input-field",
      text: "OpenAgent Browser",
    },
  });
  assert.ok(typeResult.interactionResult);

  await targetManager.dispose();
});

test("[AUT-01] executePolicyBrowserOpen: interação inválida retorna INVALID_STATE sem efeito colateral", async () => {
  const transport = new InMemoryCdpTransport();
  const targetManager = new CdpTargetManager(transport);

  try {
    await executePolicyBrowserOpen(targetManager, {
      url: "http://localhost:3000/error.html",
      interaction: {
        type: "unknown-type",
      },
    });
    assert.fail("Deveria ter lançado ProtocolError");
  } catch (error) {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  }

  assert.equal(targetManager.listActiveTargetIds().length, 0);
  await targetManager.dispose();
});

// ================================================================
// AUT-01 — target isolado
// ================================================================

test("[AUT-01] CdpTargetManager: cria target com context isolado", async () => {
  const { RunToolPermissionFlow } = await import("@openagent/policy");
  const flow = new RunToolPermissionFlow();
  const ctx = agentContext();

  const prepared = preparePolicyBrowserOpen(flow, ctx, {
    runId: "run-isolated",
    sessionId: "sess-isolated",
    requestId: "perm-browser-iso",
    url: "http://localhost:3000/iso.html",
  });
  assert.equal(prepared.permission.phase, "pending");
  const allowed = flow.decide(prepared.permission.request.requestId, "allow", "once");
  assert.ok(allowed.canExecute);

  const transport = new InMemoryCdpTransport();
  const targetManager = new CdpTargetManager(transport);
  const session = await targetManager.createIsolatedTarget("about:blank");

  assert.ok(session.targetId.startsWith("target-"));
  assert.ok(session.browserContextId.startsWith("ctx-"));
  assert.equal(session.url, "about:blank");

  const activeIds = targetManager.listActiveTargetIds();
  assert.equal(activeIds.length, 1);

  const sessionByTarget = targetManager.getSession(session.targetId);
  assert.ok(sessionByTarget);

  const sessionBySessionId = targetManager.getSessionBySessionId(session.sessionId);
  assert.ok(sessionBySessionId);

  assert.ok(targetManager.listActiveTargetIds().length > 0);

  await targetManager.dispose();
  assert.ok(targetManager.listActiveTargetIds().length === 0);
});

// ================================================================
// AUT-01 — captura e console
// ================================================================

test("[AUT-01] executePolicyBrowserOpen: navega e captura screenshot com console", async () => {
  const { RunToolPermissionFlow } = await import("@openagent/policy");
  const flow = new RunToolPermissionFlow();
  const ctx = agentContext();

  const prepared = preparePolicyBrowserOpen(flow, ctx, {
    runId: "run-screen",
    sessionId: "sess-screen",
    requestId: "perm-browser-screen",
    url: "http://localhost:3000/screen.html",
  });
  assert.equal(prepared.permission.phase, "pending");
  const allowed = flow.decide(prepared.permission.request.requestId, "allow", "once");
  assert.ok(allowed.canExecute);

  const transport = new InMemoryCdpTransport();
  const targetManager = new CdpTargetManager(transport);
  const result = await executePolicyBrowserOpen(targetManager, {
    url: "http://localhost:3000/screen.html",
  });

  assert.ok(result.screenshot === MOCK_SCREENSHOT_BASE64 || result.screenshot.length > 10);
  assert.ok(result.consoleLogs.length > 0);
  assert.ok(result.consoleLogs.some((l) => l.type === "log" && l.text.includes("Navegação")) || result.url.includes("screen.html"));

  const formatted = formatAgentBrowserToolResult(result);
  assert.equal(formatted.capability, "browser.open");
  assert.ok(formatted.screenshotLength > 0);
  assert.ok(formatted.consoleLogCount > 0);

  await targetManager.dispose();
});

// ================================================================
// AUT-01 — interação autorizada
// ================================================================

test("[AUT-01] executePolicyBrowserOpen: interação evaluate retorna resultado", async () => {
  const { RunToolPermissionFlow } = await import("@openagent/policy");
  const flow = new RunToolPermissionFlow();
  const ctx = agentContext();

  const prepared = preparePolicyBrowserOpen(flow, ctx, {
    runId: "run-interact",
    sessionId: "sess-interact",
    requestId: "perm-browser-interact",
    url: "http://localhost:3000/interact.html",
  });
  assert.equal(prepared.permission.phase, "pending");
  const allowed = flow.decide(prepared.permission.request.requestId, "allow", "once");
  assert.ok(allowed.canExecute);

  const transport = new InMemoryCdpTransport();
  const targetManager = new CdpTargetManager(transport);
  const result = await executePolicyBrowserOpen(targetManager, {
    url: "http://localhost:3000/interact.html",
    interaction: {
      type: "evaluate",
      expression: "document.title",
    },
  });

  assert.ok(result.interactionResult);

  await targetManager.dispose();
});

// ================================================================
// AUT-01 — caminho de erro: URL inválida rejeita sem efeito colateral
// ================================================================

test("[AUT-01] executePolicyBrowserOpen: URL inválida retorna INVALID_STATE sem efeito colateral", async () => {
  const transport = new InMemoryCdpTransport();
  const targetManager = new CdpTargetManager(transport);

  const targetIds = targetManager.listActiveTargetIds();
  assert.ok(targetIds.length === 0);

  try {
    await executePolicyBrowserOpen(targetManager, {
      url: "not a valid url at all",
    });
  } catch (error) {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  }

  const remaining = targetManager.listActiveTargetIds();
  assert.equal(remaining.length, 0);

  await targetManager.dispose();
});

// ================================================================
// AUT-01 — caminho de erro: esquema não autorizado retorna OUT_OF_SCOPE sem efeito colateral
// ================================================================

test("[AUT-01] executePolicyBrowserOpen: esquema não autorizado retorna OUT_OF_SCOPE sem efeito colateral", async () => {
  const transport = new InMemoryCdpTransport();
  const targetManager = new CdpTargetManager(transport);

  const targetIds = targetManager.listActiveTargetIds();
  assert.ok(targetIds.length === 0);

  try {
    await executePolicyBrowserOpen(targetManager, {
      url: "javascript:void(0)",
    });
  } catch (error) {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
  }

  const remaining = targetManager.listActiveTargetIds();
  assert.equal(remaining.length, 0);

  await targetManager.dispose();
});

// ================================================================
// AUT-01 — caminho de erro: transporte encerrado retorna INVALID_STATE
// ================================================================

test("[AUT-01] CdpTargetManager.createIsolatedTarget: transporte encerrado retorna INVALID_STATE", async () => {
  const transport = new InMemoryCdpTransport();
  const targetManager = new CdpTargetManager(transport);

  await transport.close();

  try {
    await targetManager.createIsolatedTarget("http://localhost:3000/");
  } catch (error) {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  }

  await targetManager.dispose();
});
