import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProtocolError, RPC_METHOD } from "@openagent/protocol";

import {
  ConversationSearchController,
  type ConversationMessageSearchPort,
} from "../../src/agent/conversation-search.js";

const SESSION_ID = "ses-ses-05-conversation-search";

describe("SES-05 e2e — Busca na conversa", () => {
  it("[SES-05] buscar texto lista as mensagens da sessão local que o contêm", async () => {
    const panel = new ConversationSearchController(SESSION_ID);

    assert.match(panel.snapshot.html, /data-testid="conversation-search-panel"/);
    assert.equal(panel.snapshot.accessible.phase, "idle");
    assert.equal(panel.snapshot.accessible.hitCount, 0);
    assert.match(panel.snapshot.html, /data-testid="conversation-search-idle"/);

    const pending = panel.requestSearch("refatoração");
    assert.equal(pending.rpc.method, RPC_METHOD.SESSION_SEARCH);
    assert.deepEqual(pending.rpc.params, { query: "refatoração" });
    assert.equal(pending.rpc.sessionId, SESSION_ID);
    assert.equal(pending.view.accessible.phase, "pending");
    assert.equal(pending.view.accessible.query, "refatoração");
    assert.equal(pending.view.accessible.hitCount, 0);
    assert.match(pending.view.html, /data-testid="conversation-search-pending"/);
    assert.match(pending.view.html, /data-phase="pending"/);

    const afterHits = panel.acceptHits({
      sessionId: SESSION_ID,
      query: "refatoração",
      hits: [
        {
          id: "msg-1",
          role: "user",
          status: "complete",
          lexicalSnippet: "…refatoração do daemon RPC…",
        },
        {
          messageId: "msg-2",
          role: "assistant",
          status: "complete",
          lexicalSnippet: "Plano de refatoração em três passos",
        },
      ],
    });

    assert.equal(afterHits.accessible.phase, "results");
    assert.equal(afterHits.accessible.hitCount, 2);
    assert.deepEqual([...afterHits.accessible.messageIds], ["msg-1", "msg-2"]);
    assert.match(afterHits.html, /data-testid="conversation-search-hits"/);
    assert.match(afterHits.html, /data-message-id="msg-1"/);
    assert.match(afterHits.html, /data-message-id="msg-2"/);
    assert.match(afterHits.html, /refatoração do daemon RPC/);
    assert.match(afterHits.html, /Plano de refatoração em três passos/);
    assert.match(afterHits.html, /data-role="user"/);
    assert.match(afterHits.html, /data-role="assistant"/);
    assert.deepEqual(
      panel.listHits().map((hit) => hit.messageId),
      ["msg-1", "msg-2"],
    );

    const port: ConversationMessageSearchPort = {
      async searchMessages(input) {
        assert.equal(input.sessionId, SESSION_ID);
        assert.equal(input.query, "daemon");
        return {
          sessionId: SESSION_ID,
          query: "daemon",
          hits: [
            {
              messageId: "msg-1",
              role: "user",
              status: "complete",
              lexicalSnippet: "…refatoração do daemon RPC…",
            },
          ],
        };
      },
    };

    const viaPort = await panel.searchViaPort(port, "daemon");
    assert.equal(viaPort.rpc.method, RPC_METHOD.SESSION_SEARCH);
    assert.equal(viaPort.view.accessible.hitCount, 1);
    assert.deepEqual([...viaPort.view.accessible.messageIds], ["msg-1"]);
    assert.match(viaPort.view.html, /data-message-id="msg-1"/);
  });

  it("[SES-05] caminho de erro: entrada/estado inválidos retornam INVALID_STATE sem efeito colateral", () => {
    const panel = new ConversationSearchController(SESSION_ID);
    const baseline = panel.snapshot;

    assert.throws(
      () => panel.requestSearch("   "),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.phase, baseline.accessible.phase);
    assert.equal(panel.snapshot.accessible.hitCount, 0);
    assert.equal(panel.snapshot.html, baseline.html);

    assert.throws(
      () => panel.acceptHits({ sessionId: SESSION_ID, query: "x", hits: [] }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.html, baseline.html);

    panel.requestSearch("ok");
    const pendingSnapshot = panel.snapshot;

    assert.throws(
      () =>
        panel.acceptHits({
          sessionId: "outra-sessao",
          query: "ok",
          hits: [
            {
              messageId: "msg-x",
              role: "user",
              status: "complete",
              lexicalSnippet: "trecho",
            },
          ],
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.phase, "pending");
    assert.equal(panel.snapshot.accessible.hitCount, 0);
    assert.equal(panel.snapshot.html, pendingSnapshot.html);

    assert.throws(
      () =>
        panel.acceptHits({
          sessionId: SESSION_ID,
          query: "ok",
          hits: [{ messageId: "msg-bad", role: "user", status: "complete" }],
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.phase, "pending");
    assert.equal(panel.snapshot.accessible.hitCount, 0);

    assert.throws(
      () => new ConversationSearchController("  "),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
  });
});
