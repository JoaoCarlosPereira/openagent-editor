import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { LocalHookEngine } from "@openagent/policy";

import { assertLocalHooksAllowMcpToolInvoke } from "../../src/mcp/local-hook-gate.js";

test("[CUS-03] gate MCP aplica hooks locais antes da invocação", async () => {
  const engine = new LocalHookEngine([
    {
      id: "deny-mcp",
      source: "mcp-hooks",
      handler: (action) => {
        if (action.target.kind === "tool" && action.target.tool === "mcp") {
          return { decision: "deny", justification: "Servidor MCP desabilitado pelo hook." };
        }
        return { decision: "allow" };
      },
    },
  ]);

  await assert.rejects(
    () =>
      assertLocalHooksAllowMcpToolInvoke(engine, {
        runId: "run-mcp-hook",
        sessionId: "sess-mcp-hook",
        serverId: "mem0",
        toolName: "search_memory",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
      assert.equal(error.message, "Servidor MCP desabilitado pelo hook.");
      return true;
    },
  );
});
