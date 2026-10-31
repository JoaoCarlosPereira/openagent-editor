/**
 * AUT-02 — Testes de integração do adapter Windows do computer use.
 *
 * O adapter Windows reaproveita o canal da task_177 (permissão nomeada
 * `computer.use` + `ComputerUseSession` de uso único sobre CDP) e o launcher
 * do worker do navegador (AUT-01), acrescentando a parte específica do
 * Windows (ADR-006: adapters e suites por plataforma): candidatos canônicos
 * de executável Chrome/Edge (chrome.exe/msedge.exe em Program Files/x86),
 * tipagem do aplicativo (chrome.app.type: "chrome"/"edge"), named pipe
 * canônico do gate do target isolado e degradação explícita da sandbox
 * win32 antes do consentimento.
 *
 * Ambiente de CI é Linux: os testes cobrem o CONTRATO por fakes da
 * plataforma (detecção de executável/sandbox injetáveis, caminhos com
 * aspecto Windows, CRLF no DevToolsActivePort e ramos de appType). O caminho
 * REAL executável em Windows fica registrado como limite honesto no card.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { RunToolPermissionFlow } from "@openagent/policy";
import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import {
  COMPUTER_USE_CAPABILITY,
  InMemoryCdpTransport,
  WINDOWS_CHROME_EXECUTABLE_CANDIDATES,
  WINDOWS_COMPUTER_PIPE,
  WindowsComputerUseAdapter,
  describeWindowsComputerCapability,
  parseDevToolsActivePort,
  prepareWindowsComputerAction,
  probeWindowsComputerCapability,
  resolveWindowsChromeAppType,
  type PreparePolicyComputerActionInput,
  type PolicyComputerToolContext,
  type WindowsComputerCapabilityResult,
} from "../../src/index.js";

function agentContext(): PolicyComputerToolContext {
  return { agentMode: "agent", executionMode: "standard" };
}

function prepareInput(
  requestId: string,
  action: unknown,
): PreparePolicyComputerActionInput {
  return {
    runId: `run-windows-${requestId}`,
    sessionId: `sess-windows-${requestId}`,
    requestId,
    action,
  };
}

/** Fixtures do Windows (ADR-006: detecção por SO). */
const WINDOWS_SANDBOX_OPTIONS = { platform: "win32" as NodeJS.Platform };

const CHROME_EXE = WINDOWS_CHROME_EXECUTABLE_CANDIDATES[0];
const EDGE_EXE = WINDOWS_CHROME_EXECUTABLE_CANDIDATES[2];

const CHROME_PRESENT = (candidate: string): boolean =>
  candidate === CHROME_EXE;
const EDGE_PRESENT = (candidate: string): boolean =>
  candidate === EDGE_EXE;

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
  const launches: Array<{ executable: string; appType: string }> = [];
  const launchWorker = async (launch: {
    executable: string;
    appType: string;
  }) => {
    launches.push({ executable: launch.executable, appType: launch.appType });
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
// AUT-02 — Detecção do executável Windows (caminhos canônicos Chrome/Edge)
// ================================================================

test("[AUT-02] probeWindowsComputerCapability: resolve chrome.exe canônico de Program Files com named pipe canônico", () => {
  const snapshot = probeWindowsComputerCapability({
    hasExecutable: CHROME_PRESENT,
  });

  assert.equal(snapshot.available, true);
  assert.equal(
    snapshot.executable,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "caminho canônico do Chrome deve ser valor literal do catálogo",
  );
  assert.deepEqual(snapshot.executableCandidates, WINDOWS_CHROME_EXECUTABLE_CANDIDATES);
  assert.equal(snapshot.appType, "chrome");
  assert.equal(snapshot.namedPipe, WINDOWS_COMPUTER_PIPE);
  assert.equal(snapshot.namedPipe, "\\\\.\\pipe\\openagent-computer-use");
  assert.equal(snapshot.degradationNotice, undefined);
});

test("[AUT-02] probeWindowsComputerCapability: sem Chrome resolve msedge.exe canônico de Program Files (x86) com appType edge", () => {
  const snapshot = probeWindowsComputerCapability({
    hasExecutable: EDGE_PRESENT,
  });

  assert.equal(snapshot.available, true);
  assert.equal(
    snapshot.executable,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "caminho canônico do Edge deve estar no catálogo antes do Edge (x64)",
  );
  assert.equal(snapshot.appType, "edge");
});

test("[AUT-02] probeWindowsComputerCapability: sem Chrome/Edge o adapter fica indisponível com aviso estável", () => {
  const snapshot = probeWindowsComputerCapability({ hasExecutable: () => false });

  assert.equal(snapshot.available, false);
  assert.equal(snapshot.executable, undefined);
  assert.ok(
    snapshot.degradationNotice?.includes("Chrome/Edge"),
    "aviso deve citar os executáveis ausentes",
  );

  const described = describeWindowsComputerCapability({
    hasExecutable: () => false,
  });
  assert.equal(described.platform, "win32");
});

test("[AUT-02] describeWindowsComputerCapability: sandbox win32 degradada é anunciada antes do consentimento (nunca silenciosa)", () => {
  const result = describeWindowsComputerCapability({
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: WINDOWS_SANDBOX_OPTIONS,
  });

  assert.equal(result.platform, "win32");
  assert.equal(result.sandbox.level, "degraded");
  assert.equal(result.available, true);
  const notice = result.degradationNotice ?? "";
  assert.ok(
    notice.includes("win32"),
    "aviso de sandbox degradada deve citar a plataforma",
  );
  assert.ok(
    notice.includes("worker thread"),
    "aviso de sandbox degradada deve citar o isolamento de worker thread",
  );
});

// ================================================================
// AUT-02 — Valores: chrome.app.type e CRLF do DevToolsActivePort (ramo Windows)
// ================================================================

test("[AUT-02] resolveWindowsChromeAppType: chrome.exe e msedge.exe com separadores \\ e / produzem chrome/edge", () => {
  assert.equal(
    resolveWindowsChromeAppType(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    ),
    "chrome",
  );
  assert.equal(
    resolveWindowsChromeAppType(
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ),
    "edge",
  );
  assert.equal(
    resolveWindowsChromeAppType(
      "c:/program files/microsoft/edge/application/msedge.exe",
    ),
    "edge",
  );
  assert.equal(
    resolveWindowsChromeAppType(
      "C:\\Users\\dev\\AppData\\Local\\Google\\Chrome\\Application\\CHROME.EXE",
    ),
    "chrome",
  );
});

test("[AUT-02] parseDevToolsActivePort: DevToolsActivePort do Windows com CRLF produz endpoint loopback valor exato", () => {
  assert.equal(
    parseDevToolsActivePort("58621\r\n/devtools/browser/847f0a1b\r\n"),
    "ws://127.0.0.1:58621/devtools/browser/847f0a1b",
    "quebra de linha CRLF não deve poluir o caminho do endpoint",
  );
  assert.equal(
    parseDevToolsActivePort("9223\n/devtools/browser/f83a\n"),
    "ws://127.0.0.1:9223/devtools/browser/f83a",
  );
  assert.equal(parseDevToolsActivePort("58621\r\n"), null, "sem caminho não há endpoint");
  assert.equal(parseDevToolsActivePort(""), null);
});

// ================================================================
// AUT-02 — prepareWindowsComputerAction (caminhos de erro estáveis)
// ================================================================

test("[AUT-02] prepareWindowsComputerAction: plataforma não-Windows retorna OUT_OF_SCOPE sem pedido de permissão", () => {
  const flow = new RunToolPermissionFlow();
  assert.throws(
    () =>
      prepareWindowsComputerAction(flow, agentContext(), prepareInput("perm-windows-os", {
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
  assert.equal(flow.getPending("perm-windows-os"), undefined);
});

test("[AUT-02] prepareWindowsComputerAction: host sem Chrome/Edge retorna INVALID_STATE sem efeito colateral", () => {
  const flow = new RunToolPermissionFlow();
  assert.throws(
    () =>
      prepareWindowsComputerAction(flow, agentContext(), prepareInput("perm-windows-nochrome", {
        action: "mouse_click",
        coordinate: { x: 1, y: 2 },
      }), {
        hasExecutable: () => false,
        sandboxOptions: WINDOWS_SANDBOX_OPTIONS,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.equal(flow.getPending("perm-windows-nochrome"), undefined);
});

test("[AUT-02] prepareWindowsComputerAction: pedido de permissão nomeia a ação exata e anexa o snapshot win32", () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "key_press" as const, key: "Enter" };
  const prepared = prepareWindowsComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-windows-ok", action),
    {
      hasExecutable: CHROME_PRESENT,
      sandboxOptions: WINDOWS_SANDBOX_OPTIONS,
    },
  );

  assert.equal(prepared.permission.phase, "pending");
  if (prepared.permission.phase !== "pending") {
    return;
  }
  assert.equal(prepared.permission.request.capability, COMPUTER_USE_CAPABILITY);
  assert.equal(prepared.permission.request.target.kind, "resource");
  assert.equal(prepared.permission.request.target.label, "key_press key:Enter");

  const windows: WindowsComputerCapabilityResult = prepared.windows;
  assert.equal(windows.platform, "win32");
  assert.equal(windows.available, true);
  assert.equal(windows.executable, CHROME_EXE);
  assert.equal(windows.appType, "chrome");
  assert.equal(windows.namedPipe, WINDOWS_COMPUTER_PIPE);
});

// ================================================================
// AUT-02 — WindowsComputerUseAdapter com worker fake (contrato)
// ================================================================

test("[AUT-02] WindowsComputerUseAdapter: ação autorizada executa uma única chamada e mostra o resultado", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "mouse_click" as const, coordinate: { x: 15, y: 25 } };
  const prepared = prepareWindowsComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-windows-run", action),
    { hasExecutable: CHROME_PRESENT, sandboxOptions: WINDOWS_SANDBOX_OPTIONS },
  );
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new RecordingCdpTransport();
  const launchedFirstExecutable = { first: null as string | null };
  const { launchWorker, launches } = fakeWorkerFor(transport, launchedFirstExecutable);
  const adapter = new WindowsComputerUseAdapter({
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: WINDOWS_SANDBOX_OPTIONS,
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
    { executable: CHROME_EXE, appType: "chrome" },
  ]);
  assert.equal(adapter.capability.platform, "win32");
  assert.equal(adapter.capability.available, true);
  assert.equal(adapter.capability.sandbox.level, "degraded");
  assert.equal(adapter.capability.namedPipe, WINDOWS_COMPUTER_PIPE);

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

test("[AUT-02] WindowsComputerUseAdapter: target Edge é lançado com appType edge e caminho canônico do catálogo", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "key_press" as const, key: "Tab" };
  const prepared = prepareWindowsComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-windows-edge", action),
    { hasExecutable: EDGE_PRESENT, sandboxOptions: WINDOWS_SANDBOX_OPTIONS },
  );
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new RecordingCdpTransport();
  const { launchWorker, launches } = fakeWorkerFor(transport, { first: null });
  const adapter = new WindowsComputerUseAdapter({
    hasExecutable: EDGE_PRESENT,
    sandboxOptions: WINDOWS_SANDBOX_OPTIONS,
    launchWorker,
  });

  const result = await adapter.runAuthorizedAction(
    { action },
    { flow, requestId: prepared.permission.request.requestId },
  );

  assert.equal(result.executed, true);
  assert.equal(result.actionName, "key_press key:Tab");
  assert.deepEqual(launches, [
    { executable: EDGE_EXE, appType: "edge" },
  ]);
  assert.equal(adapter.capability.appType, "edge");

  await adapter.terminate();
});

test("[AUT-02] WindowsComputerUseAdapter: negação retorna OUT_OF_SCOPE sem enviar nada ao transporte", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "key_press" as const, key: "Enter" };
  const prepared = prepareWindowsComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-windows-deny", action),
    { hasExecutable: CHROME_PRESENT, sandboxOptions: WINDOWS_SANDBOX_OPTIONS },
  );
  flow.decide(prepared.permission.request.requestId, "deny", "once");

  const transport = new RecordingCdpTransport();
  const adapter = new WindowsComputerUseAdapter({
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: WINDOWS_SANDBOX_OPTIONS,
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

test("[AUT-02] WindowsComputerUseAdapter: autorização de outra ação retorna INVALID_STATE sem efeito", async () => {
  const flow = new RunToolPermissionFlow();
  const allowed = { action: "key_press" as const, key: "Enter" };
  const attempted = { action: "mouse_click" as const, coordinate: { x: 9, y: 9 } };
  const prepared = prepareWindowsComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-windows-mismatch", allowed),
    { hasExecutable: CHROME_PRESENT, sandboxOptions: WINDOWS_SANDBOX_OPTIONS },
  );
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const transport = new RecordingCdpTransport();
  const adapter = new WindowsComputerUseAdapter({
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: WINDOWS_SANDBOX_OPTIONS,
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

test("[AUT-02] WindowsComputerUseAdapter: recusa segunda ação enquanto a primeira executa (uma ação por vez)", async () => {
  const flow = new RunToolPermissionFlow();
  const firstAction = { action: "mouse_click" as const, coordinate: { x: 10, y: 20 } };
  const secondAction = { action: "mouse_click" as const, coordinate: { x: 30, y: 40 } };

  const firstPrepared = prepareWindowsComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-windows-par-1", firstAction),
    { hasExecutable: CHROME_PRESENT, sandboxOptions: WINDOWS_SANDBOX_OPTIONS },
  );
  flow.decide(firstPrepared.permission.request.requestId, "allow", "once");
  const secondPrepared = prepareWindowsComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-windows-par-2", secondAction),
    { hasExecutable: CHROME_PRESENT, sandboxOptions: WINDOWS_SANDBOX_OPTIONS },
  );
  flow.decide(secondPrepared.permission.request.requestId, "allow", "once");

  const transport = new GatedMouseCdpTransport();
  const adapter = new WindowsComputerUseAdapter({
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: WINDOWS_SANDBOX_OPTIONS,
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

test("[AUT-02] WindowsComputerUseAdapter: falha de lançamento não fica presa e nova ação pode retomar", async () => {
  const flow = new RunToolPermissionFlow();
  const action = { action: "screenshot" as const };
  const prepared = prepareWindowsComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-windows-retry", action),
    { hasExecutable: CHROME_PRESENT, sandboxOptions: WINDOWS_SANDBOX_OPTIONS },
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
  const adapter = new WindowsComputerUseAdapter({
    hasExecutable: CHROME_PRESENT,
    sandboxOptions: WINDOWS_SANDBOX_OPTIONS,
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
// AUT-02 — Caminho real no host Windows (contrato determinístico em Linux)
// ================================================================

test("[AUT-02] WindowsComputerUseAdapter: caminho real recusa host sem chrome.exe/msedge.exe com INVALID_STATE", { concurrency: 1 }, async () => {
  const adapter = new WindowsComputerUseAdapter();
  assert.equal(adapter.capability.platform, "win32");
  // Named pipe canônico do gate faz parte da capacidade reportada em qualquer host.
  assert.equal(adapter.capability.namedPipe, WINDOWS_COMPUTER_PIPE);

  if (!adapter.capability.available) {
    // Host sem chrome.exe/msedge.exe instalados (ex.: CI Linux): o contrato
    // estável é recusar com INVALID_STATE antes de qualquer lançamento —
    // e nada abre. Em um host Windows real com Chrome/Edge instalado, a
    // mesma chamada significa o caminho REAL do launcher (launchBrowserWorker
    // com perfil temporário e endpoint DevTools por DevToolsActivePort) —
    // limite honesto: não executável aqui, provado por fixtures acima.
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
  const prepared = prepareWindowsComputerAction(
    flow,
    agentContext(),
    prepareInput("perm-windows-real", action),
  );
  assert.equal(prepared.windows.available, true);
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  const result = await adapter.runAuthorizedAction(
    { action },
    { flow, requestId: prepared.permission.request.requestId },
  );

  assert.equal(result.executed, true);
  assert.equal(result.actionName, "mouse_click coordinate:40,50 button:left");
  assert.ok(result.screenshot.startsWith("iVBOR"), "screenshot PNG real");
  assert.ok(result.cdpCalls.includes("Input.dispatchMouseEvent"));
  assert.ok(result.cdpCalls.includes("Page.captureScreenshot"));
  assert.equal(adapter.busy, false);

  await adapter.terminate();
});
