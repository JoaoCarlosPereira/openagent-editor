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

import type { DescribeSandboxCapabilityOptions } from "../sandbox/sandbox-capability.js";
import {
  prepareSandboxToolDispatch,
  type SandboxToolDispatchPrepareResult,
} from "../sandbox/tool-sandbox-dispatch.js";
import { validateBrowserUrl } from "./browser-url-policy.js";
import type { CdpTargetManager } from "./cdp-target-manager.js";
import type {
  BrowserCdpToolResult,
  BrowserConsoleLogEntry,
  BrowserInteraction,
  BrowserUrlPolicyOptions,
  OpenAuthorizedBrowserUrlInput,
} from "./types.js";

export interface PolicyBrowserToolContext extends BrowserUrlPolicyOptions {
  agentMode: AgentMode;
  executionMode: ExecutionMode;
}

export interface PreparePolicyBrowserOpenInput {
  runId: string;
  sessionId: string;
  requestId: string;
  url: unknown;
  interaction?: unknown;
}

export interface AgentBrowserToolInvocationResult {
  capability: "browser.open";
  tool: "browser.open";
  url: string;
  targetId: string;
  browserContextId: string;
  title: string;
  screenshotLength: number;
  consoleLogCount: number;
  consoleLogs: readonly BrowserConsoleLogEntry[];
  interactionResult?: unknown;
}

function validateInteraction(raw: unknown): BrowserInteraction | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Interação do navegador inválida.",
    );
  }

  const interaction = raw as Record<string, unknown>;
  switch (interaction["type"]) {
    case "none":
      return { type: "none" };
    case "evaluate":
      if (
        typeof interaction["expression"] !== "string" ||
        !interaction["expression"].trim()
      ) {
        throw new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "Expressão de interação do navegador inválida.",
        );
      }
      return { type: "evaluate", expression: interaction["expression"] };
    case "click":
      if (
        typeof interaction["selector"] !== "string" ||
        !interaction["selector"].trim()
      ) {
        throw new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "Seletor de interação do navegador inválido.",
        );
      }
      return { type: "click", selector: interaction["selector"] };
    case "type":
      if (
        typeof interaction["selector"] !== "string" ||
        !interaction["selector"].trim() ||
        typeof interaction["text"] !== "string"
      ) {
        throw new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "Entrada de digitação do navegador inválida.",
        );
      }
      return {
        type: "type",
        selector: interaction["selector"],
        text: interaction["text"],
      };
    default:
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Tipo de interação do navegador não suportado.",
      );
  }
}

/**
 * AUT-01 + PER-01/PER-03: Prepara a abertura de URL no navegador com validação de policy e target.
 */
export function preparePolicyBrowserOpen(
  flow: RunToolPermissionFlow,
  context: PolicyBrowserToolContext,
  input: PreparePolicyBrowserOpenInput,
  sandboxOptions?: DescribeSandboxCapabilityOptions,
): SandboxToolDispatchPrepareResult {
  assertCapabilityAllowedForAgentMode(context.agentMode, "browser.open");
  const validatedUrl = validateBrowserUrl(input.url, context);
  const interaction = validateInteraction(input.interaction);

  return prepareSandboxToolDispatch(
    flow,
    {
      runId: input.runId,
      sessionId: input.sessionId,
      executionMode: context.executionMode,
      capability: "browser.open",
      target: {
        kind: "url",
        url: interaction
          ? `${validatedUrl} [interaction:${interaction.type}]`
          : validatedUrl,
      },
      requestId: input.requestId,
    },
    sandboxOptions,
  );
}

/**
 * AUT-01: Executa abertura de URL autorizada no CDP em target isolado.
 * Abre o navegador em contexto isolado, navega, executa interação autorizada se solicitada,
 * e captura screenshot e mensagens de console.
 */
export async function executePolicyBrowserOpen(
  targetManager: CdpTargetManager,
  input: OpenAuthorizedBrowserUrlInput,
  policyOptions?: BrowserUrlPolicyOptions,
): Promise<BrowserCdpToolResult> {
  const validatedUrl = validateBrowserUrl(input.url, policyOptions);
  const interaction = validateInteraction(input.interaction);
  const timeoutMs = input.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Timeout de navegação inválido.",
    );
  }

  const targetSession = await targetManager.createIsolatedTarget(validatedUrl);
  const transport = targetManager.getTransport();
  const consoleLogs: BrowserConsoleLogEntry[] = [];

  const offConsole = transport.on(
    "Runtime.consoleAPICalled",
    (params, sid) => {
      if (sid === targetSession.sessionId) {
        const logType =
          (params["type"] as BrowserConsoleLogEntry["type"]) ?? "log";
        const args = Array.isArray(params["args"]) ? params["args"] : [];
        const firstArg = args[0] as { value?: unknown } | undefined;
        const text =
          typeof firstArg?.value === "string"
            ? firstArg.value
            : JSON.stringify(firstArg ?? "");
        consoleLogs.push({
          type: logType,
          text,
          timestamp: (params["timestamp"] as number) ?? Date.now(),
          args,
        });
      }
    },
  );

  const offConsoleMsg = transport.on(
    "Console.messageAdded",
    (params, sid) => {
      if (sid === targetSession.sessionId) {
        const msg = (params["message"] ?? {}) as Record<string, unknown>;
        const text = String(msg["text"] ?? "");
        const level = (msg["level"] as BrowserConsoleLogEntry["type"]) ?? "log";
        consoleLogs.push({
          type: level,
          text,
          timestamp: Date.now(),
        });
      }
    },
  );

  try {
    await transport.send("Page.enable", {}, targetSession.sessionId);
    await transport.send("Runtime.enable", {}, targetSession.sessionId);
    await transport.send("Console.enable", {}, targetSession.sessionId);

    await transport.send(
      "Page.navigate",
      { url: validatedUrl },
      targetSession.sessionId,
    );

    let interactionResult: unknown = undefined;
    if (interaction && interaction.type !== "none") {
      let expression: string;
      switch (interaction.type) {
        case "evaluate":
          if (!interaction.expression?.trim()) {
            throw new ProtocolError(
              PROTOCOL_ERROR_CODES.INVALID_STATE,
              "Expressão de interação do navegador inválida.",
            );
          }
          expression = interaction.expression;
          break;
        case "click":
          expression = `(() => { const element = document.querySelector(${JSON.stringify(interaction.selector ?? "")}); if (!element) throw new Error("Elemento não encontrado"); element.click(); return true; })()`;
          break;
        case "type":
          expression = `(() => { const element = document.querySelector(${JSON.stringify(interaction.selector ?? "")}); if (!element) throw new Error("Elemento não encontrado"); element.value = ${JSON.stringify(interaction.text ?? "")}; element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`;
          break;
        default:
          throw new ProtocolError(
            PROTOCOL_ERROR_CODES.INVALID_STATE,
            "Tipo de interação não suportado.",
          );
      }

      const evalRes = await transport.send(
        "Runtime.evaluate",
        {
          expression,
          returnByValue: true,
          awaitPromise: true,
        },
        targetSession.sessionId,
      );
      if (evalRes["exceptionDetails"]) {
        throw new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "A interação autorizada falhou no target do navegador.",
          [JSON.stringify(evalRes["exceptionDetails"])],
        );
      }
      interactionResult = evalRes["result"];
    }

    const screenshotRes = await transport.send(
      "Page.captureScreenshot",
      { format: "png" },
      targetSession.sessionId,
    );
    const screenshot = String(screenshotRes["data"] ?? "");

    let title = "Página em target isolado";
    try {
      const titleRes = await transport.send(
        "Runtime.evaluate",
        { expression: "document.title" },
        targetSession.sessionId,
      );
      const titleObj = titleRes["result"] as { value?: unknown } | undefined;
      if (typeof titleObj?.value === "string" && titleObj.value.trim()) {
        title = titleObj.value.trim();
      }
    } catch {
      // Ignora erro de título
    }

    return {
      capability: "browser.open",
      tool: "browser.open",
      url: validatedUrl,
      targetId: targetSession.targetId,
      browserContextId: targetSession.browserContextId,
      sessionId: targetSession.sessionId,
      title,
      screenshot,
      consoleLogs: [...consoleLogs],
      interactionResult,
    };
  } finally {
    offConsole();
    offConsoleMsg();
  }
}

/**
 * AUT-01: Formata resultado para exibição e consumo no painel do agente.
 */
export function formatAgentBrowserToolResult(
  result: BrowserCdpToolResult,
): AgentBrowserToolInvocationResult {
  return {
    capability: "browser.open",
    tool: "browser.open",
    url: result.url,
    targetId: result.targetId,
    browserContextId: result.browserContextId,
    title: result.title,
    screenshotLength: result.screenshot.length,
    consoleLogCount: result.consoleLogs.length,
    consoleLogs: result.consoleLogs,
    interactionResult: result.interactionResult,
  };
}
