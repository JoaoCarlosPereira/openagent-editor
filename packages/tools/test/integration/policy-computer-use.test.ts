import assert from "node:assert/strict";
import test from "node:test";

import {
  RunToolPermissionFlow,
  assertCapabilityAllowedForAgentMode,
  assertCapabilityAllowedForExecutionMode,
  AGENT_MODE_ASK_BLOCKED_MESSAGE,
} from "@openagent/policy";
import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import {
  COMPUTER_USE_CAPABILITY,
  ComputerUseSession,
  executePolicyComputerAction,
  formatAgentComputerToolResult,
  InMemoryCdpTransport,
  preparePolicyComputerAction,
  validateComputerAction,
  type PolicyComputerToolContext,
  type PreparePolicyComputerActionInput,
} from "../../src/index.js";

function agentContext(): PolicyComputerToolContext {
  return { agentMode: "agent", executionMode: "standard" };
}

function prepareAction(
  flow: RunToolPermissionFlow,
  requestId: string,
  action: unknown,
  context: PolicyComputerToolContext = agentContext(),
) {
  const input: PreparePolicyComputerActionInput = {
    runId: `run-${requestId}`,
    sessionId: `sess-${requestId}`,
    requestId,
    action,
  };
  return preparePolicyComputerAction(flow, context, input);
}

/** Transporte de teste que grava os métodos CDP enviados (verificação de efeito colateral). */
class RecordingCdpTransport extends InMemoryCdpTransport {
  readonly sentMethods: string[] = [];

  override async send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    this.sentMethods.push(method);
    return super.send(method, params, sessionId);
  }
}

/** Transporte de teste que segura o primeiro evento de mouse até o teste liberar. */
class GatedMouseCdpTransport extends InMemoryCdpTransport {
  private gate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;

  armMouseGate(): void {
    this.gate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });
  }

  releaseMouseGate(): void {
    const release = this.releaseGate;
    this.releaseGate = null;
    this.gate = null;
    release?.();
  }

  override async send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    if (method === "Input.dispatchMouseEvent" && this.gate) {
      const gate = this.gate;
      this.gate = null;
      await gate;
    }
    return super.send(method, params, sessionId);
  }
}

// ================================================================
// AUT-02 — validação de entrada sem efeito colateral
// ================================================================

test("[AUT-02] validateComputerAction: ação de mouse válida é normalizada", () => {
  const action = validateComputerAction({
    action: "mouse_click",
    coordinate: { x: 123, y: 45 },
    button: "right",
  });
  assert.deepEqual(action, {
    action: "mouse_click",
    coordinate: { x: 123, y: 45 },
    button: "right",
  });
});

test("[AUT-02] validateComputerAction: teclado com key é normalizado", () => {
  const action = validateComputerAction({ action: "key_press", key: "Enter" });
  assert.deepEqual(action, { action: "key_press", key: "Enter" });
});

test("[AUT-02] validateComputerAction: entrada inválida retorna INVALID_STATE", () => {
  const invalidInputs: unknown[] = [
    null,
    "mouse_click",
    { coordinate: { x: 1, y: 1 } },
    { action: "format_disk" },
    { action: "mouse_click" },
    { action: "mouse_move", coordinate: { x: -1, y: 0 } },
    { action: "mouse_click", coordinate: { x: 1.5, y: 2 }, button: "left" },
    { action: "mouse_click", coordinate: { x: 1, y: 2 }, button: "wheel" },
    { action: "key_press", key: "   " },
  ];
  for (const invalid of invalidInputs) {
    assert.throws(
      () => validateComputerAction(invalid),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
      `Deveria rejeitar: ${JSON.stringify(invalid)}`,
    );
  }
});

// ================================================================
// AUT-02 — permissão nomeia a ação exata (PER-01)
// ================================================================

test("[AUT-02] preparePolicyComputerAction: pedido pendente nomeia a ação exata", () => {
  const flow = new RunToolPermissionFlow();
  const prepared = prepareAction(flow, "perm-comp-01", {
    action: "mouse_click",
    coordinate: { x: 123, y: 45 },
    button: "left",
  });

  assert.equal(prepared.permission.phase, "pending");
  assert.equal(prepared.permission.request.capability, COMPUTER_USE_CAPABILITY);
  assert.equal(prepared.permission.request.target.kind, "resource");
  assert.equal(
    prepared.permission.request.target.label,
    "mouse_click coordinate:123,45 button:left",
  );
  assert.equal(prepared.permission.prompt.action, "Usar o computador");
  assert.equal(
    prepared.permission.prompt.target,
    "mouse_click coordinate:123,45 button:left",
  );
});

test("[AUT-02] preparePolicyComputerAction: modo Ask bloqueia uso do computador (AGT-01)", () => {
  assert.throws(
    () =>
      assertCapabilityAllowedForAgentMode("ask", COMPUTER_USE_CAPABILITY),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
      assert.ok(String(error.message).includes(AGENT_MODE_ASK_BLOCKED_MESSAGE));
      return true;
    },
  );
});

test("[AUT-02] preparePolicyComputerAction: modo Somente leitura bloqueia uso do computador (PER-03)", () => {
  assert.throws(
    () =>
      assertCapabilityAllowedForExecutionMode(
        "read_only",
        COMPUTER_USE_CAPABILITY,
      ),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
      return true;
    },
  );
});

// ================================================================
// AUT-02 — execução de uma ação autorizada com resultado
// ================================================================

test("[AUT-02] executePolicyComputerAction: decisão allow executa a ação e mostra o resultado", async () => {
  const flow = new RunToolPermissionFlow();
  const action = {
    action: "mouse_click" as const,
    coordinate: { x: 10, y: 20 },
    button: "left" as const,
  };
  const prepared = prepareAction(flow, "perm-comp-execute", action);
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new InMemoryCdpTransport();
  const session = new ComputerUseSession(transport);
  const result = await executePolicyComputerAction(
    session,
    { action },
    { flow, requestId: prepared.permission.request.requestId },
  );

  assert.equal(result.capability, COMPUTER_USE_CAPABILITY);
  assert.equal(result.tool, "computer.use");
  assert.equal(result.action, "mouse_click");
  assert.equal(result.actionName, "mouse_click coordinate:10,20 button:left");
  assert.equal(result.executed, true);
  assert.ok(result.screenshot.startsWith("iVBOR"));
  assert.equal(result.screenshotMimeType, "image/png");
  assert.deepEqual(result.cdpCalls, [
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Page.captureScreenshot",
  ]);

  const formatted = formatAgentComputerToolResult(result);
  assert.equal(formatted.capability, COMPUTER_USE_CAPABILITY);
  assert.equal(formatted.actionLabel, "clicar com o botão left em (10, 20)");
  assert.equal(formatted.cdpCallCount, 3);
  assert.ok(formatted.screenshotLength > 0);

  await transport.close();
});

test("[AUT-02] executePolicyComputerAction: key_press por texto usa keyDown, char e keyUp", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "key_press" as const, text: "openagent" };
  const prepared = prepareAction(flow, "perm-comp-key", action);
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new RecordingCdpTransport();
  const session = new ComputerUseSession(transport);
  const result = await executePolicyComputerAction(
    session,
    { action },
    { flow, requestId: prepared.permission.request.requestId },
  );

  assert.equal(result.actionName, "key_press text:openagent");
  assert.deepEqual(result.cdpCalls, [
    "Input.dispatchKeyEvent",
    "Input.dispatchKeyEvent",
    "Input.dispatchKeyEvent",
    "Page.captureScreenshot",
  ]);
  assert.deepEqual(transport.sentMethods, result.cdpCalls);

  await transport.close();
});

test("[AUT-02] executePolicyComputerAction: ação screenshot não envia eventos de entrada", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "screenshot" as const };
  const prepared = prepareAction(flow, "perm-comp-shot", action);
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new RecordingCdpTransport();
  const session = new ComputerUseSession(transport);
  const result = await executePolicyComputerAction(
    session,
    { action },
    { flow, requestId: prepared.permission.request.requestId },
  );

  assert.equal(result.actionName, "screenshot");
  assert.deepEqual(result.cdpCalls, ["Page.captureScreenshot"]);
  assert.equal(result.actionLabel, "capturar a tela");

  await transport.close();
});

// ================================================================
// AUT-02 — autorização é limitada à ação exata nomeada
// ================================================================

test("[AUT-02] executePolicyComputerAction: negação retorna OUT_OF_SCOPE sem executar nada", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "mouse_click" as const, coordinate: { x: 1, y: 2 } };
  const prepared = prepareAction(flow, "perm-comp-deny", action);
  flow.decide(prepared.permission.request.requestId, "deny", "once");

  const transport = new RecordingCdpTransport();
  const session = new ComputerUseSession(transport);
  await assert.rejects(
    executePolicyComputerAction(session, { action }, {
      flow,
      requestId: prepared.permission.request.requestId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
      return true;
    },
  );
  assert.deepEqual(transport.sentMethods, []);

  await transport.close();
});

test("[AUT-02] executePolicyComputerAction: autorização não cobre outra ação", async () => {
  const flow = new RunToolPermissionFlow();
  const allowed = { action: "key_press" as const, key: "Enter" };
  const attempted = { action: "mouse_click" as const, coordinate: { x: 99, y: 99 } };
  const prepared = prepareAction(flow, "perm-comp-mismatch", allowed);
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new RecordingCdpTransport();
  const session = new ComputerUseSession(transport);
  await assert.rejects(
    executePolicyComputerAction(session, { action: attempted }, {
      flow,
      requestId: prepared.permission.request.requestId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.deepEqual(transport.sentMethods, []);

  await transport.close();
});

test("[AUT-02] executePolicyComputerAction: sem decisão de autorização não executa", async () => {
  const transport = new RecordingCdpTransport();
  const session = new ComputerUseSession(transport);
  await assert.rejects(
    executePolicyComputerAction(session, {
      action: { action: "key_press" as const, key: "Enter" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.deepEqual(transport.sentMethods, []);

  await transport.close();
});

test("[AUT-02] executePolicyComputerAction: cada ação consome a própria autorização", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "key_press" as const, key: "Tab" };
  const prepared = prepareAction(flow, "perm-comp-once", action);
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new InMemoryCdpTransport();
  const session = new ComputerUseSession(transport);
  await executePolicyComputerAction(session, { action }, {
    flow,
    requestId: prepared.permission.request.requestId,
  });

  await assert.rejects(
    executePolicyComputerAction(session, { action }, {
      flow,
      requestId: prepared.permission.request.requestId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  // Uma nova decisão permite repetir a mesma ação nomeada.
  const preparedAgain = prepareAction(flow, "perm-comp-once-2", action);
  flow.decide(preparedAgain.permission.request.requestId, "allow", "once");
  const second = await executePolicyComputerAction(session, { action }, {
    flow,
    requestId: preparedAgain.permission.request.requestId,
  });
  assert.equal(second.executed, true);

  await transport.close();
});

// ================================================================
// AUT-02 — uma ação por vez
// ================================================================

test("[AUT-02] ComputerUseSession: recusa segunda ação enquanto a primeira está em execução", async () => {
  const flow = new RunToolPermissionFlow();
  const transport = new GatedMouseCdpTransport();
  const session = new ComputerUseSession(transport);
  const firstAction = { action: "mouse_click" as const, coordinate: { x: 10, y: 20 } };
  const secondAction = { action: "mouse_click" as const, coordinate: { x: 30, y: 40 } };

  const firstPrepared = prepareAction(flow, "perm-comp-par-1", firstAction);
  flow.decide(firstPrepared.permission.request.requestId, "allow", "once");
  const secondPrepared = prepareAction(flow, "perm-comp-par-2", secondAction);
  flow.decide(secondPrepared.permission.request.requestId, "allow", "once");

  transport.armMouseGate();
  const firstPromise = executePolicyComputerAction(session, { action: firstAction }, {
    flow,
    requestId: firstPrepared.permission.request.requestId,
  });
  assert.equal(session.busy, true);

  await assert.rejects(
    executePolicyComputerAction(session, { action: secondAction }, {
      flow,
      requestId: secondPrepared.permission.request.requestId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      assert.ok(String(error.message).includes("uma ação por vez"));
      return true;
    },
  );

  transport.releaseMouseGate();
  const first = await firstPromise;
  assert.equal(first.executed, true);
  assert.equal(session.busy, false);

  const second = await executePolicyComputerAction(session, { action: secondAction }, {
    flow,
    requestId: secondPrepared.permission.request.requestId,
  });
  assert.equal(second.executed, true);
  assert.equal(second.actionName, "mouse_click coordinate:30,40 button:left");

  await transport.close();
});

// ================================================================
// AUT-02 — caminho de erro: estado inválido sem efeito colateral
// ================================================================

test("[AUT-02] ComputerUseSession: transporte encerrado retorna INVALID_STATE e libera a sessão", async () => {
  const transport = new InMemoryCdpTransport();
  const session = new ComputerUseSession(transport);
  await transport.close();

  await assert.rejects(
    session.run({ action: "key_press", key: "Enter" }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.equal(session.busy, false);
});

test("[AUT-02] executePolicyComputerAction: ação inválida retorna INVALID_STATE sem enviar nada ao transporte", async () => {
  const transport = new RecordingCdpTransport();
  const session = new ComputerUseSession(transport);
  await assert.rejects(
    executePolicyComputerAction(session, { action: { action: "shutdown_now" } }, {
      flow: new RunToolPermissionFlow(),
      requestId: "perm-comp-invalid",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.deepEqual(transport.sentMethods, []);
  assert.equal(session.busy, false);

  await transport.close();
});
