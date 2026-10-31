/**
 * AUT-02 — Adapter Windows do computer use (task_180).
 *
 * Reaproveita a mesma fundação da task_177 (`preparePolicyComputerAction`,
 * `ComputerUseSession`, `executePolicyComputerAction`) e o launcher da
 * AUT-01 (`launchBrowserWorker` — perfil temporário dedicado + endpoint
 * DevTools lido do DevToolsActivePort), acrescentando a parte específica do
 * Windows (ADR-006: adapters e suites por plataforma):
 *
 * - candidatos de executável Chromium canônicos do Windows
 *   (`C:\Program Files\Google\Chrome\Application\chrome.exe` e a família
 *   Edge `msedge.exe`), resolvidos em ordem;
 * - tipagem do aplicativo resolvido (`chrome.app.type`: "chrome" | "edge"),
 *   que determina o app do target isolado a cada lançamento;
 * - named pipe canônico do gate do target isolado
 *   (`\\.\pipe\openagent-computer-use`) exposto no snapshot de capacidade,
 *   rota de transporte do Chromium do Electron conectado ao gate do
 *   computer use no Windows;
 * - devtools endpoint com quebras CRLF (`parseDevToolsActivePort` no
 *   launcher, reexportado como `buildWindowsDevToolsEndpoint`) para os
 *   ramos de caminho Windows;
 * - degradação explícita da sandbox win32 (AppContainer fica em tarefa
 *   dedicada; nesta base o isolamento nativo reporta worker thread) antes
 *   do consentimento.
 *
 * Não introduz bibliotecas nativas novas: toda a interação é feita via CDP
 * (Input.* + Page.captureScreenshot) sobre o target isolado, identicamente
 * aos adapters Linux (task_178) e macOS (task_179).
 */

import { existsSync } from "node:fs";

import { RunToolPermissionFlow } from "@openagent/policy";
import {
  ProtocolError,
  PROTOCOL_ERROR_CODES,
} from "@openagent/protocol";

import {
  launchBrowserWorker,
  parseDevToolsActivePort,
} from "../browser/browser-worker-launcher.js";
import { CdpTargetManager } from "../browser/cdp-target-manager.js";
import type { CdpTransport } from "../browser/types.js";
import {
  describeSandboxCapability,
  type DescribeSandboxCapabilityOptions,
  type SandboxCapabilitySnapshot,
} from "../sandbox/sandbox-capability.js";
import {
  ComputerUseSession,
  executePolicyComputerAction,
  preparePolicyComputerAction,
  type ComputerActionAuthorization,
  type PolicyComputerActionResult,
  type PolicyComputerToolContext,
  type PreparePolicyComputerActionInput,
} from "./policy-computer-tools.js";

/** Executáveis Chrome/Edge canônicos do Windows, tentados em ordem. */
export const WINDOWS_CHROME_EXECUTABLE_CANDIDATES: readonly string[] = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

/** Aplicativo do Chromium resolvido no Windows. */
export type WindowsChromeAppType = "chrome" | "edge";

/**
 * Nome canônico da named pipe do gate do target isolado do computer use no
 * Windows (ADR-006): toda abertura do target publica o mesmo nome. Constante
 * não credencial — revela apenas a identidade do gate local, nunca tokens.
 */
export const WINDOWS_COMPUTER_PIPE = "\\\\.\\pipe\\openagent-computer-use";

const MISSING_EXECUTABLE_NOTICE =
  "Nenhum executável de Chrome/Edge encontrado no Windows para o target isolado do computer use.";

/**
 * Tipo do aplicativo resolvido pelo caminho do executável chrome/msedge
 * (separadores `\` e `/`, case-insensitive — ramos de caminho do Windows).
 */
export function resolveWindowsChromeAppType(
  executable: string,
): WindowsChromeAppType {
  const basename = executable.toLowerCase().split(/[\\/]/).pop() ?? "";
  return basename === "msedge.exe" ? "edge" : "chrome";
}

/** Endpoint DevTools do ramos Windows: parse do DevToolsActivePort com CRLF. */
export function buildWindowsDevToolsEndpoint(raw: string): string | null {
  return parseDevToolsActivePort(raw);
}

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export type WindowsChromeExecutableProbe = (candidate: string) => boolean;

export interface WindowsComputerProbeOptions {
  /** Candidatos de executável do Chromium (padrão: catálogo canônico do Windows). */
  executableCandidates?: readonly string[];
  /** Somente teste/fake: verificação de existência do executável. */
  hasExecutable?: WindowsChromeExecutableProbe;
}

export interface WindowsComputerCapabilitySnapshot {
  /** Target isolado do Chrome/Edge disponível (executável resolvido). */
  available: boolean;
  executable?: string;
  /** Aplicativo do executável resolvido ("chrome" | "edge"). */
  appType?: WindowsChromeAppType;
  /** Candidatos consultados nesta detecção (diagnóstico estável). */
  executableCandidates: readonly string[];
  /** Named pipe canônica do gate do target isolado (contrato Windows). */
  namedPipe: string;
  /** Endpoint DevTools canônico quando o DevToolsActivePort está disponível. */
  devtoolsEndpoint?: string | undefined;
  /** Mensagem de degradação exibida antes do consentimento (ADR-006). */
  degradationNotice?: string;
}

/** Snapshot de capability do computer use no Windows combinado à sandbox. */
export interface WindowsComputerCapabilityResult
  extends WindowsComputerCapabilitySnapshot {
  platform: NodeJS.Platform;
  sandbox: SandboxCapabilitySnapshot;
}

function probeSnapshot(
  options?: WindowsComputerProbeOptions,
): WindowsComputerCapabilitySnapshot {
  const candidates =
    options?.executableCandidates ?? WINDOWS_CHROME_EXECUTABLE_CANDIDATES;
  const hasExecutable =
    options?.hasExecutable ?? ((candidate: string) => existsSync(candidate));
  let executable: string | undefined;
  let appType: WindowsChromeAppType | undefined;
  for (const candidate of candidates) {
    if (hasExecutable(candidate)) {
      executable = candidate;
      appType = resolveWindowsChromeAppType(candidate);
      break;
    }
  }
  const available = executable !== undefined;
  const notices: string[] = [];
  if (!available) {
    notices.push(MISSING_EXECUTABLE_NOTICE);
  }

  return {
    available,
    executable,
    appType,
    executableCandidates: candidates,
    namedPipe: WINDOWS_COMPUTER_PIPE,
    degradationNotice: notices.length > 0 ? notices.join("; ") : undefined,
  };
}

/** Detecta o executável do target + o catálogo do host Windows. */
export function probeWindowsComputerCapability(
  options?: WindowsComputerProbeOptions,
): WindowsComputerCapabilitySnapshot {
  return probeSnapshot(options);
}

export interface DescribeWindowsComputerCapabilityOptions
  extends WindowsComputerProbeOptions {
  /** Opções da sandbox nativa (ADR-006), reutilizadas na cadeia da policy. */
  sandboxOptions?: DescribeSandboxCapabilityOptions;
}

/**
 * Combina o snapshot do executável com o nível de sandbox do Windows
 * (ADR-006). O adapter é win32: a sandbox descrita é sempre a do Windows,
 * mesmo que o chamador não tenha sinalizado plataforma. Na base atual não
 * há AppContainer (tarefa dedicada): win32 desce como degradado e o aviso
 * nunca é silencioso.
 */
export function describeWindowsComputerCapability(
  options?: DescribeWindowsComputerCapabilityOptions,
): WindowsComputerCapabilityResult {
  const sandboxOptions: DescribeSandboxCapabilityOptions = {
    ...options?.sandboxOptions,
    platform: "win32",
  };
  const sandbox = describeSandboxCapability(sandboxOptions);
  const windows = probeSnapshot(options);
  const notices = [
    (sandbox.level === "degraded" ? sandbox.degradationNotice : undefined),
    windows.degradationNotice,
  ];
  const uniqueNotices = [...new Set(notices.filter(notice => isNonEmpty(notice)))];
  return {
    ...windows,
    degradationNotice:
      uniqueNotices.length > 0 ? uniqueNotices.join("; ") : undefined,
    platform: sandbox.platform,
    sandbox,
  };
}

export type PrepareWindowsComputerActionOptions =
  DescribeWindowsComputerCapabilityOptions;

export type PreparedWindowsComputerAction = ReturnType<
  typeof preparePolicyComputerAction
> & {
  windows: WindowsComputerCapabilityResult;
};

/**
 * AUT-02: prepara uma ação de computer use pelo adapter Windows.
 * - plataforma não-Windows: `OUT_OF_SCOPE` estável, sem pedido de permissão;
 * - target indisponível (sem Chrome/Edge): `INVALID_STATE` estável, sem pedido;
 * - caso válido: mesmo pedido nomeado da task_177 com snapshot win32 anexado.
 */
export function prepareWindowsComputerAction(
  flow: RunToolPermissionFlow,
  context: PolicyComputerToolContext,
  input: PreparePolicyComputerActionInput,
  options?: PrepareWindowsComputerActionOptions,
): PreparedWindowsComputerAction {
  const platform =
    options?.sandboxOptions?.platform ?? process.platform;
  if (platform !== "win32") {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
      `Adapter do computer use Windows não se aplica à plataforma '${platform}' (disponível apenas em Windows).`,
    );
  }
  const windows = describeWindowsComputerCapability(options);
  if (!windows.available) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Computer use indisponível neste host Windows.",
      [windows.degradationNotice ?? MISSING_EXECUTABLE_NOTICE],
    );
  }
  const prepared = preparePolicyComputerAction(
    flow,
    context,
    input,
    options?.sandboxOptions,
  );
  return { ...prepared, windows };
}

/** Processo do target isolado usado pelo adapter Windows. */
export interface WindowsComputerWorkerProcess {
  transport: CdpTransport;
  /** Nível de sandbox aplicado ao processo real do target (ADR-006). */
  sandbox?: SandboxCapabilitySnapshot;
  /** Cancelamento: encerra o worker e impede novos dispatches (ADR-006). */
  terminate(): Promise<void>;
}

/** Lançamento entregue aos launchers (injetável em testes). */
export interface WindowsComputerTargetLaunch {
  /** Executável Chromium resolvido nesta abertura (diagnóstico). */
  executable: string;
  /** Aplicativo do executável resolvido ("chrome" | "edge"). */
  appType: WindowsChromeAppType;
}

export type WindowsComputerLaunchWorker = (
  launch: WindowsComputerTargetLaunch,
) => Promise<WindowsComputerWorkerProcess>;

export interface WindowsComputerUseAdapterOptions
  extends DescribeWindowsComputerCapabilityOptions {
  /** Somente teste/fixture: injeta o worker em vez de lançar o Chromium real. */
  launchWorker?: WindowsComputerLaunchWorker;
  /** Timeout de espera pelo endpoint DevTools do Chrome real. */
  startupTimeoutMs?: number;
}

/**
 * AUT-02: adapter Windows do computer use. Mantém uma única ação autorizada
 * por vez sobre o target Chrome/Edge isolado; `terminate()` encerra o worker
 * do SO e impede novos dispatches (ADR-006).
 */
export class WindowsComputerUseAdapter {
  private readonly options: WindowsComputerUseAdapterOptions;
  private capabilityResult: WindowsComputerCapabilityResult | null = null;
  private opening: Promise<ComputerUseSession> | null = null;
  private openedSession: ComputerUseSession | null = null;
  private worker: WindowsComputerWorkerProcess | null = null;
  private terminated = false;

  constructor(options?: WindowsComputerUseAdapterOptions) {
    this.options = options ?? {};
  }

  /** Snapshot da capability no host (memoizado). */
  get capability(): WindowsComputerCapabilityResult {
    this.capabilityResult ??= this.describeCapability();
    return this.capabilityResult;
  }

  get busy(): boolean {
    return this.openedSession?.busy ?? false;
  }

  get open(): boolean {
    return !this.terminated && this.openedSession !== null;
  }

  /**
   * Abre (lazily, uma única vez) o target Chrome/Edge isolado do Windows e
   * retorna a sessão de uso. Idempotente enquanto aberto; estável via
   * INVALID_STATE quando encerrado ou quando o host não tem executável do
   * Chrome/Edge.
   */
  async openTarget(): Promise<ComputerUseSession> {
    if (this.terminated && this.openedSession === null) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Adapter do computer use Windows foi encerrado.",
      );
    }
    if (this.openedSession) {
      return this.openedSession;
    }
    if (!this.opening) {
      const opening = this.createSession().catch((error: unknown) => {
        // Falha de lançamento não deve ficar presa: nova abertura pode tentar
        // de novo (ex.: timeout transitório na espera pelo endpoint DevTools).
        if (this.opening === opening) {
          this.opening = null;
        }
        throw error;
      });
      this.opening = opening;
    }
    return this.opening;
  }

  /**
   * AUT-02: executa a ação sob a autorização nomeada consumida uma única vez.
   * Uma ação por vez: enquanto uma ação executa, novas chamadas recusam com
   * `INVALID_STATE` sem efeito colateral.
   */
  async runAuthorizedAction(
    input: { action: unknown },
    authorization?: ComputerActionAuthorization,
  ): Promise<PolicyComputerActionResult> {
    // Negação explícita recusa antes de abrir o target: nenhum processo do
    // Chrome/Edge é lançado com autorização recusada (OUT_OF_SCOPE estável).
    if (authorization?.requestId && authorization.flow.wasDenied(authorization.requestId)) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
        "Ação do computer use foi recusada.",
      );
    }
    const session = await this.openTarget();
    return executePolicyComputerAction(session, input, authorization);
  }

  /** Cancelamento: encerra o worker do target e impede novos dispatches. */
  async terminate(): Promise<void> {
    if (this.terminated) {
      return;
    }
    this.terminated = true;
    const worker = this.worker;
    this.openedSession = null;
    this.opening = null;
    this.worker = null;
    try {
      await worker?.terminate();
    } catch {
      // Encerramento do worker Windows não deve mascarar o estado do adapter.
    }
  }

  private describeCapability(): WindowsComputerCapabilityResult {
    return describeWindowsComputerCapability({
      executableCandidates: this.options.executableCandidates,
      hasExecutable: this.options.hasExecutable,
      sandboxOptions: this.options.sandboxOptions,
    });
  }

  private async createSession(): Promise<ComputerUseSession> {
    const capability = this.capability;
    if (this.terminated) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Adapter do computer use Windows foi encerrado antes do lançamento do target.",
      );
    }
    if (!capability.available) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Computer use indisponível neste host Windows.",
        [capability.degradationNotice ?? MISSING_EXECUTABLE_NOTICE],
      );
    }

    const executable = capability.executable;
    if (executable === undefined) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Computer use indisponível neste host Windows.",
        [capability.degradationNotice ?? MISSING_EXECUTABLE_NOTICE],
      );
    }

    const worker = this.options.launchWorker
      ? await this.options.launchWorker({
          executable,
          appType: resolveWindowsChromeAppType(executable),
        })
      : await this.launchRealTarget();

    if (this.terminated) {
      // Cancelamento chegou durante o lançamento: nunca entrega sessão nova.
      await worker?.terminate();
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Adapter do computer use Windows foi encerrado antes do lançamento do target.",
      );
    }

    this.worker = worker;
    // Target isolado da AUT-01: os comandos Input.*/Page.* vão para a sessão da
    // página (nível do browser não expõe domínios de entrada).
    const targetManager = new CdpTargetManager(worker.transport);
    const targetSession = await targetManager.createIsolatedTarget();
    this.openedSession = new ComputerUseSession(worker.transport, undefined, {
      cdpSessionId: targetSession.sessionId,
    });
    return this.openedSession;
  }

  private async launchRealTarget(): Promise<WindowsComputerWorkerProcess> {
    const worker = await launchBrowserWorker({
      executableCandidates:
        this.options.executableCandidates ?? WINDOWS_CHROME_EXECUTABLE_CANDIDATES,
      sandboxOptions: {
        ...this.options.sandboxOptions,
        // O adapter é Windows: garante que a sandbox descrita seja a do win32
        // mesmo que o chamador não tenha sinalizado plataforma.
        platform: "win32",
      },
      startupTimeoutMs: this.options.startupTimeoutMs,
    });
    return {
      transport: worker.transport,
      sandbox: worker.sandbox,
      terminate: () => worker.terminate(),
    };
  }
}
