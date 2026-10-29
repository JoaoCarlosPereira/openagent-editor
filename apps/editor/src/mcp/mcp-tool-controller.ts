import {
  discoverMcpStdioTools,
  discoverMcpHttpTools,
  executePolicyMcpToolInvoke,
  formatAgentMcpToolResult,
  preparePolicyMcpToolInvoke,
  primaryTextFromMcpToolInvocation,
  type McpStdioServerLaunch,
  type McpHttpServerEndpoint,
  type PolicyMcpToolContext,
  type McpToolInvocationResult,
} from "@openagent/tools";
import {
  RunToolPermissionFlow,
  assertRunToolMayExecute,
  type GrantScopeKind,
} from "@openagent/policy";
import type { McpAuthSecretResolver } from "@openagent/tools";
import { ProtocolError } from "@openagent/protocol";

import { buildMcpConfigView, type McpServerConfigInput } from "./mcp-config-view.js";
import { buildMcpToolListView, type McpToolView } from "./mcp-tool-list-view.js";
import { buildMcpToolResultView, buildMcpToolErrorView, type McpToolResultViewSnapshot } from "./mcp-tool-result-view.js";

export interface McpRunResult {
  toolName: string;
  success: true;
  result: McpToolInvocationResult;
  displayText: string;
  origin: "mcp";
  capability: "tool.invoke";
}

export interface McpRunError {
  toolName: string;
  success: false;
  code: string;
  message: string;
  details: unknown[];
}

export type McpExecutionOutcome = McpRunResult | McpRunError;

export interface McpPendingPermission {
  requestId: string;
  runId: string;
  sessionId: string;
  toolName: string;
  prompt: { action: string; target: string };
}

export interface McpToolControllerOptions {
  runId?: string;
  sessionId?: string;
  agentMode?: PolicyMcpToolContext["agentMode"];
  executionMode?: PolicyMcpToolContext["executionMode"];
  permissionFlow?: RunToolPermissionFlow;
  resolveAuth?: McpAuthSecretResolver;
  requestIdFactory?: () => string;
}

function asProtocolError(error: unknown, fallback: string): McpRunError {
  const protocol = error instanceof ProtocolError ? error : undefined;
  return {
    toolName: "",
    success: false,
    code: protocol?.code ?? "INVALID_STATE",
    message: protocol?.message ?? fallback,
    details: protocol?.details ?? (error instanceof Error ? [error.message] : [String(error)]),
  };
}

/** MCP-01: configura servidores, lista ferramentas e executa somente após permissão explícita. */
export class McpToolController {
  private currentConfig: McpServerConfigInput | undefined;
  private currentTools: readonly McpToolView[] = [];
  private currentServerId = "";
  private currentTransport: "stdio" | "http" | null = null;
  private pendingPermission: McpPendingPermission | undefined;
  private readonly permissionFlow: RunToolPermissionFlow;
  private readonly context: PolicyMcpToolContext;
  private readonly runId: string;
  private readonly sessionId: string;
  private readonly resolveAuth: McpToolControllerOptions["resolveAuth"];
  private readonly requestIdFactory: () => string;

  constructor(options: McpToolControllerOptions = {}) {
    this.permissionFlow = options.permissionFlow ?? new RunToolPermissionFlow();
    this.context = {
      agentMode: options.agentMode ?? "agent",
      executionMode: options.executionMode ?? "standard",
    };
    this.runId = options.runId ?? "mcp-ui-run";
    this.sessionId = options.sessionId ?? "mcp-ui-session";
    this.resolveAuth = options.resolveAuth;
    this.requestIdFactory = options.requestIdFactory ?? (() => `mcp-permission-${crypto.randomUUID()}`);
  }

  get serverId(): string { return this.currentServerId; }
  get transport(): "stdio" | "http" | null { return this.currentTransport; }
  get toolNames(): readonly string[] { return this.currentTools.map((tool) => tool.name); }
  get pendingPermissionRequest(): McpPendingPermission | undefined { return this.pendingPermission; }
  get permissionState(): RunToolPermissionFlow { return this.permissionFlow; }

  private currentResultView: McpToolResultViewSnapshot | null = null;

  get snapshot() {
    return {
      configView: this.currentConfig ? buildMcpConfigView(this.currentConfig) : null,
      toolListView: this.currentTransport !== null
        ? buildMcpToolListView({
            serverId: this.currentServerId,
            transport: this.currentTransport,
            tools: this.currentTools,
          })
        : null,
      tools: this.currentTools,
      pendingPermission: this.pendingPermission,
      resultView: this.currentResultView,
    };
  }

  configure(input: unknown): ReturnType<typeof buildMcpConfigView> {
    if (!input || typeof input !== "object") {
      throw new ProtocolError("INVALID_STATE", "Configuração do servidor MCP inválida.", []);
    }
    const typed = input as Record<string, unknown>;
    if (typed.kind !== "stdio" && typed.kind !== "http") {
      throw new ProtocolError("INVALID_STATE", "Tipo de transporte MCP deve ser 'stdio' ou 'http'.", []);
    }
    const serverId = typeof typed.serverId === "string" ? typed.serverId.trim() : "";
    if (!serverId) {
      throw new ProtocolError("INVALID_STATE", "Identificador do servidor MCP é obrigatório.", []);
    }

    const config: McpServerConfigInput = {
      kind: typed.kind,
      serverId,
      ...(typeof typed.command === "string" ? { command: typed.command } : {}),
      ...(Array.isArray(typed.args) && typed.args.every((arg) => typeof arg === "string")
        ? { args: typed.args }
        : {}),
      ...(typed.env !== undefined && typeof typed.env === "object" && typed.env !== null && !Array.isArray(typed.env)
        ? { env: typed.env as Record<string, string> }
        : {}),
      ...(typeof typed.cwd === "string" ? { cwd: typed.cwd } : {}),
      ...(typeof typed.url === "string" ? { url: typed.url } : {}),
      ...(typed.headers !== undefined && typeof typed.headers === "object" && typed.headers !== null && !Array.isArray(typed.headers)
        ? { headers: typed.headers as Record<string, string> }
        : {}),
      ...(typeof typed.authSecretRef === "string" ? { authSecretRef: typed.authSecretRef } : {}),
    };

    // Validate fully before mutating state: invalid config has no side effect.
    const view = buildMcpConfigView(config);
    this.currentConfig = config;
    this.currentTools = [];
    this.currentServerId = serverId;
    this.currentTransport = typed.kind;
    this.pendingPermission = undefined;
    this.currentResultView = null;
    return view;
  }

  async discoverTools(): Promise<ReturnType<typeof buildMcpToolListView>> {
    const config = this.requireConfig();
    try {
      const result = config.kind === "stdio"
        ? await discoverMcpStdioTools(this.stdioServer(config), { resolveAuth: this.resolveAuth })
        : await discoverMcpHttpTools(this.httpServer(config), { resolveAuth: this.resolveAuth });
      this.currentTools = result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      return this.getToolListView() ?? null;
    } catch (error) {
      throw error instanceof ProtocolError
        ? error
        : new ProtocolError("INVALID_STATE", `Falha ao conectar ao servidor MCP '${this.currentServerId}'.`, [
            error instanceof Error ? error.message : String(error),
          ]);
    }
  }

  getToolListView(): ReturnType<typeof buildMcpToolListView> | null {
    if (this.currentTransport === null) return null;
    return buildMcpToolListView({
      serverId: this.currentServerId,
      transport: this.currentTransport,
      tools: this.currentTools,
    });
  }

  getAvailableTools(): readonly McpToolView[] { return this.currentTools; }

  requestToolPermission(toolName: unknown): McpPendingPermission {
    const name = typeof toolName === "string" ? toolName.trim() : "";
    if (!name || !this.currentTools.some((tool) => tool.name === name)) {
      throw new ProtocolError("INVALID_STATE", "Ferramenta MCP não encontrada entre as ferramentas listadas.", [
        `toolName=${String(toolName)}`,
      ]);
    }
    if (this.pendingPermission) {
      throw new ProtocolError("INVALID_STATE", "Já existe uma solicitação de permissão MCP pendente.", []);
    }
    const prepared = preparePolicyMcpToolInvoke(this.permissionFlow, this.context, {
      runId: this.runId,
      sessionId: this.sessionId,
      requestId: this.requestIdFactory(),
      serverId: this.currentServerId,
      toolName: name,
    });
    if (prepared.permission.phase !== "pending") {
      throw new ProtocolError("INVALID_STATE", "A solicitação de permissão MCP não ficou pendente.", []);
    }
    const request = prepared.permission;
    this.pendingPermission = {
      requestId: request.request.requestId,
      runId: this.runId,
      sessionId: this.sessionId,
      toolName: name,
      prompt: request.prompt,
    };
    return this.pendingPermission;
  }

  async decideAndRun(input: {
    decision: "allow" | "deny";
    scope?: GrantScopeKind;
    arguments?: unknown;
  }): Promise<McpExecutionOutcome> {
    const pending = this.pendingPermission;
    if (!pending) {
      throw new ProtocolError("INVALID_STATE", "Nenhuma permissão MCP pendente.", []);
    }
    const toolName = pending.toolName;
    const request = this.permissionFlow.getPending(pending.requestId);
    if (!request) {
      this.pendingPermission = undefined;
      throw new ProtocolError("INVALID_STATE", "Pedido de permissão MCP não encontrado.", []);
    }
    const decision = this.permissionFlow.decide(
      pending.requestId,
      input.decision,
      input.scope ?? "once",
    );
    this.pendingPermission = undefined;
    if (input.decision !== "allow") {
      return {
        toolName,
        success: false,
        code: "PERMISSION_DENIED",
        message: "Execução da ferramenta MCP recusada.",
        details: [],
      };
    }
    assertRunToolMayExecute(decision.gate);

    try {
      const config = this.requireConfig();
      const result = await executePolicyMcpToolInvoke({
        transport: config.kind,
        server: config.kind === "stdio" ? this.stdioServer(config) : this.httpServer(config),
        toolName,
        ...(input.arguments !== undefined ? { arguments: input.arguments } : {}),
      });
      const formatted = formatAgentMcpToolResult(result);
      this.currentResultView = buildMcpToolResultView(result);
      return {
        toolName,
        success: true,
        result,
        displayText: primaryTextFromMcpToolInvocation(result),
        origin: formatted.origin,
        capability: formatted.capability,
      };
    } catch (error) {
      const normalized = asProtocolError(error, "Falha ao executar ferramenta MCP.");
      this.currentResultView = buildMcpToolErrorView(toolName, normalized.code, normalized.message);
      return { ...normalized, toolName };
    }
  }

  /** Compatibilidade para chamada não autorizada: recusa sem executar. */
  runTool(toolName: unknown): McpExecutionOutcome {
    const name = typeof toolName === "string" ? toolName.trim() : "";
    return {
      toolName: name || "(desconhecida)",
      success: false,
      code: "PERMISSION_DENIED",
      message: "Solicite e aceite permissão antes de executar a ferramenta MCP.",
      details: [],
    };
  }

  private requireConfig(): McpServerConfigInput {
    if (!this.currentConfig) {
      throw new ProtocolError("INVALID_STATE", "Nenhuma configuração de servidor MCP definida.", []);
    }
    return this.currentConfig;
  }

  private stdioServer(config: McpServerConfigInput): McpStdioServerLaunch {
    if (config.kind !== "stdio") {
      throw new ProtocolError("INVALID_STATE", "Transporte MCP não é stdio.", []);
    }
    return {
      serverId: config.serverId,
      command: config.command ?? "",
      args: [...(config.args ?? [])],
      ...(config.env ? { env: config.env } : {}),
      ...(config.cwd ? { cwd: config.cwd } : {}),
      ...(config.authSecretRef ? { authSecretRef: config.authSecretRef } : {}),
    };
  }

  private httpServer(config: McpServerConfigInput): McpHttpServerEndpoint {
    if (config.kind !== "http") {
      throw new ProtocolError("INVALID_STATE", "Transporte MCP não é HTTP.", []);
    }
    return {
      serverId: config.serverId,
      url: config.url ?? "",
      ...(config.headers ? { headers: config.headers } : {}),
      ...(config.authSecretRef ? { authSecretRef: config.authSecretRef } : {}),
    };
  }
}
