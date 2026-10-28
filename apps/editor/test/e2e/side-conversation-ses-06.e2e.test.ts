import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProtocolError, RPC_METHOD } from "@openagent/protocol";

import {
  SideConversationController,
  type SideConversationForkPort,
} from "../../src/agent/side-conversation.js";

const PARENT_SESSION_ID = "ses-parent-ses-06";

describe("SES-06 e2e — Conversa lateral", () => {
  it("[SES-06] abrir conversa lateral conserva as mensagens da conversa principal", async () => {
    const panel = new SideConversationController(PARENT_SESSION_ID);

    assert.match(panel.snapshot.html, /data-testid="side-conversation-panel"/);
    assert.equal(panel.snapshot.accessible.phase, "idle");
    assert.equal(panel.snapshot.accessible.forkSessionId, null);
    assert.equal(panel.snapshot.accessible.parentSessionId, PARENT_SESSION_ID);
    assert.equal(panel.snapshot.accessible.parentPreserved, true);
    assert.match(panel.snapshot.html, /Abra uma conversa lateral/);

    const pending = panel.requestFork("branch-lateral-01");
    assert.equal(pending.rpc.method, RPC_METHOD.SESSION_FORK);
    assert.deepEqual(pending.rpc.params, { branchId: "branch-lateral-01" });
    assert.equal(pending.rpc.sessionId, PARENT_SESSION_ID);
    assert.equal(pending.view.accessible.phase, "pending");
    assert.equal(pending.view.accessible.parentPreserved, true);
    assert.match(pending.view.html, /data-phase="pending"/);
    assert.match(pending.view.html, /Abrindo conversa lateral…/);

    const opened = panel.acceptFork({
      sessionId: "ses-fork-lateral-01",
      parentSessionId: PARENT_SESSION_ID,
    });
    assert.equal(opened.accessible.phase, "opened");
    assert.equal(opened.accessible.forkSessionId, "ses-fork-lateral-01");
    assert.equal(opened.accessible.parentPreserved, true);
    assert.match(opened.html, /data-phase="opened"/);
    assert.match(opened.html, /data-fork-session-id="ses-fork-lateral-01"/);
    assert.match(opened.html, /A conversa principal foi preservada/);

    const secondPanel = new SideConversationController(PARENT_SESSION_ID);
    const port: SideConversationForkPort = {
      async forkSession(input) {
        assert.equal(input.sessionId, PARENT_SESSION_ID);
        assert.equal(input.params.branchId, "sess-via-port");
        return {
          sessionId: "ses-via-port-forked",
          parentSessionId: PARENT_SESSION_ID,
        };
      },
    };

    const viaPort = await secondPanel.openViaPort(port, "sess-via-port");
    assert.equal(viaPort.rpc.method, RPC_METHOD.SESSION_FORK);
    assert.equal(viaPort.result.sessionId, "ses-via-port-forked");
    assert.equal(viaPort.view.accessible.phase, "opened");
    assert.equal(viaPort.view.accessible.forkSessionId, "ses-via-port-forked");
    assert.equal(viaPort.view.accessible.parentPreserved, true);
  });

  it("[SES-06] caminho de erro: entrada/estado inválidos retornam INVALID_STATE sem efeito colateral", async () => {
    const panel = new SideConversationController(PARENT_SESSION_ID);
    const baseline = panel.snapshot;

    assert.throws(
      () => panel.requestFork("   "),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.phase, baseline.accessible.phase);
    assert.equal(panel.snapshot.accessible.forkSessionId, null);
    assert.equal(panel.snapshot.html, baseline.html);

    assert.throws(
      () => panel.acceptFork({ sessionId: "ses-1", parentSessionId: PARENT_SESSION_ID }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.html, baseline.html);

    panel.requestFork("branch-ok");
    const pendingSnapshot = panel.snapshot;

    assert.throws(
      () =>
        panel.acceptFork({
          sessionId: "ses-fork-1",
          parentSessionId: "outra-sessao-pai",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.phase, "pending");
    assert.equal(panel.snapshot.html, pendingSnapshot.html);

    assert.throws(
      () =>
        panel.acceptFork({
          sessionId: PARENT_SESSION_ID,
          parentSessionId: PARENT_SESSION_ID,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.phase, "pending");

    const failingPort: SideConversationForkPort = {
      async forkSession() {
        throw new Error("Falha no transporte daemon RPC");
      },
    };
    const retryPanel = new SideConversationController(PARENT_SESSION_ID);
    await assert.rejects(
      () => retryPanel.openViaPort(failingPort, "branch-falha"),
      /Falha no transporte daemon RPC/,
    );
    assert.equal(retryPanel.snapshot.accessible.phase, "idle");
    assert.equal(retryPanel.snapshot.accessible.forkSessionId, null);

    assert.throws(
      () => new SideConversationController("   "),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
  });
});
