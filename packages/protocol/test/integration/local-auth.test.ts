import test from "node:test";
import assert from "node:assert/strict";
import { userInfo } from "node:os";
import {
  LOCAL_USER_ONLY_MESSAGE,
  ProtocolError,
  assertLocalPeerAuth,
  peerCredentialFromProcess,
  resolveLocalDaemonPrincipal,
  validateLocalPeerAuth,
} from "../../src/index.js";

const WORKSPACE_ID = "ws-cli-01-parity";

test("[CLI-01] autenticação local aceita o usuário desta máquina para o workspace", () => {
  const peer = peerCredentialFromProcess();
  const result = validateLocalPeerAuth(peer, WORKSPACE_ID);

  assert.equal(result.valid, true);
  if (!result.valid) {
    return;
  }
  assert.equal(result.workspaceId, WORKSPACE_ID);
  assert.equal(result.principal.username, userInfo().username);
  if (process.platform === "win32") {
    assert.equal(
      result.principal.userSid,
      process.env["OPENAGENT_LOCAL_USER_SID"]?.trim(),
    );
  } else {
    assert.equal(result.principal.uid, userInfo().uid);
  }
});

test("[CLI-01] assertLocalPeerAuth retorna o mesmo workspaceId para cliente autorizado", () => {
  const bound = assertLocalPeerAuth(peerCredentialFromProcess(), WORKSPACE_ID);
  assert.equal(bound.workspaceId, WORKSPACE_ID);
  assert.equal(bound.principal.username, resolveLocalDaemonPrincipal().username);
});

test("[CLI-01] rejeita peer de outro usuário com PERMISSION_DENIED sem alterar workspace", () => {
  if (process.platform === "win32") {
    const peer = {
      platform: "win32" as const,
      userSid: "S-1-5-21-0000000000-0000000000-0000000000-9999",
    };
    const result = validateLocalPeerAuth(peer, WORKSPACE_ID);
    assert.equal(result.valid, false);
    if (result.valid) {
      return;
    }
    assert.equal(result.code, "PERMISSION_DENIED");
    assert.deepEqual(result.errors, [LOCAL_USER_ONLY_MESSAGE]);
    return;
  }

  const foreignUid = userInfo().uid === 0 ? 65534 : 0;
  const result = validateLocalPeerAuth(
    { platform: "posix", uid: foreignUid, gid: userInfo().gid },
    WORKSPACE_ID,
  );
  assert.equal(result.valid, false);
  if (result.valid) {
    return;
  }
  assert.equal(result.code, "PERMISSION_DENIED");
  assert.deepEqual(result.errors, [LOCAL_USER_ONLY_MESSAGE]);
});

test("[CLI-01] entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
  const invalidPeer = validateLocalPeerAuth(null, WORKSPACE_ID);
  assert.equal(invalidPeer.valid, false);
  if (invalidPeer.valid) {
    return;
  }
  assert.equal(invalidPeer.code, "INVALID_STATE");

  const invalidWorkspace = validateLocalPeerAuth(peerCredentialFromProcess(), "  ");
  assert.equal(invalidWorkspace.valid, false);
  if (invalidWorkspace.valid) {
    return;
  }
  assert.equal(invalidWorkspace.code, "INVALID_STATE");

  assert.throws(
    () => assertLocalPeerAuth({ platform: "posix", uid: -1 }, WORKSPACE_ID),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "INVALID_STATE");
      return true;
    },
  );
});
