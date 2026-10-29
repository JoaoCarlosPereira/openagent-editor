import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  COMPLETION_CANCEL_DEADLINE_MS,
  COMPLETION_EVENT_TYPE,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  connectHarnessClient,
  incompleteStreamError,
  type CompletionStreamEvent,
  type HarnessClient,
  type WorkspaceTransportHello,
} from "@openagent/protocol";
import { openWorkspaceDatabase } from "@openagent/storage";
import {
  readCompletionSnapshot,
  startHarnessDaemon,
  type CompletionSourceInput,
  type CompletionTextSource,
} from "../../src/index.js";

const WORKSPACE: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-completion-166",
  workspaceRoot: "/tmp/openagent-completion",
  providerProfileId: "provider-local",
  mode: "agent",
  rulesRef: "rules:default",
  mcpServerIds: [],
  sessionIds: [],
};

/** Fonte controlada pelo teste: entrega deltas sob demanda e registra aborto. */
class ControlledSource {
  readonly calls: CompletionSourceInput[] = [];
  aborted = 0;
  private readonly queues = new Map<string, Array<string | Error | "end">>();
  private readonly wakers = new Map<string, () => void>();

  readonly source: CompletionTextSource = (input) => {
    this.calls.push(input);
    input.signal.addEventListener("abort", () => {
      this.aborted += 1;
    });
    return this.generate(input.completionId);
  };

  private async *generate(id: string): AsyncGenerator<string, void, void> {
    for (;;) {
      const next = (this.queues.get(id) ?? []).shift();
      if (next === undefined) {
        await new Promise<void>((resolve) => this.wakers.set(id, resolve));
        continue;
      }
      if (next === "end") {
        return;
      }
      if (next instanceof Error) {
        throw next;
      }
      yield next;
    }
  }

  push(completionId: string, item: string | Error | "end"): void {
    const queue = this.queues.get(completionId) ?? [];
    queue.push(item);
    this.queues.set(completionId, queue);
    this.wakers.get(completionId)?.();
    this.wakers.delete(completionId);
  }
}

type Harness = {
  dataRoot: string;
  address: string;
  daemon: Awaited<ReturnType<typeof startHarnessDaemon>>;
  client: HarnessClient;
  sessionId: string;
  runId: string;
  source: ControlledSource;
  stop(): Promise<void>;
};

async function setup(): Promise<Harness> {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "oa-completion-"));
  const source = new ControlledSource();
  const daemon = await startHarnessDaemon({
    dataRoot,
    runtimeDirectory: path.join(dataRoot, "runtime"),
    completionSource: source.source,
    drainTimeoutMs: 50,
  });
  const client = await connectHarnessClient({ address: daemon.address, workspaceHello: WORKSPACE });
  const session = await client.createSession({ mode: "agent" });
  const runId = `run-${randomUUID()}`;
  for await (const event of client.startRun({
    sessionId: session.sessionId,
    runId,
    input: { text: "início" },
  })) {
    void event;
  }
  return {
    dataRoot,
    address: daemon.address,
    daemon,
    client,
    sessionId: session.sessionId,
    runId,
    source,
    stop: async () => {
      client.close();
      await daemon.stop();
      await rm(dataRoot, { recursive: true, force: true });
    },
  };
}

async function collect(stream: AsyncIterable<CompletionStreamEvent>): Promise<CompletionStreamEvent[]> {
  const events: CompletionStreamEvent[] = [];
  for await (const item of stream) {
    events.push(item);
  }
  return events;
}

function types(events: CompletionStreamEvent[]): string[] {
  return events.map((item) => item.payload.type);
}

function persistedCompletionTypes(h: Harness, completionId: string): string[] {
  const db = openWorkspaceDatabase({ dataRoot: h.dataRoot, workspaceId: WORKSPACE.workspaceId });
  try {
    return db
      .listHarnessEvents(h.runId)
      .filter((event) => event.type.startsWith("completion."))
      .map((event) => ({
        type: event.type,
        payload: JSON.parse(Buffer.from(db.readCasBlob(event.payloadRef)).toString("utf8")) as {
          completionId: string;
        },
      }))
      .filter((item) => item.payload.completionId === completionId)
      .map((item) => item.type);
  } finally {
    db.close();
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("timeout aguardando condição");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test.describe("completion.start/cancel no daemon (TAB-01)", { concurrency: 1 }, () => {
  test("[TAB-01] stream parcial entrega deltas ordenados e uma única conclusão persistida", async () => {
    const h = await setup();
    try {
      const stream = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-1",
        prefix: "const a = ",
        suffix: ";",
        language: "typescript",
      });
      h.source.push("c-1", "1");
      h.source.push("c-1", "23");
      h.source.push("c-1", "end");
      const events = await collect(stream);
      assert.deepEqual(types(events), [
        COMPLETION_EVENT_TYPE.STARTED,
        COMPLETION_EVENT_TYPE.DELTA,
        COMPLETION_EVENT_TYPE.DELTA,
        COMPLETION_EVENT_TYPE.COMPLETED,
      ]);
      const completed = events[3]?.payload;
      assert.equal(completed?.type, COMPLETION_EVENT_TYPE.COMPLETED);
      assert.equal(completed?.type === COMPLETION_EVENT_TYPE.COMPLETED && completed.text, "123");
      assert.deepEqual(await stream.result, { completionId: "c-1", state: "completed", attempt: 1 });
      assert.deepEqual(persistedCompletionTypes(h, "c-1"), types(events));
      assert.equal(h.source.calls[0]?.prefix, "const a = ");
      assert.equal(h.source.calls[0]?.runId, h.runId);
    } finally {
      await h.stop();
    }
  });

  test("[TAB-01] cancelamento durante a geração chega a Cancelada em até 2 s e preserva o parcial", async () => {
    const h = await setup();
    try {
      const stream = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-cancel",
        prefix: "x",
      });
      const collected = collect(stream);
      h.source.push("c-cancel", "parc");
      await waitFor(() => persistedCompletionTypes(h, "c-cancel").includes(COMPLETION_EVENT_TYPE.DELTA));

      const startedAt = Date.now();
      const cancel = await h.client.cancelCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-cancel",
      });
      const events = await collected;
      const elapsed = Date.now() - startedAt;

      assert.ok(elapsed <= COMPLETION_CANCEL_DEADLINE_MS, `cancelamento levou ${elapsed}ms`);
      assert.deepEqual(cancel, { completionId: "c-cancel", state: "cancelled", cancelled: true });
      assert.equal(types(events).at(-1), COMPLETION_EVENT_TYPE.CANCELLED);
      const last = events.at(-1)?.payload;
      assert.equal(last?.type === COMPLETION_EVENT_TYPE.CANCELLED && last.text, "parc");
      assert.equal((await stream.result).state, "cancelled");
      assert.equal(h.source.calls[0]?.signal.aborted, true);
    } finally {
      await h.stop();
    }
  });

  test("[TAB-01] resposta tardia após cancelamento não gera evento nem altera o estado", async () => {
    const h = await setup();
    try {
      const stream = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-late",
        prefix: "x",
      });
      const collected = collect(stream);
      h.source.push("c-late", "a");
      await waitFor(() => persistedCompletionTypes(h, "c-late").includes(COMPLETION_EVENT_TYPE.DELTA));
      await h.client.cancelCompletion({ sessionId: h.sessionId, runId: h.runId, completionId: "c-late" });
      await collected;
      const before = persistedCompletionTypes(h, "c-late");

      // A fonte ignora o aborto e entrega texto e fim depois do cancelamento.
      h.source.push("c-late", "TARDIO");
      h.source.push("c-late", "end");
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.deepEqual(persistedCompletionTypes(h, "c-late"), before);
      assert.equal(before.filter((type) => type === COMPLETION_EVENT_TYPE.COMPLETED).length, 0);
      const db = openWorkspaceDatabase({ dataRoot: h.dataRoot, workspaceId: WORKSPACE.workspaceId });
      try {
        const snapshot = readCompletionSnapshot(db, h.runId, "c-late");
        assert.equal(snapshot?.state, "cancelled");
        assert.equal(snapshot?.text, "a");
      } finally {
        db.close();
      }
    } finally {
      await h.stop();
    }
  });

  test("[TAB-01] cancelar após o término é idempotente e não regrava estado", async () => {
    const h = await setup();
    try {
      const stream = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-done",
        prefix: "x",
      });
      h.source.push("c-done", "ok");
      h.source.push("c-done", "end");
      await collect(stream);
      const before = persistedCompletionTypes(h, "c-done");
      const result = await h.client.cancelCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-done",
      });
      assert.deepEqual(result, { completionId: "c-done", state: "completed", cancelled: false });
      assert.deepEqual(persistedCompletionTypes(h, "c-done"), before);
    } finally {
      await h.stop();
    }
  });

  test("[TAB-01] falha do provedor vira Incompleta e o retry idempotente continua sem duplicar", async () => {
    const h = await setup();
    try {
      const first = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-retry",
        prefix: "p",
      });
      h.source.push("c-retry", "ab");
      h.source.push("c-retry", incompleteStreamError());
      const firstEvents = await collect(first);
      const incomplete = firstEvents.at(-1)?.payload;
      assert.equal(incomplete?.type, COMPLETION_EVENT_TYPE.INCOMPLETE);
      if (incomplete?.type === COMPLETION_EVENT_TYPE.INCOMPLETE) {
        assert.equal(incomplete.code, PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM);
        assert.equal(incomplete.text, "ab");
        assert.equal(incomplete.idempotentRetry, true);
        assert.equal(incomplete.skipRepeatedMutations, true);
      }
      assert.deepEqual(await first.result, { completionId: "c-retry", state: "incomplete", attempt: 1 });

      const retry = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-retry",
        prefix: "p",
      });
      h.source.push("c-retry", "cd");
      h.source.push("c-retry", "end");
      const retryEvents = await collect(retry);
      assert.equal(h.source.calls[1]?.resumeText, "ab");
      const started = retryEvents[0]?.payload;
      assert.equal(started?.type === COMPLETION_EVENT_TYPE.STARTED && started.resumeOffset, 2);
      const completed = retryEvents.at(-1)?.payload;
      assert.equal(completed?.type === COMPLETION_EVENT_TYPE.COMPLETED && completed.text, "abcd");
      assert.deepEqual(await retry.result, { completionId: "c-retry", state: "completed", attempt: 2 });

      // Replay do terminal: nenhuma nova geração nem novos eventos.
      const eventsBeforeReplay = persistedCompletionTypes(h, "c-retry");
      const replay = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-retry",
        prefix: "p",
      });
      const replayEvents = await collect(replay);
      assert.deepEqual(types(replayEvents), [COMPLETION_EVENT_TYPE.COMPLETED]);
      assert.deepEqual(await replay.result, {
        completionId: "c-retry",
        state: "completed",
        attempt: 2,
        replayed: true,
      });
      assert.equal(h.source.calls.length, 2);
      assert.deepEqual(persistedCompletionTypes(h, "c-retry"), eventsBeforeReplay);
      assert.equal(
        eventsBeforeReplay.filter((type) => type === COMPLETION_EVENT_TYPE.COMPLETED).length,
        1,
      );
    } finally {
      await h.stop();
    }
  });

  test("[TAB-01] completions concorrentes ficam isoladas: cancelar uma não afeta a outra", async () => {
    const h = await setup();
    try {
      const keep = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-keep",
        prefix: "k",
      });
      const drop = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-drop",
        prefix: "d",
      });
      const keepEvents = collect(keep);
      const dropEvents = collect(drop);
      h.source.push("c-keep", "K1");
      h.source.push("c-drop", "D1");
      await waitFor(
        () =>
          persistedCompletionTypes(h, "c-keep").includes(COMPLETION_EVENT_TYPE.DELTA) &&
          persistedCompletionTypes(h, "c-drop").includes(COMPLETION_EVENT_TYPE.DELTA),
      );
      await h.client.cancelCompletion({ sessionId: h.sessionId, runId: h.runId, completionId: "c-drop" });
      h.source.push("c-keep", "K2");
      h.source.push("c-keep", "end");

      const [kept, dropped] = await Promise.all([keepEvents, dropEvents]);
      const keptLast = kept.at(-1)?.payload;
      assert.equal(keptLast?.type, COMPLETION_EVENT_TYPE.COMPLETED);
      assert.equal(keptLast?.type === COMPLETION_EVENT_TYPE.COMPLETED && keptLast.text, "K1K2");
      assert.equal(dropped.at(-1)?.payload.type, COMPLETION_EVENT_TYPE.CANCELLED);
      assert.ok(kept.every((item) => item.payload.completionId === "c-keep"));
      assert.ok(dropped.every((item) => item.payload.completionId === "c-drop"));
    } finally {
      await h.stop();
    }
  });

  test("[TAB-01] entradas inválidas: id duplicado em voo, reuso com outra entrada e run inexistente", async () => {
    const h = await setup();
    try {
      const live = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-dup",
        prefix: "a",
      });
      const liveEvents = collect(live);
      await waitFor(() => persistedCompletionTypes(h, "c-dup").includes(COMPLETION_EVENT_TYPE.STARTED));

      const duplicate = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-dup",
        prefix: "a",
      });
      await assert.rejects(collect(duplicate), (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.CONFLICT);
        return true;
      });
      assert.equal(h.source.calls.length, 1);

      h.source.push("c-dup", "z");
      h.source.push("c-dup", "end");
      await liveEvents;

      const reused = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-dup",
        prefix: "OUTRA ENTRADA",
      });
      await assert.rejects(collect(reused), { code: PROTOCOL_ERROR_CODES.CONFLICT });

      const orphan = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: "run-inexistente",
        completionId: "c-orphan",
        prefix: "a",
      });
      await assert.rejects(collect(orphan), { code: PROTOCOL_ERROR_CODES.INVALID_STATE });

      await assert.rejects(
        h.client.cancelCompletion({ sessionId: h.sessionId, runId: h.runId, completionId: "nunca-existiu" }),
        { code: PROTOCOL_ERROR_CODES.INVALID_STATE },
      );

      const invalid = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "",
        prefix: "a",
      });
      await assert.rejects(collect(invalid));
      assert.deepEqual(persistedCompletionTypes(h, "c-orphan"), []);
      assert.equal(h.source.calls.length, 1);
    } finally {
      await h.stop();
    }
  });

  test("[TAB-01] queda da conexão aborta a geração em voo e libera o provedor", async () => {
    const h = await setup();
    try {
      const stream = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-drop-conn",
        prefix: "a",
      });
      void collect(stream).catch(() => undefined);
      h.source.push("c-drop-conn", "x");
      await waitFor(() => persistedCompletionTypes(h, "c-drop-conn").includes(COMPLETION_EVENT_TYPE.DELTA));
      h.client.close();
      await waitFor(() => h.source.calls[0]?.signal.aborted === true);
      await waitFor(() =>
        persistedCompletionTypes(h, "c-drop-conn").includes(COMPLETION_EVENT_TYPE.CANCELLED),
      );
    } finally {
      await h.stop();
    }
  });

  test("[TAB-01] erro de RPC concorrente não derruba a completion em voo nem pendura a chamada", async () => {
    const h = await setup();
    try {
      const stream = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-mixed",
        prefix: "a",
      });
      const collected = collect(stream);
      await waitFor(() => persistedCompletionTypes(h, "c-mixed").includes(COMPLETION_EVENT_TYPE.STARTED));

      await assert.rejects(
        Promise.race([
          h.client.enqueue("run-inexistente", { text: "x" }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("chamada pendurada")), 1_500)),
        ]),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError, String(error));
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );

      h.source.push("c-mixed", "ok");
      h.source.push("c-mixed", "end");
      const events = await collected;
      assert.equal(events.at(-1)?.payload.type, COMPLETION_EVENT_TYPE.COMPLETED);
    } finally {
      await h.stop();
    }
  });

  test("[TAB-01] mesmo completionId em duas conexões: uma geração, conflito na outra e cancel cruzado", async () => {
    const h = await setup();
    const other = await connectHarnessClient({
      address: h.address,
      workspaceHello: WORKSPACE,
    });
    try {
      const first = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-shared",
        prefix: "a",
      });
      const firstEvents = collect(first);
      h.source.push("c-shared", "p");
      await waitFor(() => persistedCompletionTypes(h, "c-shared").includes(COMPLETION_EVENT_TYPE.DELTA));

      const second = other.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-shared",
        prefix: "a",
      });
      await assert.rejects(collect(second), { code: PROTOCOL_ERROR_CODES.CONFLICT });
      assert.equal(h.source.calls.length, 1);

      const cancel = await other.cancelCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-shared",
      });
      assert.deepEqual(cancel, { completionId: "c-shared", state: "cancelled", cancelled: true });
      assert.equal((await firstEvents).at(-1)?.payload.type, COMPLETION_EVENT_TYPE.CANCELLED);

      const terminals = persistedCompletionTypes(h, "c-shared").filter(
        (type) => type !== COMPLETION_EVENT_TYPE.STARTED && type !== COMPLETION_EVENT_TYPE.DELTA,
      );
      assert.deepEqual(terminals, [COMPLETION_EVENT_TYPE.CANCELLED]);
    } finally {
      other.close();
      await h.stop();
    }
  });

  test("[TAB-01] fechar outra conexão não aborta a completion de quem ainda está conectado", async () => {
    const h = await setup();
    const other = await connectHarnessClient({
      address: h.address,
      workspaceHello: WORKSPACE,
    });
    try {
      const stream = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-survive",
        prefix: "a",
      });
      const collected = collect(stream);
      h.source.push("c-survive", "x");
      await waitFor(() => persistedCompletionTypes(h, "c-survive").includes(COMPLETION_EVENT_TYPE.DELTA));
      other.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(h.source.calls[0]?.signal.aborted, false);
      h.source.push("c-survive", "end");
      assert.equal((await collected).at(-1)?.payload.type, COMPLETION_EVENT_TYPE.COMPLETED);
    } finally {
      await h.stop();
    }
  });

  test("[TAB-01] após a queda do daemon, novas chamadas falham em vez de ficar penduradas", async () => {
    const h = await setup();
    const stopping = h.daemon.stop();
    try {
      await stopping;
      await new Promise((resolve) => setTimeout(resolve, 200));
      await assert.rejects(
        Promise.race([
          h.client.createSession({ mode: "agent" }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("chamada pendurada")), 1_500)),
        ]),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError, String(error));
          return true;
        },
      );
      const stream = h.client.startCompletion({
        sessionId: h.sessionId,
        runId: h.runId,
        completionId: "c-after-drop",
        prefix: "a",
      });
      await assert.rejects(collect(stream), { code: PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM });
    } finally {
      h.client.close();
      await rm(h.dataRoot, { recursive: true, force: true });
    }
  });
});
