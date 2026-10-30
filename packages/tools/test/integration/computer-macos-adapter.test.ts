/**
 * AUT-02 — Testes de integração do adapter macOS do computer use.
 *
 * O adapter macOS reaproveita o canal da task_177 (permissão nomeada
 * `computer.use` + `ComputerUseSession` de uso único sobre CDP) e acrescenta a
 * parte específica do macOS (ADR-006: detecção executáveis Chrome/Chromium
 * canônicos + permissões TCC Screen Recording/Accessibility documentadas antes
 * do consentimento), lançando o target Chrome isolado real pela mesma cadeia
 * do worker do navegador (AUT-01), que já aplica sandbox-exec/Seatbelt.
 *
 * Ambiente de CI é Linux: os testes cobrem o CONTRATO por fakes da plataforma
 * (plataforma/detecção de executável/sandbox injetáveis). O caminho REAL
 * executável em macOS fica registrado como limite honesto no card.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { RunToolPermissionFlow } from "@openagent/policy";
import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import {
  COMPUTER_USE_CAPABILITY,
  InMemoryCdpTransport,
  MACOS_CHROME_EXECUTABLE_CANDIDATES,
  MACOS_PERMISSIONS_NOTICE,
  MACOS_REQUIRED_COMPUTER_PERMISSIONS,
  MacosComputerUseAdapter,
  prepareMacosComputerAction,
  probeMacosComputerCapability,
  describeMacosComputerCapability,
  type MacosComputerCapabilityResult,
  type PreparePolicyComputerActionInput,
  type PolicyComputerToolContext,
} from "../../src/index.js";

function agentContext(): PolicyComputerToolContext {
  return { agentMode: "agent", executionMode: "standard" };
}

function prepareInput(
  requestId: string,
  action: unknown,
): PreparePolicyComputerActionInput {
  return {
    runId: `run-macos-${requestId}`,
    sessionId: `sess-macos-${requestId}`,
    requestId,
    action,
  };
}

/** Fixtures do macOS (ADR-006: detecção por SO). */
const MACOS_SANDBOX_OPTIONS = { platform: "darwin" as NodeJS.Platform };

const NATIVE_MACOS_SANDBOX = {
  ...MACOS_SANDBOX_OPTIONS,
  macosProbe: () => ({
    nativeAvailable: true,
    primitive: "sandbox-exec" as const,
    sandboxExecAvailable: true,
    seatbeltOperational: true,
  }),
};
const DEGRADED_MACOS_SANDBOX = {
  ...MACOS_SANDBOX_OPTIONS,
  macosProbe: () => ({
    nativeAvailable: false,
    primitive: null,
    sandboxExecAvailable: false,
    seatbeltOperational: false,
  }),
};

const CHROME_PRESENT = (candidate: string): boolean =>
  candidate === MACOS_CHROME_EXECUTABLE_CANDIDATES[0];

/** Transporte de teste que grava os métodos CDP enviados (efeito colateral). */
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

/** Comandos de infraestrutura CDP (lançamento/attach do target isolado). */
const INFRA_METHODS = new Set([
  "Target.createBrowserContext",
  "Target.createTarget",
  "Target.attachToTarget",
]);

function inputEvents(transport: InMemoryCdpTransport): string[] {
  const methods =
    transport instanceof RecordingCdpTransport
      ? transport.sentMethods
      : [];
  return methods.filter((method) => !INFRA_METHODS.has(method));
}

function fakeWorkerFor(transport: InMemoryCdpTransport, recordedExecutable: {
  first: string | null;
}) {
  const launches: Array<{ executable: string }> = [];
  const launchWorker = async (launch: { executable: string }) => {
    launches.push({ executable: launch.executable });
    if (recordedExecutable.first === null) {
      recordedExecutable.first = launch.executable;
    }
    return {
      transport,
      terminate: async () => {
        await transport.close();
      },
    };
  };
  return { launchWorker, launches };
}

// ================================================================
// AUT-02 — Detecção do executável + permissões TCC do macOS (ADR-006)
// ================================================================

test("[AUT-02] probeMacosComputerCapability: Chrome canônico com permissões documentadas e sem degradação", () => {
  const snapshot = probeMacosComputerCapability({ hasExecutable: CHROME_PRESENT });

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.executable, MACOS_CHROME_EXECUTABLE_CANDIDATES[0]);
  assert.deepEqual(snapshot.executableCandidates, MACOS_CHROME_EXECUTABLE_CANDIDATES);
  assert.equal(snapshot.requiredPermissions[0], "screen-recording");
  assert.equal(snapshot.requiredPermissions[1], "accessibility");
  assert.ok(
    snapshot.permissionsNotice.includes("Screen Recording"),
    "notice deve documentar Screen Recording",
  );
  assert.ok(
    snapshot.permissionsNotice.includes("Accessibility"),
    "notice deve documentar Accessibility",
  );
  assert.equal(snapshot.degradationNotice, undefined);
  assert.equal(MACOS_REQUIRED_COMPUTER_PERMISSIONS.length, 2);
});

test("[AUT-02] Sem executável Chrome/Chromium no macOS: adapter indisponível com aviso estável", () => {
  const snapshot = probeMacosComputerCapability({ hasExecutable: () => false });

  assert.equal(snapshot.available, false);
  assert.equal(snapshot.executable, undefined);
  assert.ok(
    snapshot.degradationNotice?.includes("Chromium"),
    "aviso deve citar o executável ausente",
  );
  // Permissões seguem documentadas mesmo degradado (nunca silencioso).
  assert.ok(snapshot.requiredPermissions.includes("screen-recording"));
});

test("[AUT-02] describeMacosComputerCapability: sandbox nativa (Seatbelt) não emite degradação e platform é darwin", () => {
  const result = describeMacosComputerCapability({
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: NATIVE_MACOS_SANDBOX,
  });

  assert.equal(result.platform, "darwin");
  assert.equal(result.sandbox.level, "native");
  assert.equal(result.sandbox.nativePrimitive, "sandbox-exec");
  assert.equal(result.degradationNotice, undefined);
  assert.ok(result.permissionsNotice.includes("Accessibility"));
});

test("[AUT-02] describeMacosComputerCapability combina aviso de sandbox degradada e de executável ausente (nunca silencioso)", () => {
  const result = describeMacosComputerCapability({
    hasExecutable: () => false,
    sandboxOptions: DEGRADED_MACOS_SANDBOX,
  });

  assert.equal(result.platform, "darwin");
  assert.equal(result.sandbox.level, "degraded");
  assert.equal(result.available, false);
  const notice = result.degradationNotice ?? "";
  assert.ok(
    notice.includes("worker thread"),
    "aviso da sandbox degradada deve constar no snapshot",
  );
  assert.ok(
    notice.includes("Chromium"),
    "aviso do executável ausente deve constar no snapshot",
  );
  assert.equal(result.permissionsNotice, MACOS_PERMISSIONS_NOTICE);
});

// ================================================================
// AUT-02 — prepareMacosComputerAction (caminhos de erro estáveis)
// ================================================================

test("[AUT-02] prepareMacosComputerAction: plataforma não-macOS retorna OUT_OF_SCOPE sem pedido de permissão", () => {
  const flow = new RunToolPermissionFlow();
  assert.throws(
    () =>
      prepareMacosComputerAction(flow, agentContext(), prepareInput("perm-macos-os", {
        action: "key_press",
        key: "Enter",
      }), {
        hasExecutable: CHROME_PRESENT,
        sandboxOptions: { platform: "linux" as NodeJS.Platform },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
      assert.ok(String(error.message).includes("linux"));
      return true;
    },
  );
  assert.equal(flow.getPending("perm-macos-os"), undefined);
});

test("[AUT-02] prepareMacosComputerAction: host sem Chrome/Chromium retorna INVALID_STATE sem efeito colateral", () => {
  const flow = new RunToolPermissionFlow();
  assert.throws(
    () =>
      prepareMacosComputerAction(flow, agentContext(), prepareInput("perm-macos-nochrome", {
        action: "mouse_click",
        coordinate: { x: 1, y: 2 },
      }), {
        hasExecutable: () => false,
        sandboxOptions: NATIVE_MACOS_SANDBOX,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.equal(flow.getPending("perm-macos-nochrome"), undefined);
});

test("[AUT-02] prepareMacosComputerAction: pedido de permissão nomeia a ação exata e anexa o snapshot macOS", () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "key_press" as const, key: "Enter" };
  const prepared = prepareMacosComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-macos-ok", action),
    {
      hasExecutable: CHROME_PRESENT,
      sandboxOptions: NATIVE_MACOS_SANDBOX,
    },
  );

  assert.equal(prepared.permission.phase, "pending");
  if (prepared.permission.phase !== "pending") {
    return;
  }
  assert.equal(prepared.permission.request.capability, COMPUTER_USE_CAPABILITY);
  assert.equal(prepared.permission.request.target.kind, "resource");
  assert.equal(prepared.permission.request.target.label, "key_press key:Enter");

  const macos: MacosComputerCapabilityResult = prepared.macos;
  assert.equal(macos.platform, "darwin");
  assert.equal(macos.available, true);
  assert.equal(macos.executable, MACOS_CHROME_EXECUTABLE_CANDIDATES[0]);
  assert.equal(macos.sandbox.level, "native");
  assert.ok(macos.permissionsNotice.includes("Screen Recording"));
});

// ================================================================
// AUT-02 — MacosComputerUseAdapter com worker fake (contrato)
// ================================================================

test("[AUT-02] MacosComputerUseAdapter: ação autorizada executa uma única chamada e mostra o resultado", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "mouse_click" as const, coordinate: { x: 15, y: 25 } };
  const prepared = prepareMacosComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-macos-run", action),
    { hasExecutable: CHROME_PRESENT, sandboxOptions: NATIVE_MACOS_SANDBOX },
  );
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new RecordingCdpTransport();
  const launchedFirstExecutable = { first: null as string | null };
  const { launchWorker, launches } = fakeWorkerFor(transport, launchedFirstExecutable);
  const adapter = new MacosComputerUseAdapter({
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: NATIVE_MACOS_SANDBOX,
    launchWorker,
  });
  assert.equal(adapter.open, false);

  const result = await adapter.runAuthorizedAction(
    { action },
    { flow, requestId: prepared.permission.request.requestId },
  );

  assert.equal(result.executed, true);
  assert.equal(result.actionName, "mouse_click coordinate:15,25 button:left");
  assert.equal(result.capability, COMPUTER_USE_CAPABILITY);
  assert.ok(result.screenshot.startsWith("iVBOR"));
  assert.deepEqual(result.cdpCalls, [
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Page.captureScreenshot",
  ]);
  assert.deepEqual(inputEvents(transport), result.cdpCalls);

  assert.equal(adapter.open, true);
  assert.equal(adapter.busy, false);
  assert.deepEqual(launches, [
    { executable: MACOS_CHROME_EXECUTABLE_CANDIDATES[0] },
  ]);
  assert.equal(adapter.capability.platform, "darwin");
  assert.equal(adapter.capability.available, true);

  await adapter.terminate();
  assert.equal(adapter.open, false);
  assert.equal(transport.isClosed(), true);

  await assert.rejects(
    adapter.openTarget(),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});

test("[AUT-02] MacosComputerUseAdapter: negação retorna OUT_OF_SCOPE sem enviar nada ao transporte", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "key_press" as const, key: "Enter" };
  const prepared = prepareMacosComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-macos-deny", action),
    { hasExecutable: CHROME_PRESENT, sandboxOptions: NATIVE_MACOS_SANDBOX },
  );
  flow.decide(prepared.permission.request.requestId, "deny", "once");

  const transport = new RecordingCdpTransport();
  const adapter = new MacosComputerUseAdapter({
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: NATIVE_MACOS_SANDBOX,
    launchWorker: fakeWorkerFor(transport, { first: null }).launchWorker,
  });

  await assert.rejects(
    adapter.runAuthorizedAction(
      { action },
      { flow, requestId: prepared.permission.request.requestId },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
      return true;
    },
  );
  assert.deepEqual(inputEvents(transport), []);
  // Negação não deve nem lançar o processo do Chrome do target.
  assert.equal(adapter.open, false);

  await adapter.terminate();
});

test("[AUT-02] MacosComputerUseAdapter: autorização de outra ação retorna INVALID_STATE sem efeito", async () => {
  const flow = new RunToolPermissionFlow();
  const allowed = { action: "key_press" as const, key: "Enter" };
  const attempted = { action: "mouse_click" as const, coordinate: { x: 9, y: 9 } };
  const prepared = prepareMacosComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-macos-mismatch", allowed),
    { hasExecutable: CHROME_PRESENT, sandboxOptions: NATIVE_MACOS_SANDBOX },
  );
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new RecordingCdpTransport();
  const adapter = new MacosComputerUseAdapter({
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: NATIVE_MACOS_SANDBOX,
    launchWorker: fakeWorkerFor(transport, { first: null }).launchWorker,
  });

  await assert.rejects(
    adapter.runAuthorizedAction(
      { action: attempted },
      { flow, requestId: prepared.permission.request.requestId },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.deepEqual(inputEvents(transport), []);

  await adapter.terminate();
});

test("[AUT-02] MacosComputerUseAdapter: recusa segunda ação enquanto a primeira executa (uma ação por vez)", async () => {
  const flow = new RunToolPermissionFlow();
  const firstAction = { action: "mouse_click" as const, coordinate: { x: 10, y: 20 } };
  const secondAction = { action: "mouse_click" as const, coordinate: { x: 30, y: 40 } };

  const firstPrepared = prepareMacosComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-macos-par-1", firstAction),
    { hasExecutable: CHROME_PRESENT, sandboxOptions: NATIVE_MACOS_SANDBOX },
  );
  flow.decide(firstPrepared.permission.request.requestId, "allow", "once");
  const secondPrepared = prepareMacosComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-macos-par-2", secondAction),
    { hasExecutable: CHROME_PRESENT, sandboxOptions: NATIVE_MACOS_SANDBOX },
  );
  flow.decide(secondPrepared.permission.request.requestId, "allow", "once");

  const transport = new GatedMouseCdpTransport();
  const adapter = new MacosComputerUseAdapter({
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: NATIVE_MACOS_SANDBOX,
    launchWorker: fakeWorkerFor(transport, { first: null }).launchWorker,
  });

  transport.armMouseGate();
  const firstPromise = adapter.runAuthorizedAction(
    { action: firstAction },
    { flow, requestId: firstPrepared.permission.request.requestId },
  );
  // O primeiro send de input fica travado no gate: aguarda um tick para a
  // ação em curso ser registrada na sessão única do adapter.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(adapter.busy, true);

  await assert.rejects(
    adapter.runAuthorizedAction(
      { action: secondAction },
      { flow, requestId: secondPrepared.permission.request.requestId },
    ),
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
  assert.equal(adapter.busy, false);

  const second = await adapter.runAuthorizedAction(
    { action: secondAction },
    { flow, requestId: secondPrepared.permission.request.requestId },
  );
  assert.equal(second.executed, true);
  assert.equal(second.actionName, "mouse_click coordinate:30,40 button:left");

  await adapter.terminate();
});

test("[AUT-02] MacosComputerUseAdapter: falha de lançamento não fica presa e nova ação pode retomar", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "screenshot" as const };
  const prepared = prepareMacosComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-macos-retry", action),
    { hasExecutable: CHROME_PRESENT, sandboxOptions: NATIVE_MACOS_SANDBOX },
  );
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  let attempts = 0;
  const flakyLaunch = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("Tempo limite excedido ao aguardar o endpoint DevTools");
    }
    const transport = new RecordingCdpTransport();
    return {
      transport,
      terminate: async () => {
        await transport.close();
      },
    };
  };
  const adapter = new MacosComputerUseAdapter({
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: NATIVE_MACOS_SANDBOX,
    launchWorker: flakyLaunch,
  });

  await assert.rejects(
    adapter.runAuthorizedAction(
      { action },
      { flow, requestId: prepared.permission.request.requestId },
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("endpoint DevTools"),
  );
  assert.equal(adapter.open, false);

  // Nova chamada retoma o lançamento (a autorização não foi consumida pela
  // falha de infraestrutura anterior) e executa a ação autorizada.
  const result = await adapter.runAuthorizedAction(
    { action },
    { flow, requestId: prepared.permission.request.requestId },
  );
  assert.equal(result.executed, true);
  assert.equal(attempts, 2);

  await adapter.terminate();
});

// ================================================================
// AUT-02 — Caminho real no host macOS (Chrome isolado via Seatbelt/CDP)
// ================================================================

test("[AUT-02] MacosComputerUseAdapter: caminho real lança o target Chrome isolado e executa a ação autorizada", { concurrency: 1 }, async () => {
  const adapter = new MacosComputerUseAdapter();
  assert.equal(adapter.capability.platform, "darwin");
  // Permissões TCC fazem parte da capacidade reportada em qualquer host.
  assert.ok(adapter.capability.permissionsNotice.includes("Accessibility"));

  if (!adapter.capability.available) {
    // Host sem Google Chrome.app/Chromium.app (ex.: CI Linux): o contrato
    // estável é recusar com INVALID_STATE antes de qualquer lançamento —
    // e nada abre. Em um host macOS real com Chrome instalado, a mesma
    // chamada significa o caminho REAL sobre CDP (limite honesto: não
    // executável aqui, provado por fixtures acima).
    await assert.rejects(
      adapter.openTarget(),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    return;
  }

  const flow = new RunToolPermissionFlow();
  const action = { action: "mouse_click" as const, coordinate: { x: 40, y: 50 } };
  const prepared = prepareMacosComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-macos-real", action),
  );
  assert.equal(prepared.macos.available, true);
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const result = await adapter.runAuthorizedAction(
    { action },
    { flow, requestId: prepared.permission.request.requestId },
  );

  assert.equal(result.executed, true);
  assert.equal(result.actionName, "mouse_click coordinate:40,50 button:left");
  assert.ok(result.screenshot.startsWith("iVBOR"), "screenshot PNG real");
  assert.ok(result.screenshot.length > MOCK_LENGTH_MIN);
  assert.ok(result.cdpCalls.includes("Input.dispatchMouseEvent"));
  assert.ok(result.cdpCalls.includes("Page.captureScreenshot"));
  assert.equal(adapter.busy, false);

  await adapter.terminate();
});

const MOCK_LENGTH_MIN = 100;
