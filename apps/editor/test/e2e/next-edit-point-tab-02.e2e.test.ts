import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMPLETION_EVENT_TYPE,
  ProtocolError,
  type CompletionCancelParams,
  type CompletionCancelResult,
  type CompletionEventPayload,
  type CompletionStartParams,
  type CompletionStartResult,
} from "@openagent/protocol";

import {
  GhostTextController,
  NEXT_EDIT_POINT_MARKER,
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
    kind: "block",
    inputHash: "sha256:input",
    resumeOffset: 0,
  };
}

function delta(completionId: string, offset: number, deltaText: string): CompletionEventPayload {
  return { type: COMPLETION_EVENT_TYPE.DELTA, completionId, attempt: 1, offset, deltaText };
}

function completed(completionId: string, text: string): CompletionEventPayload {
  return { type: COMPLETION_EVENT_TYPE.COMPLETED, completionId, attempt: 1, text };
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

describe("TAB-02 e2e - próximo ponto de edição e salto por teclado", () => {
  it("[TAB-02] aceitar sugestão com continuação indica o próximo ponto e o Tab salta aplicando a continuação nele", async () => {
    const port = new FakePort();
    const ghost = makeController(port, "export function x() { ");

    const requesting = ghost.type("go");
    assert.equal(requesting.accessible.phase, "requesting");

    const first = port.streams[0];
    assert.ok(first);
    const body = "await x();";
    const rest = "\n  await done();";
    first.push(started("cmp-1"));
    first.push(delta("cmp-1", 0, body));
    first.push(completed("cmp-1", body + NEXT_EDIT_POINT_MARKER + rest));
    first.end();
    await flush();

    const accepted = await ghost.accept();
    assert.equal(accepted.accessible.phase, "accepted");
    const point = accepted.accessible.nextEditPoint;
    assert.ok(point, "próximo ponto de edição deve ser indicado");
    const baseCursor = "export function x() { go".length;
    const expectedOffset = baseCursor + body.length;
    assert.equal(point.offset, expectedOffset);
    assert.equal(point.line, 1);
    assert.equal(point.column, expectedOffset + 1);
    assert.equal(accepted.accessible.canJump, true);
    // Continuação não entra no buffer no aceite; fica reservada ao salto.
    assert.equal(ghost.text, "export function x() { go" + body);
    assert.doesNotMatch(accepted.html, new RegExp(escapeRegExp(rest)));

    // Indicação visível do próximo ponto + salto por teclado (Tab).
    assert.match(accepted.html, /data-testid="ghost-text-next-point" role="status"/);
    assert.match(accepted.html, /Proximo ponto de edicao: linha 1, coluna 35 \(Tab para saltar\)/);
    assert.match(accepted.html, /data-testid="ghost-text-jump" aria-keyshortcuts="Tab"/);

    const jumped = await ghost.jump();
    assert.equal(jumped.accessible.phase, "jumped");
    assert.equal(jumped.accessible.statusLabel, "Salto para proximo ponto");
    assert.equal(jumped.accessible.nextEditPoint, null);
    assert.equal(jumped.accessible.canJump, false);
    assert.equal(jumped.accessible.cursor, expectedOffset + rest.length);
    assert.equal(jumped.accessible.bufferText, "export function x() { go" + body + rest);
    // O salto é ação local do editor: completa o rpclog de completion sem novas chamadas.
    assert.equal(port.cancels.length, 0);

    // Sem novo ponto: salto repetido é recusado com código estável, sem efeito.
    const depois = jumped.accessible;
    await assert.rejects(() => ghost.jump(), assertInvalidState);
    assert.deepEqual(ghost.snapshot.accessible.bufferText, depois.bufferText);
    assert.deepEqual(ghost.snapshot.accessible.cursor, depois.cursor);
  });

  it("[TAB-02] marcador dividido entre deltas do stream também registra o próximo ponto", async () => {
    const port = new FakePort();
    const ghost = makeController(port, "const ");
    ghost.type("do");
    const first = port.streams[0];
    assert.ok(first);
    const body = "arma(";
    const rest = ")?";
    first.push(started("cmp-1"));
    first.push(delta("cmp-1", 0, body));
    first.push(delta("cmp-1", body.length, NEXT_EDIT_POINT_MARKER.slice(0, 5)));
    first.push(delta("cmp-1", body.length + 5, NEXT_EDIT_POINT_MARKER.slice(5) + rest));
    first.push(completed("cmp-1", body + NEXT_EDIT_POINT_MARKER + rest));
    first.end();
    await flush();

    const accepted = await ghost.accept();
    const point = accepted.accessible.nextEditPoint;
    assert.ok(point);
    assert.equal(point.offset, "const do".length + body.length);
    const jumped = await ghost.jump();
    assert.equal(jumped.accessible.bufferText, "const do" + body + rest);
    assert.equal(jumped.accessible.cursor, "const do".length + body.length + rest.length);
  });

  it("[TAB-02] sugestão sem continuação mantém TAB-01: sem próximo ponto e salto recusado sem efeito", async () => {
    const port = new FakePort();
    const ghost = makeController(port, "let x");
    ghost.type(" =");
    const first = port.streams[0];
    assert.ok(first);
    first.push(delta("cmp-1", 0, " 42;"));
    first.push(completed("cmp-1", " 42;"));
    first.end();
    await flush();

    const accepted = await ghost.accept();
    assert.equal(accepted.accessible.phase, "accepted");
    assert.equal(accepted.accessible.nextEditPoint, null);
    assert.equal(accepted.accessible.canJump, false);
    assert.doesNotMatch(accepted.html, /ghost-text-next-point/);
    assert.match(accepted.html, /data-testid="ghost-text-jump" aria-keyshortcuts="Tab" disabled/);
    assert.equal(ghost.text, "let x = 42;");

    // Caminho de erro: salto sem próximo ponto não altera buffer nem cursor nem rpc.
    const baseline = ghost.snapshot;
    await assert.rejects(() => ghost.jump(), assertInvalidState);
    assert.equal(ghost.snapshot, baseline);
  });

  it("[TAB-02] caminho de erro: digitação nova limpa o próximo ponto pendente e salto volta a INVALID_STATE", async () => {
    const port = new FakePort();
    const ghost = makeController(port, "let a");
    ghost.type(" =");
    const first = port.streams[0];
    assert.ok(first);
    const body = "1;";
    const rest = " // retomar";
    first.push(delta("cmp-1", 0, body));
    first.push(delta("cmp-1", body.length, NEXT_EDIT_POINT_MARKER));
    first.push(completed("cmp-1", body + NEXT_EDIT_POINT_MARKER + rest));
    first.end();
    await flush();

    const accepted = await ghost.accept();
    assert.ok(accepted.accessible.nextEditPoint);

    // Nova digitação cancela a continuação pendente (comportamento de nova sugestão).
    ghost.type("b");
    await flush();
    assert.equal(ghost.snapshot.accessible.nextEditPoint, null);
    assert.equal(ghost.snapshot.accessible.canJump, false);
    assert.equal(ghost.text, "let a =1;b");
    await assert.rejects(() => ghost.jump(), assertInvalidState);
    assert.equal(ghost.text, "let a =1;b");

    // Entrada inválida de digitação continua estável (TAB-01) e sem efeito colateral.
    assert.throws(() => ghost.type(42 as unknown as string), assertInvalidState);
    assert.equal(ghost.text, "let a =1;b");
  });
});

function escapeRegExp(text: string): string {
  return text.replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("(", "\\(").replaceAll(")", "\\)").replaceAll("+", "\\+");
}
