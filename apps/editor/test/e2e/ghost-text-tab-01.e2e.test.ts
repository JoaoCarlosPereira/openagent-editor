import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMPLETION_EVENT_TYPE,
  ProtocolError,
  RPC_METHOD,
  type CompletionCancelParams,
  type CompletionCancelResult,
  type CompletionEventPayload,
  type CompletionStartParams,
  type CompletionStartResult,
} from "@openagent/protocol";

import {
  GhostTextController,
  type GhostTextCompletionPort,
  type GhostTextStream,
} from "../../src/tab/ghost-text.js";

interface FakeStream {
  params: CompletionStartParams;
  push(payload: CompletionEventPayload): void;
  end(): void;
}

class FakePort implements GhostTextCompletionPort {
  readonly streams: FakeStream[] = [];
  readonly cancels: CompletionCancelParams[] = [];

  start(params: CompletionStartParams): GhostTextStream {
    const queue: CompletionEventPayload[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const notify = (): void => {
      wake?.();
      wake = null;
    };
    this.streams.push({
      params,
      push: (payload) => {
        queue.push(payload);
        notify();
      },
      end: () => {
        ended = true;
        notify();
      },
    });
    const result: Promise<CompletionStartResult> = Promise.resolve({
      completionId: params.completionId,
      state: "completed",
      attempt: 1,
    });
    return {
      result,
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const next = queue.shift();
          if (next !== undefined) {
            yield { payload: next };
            continue;
          }
          if (ended) {
            return;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
    };
  }

  async cancel(params: CompletionCancelParams): Promise<CompletionCancelResult> {
    this.cancels.push(params);
    return { completionId: params.completionId, state: "cancelled", cancelled: true };
  }
}

function started(completionId: string): CompletionEventPayload {
  return {
    type: COMPLETION_EVENT_TYPE.STARTED,
    completionId,
    attempt: 1,
    kind: "line",
    inputHash: "sha256:input",
    resumeOffset: 0,
  };
}

function delta(completionId: string, offset: number, deltaText: string): CompletionEventPayload {
  return { type: COMPLETION_EVENT_TYPE.DELTA, completionId, attempt: 1, offset, deltaText };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function makeController(port: FakePort, initialText = "") {
  let counter = 0;
  return new GhostTextController({
    port,
    initialText,
    language: "typescript",
    newCompletionId: () => `cmp-${(counter += 1)}`,
  });
}

function assertInvalidState(error: unknown): boolean {
  assert.ok(error instanceof ProtocolError);
  assert.equal(error.code, "INVALID_STATE");
  return true;
}

describe("TAB-01 e2e - ghost text com aceitar, recusar e cancelar", () => {
  it("[TAB-01] digitar -> sugestao via stream -> aceitar insere o texto no buffer", async () => {
    const port = new FakePort();
    const ghost = makeController(port, "const a");

    assert.equal(ghost.snapshot.accessible.phase, "idle");
    assert.match(ghost.snapshot.html, /data-testid="ghost-text-panel"/);

    const requesting = ghost.type(" = ");
    assert.equal(requesting.accessible.phase, "requesting");
    assert.equal(requesting.accessible.canCancel, true);
    assert.equal(requesting.accessible.canAccept, false);
    assert.deepEqual(ghost.rpcLog[0], {
      method: RPC_METHOD.COMPLETION_START,
      params: {
        completionId: "cmp-1",
        prefix: "const a = ",
        language: "typescript",
        kind: "line",
      },
    });

    const stream = port.streams[0];
    assert.ok(stream);
    stream.push(started("cmp-1"));
    stream.push(delta("cmp-1", 0, "compute"));
    await flush();
    assert.equal(ghost.snapshot.accessible.phase, "suggesting");
    assert.equal(ghost.snapshot.accessible.suggestion, "compute");
    assert.equal(ghost.snapshot.accessible.canAccept, true);
    assert.match(ghost.snapshot.html, /data-testid="ghost-text-suggestion"/);
    assert.equal(ghost.text, "const a = ");

    stream.push(delta("cmp-1", 0, "compute"));
    stream.push(delta("cmp-1", 7, "();"));
    await flush();
    assert.equal(ghost.snapshot.accessible.suggestion, "compute();");

    stream.push({
      type: COMPLETION_EVENT_TYPE.COMPLETED,
      completionId: "cmp-1",
      attempt: 1,
      text: "compute();",
    });
    stream.end();
    await flush();

    const accepted = await ghost.accept();
    assert.equal(accepted.accessible.phase, "accepted");
    assert.equal(accepted.accessible.statusLabel, "Sugestao aceita");
    assert.equal(accepted.accessible.suggestion, "");
    assert.equal(ghost.text, "const a = compute();");
    assert.equal(accepted.accessible.bufferText, "const a = compute();");
    assert.equal(accepted.accessible.cursor, "const a = compute();".length);
    assert.equal(port.cancels.length, 0);
  });

  it("[TAB-01] aceitar sugestao parcial insere o texto e cancela a geracao residual", async () => {
    const port = new FakePort();
    const ghost = makeController(port, "fn");
    ghost.type(" ");
    const stream = port.streams[0];
    assert.ok(stream);
    stream.push(delta("cmp-1", 0, "main"));
    await flush();

    const accepted = await ghost.accept();
    assert.equal(accepted.accessible.phase, "accepted");
    assert.equal(ghost.text, "fn main");
    assert.deepEqual(port.cancels, [{ completionId: "cmp-1" }]);

    stream.push(delta("cmp-1", 4, "(late)"));
    await flush();
    assert.equal(ghost.text, "fn main");
    assert.equal(ghost.snapshot.accessible.phase, "accepted");
    assert.equal(ghost.snapshot.accessible.suggestion, "");
  });

  it("[TAB-01] recusar descarta a sugestao sem alterar o buffer", async () => {
    const port = new FakePort();
    const ghost = makeController(port, "let x");
    ghost.type(" =");
    const stream = port.streams[0];
    assert.ok(stream);
    stream.push(delta("cmp-1", 0, " 42;"));
    stream.push({
      type: COMPLETION_EVENT_TYPE.COMPLETED,
      completionId: "cmp-1",
      attempt: 1,
      text: " 42;",
    });
    stream.end();
    await flush();
    assert.equal(ghost.snapshot.accessible.phase, "suggesting");

    const rejected = await ghost.reject();
    assert.equal(rejected.accessible.phase, "rejected");
    assert.equal(rejected.accessible.statusLabel, "Sugestao recusada");
    assert.equal(rejected.accessible.suggestion, "");
    assert.equal(rejected.accessible.canAccept, false);
    assert.equal(ghost.text, "let x =");
    assert.doesNotMatch(rejected.html, /data-testid="ghost-text-suggestion"/);
    assert.equal(port.cancels.length, 0);
  });

  it("[TAB-01] cancelar durante a geracao chama completion.cancel e ignora deltas tardios", async () => {
    const port = new FakePort();
    const ghost = makeController(port, "return");
    ghost.type(" ");
    const stream = port.streams[0];
    assert.ok(stream);
    stream.push(delta("cmp-1", 0, "val"));
    await flush();
    assert.equal(ghost.snapshot.accessible.suggestion, "val");

    const cancelled = await ghost.cancel();
    assert.equal(cancelled.accessible.phase, "cancelled");
    assert.equal(cancelled.accessible.statusLabel, "Sugestao cancelada");
    assert.equal(cancelled.accessible.suggestion, "");
    assert.deepEqual(port.cancels, [{ completionId: "cmp-1" }]);
    assert.equal(ghost.rpcLog.at(-1)?.method, RPC_METHOD.COMPLETION_CANCEL);

    stream.push(delta("cmp-1", 3, "ue"));
    stream.push({
      type: COMPLETION_EVENT_TYPE.COMPLETED,
      completionId: "cmp-1",
      attempt: 1,
      text: "value",
    });
    stream.end();
    await flush();
    assert.equal(ghost.snapshot.accessible.phase, "cancelled");
    assert.equal(ghost.snapshot.accessible.suggestion, "");
    assert.equal(ghost.text, "return ");
  });

  it("[TAB-01] nova digitacao cancela a sugestao anterior e ignora seus deltas", async () => {
    const port = new FakePort();
    const ghost = makeController(port, "const");
    ghost.type(" ");
    const first = port.streams[0];
    assert.ok(first);
    first.push(delta("cmp-1", 0, "old"));
    await flush();

    ghost.type("v");
    await flush();
    assert.deepEqual(port.cancels, [{ completionId: "cmp-1" }]);
    assert.equal(ghost.snapshot.accessible.phase, "requesting");
    assert.equal(ghost.snapshot.accessible.suggestion, "");
    assert.equal(port.streams.length, 2);

    first.push(delta("cmp-1", 3, "late"));
    const second = port.streams[1];
    assert.ok(second);
    second.push(delta("cmp-2", 0, "alue = 1;"));
    await flush();
    assert.equal(ghost.snapshot.accessible.suggestion, "alue = 1;");

    const accepted = await ghost.accept();
    assert.equal(accepted.accessible.bufferText, "const value = 1;");
  });

  it("[TAB-01] cancelled do daemon encerra a sugestao sem inserir texto", async () => {
    const port = new FakePort();
    const ghost = makeController(port, "x");
    ghost.type("=");
    const stream = port.streams[0];
    assert.ok(stream);
    stream.push(delta("cmp-1", 0, "1"));
    stream.push({
      type: COMPLETION_EVENT_TYPE.CANCELLED,
      completionId: "cmp-1",
      attempt: 1,
      text: "1",
    });
    stream.end();
    await flush();
    assert.equal(ghost.snapshot.accessible.phase, "cancelled");
    assert.equal(ghost.text, "x=");
    assert.equal(port.cancels.length, 0);
  });

  it("[TAB-01] caminho de erro: estado/entrada invalidos retornam INVALID_STATE sem efeito colateral", async () => {
    const port = new FakePort();
    const ghost = makeController(port, "abc");
    const baseline = ghost.snapshot;

    await assert.rejects(() => ghost.accept(), assertInvalidState);
    await assert.rejects(() => ghost.reject(), assertInvalidState);
    await assert.rejects(() => ghost.cancel(), assertInvalidState);
    assert.throws(() => ghost.type(""), assertInvalidState);
    assert.throws(() => ghost.type(42 as unknown as string), assertInvalidState);
    assert.equal(ghost.snapshot, baseline);
    assert.equal(ghost.text, "abc");
    assert.equal(port.streams.length, 0);
    assert.equal(port.cancels.length, 0);
    assert.equal(ghost.rpcLog.length, 0);

    ghost.type(" ");
    await assert.rejects(() => ghost.accept(), assertInvalidState);
    await assert.rejects(() => ghost.reject(), assertInvalidState);
    assert.equal(ghost.snapshot.accessible.phase, "requesting");
    assert.equal(ghost.text, "abc ");

    const stream = port.streams[0];
    assert.ok(stream);
    stream.push(delta("cmp-1", 0, "def"));
    await flush();

    const first = ghost.accept();
    await assert.rejects(() => ghost.accept(), assertInvalidState);
    await assert.rejects(() => ghost.reject(), assertInvalidState);
    await first;
    assert.equal(ghost.text, "abc def");
    assert.deepEqual(port.cancels, [{ completionId: "cmp-1" }]);

    await assert.rejects(() => ghost.accept(), assertInvalidState);
    await assert.rejects(() => ghost.cancel(), assertInvalidState);
    assert.equal(ghost.text, "abc def");
    assert.equal(port.cancels.length, 1);
    assert.equal(ghost.snapshot.accessible.phase, "accepted");
  });

  it("[TAB-01] falha de stream volta a idle com codigo estavel e sem inserir texto", async () => {
    const port = new FakePort();
    const ghost = makeController(port, "a");
    ghost.type("b");
    const stream = port.streams[0];
    assert.ok(stream);
    stream.push(delta("cmp-1", 0, "c"));
    stream.push({
      type: COMPLETION_EVENT_TYPE.INCOMPLETE,
      completionId: "cmp-1",
      attempt: 1,
      text: "c",
      code: "INCOMPLETE_STREAM",
      reason: "stream interrompido",
      idempotentRetry: true,
      skipRepeatedMutations: true,
    });
    stream.end();
    await flush();
    assert.equal(ghost.snapshot.accessible.phase, "idle");
    assert.equal(ghost.snapshot.accessible.errorCode, "INCOMPLETE_STREAM");
    assert.equal(ghost.snapshot.accessible.suggestion, "");
    assert.equal(ghost.text, "ab");
    await assert.rejects(() => ghost.accept(), assertInvalidState);
  });
});
