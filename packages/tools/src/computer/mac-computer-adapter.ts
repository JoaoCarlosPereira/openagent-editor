/**
 * AUT-02 — Adapter macOS do computer use (task_179).
 *
 * Reaproveita a mesma fundação da task_177 (`preparePolicyComputerAction`,
 * `ComputerUseSession`, `executePolicyComputerAction`) e o launcher da AUT-01
 * (`launchBrowserWorker`, que já aplica a sandbox nativa do macOS via
 * sandbox-exec/Seatbelt — ADR-006), acrescentando a parte específica do macOS:
 *
 * - candidatos de executável Chrome/Chromium canônicos do macOS
 *   (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, etc.);
 * - permissões TCC do macOS (Screen Recording e Accessibility) documentadas
 *   explicitamente como parte do snapshot de capacidade antes do consentimento;
 * - degradação explícita da sandbox (Seatbelt indisponível ou degradado).
 *
 * Não introduz bibliotecas nativas novas: toda a interação é feita via CDP
 * (Input.* + Page.captureScreenshot) sobre o target isolado, identicamente ao
 * adapter Linux da task_178.
 */

import { existsSync } from "node:fs";

import { RunToolPermissionFlow } from "@openagent/policy";
import {
  ProtocolError,
  PROTOCOL_ERROR_CODES,
} from "@openagent/protocol";

import { launchBrowserWorker } from "../browser/browser-worker-launcher.js";
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

/** Executáveis Chrome/Chromium canônicos do macOS, tentados em ordem. */
export const MACOS_CHROME_EXECUTABLE_CANDIDATES: readonly string[] = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

/** Permissões do sistema (TCC) exigidas pelo computer use no macOS. */
export type MacosComputerPermission = "screen-recording" | "accessibility";

export const MACOS_REQUIRED_COMPUTER_PERMISSIONS: readonly MacosComputerPermission[] = [
  "screen-recording",
  "accessibility",
];

/**
 * Documentação estática do requisito de permissões do macOS: nunca é
 * silenciosa — consta no snapshot de capacidade ANTES do consentimento
 * (ADR-006). O próprio SO solicita as concessões TCC ao primeiro uso.
 */
export const MACOS_PERMISSIONS_NOTICE =
  "No macOS, o computer use requer as permissões de Screen Recording (captura de tela) e Accessibility (controle) em Configurações do Sistema; o SO solicita ao primeiro uso.";

const MISSING_EXECUTABLE_NOTICE =
  "Nenhum executável de Chrome/Chromium encontrado no macOS para o target isolado do computer use.";

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export type MacosChromeExecutableProbe = (candidate: string) => boolean;

export interface MacosComputerProbeOptions {
  /** Candidatos de executável do Chromium (padrão: catálogo canônico do macOS). */
  executableCandidates?: readonly string[];
  /** Somente teste/fake: verificação de existência do executável. */
  hasExecutable?: MacosChromeExecutableProbe;
}

export interface MacosComputerCapabilitySnapshot {
  /** Target isolado do Chrome/Chromium disponível (executável resolvido). */
  available: boolean;
  executable?: string;
  /** Candidatos consultados nesta detecção (diagnóstico estável). */
  executableCandidates: readonly string[];
  /** Permissões TCC obrigatórias reportadas como parte da capacidade. */
  requiredPermissions: readonly MacosComputerPermission[];
  /** Documentação estável das permissões (sempre presente no macOS). */
  permissionsNotice: string;
  /** Mensagem de degradação exibida antes do consentimento (ADR-006). */
  degradationNotice?: string;
}

/** Snapshot de capability do computer use no macOS combinado à sandbox. */
export interface MacosComputerCapabilityResult
  extends MacosComputerCapabilitySnapshot {
  platform: NodeJS.Platform;
  sandbox: SandboxCapabilitySnapshot;
}

function probeSnapshot(
  options?: MacosComputerProbeOptions,
): MacosComputerCapabilitySnapshot {
  const candidates =
    options?.executableCandidates ?? MACOS_CHROME_EXECUTABLE_CANDIDATES;
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
  const notices: string[] = [];
  if (!available) {
    notices.push(MISSING_EXECUTABLE_NOTICE);
  }

  return {
    available,
    executable,
    executableCandidates: candidates,
    requiredPermissions: MACOS_REQUIRED_COMPUTER_PERMISSIONS,
    permissionsNotice: MACOS_PERMISSIONS_NOTICE,
    degradationNotice: notices.length > 0 ? notices.join("; ") : undefined,
  };
}

/** Detecta o executável do target + o catálogo do host macOS. */
export function probeMacosComputerCapability(
  options?: MacosComputerProbeOptions,
): MacosComputerCapabilitySnapshot {
  return probeSnapshot(options);
}

export interface DescribeMacosComputerCapabilityOptions
  extends MacosComputerProbeOptions {
  /** Opções da sandbox nativa (ADR-006), reutilizadas na cadeia da policy. */
  sandboxOptions?: DescribeSandboxCapabilityOptions;
}

/**
 * Combina o snapshot do executável com o nível de sandbox do macOS (ADR-006).
 * O adapter é macOS: a sandbox descrita é sempre a do darwin, mesmo que o
 * chamador não tenha sinalizado plataforma.
 */
export function describeMacosComputerCapability(
  options?: DescribeMacosComputerCapabilityOptions,
): MacosComputerCapabilityResult {
  const sandboxOptions: DescribeSandboxCapabilityOptions = {
    ...options?.sandboxOptions,
    platform: "darwin",
  };
  const sandbox = describeSandboxCapability(sandboxOptions);
  const macos = probeSnapshot(options);
  const notices = [
    (sandbox.level === "degraded" ? sandbox.degradationNotice : undefined),
    macos.degradationNotice,
  ];
  const uniqueNotices = [...new Set(notices.filter(notice => isNonEmpty(notice)))];
  return {
    ...macos,
    degradationNotice:
      uniqueNotices.length > 0 ? uniqueNotices.join("; ") : undefined,
    platform: sandbox.platform,
    sandbox,
  };
}

export type PrepareMacosComputerActionOptions =
  DescribeMacosComputerCapabilityOptions;

export type PreparedMacosComputerAction = ReturnType<
  typeof preparePolicyComputerAction
> & {
  macos: MacosComputerCapabilityResult;
};

/**
 * AUT-02: prepara uma ação de computer use pelo adapter macOS.
 * - plataforma não-macOS: `OUT_OF_SCOPE` estável, sem pedido de permissão;
 * - target indisponível (sem Chrome/Chromium): `INVALID_STATE` estável, sem pedido;
 * - caso válido: mesmo pedido nomeado da task_177 com snapshot macOS anexado.
 */
export function prepareMacosComputerAction(
  flow: RunToolPermissionFlow,
  context: PolicyComputerToolContext,
  input: PreparePolicyComputerActionInput,
  options?: PrepareMacosComputerActionOptions,
): PreparedMacosComputerAction {
  const platform =
    options?.sandboxOptions?.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
      `Adapter do computer use macOS não se aplica à plataforma '${platform}' (disponível apenas em macOS).`,
    );
  }
  const macos = describeMacosComputerCapability(options);
  if (!macos.available) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Computer use indisponível neste host macOS.",
      [macos.degradationNotice ?? MISSING_EXECUTABLE_NOTICE],
    );
  }
  const prepared = preparePolicyComputerAction(
    flow,
    context,
    input,
    options?.sandboxOptions,
  );
  return { ...prepared, macos };
}

/** Processo do target isolado usado pelo adapter macOS. */
export interface MacosComputerWorkerProcess {
  transport: CdpTransport;
  /** Nível de sandbox aplicado ao processo real do target (ADR-006). */
  sandbox?: SandboxCapabilitySnapshot;
  /** Cancelamento: encerra o worker e impede novos dispatches (ADR-006). */
  terminate(): Promise<void>;
}

/** Lançamento entregue aos launchers (injetável em testes). */
export interface MacosComputerTargetLaunch {
  /** Executável Chromium resolvido nesta abertura (diagnóstico). */
  executable: string;
}

export type MacosComputerLaunchWorker = (
  launch: MacosComputerTargetLaunch,
) => Promise<MacosComputerWorkerProcess>;

export interface MacosComputerUseAdapterOptions
  extends DescribeMacosComputerCapabilityOptions {
  /** Somente teste/fixture: injeta o worker em vez de lançar o Chromium real. */
  launchWorker?: MacosComputerLaunchWorker;
  /** Timeout de espera pelo endpoint DevTools do Chrome real. */
  startupTimeoutMs?: number;
}

/**
 * AUT-02: adapter macOS do computer use. Mantém uma única ação autorizada por
 * vez sobre o target Chrome isolado; `terminate()` encerra o worker do SO e
 * impede novos dispatches (ADR-006).
 */
export class MacosComputerUseAdapter {
  private readonly options: MacosComputerUseAdapterOptions;
  private capabilityResult: MacosComputerCapabilityResult | null = null;
  private opening: Promise<ComputerUseSession> | null = null;
  private openedSession: ComputerUseSession | null = null;
  private worker: MacosComputerWorkerProcess | null = null;
  private terminated = false;

  constructor(options?: MacosComputerUseAdapterOptions) {
    this.options = options ?? {};
  }

  /** Snapshot da capability no host (memoizado). */
  get capability(): MacosComputerCapabilityResult {
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
   * Abre (lazily, uma única vez) o target Chrome isolado do macOS e retorna a
   * sessão de uso. Idempotente enquanto aberto; estável via INVALID_STATE
   * quando encerrado ou quando o host não tem executável do Chrome/Chromium.
   */
  async openTarget(): Promise<ComputerUseSession> {
    if (this.terminated && this.openedSession === null) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Adapter do computer use macOS foi encerrado.",
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
    // Chrome é lançado com autorização recusada (OUT_OF_SCOPE estável).
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
      // Encerramento do worker macOS não deve mascarar o estado do adapter.
    }
  }

  private describeCapability(): MacosComputerCapabilityResult {
    return describeMacosComputerCapability({
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
        "Adapter do computer use macOS foi encerrado antes do lançamento do target.",
      );
    }
    if (!capability.available) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Computer use indisponível neste host macOS.",
        [capability.degradationNotice ?? MISSING_EXECUTABLE_NOTICE],
      );
    }

    const executable = capability.executable;
    if (executable === undefined) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Computer use indisponível neste host macOS.",
        [capability.degradationNotice ?? MISSING_EXECUTABLE_NOTICE],
      );
    }

    const worker = this.options.launchWorker
      ? await this.options.launchWorker({
          executable,
        })
      : await this.launchRealTarget();

    if (this.terminated) {
      // Cancelamento chegou durante o lançamento: nunca entrega sessão nova.
      await worker?.terminate();
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Adapter do computer use macOS foi encerrado antes do lançamento do target.",
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

  private async launchRealTarget(): Promise<MacosComputerWorkerProcess> {
    const worker = await launchBrowserWorker({
      executableCandidates:
        this.options.executableCandidates ?? MACOS_CHROME_EXECUTABLE_CANDIDATES,
      sandboxOptions: {
        ...this.options.sandboxOptions,
        // O adapter é macOS: garante que a sandbox descrita seja a do darwin
        // mesmo que o chamador não tenha sinalizado plataforma.
        platform: "darwin",
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
