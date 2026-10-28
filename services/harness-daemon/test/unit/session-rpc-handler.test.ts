import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  RPC_PROTOCOL_VERSION,
  getRpcMethodSpec,
  validateRpcRequest,
} from "@openagent/protocol";
import { listStoredSessionsByWorkspace, openWorkspaceDatabase } from "@openagent/storage";
import { DatabaseSync } from "node:sqlite";

import { createWorkspaceCustomizationRules } from "../../src/customization/session-rules-loader.js";
import { handleSessionRpc } from "../../src/sessions/session-rpc-handler.js";
import type { WorkspaceBindingState } from "../../src/workspace-state.js";

function buildSessionCreateRequest(workspaceId: string, sessionId: string) {
  const spec = getRpcMethodSpec(RPC_METHOD.SESSION_CREATE);
  const envelope = {
    method: RPC_METHOD.SESSION_CREATE,
    requestId: randomUUID(),
    workspaceId,
    sessionId,
    runId: `run-${randomUUID()}`,
    expectedVersion: 0,
    capability: spec.capability,
    payload: {},
    rpcVersion: RPC_PROTOCOL_VERSION,
  };
  const validation = validateRpcRequest(envelope);
  assert.equal(validation.valid, true);
  return validation.value;
}

test("[CUS-01] session.create com rulesRef inválido não persiste sessão nem muta binding", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "oa-session-create-rules-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-session-create-ws-"));
  const workspaceId = "ws-cus01-invalid-rules";
  const placeholderSessionId = `ses-placeholder-${randomUUID()}`;

  const binding: WorkspaceBindingState = {
    workspaceId,
    workspaceRoot,
    providerProfileId: "provider-local",
    mode: "agent",
    rulesRef: "invalid-rules-ref",
    mcpServerIds: [],
    sessionIds: [],
  };

  const customizationRules = createWorkspaceCustomizationRules();
  const request = buildSessionCreateRequest(workspaceId, placeholderSessionId);

  assert.throws(
    () =>
      handleSessionRpc(
        { dataRoot, binding, customizationRules },
        request,
      ),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.deepEqual(binding.sessionIds, []);

  const db = openWorkspaceDatabase({ dataRoot, workspaceId });
  const sqlite = new DatabaseSync(db.databasePath);
  try {
    assert.equal(listStoredSessionsByWorkspace(sqlite, workspaceId).length, 0);
  } finally {
    sqlite.close();
    db.close();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
