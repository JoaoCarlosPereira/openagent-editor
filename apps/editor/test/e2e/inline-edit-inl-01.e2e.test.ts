import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  InlineEditController,
  type InlineEditApplyEdit,
  type InlineEditGenerateInput,
  type InlineEditPort,
} from "../../src/inline-edit/inline-edit.js";

interface CapturedInlineEditPort extends InlineEditPort {
  generations: InlineEditGenerateInput[];
  applies: InlineEditApplyEdit[];
  nextGenerateError?: Error;
  nextApplyError?: Error;
}

function makePort(expected: string = "x = 42; // melhorado"): CapturedInlineEditPort {
  const generations: InlineEditGenerateInput[] = [];
  const applies: InlineEditApplyEdit[] = [];
  const port = {
    generations,
    applies,
    nextGenerateError: undefined as Error | undefined,
    nextApplyError: undefined as Error | undefined,
    async generate(input: InlineEditGenerateInput): Promise<{ content: string }> {
      generations.push(input);
      if (port.nextGenerateError) {
        const error = port.nextGenerateError;
        port.nextGenerateError = undefined;
        throw error;
      }
      return { content: expected };
    },
    async apply(edit: InlineEditApplyEdit): Promise<void> {
      applies.push(edit);
      if (port.nextApplyError) {
        const error = port.nextApplyError;
        port.nextApplyError = undefined;
        throw error;
      }
    },
  };
  return port;
}

test("[INL-01] edicao da selecao mostra diff com aceitar, rejeitar e refinar; original preservado", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });
  assert.equal(controller.snapshot.accessible.phase, "idle");

  const offered = await controller.request({
    instruction: "melhore o codigo",
    document: "const x = 1;\nuso(x);\n",
    start: 0,
    end: 13,
  });
  assert.equal(offered.accessible.phase, "reviewing");
  assert.equal(offered.accessible.showsDiff, true);
  assert.equal(offered.accessible.canAccept, true);
  assert.equal(offered.accessible.canReject, true);
  assert.equal(offered.accessible.canRefine, true);
  assert.equal(offered.accessible.preservesOriginal, true);
  // original da selecao intacto e visivel para revisao
  assert.equal(offered.accessible.originalText, "const x = 1;\n");
  assert.match(offered.html, /data-testid="inline-edit-diff"/);
  assert.match(offered.html, /data-kind="add"/);
  assert.match(offered.html, /data-kind="remove"/);
  assert.match(offered.html, /data-testid="inline-edit-accept">Aceitar</);
  assert.match(offered.html, /data-testid="inline-edit-reject">Rejeitar</);
  assert.match(offered.html, /data-testid="inline-edit-refine">Refinar</);

  await controller.reject();
  assert.equal(controller.snapshot.accessible.phase, "rejected");
  assert.equal(port.applies.length, 0, "rejeitar nao escreve");
});

test("[INL-01] aceitar aplica a substituicao da selecao via port", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });
  await controller.request({
    instruction: "melhore o codigo",
    document: "const x = 1;\nuso(x);\n",
    start: 0,
    end: 13,
  });
  const applied = await controller.accept();
  assert.equal(applied.accessible.phase, "accepted");
  assert.deepEqual(port.applies, [{ start: 0, end: 13, replacement: "x = 42; // melhorado" }]);
  // texto original preservado mesmo apos aceitar (visor continua exibindo a revisao)
  assert.equal(applied.accessible.originalText, "const x = 1;\n");
});

test("[INL-01] insercao no cursor aplica sem perder o documento", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });
  const document = "antes|depois";
  const offered = await controller.request({
    instruction: "complete aqui",
    document,
    start: 5,
    end: 5,
  });
  assert.equal(offered.accessible.insertAtCursor, true);
  assert.equal(offered.accessible.showsDiff, true);
  const applied = await controller.accept();
  assert.equal(applied.accessible.phase, "accepted");
  assert.deepEqual(port.applies[0], { start: 5, end: 5, replacement: "x = 42; // melhorado" });
  assert.equal(typeof applied.html, "string");
});

test("[INL-01] refinar com instrucao substitui a proposta preservando o original", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });
  await controller.request({
    instruction: "melhore o codigo",
    document: "const x = 1;\n",
    start: 0,
    end: 13,
  });
  const firstProposal = controller.snapshot.accessible.proposal;
  assert.equal(firstProposal, "x = 42; // melhorado");

  const refined = await controller.refine("use const estrito");
  assert.equal(refined.accessible.phase, "reviewing");
  assert.equal(refined.accessible.canAccept, true);
  assert.equal(refined.accessible.canRefine, true);
  assert.equal(typeof refined.accessible.proposal, "string");
  assert.match(refined.html, /data-testid="inline-edit-diff"/);
  assert.equal(port.generations.length, 2);
  assert.equal(port.generations[1]?.instruction, "use const estrito");
  assert.equal(refined.accessible.originalText, "const x = 1;\n");
});

test("[INL-01] erro estavel INVALID_STATE sem efeito colateral", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });

  const stableError = async (action: () => Promise<unknown>) => {
    await assert.rejects(
      async () => {
        await action();
      },
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
  };
  const syncError = (action: () => unknown) => {
    assert.throws(action, (error: unknown) => error instanceof ProtocolError);
  };

  // aceitar/rejeitar/refinar sem edicao em revisao
  await stableError(() => controller.accept());
  await stableError(() => controller.reject());
  await stableError(() => controller.refine("teste"));
  assert.equal(controller.snapshot.accessible.phase, "idle");
  assert.equal(port.generations.length, 0);

  // entrada invalida: instrucao vazia, documento invalido, indices fora de ordem
  await stableError(() =>
    controller.request({ instruction: "", document: "a", start: 0, end: 1 }),
  );
  await stableError(() => controller.request({ instruction: "x", document: "", start: 0, end: 1 }));
  await stableError(() =>
    controller.request({ instruction: "x", document: "abc", start: 2, end: 1 }),
  );
  await stableError(() =>
    controller.request({ instruction: "x", document: "abc", start: 0, end: 4 }),
  );
  assert.equal(controller.snapshot.accessible.phase, "idle");
  assert.equal(port.generations.length, 0);

  // reset em fase em revisao falha estavelmente
  await controller.request({
    instruction: "melhore",
    document: "const x = 1;\n",
    start: 0,
    end: 13,
  });
  syncError(() => controller.reset());
  assert.equal(controller.snapshot.accessible.phase, "reviewing");
  assert.equal(controller.snapshot.accessible.originalText, "const x = 1;\n");
});

test("[INL-01] geracao falha restaura o estado anterior sem escrita", async () => {
  const port = makePort();
  port.nextGenerateError = new Error("provedor indisponivel");
  const controller = new InlineEditController({ port });
  await assert.rejects(
    () =>
      controller.request({
        instruction: "melhore",
        document: "const x = 1;\n",
        start: 0,
        end: 13,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError || error instanceof Error);
      return true;
    },
  );
  assert.equal(controller.snapshot.accessible.phase, "idle");
  assert.equal(port.applies.length, 0);

  // fluxo anterior aceito preservado quando nova geracao falha
  const novoController = new InlineEditController({ port });
  await novoController.request({
    instruction: "melhore",
    document: "const y = 1;\n",
    start: 0,
    end: 13,
  });
  await novoController.accept();
  port.nextGenerateError = new Error("falha de rede");
  await assert.rejects(() => novoController.refine("mais claro"));
  assert.equal(novoController.snapshot.accessible.phase, "accepted");
  assert.equal(port.applies.length, 1, "falha nao escreve");
});

test("[INL-01] refinamento falhado mantem a proposta anterior em revisao", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });
  await controller.request({
    instruction: "melhore",
    document: "const x = 1;\n",
    start: 0,
    end: 13,
  });
  port.nextGenerateError = new Error("falha de refino");
  await assert.rejects(() => controller.refine("esclarecer"));
  assert.equal(controller.snapshot.accessible.phase, "reviewing");
  assert.equal(controller.snapshot.accessible.proposal, "x = 42; // melhorado");
  assert.equal(port.applies.length, 0);
});

test("[INL-01] nova geracao durante geracao em andamento falha estavel", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });
  // port lento: trava a geracao
  let release: () => void = () => undefined;
  port.generate = async (input: InlineEditGenerateInput) => {
    port.generations.push(input);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { content: "tardio" };
  };
  const first = controller.request({
    instruction: "melhore",
    document: "const x = 1;\n",
    start: 0,
    end: 13,
  });
  assert.equal(controller.snapshot.accessible.phase, "generating");
  assert.throws(
    () => controller.request({ instruction: "outro", document: "const x = 1;\n", start: 0, end: 13 }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  release();
  const settled = await first;
  assert.equal(settled.accessible.phase, "reviewing");
  assert.equal(settled.accessible.proposal, "tardio");
});

test("[INL-01] reset apos decisao libera novo fluxo e porta invalida no construtor", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });
  await controller.request({
    instruction: "melhore",
    document: "const x = 1;\n",
    start: 0,
    end: 13,
  });
  await controller.reject();
  // aceitar/rejeitar apos deciso falha estavel e nao escreve
  await assert.rejects(
    async () => controller.accept(),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  await assert.rejects(async () => controller.reject());
  assert.equal(controller.snapshot.accessible.phase, "rejected");
  assert.equal(port.applies.length, 0);
  const reseted = controller.reset();
  assert.equal(reseted.accessible.phase, "idle");
  assert.equal(port.applies.length, 0);
  assert.throws(
    () => new InlineEditController({ port: {} as never }),
    (error: unknown) => error instanceof ProtocolError,
  );
  assert.throws(
    () => new InlineEditController({ port: null as never }),
    (error: unknown) => error instanceof ProtocolError,
  );
});

test("[INL-01] falha de apply mantem revisao e diff de insercao so tem linhas adicionadas", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });
  port.generate = async (input: InlineEditGenerateInput) => {
    port.generations.push(input);
    return { content: "linha1\nlinha2\nlinha3" };
  };
  const offered = await controller.request({
    instruction: "novo bloco",
    document: "base\n",
    start: 5,
    end: 5,
  });
  assert.match(offered.html, /data-testid="inline-edit-diff-row" data-kind="add"/);
  // insercao no cursor: original vazio, logo nenhuma linha removida ou de contexto
  assert.equal(port.generations[0]?.mode, "insert");
  assert.equal(offered.html.match(/data-kind="remove"/g), null);
  const addedRows = offered.html.match(/data-kind="add"/g);
  assert.equal(addedRows?.length, 3);
  port.nextApplyError = new Error("editor bloqueado");
  await assert.rejects(async () => controller.accept());
  assert.equal(controller.snapshot.accessible.phase, "reviewing");
  const accepted = await controller.accept();
  assert.equal(accepted.accessible.phase, "accepted");
  // 1a tentativa (falhada e registrada pela porta) + 2a tentativa bem sucedida
  assert.equal(port.applies.length, 2);
});
