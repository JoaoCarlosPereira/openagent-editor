import test from "node:test";
import assert from "node:assert/strict";
import { runAgentModeIfRequested } from "../../src/agent/agent-mode-run.js";

test("[AGT-03] runAgentModeIfRequested ignora modo que não é Agent", () => {
  const result = runAgentModeIfRequested({
    context: {} as never,
    db: {} as never,
    sessionId: "ses-1",
    runId: "run-1",
    runMode: "ask",
    workspaceRoot: "/tmp/ws",
    userInputText: JSON.stringify({ agentLoop: { turns: [] } }),
    machine: {} as never,
  });
  assert.equal(result, null);
});

test("[AGT-03] runAgentModeIfRequested ignora UserInput sem agentLoop", () => {
  const result = runAgentModeIfRequested({
    context: {} as never,
    db: {} as never,
    sessionId: "ses-1",
    runId: "run-1",
    runMode: "agent",
    workspaceRoot: "/tmp/ws",
    userInputText: "apenas texto",
    machine: {} as never,
  });
  assert.equal(result, null);
});
