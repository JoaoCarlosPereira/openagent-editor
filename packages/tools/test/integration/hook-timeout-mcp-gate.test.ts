import assert from "node:assert/strict";
import test from "node:test";

import { LocalHookEngine } from "@openagent/policy";

import { assertLocalHooksAllowMcpToolInvoke } from "../../src/mcp/local-hook-gate.js";

test("[CUS-03] gate MCP não trava quando hook excede timeout", async () => {
  const engine = new LocalHookEngine(
    [
      {
        id: "mcp-slow",
        source: "mcp-hooks",
        handler: () => new Promise(() => {}),
      },
    ],
    { handlerTimeoutMs: 35 },
  );

  const started = Date.now();
  await assertLocalHooksAllowMcpToolInvoke(engine, {
    runId: "run-hook-timeout",
    sessionId: "sess-hook-timeout",
    serverId: "fixtures",
    toolName: "ping",
  });
  assert.ok(Date.now() - started < 350);
});
