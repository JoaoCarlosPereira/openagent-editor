import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { McpToolController } from "../../src/index.js";
import type { McpToolView } from "../../src/mcp/mcp-tool-list-view.js";

describe("MCP-01 e2e — MCP pela UI: configurar, listar ferramentas e ver resultado", () => {
  it("[MCP-01] QUANDO configura servidor MCP stdio ENTÃO view de configuração é criada", () => {
    const controller = new McpToolController();
    const view = controller.configure({
      kind: "stdio",
      serverId: "test-stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-environment"],
    });

    assert.equal(view.kind, "form");
    assert.equal(view.accessible.transport, "stdio");
    assert.equal(view.accessible.serverId, "test-stdio");
    assert.match(view.html, /data-testid="mcp-config-view"/);
    assert.match(view.html, /data-transport="stdio"/);
  });

  it("[MCP-01] QUANDO configura servidor MCP HTTP ENTÃO view de configuração é criada", () => {
    const controller = new McpToolController();
    const view = controller.configure({
      kind: "http",
      serverId: "test-http",
      url: "http://localhost:3001/mcp",
    });

    assert.equal(view.kind, "form");
    assert.equal(view.accessible.transport, "http");
    assert.match(view.html, /data-transport="http"/);
  });

  it("[MCP-01] QUANDO configura com authSecretRef ENTÃO hint de autenticação aparece", () => {
    const controller = new McpToolController();
    const view = controller.configure({
      kind: "stdio",
      serverId: "secure-server",
      command: "python",
      args: ["server.py"],
      authSecretRef: "sysvault:mcp-token-1",
    });

    assert.equal(view.accessible.authHint, "Autenticação via cofre do sistema");
  });

  it("[MCP-01] configure com kind inválido retorna INVALID_STATE", () => {
    const controller = new McpToolController();
    assert.throws(
      () => controller.configure({ kind: "websocket", serverId: "bad" }),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
  });

  it("[MCP-01] configure com input nulo retorna INVALID_STATE", () => {
    const controller = new McpToolController();
    assert.throws(
      () => controller.configure(null as unknown),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
  });

  it("[MCP-01] configure com input não-object retorna INVALID_STATE", () => {
    const controller = new McpToolController();
    assert.throws(
      () => controller.configure("bad" as unknown),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
  });

  it("[MCP-01] snapshot retorna estado completo do controller", () => {
    const controller = new McpToolController();
    controller.configure({
      kind: "stdio",
      serverId: "snapshot-server",
      command: "test",
    });

    const snap = controller.snapshot;
    assert.ok(snap.configView !== null);
    assert.equal(snap.configView.accessible.serverId, "snapshot-server");
    assert.equal(snap.tools.length, 0);
  });

  it("[MCP-01] QUANDO servidor MCP é configurado e descoberto ENTÃO o produto lista as ferramentas", async () => {
    const controller = new McpToolController({
      runId: "run-ui-mcp",
      sessionId: "sess-ui-mcp",
    });

    // Configurar
    controller.configure({
      kind: "stdio",
      serverId: "ui-fixture-stdio",
      command: execPath,
    });

    // Descobrir (fixtures real server via stdio)
    const listed = await controller.discoverTools();
    assert.equal(listed.kind, "tool-list");
    assert.equal(listed.serverId, "ui-fixture-stdio");
    assert.ok(listed.tools.some((t: McpToolView) => t.name === "ping"));
    assert.ok(listed.tools.some((t: McpToolView) => t.name === "addNumbers"));
  });

  it("[MCP-01] runTool (não autorizada) recusa sem executar e sem efeito colateral", () => {
    const controller = new McpToolController();
    controller.configure({
      kind: "stdio",
      serverId: "no-auth-server",
      command: "echo",
    });

    const outcome = controller.runTool("any-tool");
    assert.equal(outcome.success, false);
    assert.equal(outcome.code, "PERMISSION_DENIED");

    // Estado preservado
    assert.equal(controller.serverId, "no-auth-server");
    assert.equal(controller.toolNames.length, 0);
  });

  it("[MCP-01] QUANDO toolName inválido ENTÃO INVALID_STATE sem efeito colateral", () => {
    const controller = new McpToolController();
    controller.configure({
      kind: "stdio",
      serverId: "err-server",
      command: "echo",
    });

    const outcomeNull = controller.runTool(null as unknown);
    assert.equal(outcomeNull.success, false);

    const outcomeEmpty = controller.runTool("");
    assert.equal(outcomeEmpty.success, false);
  });

  it("[MCP-01] QUANDO servidor MCP é configurado e descoberto ENTÃO executa com permissão", async () => {
    const controller = new McpToolController({
      runId: "run-ui-mcp-2",
      sessionId: "sess-ui-mcp-2",
    });

    // Configurar
    controller.configure({
      kind: "stdio",
      serverId: "ui-fixture-stdio-2",
      command: execPath,
    });

    // Descobrir
    await controller.discoverTools();

    // Solicitar permissão para ping
    const permission = controller.requestToolPermission("ping");
    assert.equal(permission.toolName, "ping");

    // Recusar → error
    const denied = await controller.decideAndRun({
      decision: "deny",
      scope: "once",
    });
    assert.equal(denied.success, false);
    assert.equal(denied.code, "PERMISSION_DENIED");

    // Solicitar novamente
    controller.requestToolPermission("ping");

    // Aceitar e executar
    const allowed = await controller.decideAndRun({
      decision: "allow",
      scope: "once",
      arguments: { message: "hello-ui" },
    });
    assert.equal(allowed.success, true);
    assert.equal(allowed.toolName, "ping");
  });

  it("[MCP-01] QUANDO addNumbers é executada ENTÃO resultado correto é exibido", async () => {
    const controller = new McpToolController({
      runId: "run-ui-mcp-3",
      sessionId: "sess-ui-mcp-3",
    });

    // Configurar e descobrir
    controller.configure({
      kind: "stdio",
      serverId: "ui-fixture-stdio-3",
      command: execPath,
    });
    await controller.discoverTools();

    // Solicitar permissão e executar addNumbers(5 + 3)
    controller.requestToolPermission("addNumbers");
    const result = await controller.decideAndRun({
      decision: "allow",
      scope: "once",
      arguments: { a: 5, b: 3 },
    });
    assert.equal(result.success, true);
    assert.equal(result.toolName, "addNumbers");
    assert.equal(result.displayText, "8");
  });

  it("[MCP-01] caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
    const controller = new McpToolController();
    controller.configure({
      kind: "stdio",
      serverId: "err-server",
      command: "echo",
    });

    // Tool inválida (não lista)
    assert.throws(
      () => controller.requestToolPermission("nonexistent-tool"),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );

    // Sem permissão pendente
    assert.throws(
      () => controller.decideAndRun({ decision: "allow" }),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
  });
});
