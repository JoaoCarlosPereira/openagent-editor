import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProtocolError, RPC_METHOD } from "@openagent/protocol";

import { RunQueuePanelController } from "../../src/agent/run-queue-panel.js";

const RUN_ID = "run-agt-06-queue-e2e";

describe("AGT-06 e2e — fila visível com remoção de item não iniciado", () => {
  it("[AGT-06] mensagem durante execução entra na fila e permite remover pending", () => {
    const panel = new RunQueuePanelController(RUN_ID);

    assert.match(panel.snapshot.html, /data-testid="run-queue-empty"/);
    assert.equal(panel.snapshot.accessible.runLifecycle, "idle");
    assert.equal(panel.snapshot.accessible.pendingCount, 0);

    panel.beginRunning();
    assert.equal(panel.snapshot.accessible.runLifecycle, "running");
    assert.match(panel.snapshot.html, /data-run-lifecycle="running"/);

    const enqueueReq = panel.requestEnqueue({ text: "Continuar com o próximo passo" });
    assert.equal(enqueueReq.rpc.method, RPC_METHOD.RUN_QUEUE_ADD);
    assert.deepEqual(enqueueReq.rpc.params, {
      input: { text: "Continuar com o próximo passo" },
    });
    // Sem eco do daemon: fila ainda vazia.
    assert.equal(enqueueReq.view.accessible.pendingCount, 0);
    assert.match(enqueueReq.view.html, /data-testid="run-queue-empty"/);

    const afterAdd = panel.acceptEnqueue(
      { queueItemId: "qi-pending-1", ordinal: 1 },
      { text: "Continuar com o próximo passo" },
    );

    assert.equal(afterAdd.accessible.pendingCount, 1);
    assert.equal(afterAdd.accessible.startedCount, 0);
    assert.deepEqual([...afterAdd.accessible.removableQueueItemIds], ["qi-pending-1"]);
    assert.match(afterAdd.html, /data-testid="run-queue-panel"/);
    assert.match(afterAdd.html, /data-testid="run-queue-item"/);
    assert.match(afterAdd.html, /data-queue-item-id="qi-pending-1"/);
    assert.match(afterAdd.html, /data-state="pending"/);
    assert.match(afterAdd.html, /Continuar com o próximo passo/);
    assert.match(afterAdd.html, /data-testid="run-queue-remove"/);
    assert.match(afterAdd.html, /Na fila/);

    const second = panel.acceptEnqueue(
      { queueItemId: "qi-pending-2", ordinal: 2 },
      { text: "Depois revise o diff" },
    );
    assert.equal(second.accessible.pendingCount, 2);
    assert.match(second.html, /data-queue-item-id="qi-pending-2"/);
    assert.match(second.html, /Depois revise o diff/);

    const removeReq = panel.requestRemove("qi-pending-2");
    assert.equal(removeReq.rpc.method, RPC_METHOD.RUN_QUEUE_REMOVE);
    assert.deepEqual(removeReq.rpc.params, { queueItemId: "qi-pending-2" });
    // Sem acceptRemove: item ainda visível.
    assert.equal(removeReq.view.accessible.pendingCount, 2);
    assert.equal(
      removeReq.view.accessible.items.find((i) => i.queueItemId === "qi-pending-2")
        ?.state,
      "pending",
    );

    const afterRemove = panel.acceptRemove("qi-pending-2");
    assert.equal(afterRemove.accessible.pendingCount, 1);
    assert.deepEqual([...afterRemove.accessible.removableQueueItemIds], [
      "qi-pending-1",
    ]);
    assert.doesNotMatch(afterRemove.html, /data-queue-item-id="qi-pending-2"/);
    assert.match(afterRemove.html, /data-queue-item-id="qi-pending-1"/);
    assert.match(afterRemove.html, /Continuar com o próximo passo/);
  });

  it("[AGT-06] item iniciado deixa de ser removível; demais pending permanecem", () => {
    const panel = new RunQueuePanelController(RUN_ID);
    panel.beginRunning();
    panel.acceptEnqueue(
      { queueItemId: "qi-a", ordinal: 1 },
      { text: "Primeira da fila" },
    );
    panel.acceptEnqueue(
      { queueItemId: "qi-b", ordinal: 2 },
      { text: "Segunda da fila" },
    );

    const started = panel.markStarted("qi-a");
    assert.equal(
      started.accessible.items.find((i) => i.queueItemId === "qi-a")?.state,
      "started",
    );
    assert.equal(
      started.accessible.items.find((i) => i.queueItemId === "qi-b")?.state,
      "pending",
    );
    assert.equal(started.accessible.startedCount, 1);
    assert.equal(started.accessible.pendingCount, 1);
    assert.deepEqual([...started.accessible.removableQueueItemIds], ["qi-b"]);
    assert.match(started.html, /data-queue-item-id="qi-a"[^>]*data-state="started"/);
    assert.match(started.html, /data-queue-item-id="qi-b"[^>]*data-state="pending"/);
    assert.doesNotMatch(
      started.html,
      /data-testid="run-queue-remove" data-queue-item-id="qi-a"/,
    );
    assert.match(
      started.html,
      /data-testid="run-queue-remove" data-queue-item-id="qi-b"/,
    );

    assert.throws(
      () => panel.requestRemove("qi-a"),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        assert.match(error.message, /já iniciado/);
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.pendingCount, 1);
    assert.equal(panel.snapshot.accessible.startedCount, 1);
    assert.match(panel.snapshot.html, /data-queue-item-id="qi-a"/);
    assert.match(panel.snapshot.html, /data-queue-item-id="qi-b"/);
  });

  it("[AGT-06] caminho de erro: estado/entrada inválidos retornam INVALID_STATE sem efeito colateral", () => {
    const panel = new RunQueuePanelController(RUN_ID);

    assert.throws(
      () => panel.requestEnqueue({ text: "cedo demais" }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        assert.match(error.message, /em andamento/);
        return true;
      },
    );
    assert.match(panel.snapshot.html, /data-testid="run-queue-empty"/);
    assert.equal(panel.snapshot.accessible.pendingCount, 0);

    panel.beginRunning();

    assert.throws(
      () => panel.requestEnqueue({ text: "   " }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.pendingCount, 0);
    assert.match(panel.snapshot.html, /data-testid="run-queue-empty"/);

    panel.acceptEnqueue({ queueItemId: "qi-keep", ordinal: 1 }, { text: "Preservar" });
    const beforeHtml = panel.snapshot.html;
    const beforeIds = panel.snapshot.accessible.removableQueueItemIds;

    assert.throws(
      () => panel.requestRemove("qi-missing"),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        assert.match(error.message, /inexistente/);
        return true;
      },
    );
    assert.throws(
      () => panel.requestRemove(""),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.throws(
      () => panel.acceptEnqueue({ queueItemId: "qi-keep", ordinal: 2 }, { text: "dup" }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        assert.match(error.message, /já registrado/);
        return true;
      },
    );

    assert.equal(panel.snapshot.html, beforeHtml);
    assert.deepEqual([...panel.snapshot.accessible.removableQueueItemIds], [
      ...beforeIds,
    ]);
    assert.equal(panel.snapshot.accessible.pendingCount, 1);

    panel.endRunning();
    assert.throws(
      () => panel.requestRemove("qi-keep"),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.pendingCount, 1);
    assert.match(panel.snapshot.html, /data-queue-item-id="qi-keep"/);
  });
});
