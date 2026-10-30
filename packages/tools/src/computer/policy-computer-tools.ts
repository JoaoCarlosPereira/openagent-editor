import {
  assertCapabilityAllowedForAgentMode,
  RunToolPermissionFlow,
  type ExecutionMode,
} from "@openagent/policy";
import {
  ProtocolError,
  PROTOCOL_ERROR_CODES,
  type AgentMode,
} from "@openagent/protocol";

import {
  MOCK_SCREENSHOT_BASE64,
  TimedCdpTransport,
} from "../browser/cdp-transport.js";
import type { CdpTransport } from "../browser/types.js";
import type { DescribeSandboxCapabilityOptions } from "../sandbox/sandbox-capability.js";
import {
  prepareSandboxToolDispatch,
  type SandboxToolDispatchPrepareResult,
} from "../sandbox/tool-sandbox-dispatch.js";

import type {
  ComputerActionInput,
  ComputerActionType,
} from "./index.js";

/**
 * AUT-02: capability nomeada do computer use.
 * Cada ação precisa da autorização explicitamente nomeada antes de executar.
 */
export const COMPUTER_USE_CAPABILITY = "computer.use";

export type ComputerUseCapability = typeof COMPUTER_USE_CAPABILITY;

/** PNG 1x1 transparente mínimo em base64 reexportado como captura padrão de teste. */
export { MOCK_SCREENSHOT_BASE64 as COMPUTER_SCREENSHOT_MOCK_BASE64 };

const MOUSE_ACTIONS: ReadonlySet<ComputerActionType> = new Set([
  "mouse_move",
  "mouse_click",
  "mouse_down",
  "mouse_up",
]);

const KEY_ACTIONS: ReadonlySet<ComputerActionType> = new Set([
  "key_press",
  "key_down",
  "key_up",
]);

const MOUSE_BUTTONS: ReadonlySet<string> = new Set(["left", "right", "middle"]);

const MAX_COORDINATE = 100_000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidActionError(details: string[]): ProtocolError {
  return new ProtocolError(
    PROTOCOL_ERROR_CODES.INVALID_STATE,
    "Ação do computer use inválida.",
    details,
  );
}

function validateCoordinate(raw: unknown, details: string[]): { x: number; y: number } | undefined {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    typeof (raw as Record<string, unknown>)["x"] !== "number" ||
    typeof (raw as Record<string, unknown>)["y"] !== "number"
  ) {
    details.push("Ações de mouse exigem coordenada com campos numéricos 'x' e 'y'.");
    return undefined;
  }
  const { x, y } = raw as { x: number; y: number };
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x > MAX_COORDINATE ||
    y > MAX_COORDINATE
  ) {
    details.push(`Coordenada fora do intervalo suportado (0..${MAX_COORDINATE}).`);
    return undefined;
  }
  return { x, y };
}

/**
 * AUT-02: valida e normaliza a entrada da ação antes de qualquer efeito colateral.
 * Entrada inválida retorna erro estável INVALID_STATE, sem eventos CDP enviados.
 */
export function validateComputerAction(raw: unknown): ComputerActionInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalidActionError(["Ação deve ser um objeto com campo 'action'."]);
  }
  const input = raw as Record<string, unknown>;
  const action = input["action"];
  if (!isNonEmptyString(action)) {
    throw invalidActionError(["Campo 'action' ausente ou inválido."]);
  }
  const details: string[] = [];
  const known = new Set<ComputerActionType>([...MOUSE_ACTIONS, ...KEY_ACTIONS, "screenshot"]);
  if (!(known as ReadonlySet<string>).has(action)) {
    throw invalidActionError([`Tipo de ação '${action}' não é suportado.`]);
  }

  const buttonRaw = typeof input["button"] === "string" ? input["button"] : "left";
  let button: "left" | "right" | "middle" | undefined;
  if (MOUSE_ACTIONS.has(action as ComputerActionType) && action !== "mouse_move") {
    if (!(MOUSE_BUTTONS as ReadonlySet<string>).has(buttonRaw)) {
      throw invalidActionError([`Botão do mouse '${buttonRaw}' não é suportado.`]);
    }
    button = buttonRaw as "left" | "right" | "middle";
  }

  const coordinate = validateCoordinate(input["coordinate"], details);
  if (MOUSE_ACTIONS.has(action as ComputerActionType) && !coordinate) {
    throw invalidActionError(details);
  }

  const key = typeof input["key"] === "string" ? input["key"].trim() : undefined;
  const text = typeof input["text"] === "string" ? input["text"] : undefined;
  if (KEY_ACTIONS.has(action as ComputerActionType) && !isNonEmptyString(key) && !isNonEmptyString(text)) {
    throw invalidActionError(["Ações de teclado exigem campo 'key' ou 'text' não-vazio."]);
  }

  const normalized: ComputerActionInput = { action: action as ComputerActionType };
  if (coordinate) normalized.coordinate = coordinate;
  if (button) normalized.button = button;
  if (key) normalized.key = key;
  if (text !== undefined && text.length > 0) normalized.text = text;
  return normalized;
}

/**
 * AUT-02: nome canônico que identifica exatamente a ação.
 * O pedido de permissão carrega esse nome — a autorização é válida só para essa ação.
 */
export function computerActionName(input: ComputerActionInput): string {
  const parts: string[] = [input.action];
  if (input.coordinate) {
    parts.push(`coordinate:${input.coordinate.x},${input.coordinate.y}`);
  }
  if (input.button) {
    parts.push(`button:${input.button}`);
  }
  if (input.key) {
    parts.push(`key:${input.key}`);
  }
  if (input.text) {
    parts.push(`text:${input.text}`);
  }
  return parts.join(" ");
}

/**
 * AUT-02: rótulo legível exibido no diálogo de permissão.
 */
export function formatComputerActionLabel(input: ComputerActionInput): string {
  switch (input.action) {
    case "screenshot":
      return "capturar a tela";
    case "mouse_move":
      return `mover o mouse para (${input.coordinate?.x}, ${input.coordinate?.y})`;
    case "mouse_click":
      return `clicar com o botão ${input.button ?? "left"} em (${input.coordinate?.x}, ${input.coordinate?.y})`;
    case "mouse_down":
      return `pressionar o botão ${input.button ?? "left"} em (${input.coordinate?.x}, ${input.coordinate?.y})`;
    case "mouse_up":
      return `soltar o botão ${input.button ?? "left"} em (${input.coordinate?.x}, ${input.coordinate?.y})`;
    case "key_press":
      return `pressionar a tecla ${input.key ?? input.text}`;
    case "key_down":
      return `manter pressionada a tecla ${input.key ?? input.text}`;
    case "key_up":
      return `soltar a tecla ${input.key ?? input.text}`;
    default: {
      const _exhaustive: never = input.action;
      return _exhaustive;
    }
  }
}

interface CdpCall {
  method: string;
  params: Record<string, unknown>;
}

function mouseEventParams(
  type: string,
  input: ComputerActionInput,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    type,
    x: input.coordinate?.x ?? 0,
    y: input.coordinate?.y ?? 0,
    button: input.button ?? "left",
    clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
  };
  if (type === "mouseMoved") {
    delete params["button"];
    delete params["clickCount"];
  }
  return params;
}

function keyEventParams(
  type: string,
  input: ComputerActionInput,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    type,
    key: input.key ?? input.text ?? "",
  };
  if (type === "char") {
    params["text"] = input.text ?? "";
    delete params["key"];
  }
  return params;
}

/**
 * AUT-02: eventos CDP do Chromium/Electron correspondentes a uma única ação autorizada.
 */
export function computerActionCdpCalls(input: ComputerActionInput): readonly CdpCall[] {
  switch (input.action) {
    case "mouse_move":
      return [{ method: "Input.dispatchMouseEvent", params: mouseEventParams("mouseMoved", input) }];
    case "mouse_down":
      return [{ method: "Input.dispatchMouseEvent", params: mouseEventParams("mousePressed", input) }];
    case "mouse_up":
      return [{ method: "Input.dispatchMouseEvent", params: mouseEventParams("mouseReleased", input) }];
    case "mouse_click":
      return [
        { method: "Input.dispatchMouseEvent", params: mouseEventParams("mousePressed", input) },
        { method: "Input.dispatchMouseEvent", params: mouseEventParams("mouseReleased", input) },
      ];
    case "key_down":
      return [{ method: "Input.dispatchKeyEvent", params: keyEventParams("keyDown", input) }];
    case "key_up":
      return [{ method: "Input.dispatchKeyEvent", params: keyEventParams("keyUp", input) }];
    case "key_press": {
      if (input.text && !input.key) {
        return [
          { method: "Input.dispatchKeyEvent", params: keyEventParams("keyDown", input) },
          { method: "Input.dispatchKeyEvent", params: keyEventParams("char", { ...input, text: input.text }) },
          { method: "Input.dispatchKeyEvent", params: keyEventParams("keyUp", { ...input, text: input.text }) },
        ];
      }
      const keyInput: ComputerActionInput = { action: "key_press", key: input.key ?? input.text ?? "" };
      return [
        { method: "Input.dispatchKeyEvent", params: keyEventParams("keyDown", keyInput) },
        { method: "Input.dispatchKeyEvent", params: keyEventParams("keyUp", keyInput) },
      ];
    }
    case "screenshot":
      return [];
    default: {
      // Exhaustiveness: novas ComputerActionType exigem um novo case acima.
      return [];
    }
  }
}

export interface PolicyComputerToolContext {
  agentMode: AgentMode;
  executionMode: ExecutionMode;
}

export interface PreparePolicyComputerActionInput {
  runId: string;
  sessionId: string;
  requestId: string;
  action: unknown;
}

export interface ComputerActionAuthorization {
  flow: RunToolPermissionFlow;
  requestId: string;
}

export interface PolicyComputerActionResult {
  capability: ComputerUseCapability;
  tool: "computer.use";
  action: ComputerActionType;
  actionName: string;
  actionLabel: string;
  executed: true;
  screenshot: string;
  screenshotMimeType: "image/png";
  cdpCalls: readonly string[];
  timestamp: number;
}

export interface AgentComputerToolInvocationResult {
  capability: ComputerUseCapability;
  tool: "computer.use";
  action: ComputerActionType;
  actionName: string;
  actionLabel: string;
  screenshotLength: number;
  cdpCallCount: number;
}

/**
 * AUT-02: prepara o pedido de permissão nomeando a ação exata a executar.
 * O alvo é do tipo resource com o nome canônico da ação — a permissão vale só para ela.
 */
export function preparePolicyComputerAction(
  flow: RunToolPermissionFlow,
  context: PolicyComputerToolContext,
  input: PreparePolicyComputerActionInput,
  sandboxOptions?: DescribeSandboxCapabilityOptions,
): SandboxToolDispatchPrepareResult {
  assertCapabilityAllowedForAgentMode(context.agentMode, COMPUTER_USE_CAPABILITY);
  const action = validateComputerAction(input.action);
  return prepareSandboxToolDispatch(
    flow,
    {
      runId: input.runId,
      sessionId: input.sessionId,
      executionMode: context.executionMode,
      capability: COMPUTER_USE_CAPABILITY,
      target: { kind: "resource", label: computerActionName(action) },
      requestId: input.requestId,
    },
    sandboxOptions,
  );
}

/**
 * AUT-02: sessão de uso do computador sobre um transporte CDP exclusivo.
 * Garante uma única ação por vez: enquanto uma ação está em execução, novas
 * chamadas retornam erro estável e não executam nada.
 */
export class ComputerUseSession {
  private inflight: Promise<PolicyComputerActionResult> | null = null;

  constructor(
    private readonly transport: CdpTransport,
    private readonly defaultTimeoutMs?: number,
  ) {}

  get busy(): boolean {
    return this.inflight !== null;
  }

  /**
   * Executa a ação já autorizada; recusa com INVALID_STATE se outra ação está em andamento.
   */
  async run(input: ComputerActionInput, timeoutMs?: number): Promise<PolicyComputerActionResult> {
    if (this.inflight) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Computer use executa uma ação por vez; aguarde a ação em curso terminar.",
      );
    }
    const execution = this.executeAndClear(input, timeoutMs);
    this.inflight = execution;
    return execution;
  }

  private async executeAndClear(
    input: ComputerActionInput,
    timeoutMs?: number,
  ): Promise<PolicyComputerActionResult> {
    try {
      return await this.dispatchAction(input, timeoutMs);
    } finally {
      this.inflight = null;
    }
  }

  private async dispatchAction(
    input: ComputerActionInput,
    timeoutMs?: number,
  ): Promise<PolicyComputerActionResult> {
    const action = validateComputerAction(input);
    const actionName = computerActionName(action);
    if (this.transport.isClosed()) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Transporte CDP do computer use está encerrado.",
      );
    }
    const resolvedTimeout = timeoutMs ?? this.defaultTimeoutMs;
    if (resolvedTimeout !== undefined && (!Number.isFinite(resolvedTimeout) || resolvedTimeout <= 0)) {
      throw invalidActionError(["Timeout da ação inválido."]);
    }
    const timed = resolvedTimeout !== undefined
      ? new TimedCdpTransport(this.transport, resolvedTimeout)
      : this.transport;

    const calls = computerActionCdpCalls(action);
    const cdpCalls: string[] = [];
    for (const call of calls) {
      await timed.send(call.method, call.params);
      cdpCalls.push(call.method);
    }

    const screenshotRes = await timed.send("Page.captureScreenshot", { format: "png" });
    cdpCalls.push("Page.captureScreenshot");
    const screenshot = String(screenshotRes["data"] ?? "");
    if (!screenshot) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Falha ao capturar o resultado da ação do computer use (screenshot vazio).",
      );
    }

    return {
      capability: COMPUTER_USE_CAPABILITY,
      tool: "computer.use",
      action: action.action,
      actionName,
      actionLabel: formatComputerActionLabel(action),
      executed: true,
      screenshot,
      screenshotMimeType: "image/png",
      cdpCalls,
      timestamp: Date.now(),
    };
  }
}

/**
 * AUT-02: executa uma única ação de computer use sob decisão de permissão nomeada.
 * Sem decisão, com negação, com nome de ação divergente ou com outra ação em
 * andamento, retorna erro estável sem efeito colateral no transporte.
 */
export async function executePolicyComputerAction(
  session: ComputerUseSession,
  input: { action: unknown },
  authorization?: ComputerActionAuthorization,
): Promise<PolicyComputerActionResult> {
  const action = validateComputerAction(input.action);
  const actionName = computerActionName(action);

  if (!authorization?.requestId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Computer use exige uma decisão de autorização para a ação nomeada.",
    );
  }
  if (session.busy) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Computer use executa uma ação por vez; aguarde a ação em curso terminar.",
    );
  }

  const authorizedRequest = authorization.flow.consumeAuthorizedRequest(authorization.requestId);
  if (
    !authorizedRequest ||
    authorizedRequest.capability !== COMPUTER_USE_CAPABILITY ||
    authorizedRequest.target.kind !== "resource" ||
    authorizedRequest.target.label !== actionName
  ) {
    const denied = authorization.flow.wasDenied(authorization.requestId);
    throw new ProtocolError(
      denied ? PROTOCOL_ERROR_CODES.OUT_OF_SCOPE : PROTOCOL_ERROR_CODES.INVALID_STATE,
      denied
        ? "Ação do computer use foi recusada."
        : "A decisão de autorização não corresponde à ação solicitada.",
    );
  }

  return session.run(action);
}

/**
 * AUT-02: formata o resultado para exibição e consumo no painel do agente.
 */
export function formatAgentComputerToolResult(
  result: PolicyComputerActionResult,
): AgentComputerToolInvocationResult {
  return {
    capability: result.capability,
    tool: result.tool,
    action: result.action,
    actionName: result.actionName,
    actionLabel: result.actionLabel,
    screenshotLength: result.screenshot.length,
    cdpCallCount: result.cdpCalls.length,
  };
}
