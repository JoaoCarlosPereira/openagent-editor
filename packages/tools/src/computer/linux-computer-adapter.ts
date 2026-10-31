/**
 * AUT-02 — Adapter Linux do computer use (task_178).
 *
 * Reaproveita a fundação da task_177 (`preparePolicyComputerAction`,
 * `ComputerUseSession`, `executePolicyComputerAction`) e o launcher do target
 * Chromium isolado da AUT-01 (`launchBrowserWorker`), acrescentando a parte
 * específica do Linux (ADR-006: adapters e suites por plataforma):
 *
 * - detecção do ambiente de exibição (X11/XWayland, Wayland nativo, headless);
 * - degradação explícita antes do consentimento (nunca silenciosa);
 * - paísagem do Chromium do Electron/Chrome por SO: em Wayland nativo (sem
 *   XWayland) o target passa `--ozone-platform-hint=auto`; em X11 usa a rota
 *   padrão; sem servidor de exibição roda headless com aviso documentado.
 *
 * Não introduce bibliotecas nativas novas: toda a interação é feita via CDP
 * (Input.* + Page.captureScreenshot) sobre o target isolado.
 */

import { existsSync } from "node:fs";

import { RunToolPermissionFlow } from "@openagent/policy";
import {
  ProtocolError,
  PROTOCOL_ERROR_CODES,
} from "@openagent/protocol";

import {
  DEFAULT_CHROME_EXECUTABLE_CANDIDATES,
  launchBrowserWorker,
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

export { DEFAULT_CHROME_EXECUTABLE_CANDIDATES };

/** Rota de exibição detectada no Linux. */
export type LinuxDisplayMode = "x11" | "wayland" | "headless";

/** Variáveis canônicas do ambiente de sessão gráfica do Linux. */
export interface LinuxDisplayEnvironment {
  xdgSessionType?: string | undefined;
  display?: string | undefined;
  waylandDisplay?: string | undefined;
}

/** Lê o ambiente de exibição do processo (injetável em testes). */
export function readLinuxDisplayEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): LinuxDisplayEnvironment {
  return {
    xdgSessionType: env["XDG_SESSION_TYPE"],
    display: env["DISPLAY"],
    waylandDisplay: env["WAYLAND_DISPLAY"],
  };
}

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Classificação do ambiente (X11 cobre XWayland: com `DISPLAY` presente o
 * Chromium conecta pela rota X11 padrão do compositor).
 */
export function classifyLinuxDisplayMode(
  environment: LinuxDisplayEnvironment,
): LinuxDisplayMode {
  if (isNonEmpty(environment.display)) {
    return "x11";
  }
  if (
    isNonEmpty(environment.waylandDisplay) ||
    environment.xdgSessionType?.trim() === "wayland"
  ) {
    return "wayland";
  }
  return "headless";
}

/**
 * Ajustes de lançamento do Chromium por modo de exibição. Em Wayland nativo
 * (sem XWayland) o Chromium precisa da dica de backend Ozone; em X11 e
 * headless o launcher usa os argumentos padrão.
 */
export function buildLinuxComputerTargetArgs(
  environment: LinuxDisplayEnvironment,
): readonly string[] {
  return classifyLinuxDisplayMode(environment) === "wayland"
    ? ["--ozone-platform-hint=auto"]
    : [];
}

export type LinuxChromiumExecutableProbe = (candidate: string) => boolean;

export interface LinuxComputerProbeOptions {
  /** Somente teste/diagnóstico: ambiente fixo em vez de process.env. */
  environment?: LinuxDisplayEnvironment;
  /** Candidatos de executável do Chromium (padrão: mesmo catálogo do launcher). */
  executableCandidates?: readonly string[];
  /** Somente teste/fake: verificação de existência do executável. */
  hasExecutable?: LinuxChromiumExecutableProbe;
}

export interface LinuxComputerCapabilitySnapshot {
  displayMode: LinuxDisplayMode;
  /** Há exibição visível ao usuário (x11 ou wayland nativo). */
  desktopAvailable: boolean;
  /** Target isolado do Chromium disponível (executável resolvido). */
  available: boolean;
  executable?: string;
  /** Mensagem de degradação exibida antes do consentimento (ADR-006). */
  degradationNotice?: string;
}

/** Snapshot de capability do computer use no Linux combinado à sandbox. */
export interface LinuxComputerCapabilityResult
  extends LinuxComputerCapabilitySnapshot {
  platform: NodeJS.Platform;
  sandbox: SandboxCapabilitySnapshot;
}

const HEADLESS_DISPLAY_NOTICE =
  "Nenhum servidor de exibição X11/Wayland detectado; o computer use roda em target isolado headless via CDP.";
const WAYLAND_NATIVE_DISPLAY_NOTICE =
  "Sessão Wayland nativa (sem XWayland): o Chromium do target isolado roda com --ozone-platform-hint=auto.";
const MISSING_EXECUTABLE_NOTICE =
  "Nenhum executável de Chrome/Chromium encontrado para o target isolado do computer use.";

function probeDisplaySnapshot(
  options?: LinuxComputerProbeOptions,
): LinuxComputerCapabilitySnapshot {
  const environment = options?.environment ?? readLinuxDisplayEnvironment();
  const displayMode = classifyLinuxDisplayMode(environment);
  const notices: string[] = [];
  if (displayMode === "headless") {
    notices.push(HEADLESS_DISPLAY_NOTICE);
  }
  if (displayMode === "wayland") {
    notices.push(WAYLAND_NATIVE_DISPLAY_NOTICE);
  }

  const candidates =
    options?.executableCandidates ?? DEFAULT_CHROME_EXECUTABLE_CANDIDATES;
  const hasExecutable =
    options?.hasExecutable ?? ((candidate: string) => existsSync(candidate));
  let executable: string | undefined;
  for (const candidate of candidates) {
    if (hasExecutable(candidate)) {
      executable = candidate;
      break;
    }
  }
  const available = executable !== undefined;
  if (!available) {
    notices.push(MISSING_EXECUTABLE_NOTICE);
  }

  return {
    displayMode,
    desktopAvailable: displayMode !== "headless",
    available,
    executable,
    degradationNotice: notices.length > 0 ? notices.join("; ") : undefined,
  };
}

/** Detecta o ambiente de exibição + executável do target no host Linux. */
export function probeLinuxComputerDisplay(
  options?: LinuxComputerProbeOptions,
): LinuxComputerCapabilitySnapshot {
  return probeDisplaySnapshot(options);
}

export interface DescribeLinuxComputerCapabilityOptions
  extends LinuxComputerProbeOptions {
  /** Opções da sandbox nativa (ADR-006), reutilizadas na cadeia da policy. */
  sandboxOptions?: DescribeSandboxCapabilityOptions;
}

/** Combina o snapshot de exibição com o nível de sandbox do SO (ADR-006). */
export function describeLinuxComputerCapability(
  options?: DescribeLinuxComputerCapabilityOptions,
): LinuxComputerCapabilityResult {
  const sandbox = describeSandboxCapability(options?.sandboxOptions);
  const display = probeDisplaySnapshot(options);
  const notices = [
    (sandbox.level === "degraded" ? sandbox.degradationNotice : undefined),
    display.degradationNotice,
  ];
  const uniqueNotices = [...new Set(notices.filter(notice => isNonEmpty(notice)))];
  return {
    ...display,
    platform: sandbox.platform,
    sandbox,
    degradationNotice:
      uniqueNotices.length > 0 ? uniqueNotices.join("; ") : undefined,
  };
}

export type PrepareLinuxComputerActionOptions =
  DescribeLinuxComputerCapabilityOptions;

export interface PreparedLinuxComputerAction
  extends ReturnType<typeof preparePolicyComputerAction> {
  linux: LinuxComputerCapabilityResult;
}

/**
 * AUT-02: prepara uma ação de computer use pelo adapter Linux.
 * - plataforma não-Linux: `OUT_OF_SCOPE` estável, sem pedido de permissão;
 * - target indisponível (sem Chromium): `INVALID_STATE` estável, sem pedido;
 * - caso válido: mesmo pedido nomeado da task_177 com snapshot Linux anexado.
 */
export function prepareLinuxComputerAction(
  flow: RunToolPermissionFlow,
  context: PolicyComputerToolContext,
  input: PreparePolicyComputerActionInput,
  options?: PrepareLinuxComputerActionOptions,
): PreparedLinuxComputerAction {
  const platform =
    options?.sandboxOptions?.platform ?? process.platform;
  if (platform !== "linux") {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
      `Adapter do computer use Linux não se aplica à plataforma '${platform}' (disponível apenas em Linux).`,
    );
  }
  const linux = describeLinuxComputerCapability(options);
  if (!linux.available) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Computer use indisponível neste host Linux.",
      [linux.degradationNotice ?? MISSING_EXECUTABLE_NOTICE],
    );
  }
  const prepared = preparePolicyComputerAction(
    flow,
    context,
    input,
    options?.sandboxOptions,
  );
  return { ...prepared, linux };
}

/** Processo do target isolado usado pelo adapter Linux. */
export interface LinuxComputerWorkerProcess {
  transport: CdpTransport;
  /** Nível de sandbox aplicado ao processo real do target (ADR-006). */
  sandbox?: SandboxCapabilitySnapshot;
  /** Cancelamento: encerra o worker e impede novos dispatches (ADR-006). */
  terminate(): Promise<void>;
}

/** Lançamento entregue aos launchers (injetável em testes). */
export interface LinuxComputerTargetLaunch {
  displayMode: LinuxDisplayMode;
  extraChromiumArgs: readonly string[];
}

export type LinuxComputerLaunchWorker = (
  launch: LinuxComputerTargetLaunch,
) => Promise<LinuxComputerWorkerProcess>;

export interface LinuxComputerUseAdapterOptions
  extends DescribeLinuxComputerCapabilityOptions {
  /** Somente teste/fixture: injeta o worker em vez de lançar o Chromium real. */
  launchWorker?: LinuxComputerLaunchWorker;
  /** Timeout de espera pelo endpoint DevTools do Chromium real. */
  startupTimeoutMs?: number;
}

/**
 * AUT-02: adapter Linux do computer use.
 * Mantém uma única ação autorizada por vez sobre o target Chromium isolado;
 * `terminate()` encerra o worker do SO e impede novos dispatches (ADR-006).
 */
export class LinuxComputerUseAdapter {
  private readonly environment: LinuxDisplayEnvironment;
  private readonly options: LinuxComputerUseAdapterOptions;
  private capabilityResult: LinuxComputerCapabilityResult | null = null;
  private opening: Promise<ComputerUseSession> | null = null;
  private openedSession: ComputerUseSession | null = null;
  private worker: LinuxComputerWorkerProcess | null = null;
  private terminated = false;

  constructor(options?: LinuxComputerUseAdapterOptions) {
    this.options = options ?? {};
    this.environment = options?.environment ?? readLinuxDisplayEnvironment();
  }

  /** Snapshot da capability no host (memoizado). */
  get capability(): LinuxComputerCapabilityResult {
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
   * Abre (lazily, uma única vez) o target Chromium isolado do Linux e retorna
   * a sessão de uso. Idempotente enquanto aberto; estável via INVALID_STATE
   * quando encerrado ou quando o host não tem executável do Chromium.
   */
  async openTarget(): Promise<ComputerUseSession> {
    if (this.terminated && this.openedSession === null) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Adapter do computer use Linux foi encerrado.",
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
    // Chromium é lançado com autorização recusada (OUT_OF_SCOPE estável).
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
      // Encerramento do worker Linux não deve mascarar o estado do adapter.
    }
  }

  private describeCapability(): LinuxComputerCapabilityResult {
    return describeLinuxComputerCapability({
      environment: this.environment,
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
        "Adapter do computer use Linux foi encerrado antes do lançamento do target.",
      );
    }
    if (!capability.available) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Computer use indisponível neste host Linux.",
        [capability.degradationNotice ?? MISSING_EXECUTABLE_NOTICE],
      );
    }

    const worker = this.options.launchWorker
      ? await this.options.launchWorker({
          displayMode: capability.displayMode,
          extraChromiumArgs: buildLinuxComputerTargetArgs(this.environment),
        })
      : await this.launchRealTarget();

    if (this.terminated) {
      // Cancelamento chegou durante o lançamento: nunca entrega sessão nova.
      await worker?.terminate();
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Adapter do computer use Linux foi encerrado antes do lançamento do target.",
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

  private async launchRealTarget(): Promise<LinuxComputerWorkerProcess> {
    const worker = await launchBrowserWorker({
      executableCandidates: this.options.executableCandidates,
      extraChromiumArgs: buildLinuxComputerTargetArgs(this.environment),
      sandboxOptions: {
        ...this.options.sandboxOptions,
        // O adapter é Linux: garante que a sandbox descrita seja a do Linux
        // mesmo que o chamador não tenha sinalizado plataforma.
        platform: "linux",
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
