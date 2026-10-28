import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  assertRunToolMayExecute,
  RunToolPermissionFlow,
} from "@openagent/policy";

import {
  discoverMcpHttpTools,
  discoverMcpStdioTools,
  executePolicyMcpToolInvoke,
  formatAgentMcpToolResult,
  preparePolicyMcpToolInvoke,
  primaryTextFromMcpToolInvocation,
  type PolicyMcpToolContext,
} from "../../src/index.js";
import { withMcpHttpDiscoveryServer } from "../fixtures/mcp-http-discovery-server.mjs";

const fixtureStdioServerPath = fileURLToPath(
  new URL("../fixtures/mcp-stdio-discovery-server.mjs", import.meta.url),
);

function mcpPolicyContext(): PolicyMcpToolContext {
  return { agentMode: "agent", executionMode: "standard" };
}

test("[MCP-01][PER-01] HTTP: lista ferramentas, executa com permissão e mostra resultado", async () => {
  await withMcpHttpDiscoveryServer(async (mcpUrl: string) => {
    const listed = await discoverMcpHttpTools({ serverId: "fixture-http", url: mcpUrl });
    assert.ok(listed.tools.some((tool) => tool.name === "addNumbers"));

    const flow = new RunToolPermissionFlow();
    const prepared = preparePolicyMcpToolInvoke(flow, mcpPolicyContext(), {
      runId: "run-mcp-http",
      sessionId: "sess-mcp",
      requestId: "perm-mcp-http-add",
      serverId: "fixture-http",
      toolName: "addNumbers",
    });

    assert.equal(prepared.permission.phase, "pending");
    if (prepared.permission.phase !== "pending") {
      return;
    }
    assert.equal(prepared.permission.prompt.action, "Executar ferramenta");
    assert.equal(prepared.permission.prompt.target, "mcp → fixture-http/addNumbers");

    const pending = prepared.permission;
    assert.equal(pending.phase, "pending");
    if (pending.phase !== "pending") {
      return;
    }
    assert.throws(() => assertRunToolMayExecute(pending.gate), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
      return true;
    });

    const allowed = flow.decide(pending.request.requestId, "allow", "once");
    assertRunToolMayExecute(allowed.gate);

    const raw = await executePolicyMcpToolInvoke({
      transport: "http",
      server: { serverId: "fixture-http", url: mcpUrl },
      toolName: "addNumbers",
      arguments: { a: 4, b: 7 },
    });

    const formatted = formatAgentMcpToolResult(raw);
    assert.equal(formatted.origin, "mcp");
    assert.equal(formatted.capability, "tool.invoke");
    assert.equal(formatted.isError, false);
    assert.equal(primaryTextFromMcpToolInvocation(raw), "11");
  });
});

test("[MCP-01][PER-01] stdio: executa ping após aceite explícito", async () => {
  const flow = new RunToolPermissionFlow();
  const prepared = preparePolicyMcpToolInvoke(flow, mcpPolicyContext(), {
    runId: "run-mcp-stdio",
    sessionId: "sess-mcp-stdio",
    requestId: "perm-mcp-stdio-ping",
    serverId: "fixture-stdio",
    toolName: "ping",
  });

  assert.equal(prepared.permission.phase, "pending");
  if (prepared.permission.phase !== "pending") {
    return;
  }

  const listed = await discoverMcpStdioTools({
    serverId: "fixture-stdio",
    command: process.execPath,
    args: [fixtureStdioServerPath],
  });
  assert.ok(listed.tools.some((tool) => tool.name === "ping"));

  const allowed = flow.decide(prepared.permission.request.requestId, "allow", "once");
  assertRunToolMayExecute(allowed.gate);

  const raw = await executePolicyMcpToolInvoke({
    transport: "stdio",
    server: {
      serverId: "fixture-stdio",
      command: process.execPath,
      args: [fixtureStdioServerPath],
    },
    toolName: "ping",
    arguments: { message: "hello-mcp" },
  });

  assert.equal(raw.isError, false);
  assert.equal(primaryTextFromMcpToolInvocation(raw), "hello-mcp");
});

test("[MCP-01] caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", async () => {
  const flow = new RunToolPermissionFlow();

  assert.throws(
    () =>
      preparePolicyMcpToolInvoke(flow, mcpPolicyContext(), {
        runId: "run-invalid",
        sessionId: "sess-invalid",
        requestId: "perm-invalid",
        serverId: "",
        toolName: "ping",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  await assert.rejects(
    executePolicyMcpToolInvoke({
      transport: "http",
      server: { serverId: "x", url: "ftp://bad" },
      toolName: "ping",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});
