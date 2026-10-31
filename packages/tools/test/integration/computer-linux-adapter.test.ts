/**
 * AUT-02 — Testes de integração do adapter Linux do computer use.
 *
 * O adapter Linux reaproveita o canal da task_177 (permissão nomeada
 * `computer.use` + `ComputerUseSession` de uso único sobre CDP) e acrescenta a
 * detecção do ambiente de exibição do Linux (X11/XWayland, Wayland nativo,
 * headless) com degradação explícita (ADR-006), além de lançar o target
 * Chromium isolado real pela mesma cadeia do worker do navegador (AUT-01).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { RunToolPermissionFlow } from "@openagent/policy";
import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import {
  COMPUTER_USE_CAPABILITY,
  DEFAULT_CHROME_EXECUTABLE_CANDIDATES,
  InMemoryCdpTransport,
  LinuxComputerUseAdapter,
  prepareLinuxComputerAction,
  probeLinuxComputerDisplay,
  describeLinuxComputerCapability,
  buildLinuxComputerTargetArgs,
  classifyLinuxDisplayMode,
  readLinuxDisplayEnvironment,
  type LinuxComputerCapabilityResult,
  type LinuxDisplayEnvironment,
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
    runId: `run-linux-${requestId}`,
    sessionId: `sess-linux-${requestId}`,
    requestId,
    action,
  };
}

/** Fixtures de ambientes de exibição do Linux (ADR-006: detecção por SO). */
const X11_ENV: LinuxDisplayEnvironment = {
  xdgSessionType: "x11",
  display: ":0",
};
const WAYLAND_NATIVE_ENV: LinuxDisplayEnvironment = {
  xdgSessionType: "wayland",
  waylandDisplay: "wayland-0",
};
const XWAYLAND_ENV: LinuxDisplayEnvironment = {
  xdgSessionType: "wayland",
  waylandDisplay: "wayland-0",
  display: ":0",
};
const HEADLESS_ENV: LinuxDisplayEnvironment = {};

const CHROME_PRESENT = (candidate: string): boolean =>
  candidate === DEFAULT_CHROME_EXECUTABLE_CANDIDATES[0];

const NATIVE_LINUX_SANDBOX = {
  platform: "linux" as NodeJS.Platform,
  linuxProbe: () => ({
    nativeAvailable: true,
    primitive: "bubblewrap" as const,
    unshareUserNsAvailable: true,
  }),
};
const DEGRADED_LINUX_SANDBOX = {
  platform: "linux" as NodeJS.Platform,
  linuxProbe: () => ({
    nativeAvailable: false,
    primitive: null,
    unshareUserNsAvailable: false,
  }),
};

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

function fakeWorkerFor(transport: InMemoryCdpTransport) {
  const launches: Array<{
    displayMode: string;
    extraChromiumArgs: readonly string[];
  }> = [];
  const launchWorker = async (launch: {
    displayMode: string;
    extraChromiumArgs: readonly string[];
  }) => {
    launches.push({
      displayMode: launch.displayMode,
      extraChromiumArgs: launch.extraChromiumArgs,
    });
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
// AUT-02 — Detecção do ambiente de exibição do Linux (ADR-006)
// ================================================================

test("[AUT-02] probeLinuxComputerDisplay: sessão X11 próximo desktop visível sem aviso", () => {
  const snapshot = probeLinuxComputerDisplay({
    environment: X11_ENV,
    hasExecutable: CHROME_PRESENT,
  });

  assert.equal(snapshot.displayMode, "x11");
  assert.equal(snapshot.desktopAvailable, true);
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.executable, DEFAULT_CHROME_EXECUTABLE_CANDIDATES[0]);
  assert.equal(snapshot.degradationNotice, undefined);
  assert.equal(classifyLinuxDisplayMode(X11_ENV), "x11");
});

test("[AUT-02] Wayland nativo sem XWayland: target roda com --ozone-platform-hint=auto e aviso explícito", () => {
  assert.equal(classifyLinuxDisplayMode(WAYLAND_NATIVE_ENV), "wayland");
  assert.deepEqual(
    buildLinuxComputerTargetArgs(WAYLAND_NATIVE_ENV),
    ["--ozone-platform-hint=auto"],
  );
  assert.deepEqual(
    buildLinuxComputerTargetArgs(X11_ENV),
    [],
  );

  const snapshot = probeLinuxComputerDisplay({
    environment: WAYLAND_NATIVE_ENV,
    hasExecutable: CHROME_PRESENT,
  });
  assert.equal(snapshot.displayMode, "wayland");
  assert.equal(snapshot.desktopAvailable, true);
  assert.equal(snapshot.available, true);
  assert.ok(
    snapshot.degradationNotice?.includes("--ozone-platform-hint=auto"),
  );
});

test("[AUT-02] XWayland: DISPLAY presente em sessão Wayland roteia por X11 sem aviso", () => {
  assert.equal(classifyLinuxDisplayMode(XWAYLAND_ENV), "x11");
  assert.deepEqual(buildLinuxComputerTargetArgs(XWAYLAND_ENV), []);

  const snapshot = probeLinuxComputerDisplay({
    environment: XWAYLAND_ENV,
    hasExecutable: CHROME_PRESENT,
  });
  assert.equal(snapshot.displayMode, "x11");
  assert.equal(snapshot.desktopAvailable, true);
  assert.equal(snapshot.degradationNotice, undefined);
});

test("[AUT-02] Sem servidor de exibição: degradação explícita para target headless", () => {
  assert.equal(classifyLinuxDisplayMode(HEADLESS_ENV), "headless");

  const snapshot = probeLinuxComputerDisplay({
    environment: HEADLESS_ENV,
    hasExecutable: CHROME_PRESENT,
  });
  assert.equal(snapshot.displayMode, "headless");
  assert.equal(snapshot.desktopAvailable, false);
  assert.equal(snapshot.available, true);
  assert.ok(
    snapshot.degradationNotice?.includes("headless"),
    "aviso deve documentar a execução headless",
  );
});

test("[AUT-02] Sem executável Chromium/Chrome: adapter indisponível com aviso estável", () => {
  const snapshot = probeLinuxComputerDisplay({
    environment: X11_ENV,
    hasExecutable: () => false,
  });
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.executable, undefined);
  assert.ok(
    snapshot.degradationNotice?.includes("Chromium"),
    "aviso deve citar o executável ausente",
  );
});

test("[AUT-02] readLinuxDisplayEnvironment lê as variáveis canônicas do processo", () => {
  const environment = readLinuxDisplayEnvironment({
    XDG_SESSION_TYPE: "wayland",
    DISPLAY: ":1",
    WAYLAND_DISPLAY: "wayland-1",
  } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(
    environment,
    { xdgSessionType: "wayland", display: ":1", waylandDisplay: "wayland-1" },
  );
});

// ================================================================
// AUT-02 — Snapshot de capability combinado (sandbox + exibição)
// ================================================================

test("[AUT-02] describeLinuxComputerCapability combina aviso de sandbox degradada e de exibição (nunca silencioso)", () => {
  const result = describeLinuxComputerCapability({
    environment: HEADLESS_ENV,
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: DEGRADED_LINUX_SANDBOX,
  });

  assert.equal(result.platform, "linux");
  assert.equal(result.sandbox.level, "degraded");
  assert.equal(result.displayMode, "headless");
  assert.equal(result.available, true);
  const notice = result.degradationNotice ?? "";
  assert.ok(
    notice.includes("worker thread"),
    "aviso da sandbox degradada deve constar no snapshot",
  );
  assert.ok(
    notice.includes("headless"),
    "aviso do target headless deve constar no snapshot",
  );
});

test("[AUT-02] describeLinuxComputerCapability: sandbox nativa com X11 não emite aviso", () => {
  const result = describeLinuxComputerCapability({
    environment: X11_ENV,
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: NATIVE_LINUX_SANDBOX,
  });

  assert.equal(result.sandbox.level, "native");
  assert.equal(result.sandbox.nativePrimitive, "bubblewrap");
  assert.equal(result.displayMode, "x11");
  assert.equal(result.degradationNotice, undefined);
});

// ================================================================
// AUT-02 — prepareLinuxComputerAction (caminhos de erro estáveis)
// ================================================================

test("[AUT-02] prepareLinuxComputerAction: plataforma não-Linux retorna OUT_OF_SCOPE sem pedido de permissão", () => {
  const flow = new RunToolPermissionFlow();
  assert.throws(
    () =>
      prepareLinuxComputerAction(flow, agentContext(), prepareInput("perm-linux-os", {
        action: "key_press",
        key: "Enter",
      }), {
        environment: X11_ENV,
        hasExecutable: CHROME_PRESENT,
        sandboxOptions: { platform: "darwin" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
      assert.ok(String(error.message).includes("darwin"));
      return true;
    },
  );
  assert.equal(flow.getPending("perm-linux-os"), undefined);
});

test("[AUT-02] prepareLinuxComputerAction: host sem Chromium retorna INVALID_STATE sem efeito colateral", () => {
  const flow = new RunToolPermissionFlow();
  assert.throws(
    () =>
      prepareLinuxComputerAction(flow, agentContext(), prepareInput("perm-linux-nochrome", {
        action: "mouse_click",
        coordinate: { x: 1, y: 2 },
      }), {
        environment: X11_ENV,
        hasExecutable: () => false,
        sandboxOptions: NATIVE_LINUX_SANDBOX,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.equal(flow.getPending("perm-linux-nochrome"), undefined);
});

test("[AUT-02] prepareLinuxComputerAction: pedido de permissão nomeia a ação exata e anexa o snapshot Linux", () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "key_press" as const, key: "Enter" };
  const prepared = prepareLinuxComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-linux-ok", action),
    {
      environment: X11_ENV,
      hasExecutable: CHROME_PRESENT,
      sandboxOptions: NATIVE_LINUX_SANDBOX,
    },
  );

  assert.equal(prepared.permission.phase, "pending");
  if (prepared.permission.phase !== "pending") {
    return;
  }
  assert.equal(prepared.permission.request.capability, COMPUTER_USE_CAPABILITY);
  assert.equal(prepared.permission.request.target.kind, "resource");
  assert.equal(prepared.permission.request.target.label, "key_press key:Enter");

  const linux: LinuxComputerCapabilityResult = prepared.linux;
  assert.equal(linux.displayMode, "x11");
  assert.equal(linux.desktopAvailable, true);
  assert.equal(linux.available, true);
  assert.equal(linux.sandbox.level, "native");
});

// ================================================================
// AUT-02 — LinuxComputerUseAdapter com worker fake (contrato)
// ================================================================

test("[AUT-02] LinuxComputerUseAdapter: ação autorizada executa uma única chamada e mostra o resultado", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "mouse_click" as const, coordinate: { x: 15, y: 25 } };
  const environment = X11_ENV;
  const prepared = prepareLinuxComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-linux-run", action),
    { environment, hasExecutable: CHROME_PRESENT },
  );
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new RecordingCdpTransport();
  const { launchWorker, launches } = fakeWorkerFor(transport);
  const adapter = new LinuxComputerUseAdapter({
    environment,
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
    { displayMode: "x11", extraChromiumArgs: [] },
  ]);
  assert.equal(adapter.capability.displayMode, "x11");
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

test("[AUT-02] LinuxComputerUseAdapter: Wayland nativo propaga --ozone-platform-hint=auto ao launcher", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "screenshot" as const };
  const prepared = prepareLinuxComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-linux-wl", action),
    {
      environment: WAYLAND_NATIVE_ENV,
      hasExecutable: CHROME_PRESENT,
    },
  );
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new RecordingCdpTransport();
  const { launchWorker, launches } = fakeWorkerFor(transport);
  const adapter = new LinuxComputerUseAdapter({
    environment: WAYLAND_NATIVE_ENV,
    launchWorker,
  });

  const result = await adapter.runAuthorizedAction(
    { action },
    { flow, requestId: prepared.permission.request.requestId },
  );

  assert.equal(result.executed, true);
  assert.equal(result.actionName, "screenshot");
  assert.deepEqual(launches, [
    { displayMode: "wayland", extraChromiumArgs: ["--ozone-platform-hint=auto"] },
  ]);
  assert.equal(adapter.capability.displayMode, "wayland");

  await adapter.terminate();
});

test("[AUT-02] LinuxComputerUseAdapter: negação retorna OUT_OF_SCOPE sem enviar nada ao transporte", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "key_press" as const, key: "Enter" };
  const prepared = prepareLinuxComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-linux-deny", action),
    { environment: X11_ENV, hasExecutable: CHROME_PRESENT },
  );
  flow.decide(prepared.permission.request.requestId, "deny", "once");

  const transport = new RecordingCdpTransport();
  const adapter = new LinuxComputerUseAdapter({
    environment: X11_ENV,
    launchWorker: fakeWorkerFor(transport).launchWorker,
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
  // Negação não deve nem lançar o processo do Chromium do target.
  assert.equal(adapter.open, false);

  await adapter.terminate();
});

test("[AUT-02] LinuxComputerUseAdapter: autorização de outra ação retorna INVALID_STATE sem efeito", async () => {
  const flow = new RunToolPermissionFlow();
  const allowed = { action: "key_press" as const, key: "Enter" };
  const attempted = { action: "mouse_click" as const, coordinate: { x: 9, y: 9 } };
  const prepared = prepareLinuxComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-linux-mismatch", allowed),
    { environment: X11_ENV, hasExecutable: CHROME_PRESENT },
  );
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new RecordingCdpTransport();
  const adapter = new LinuxComputerUseAdapter({
    environment: X11_ENV,
    launchWorker: fakeWorkerFor(transport).launchWorker,
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

test("[AUT-02] LinuxComputerUseAdapter: recusa segunda ação enquanto a primeira executa (uma ação por vez)", async () => {
  const flow = new RunToolPermissionFlow();
  const firstAction = { action: "mouse_click" as const, coordinate: { x: 10, y: 20 } };
  const secondAction = { action: "mouse_click" as const, coordinate: { x: 30, y: 40 } };

  const firstPrepared = prepareLinuxComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-linux-par-1", firstAction),
    { environment: X11_ENV, hasExecutable: CHROME_PRESENT },
  );
  flow.decide(firstPrepared.permission.request.requestId, "allow", "once");
  const secondPrepared = prepareLinuxComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-linux-par-2", secondAction),
    { environment: X11_ENV, hasExecutable: CHROME_PRESENT },
  );
  flow.decide(secondPrepared.permission.request.requestId, "allow", "once");

  const transport = new GatedMouseCdpTransport();
  const adapter = new LinuxComputerUseAdapter({
    environment: X11_ENV,
    launchWorker: fakeWorkerFor(transport).launchWorker,
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

test("[AUT-02] LinuxComputerUseAdapter: falha de lançamento não fica presa e nova ação pode retomar", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "screenshot" as const };
  const prepared = prepareLinuxComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-linux-retry", action),
    { environment: X11_ENV, hasExecutable: CHROME_PRESENT },
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
  const adapter = new LinuxComputerUseAdapter({
    environment: X11_ENV,
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
// AUT-02 — Caminho real no host Linux (Chromium isolado via bwrap/CDP)
// ================================================================

test("[AUT-02] LinuxComputerUseAdapter: caminho real lança o target Chromium isolado e executa a ação autorizada", { concurrency: 1 }, async () => {
  const adapter = new LinuxComputerUseAdapter();
  assert.equal(adapter.capability.platform, "linux");

  if (!adapter.capability.available) {
    // Host sem Chromium: o contrato estável é recusar com INVALID_STATE antes
    // de qualquer lançamento — e nada abre.
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
  const prepared = prepareLinuxComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-linux-real", action),
  );
  assert.equal(prepared.linux.available, true);
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
