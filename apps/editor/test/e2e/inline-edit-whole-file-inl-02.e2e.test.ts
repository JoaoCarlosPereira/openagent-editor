import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  InlineEditController,
  type InlineEditApplyEdit,
  type InlineEditGenerateInput,
  type InlineEditPort,
  type InlineEditRestoreEdit,
} from "../../src/inline-edit/inline-edit.js";

interface CapturedWholeFilePort extends InlineEditPort {
  generations: InlineEditGenerateInput[];
  applies: InlineEditApplyEdit[];
  restores: InlineEditRestoreEdit[];
  /** Estado do editor simulado; restore escreve aqui de volta. */
  editorContent: string;
  nextGenerateError?: Error;
  nextRestoreError?: Error;
}

const ORIGINAL = "function total(itens) {\n  return itens.length;\n}\n";
const REFACTOR = "const total = (itens) =>\n  itens.length;\n";

function makePort(): CapturedWholeFilePort {
  const generations: InlineEditGenerateInput[] = [];
  const applies: InlineEditApplyEdit[] = [];
  const restores: InlineEditRestoreEdit[] = [];
  const port = {
    generations,
    applies,
    restores,
    editorContent: ORIGINAL,
    nextGenerateError: undefined as Error | undefined,
    nextRestoreError: undefined as Error | undefined,
    async generate(input: InlineEditGenerateInput): Promise<{ content: string }> {
      generations.push(input);
      if (port.nextGenerateError) {
        const error = port.nextGenerateError;
        port.nextGenerateError = undefined;
        throw error;
      }
      return { content: REFACTOR };
    },
    async apply(edit: InlineEditApplyEdit): Promise<void> {
      applies.push(edit);
    },
    async restore(edit: InlineEditRestoreEdit): Promise<void> {
      restores.push(edit);
      if (port.nextRestoreError) {
        const error = port.nextRestoreError;
        port.nextRestoreError = undefined;
        throw error;
      }
      // a restauracao devolve o conteudo anterior ao pedido ao editor
      port.editorContent = edit.content;
    },
  };
  return port;
}

test("[INL-02] pedido de arquivo inteiro mostra previa do diff completo com acoes disponiveis", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });
  const offered = await controller.request({
    instruction: "refatore o arquivo para arrow function",
    document: ORIGINAL,
    start: 0,
    end: ORIGINAL.length,
  });
  const view = offered.accessible;
  assert.equal(view.phase, "reviewing");
  assert.equal(view.mode, "wholefile");
  assert.equal(view.wholeFile, true);
  // previa: diff do arquivo inteiro antes do aceite
  assert.equal(view.showsDiff, true);
  assert.equal(view.originalText, ORIGINAL);
  assert.equal(view.proposal, REFACTOR);
  assert.equal(view.canAccept, true);
  assert.equal(view.canReject, true);
  assert.equal(view.canRefine, true);
  assert.match(offered.html, /data-mode="wholefile"/);
  assert.match(offered.html, /data-testid="inline-edit-whole-file"/);
  assert.match(offered.html, /data-testid="inline-edit-diff"/);
  assert.match(offered.html, /data-testid="inline-edit-diff-row" data-kind="remove"/);
  assert.match(offered.html, /data-testid="inline-edit-diff-row" data-kind="add"/);
  assert.match(offered.html, /data-testid="inline-edit-accept">Aceitar</);
  assert.match(offered.html, /data-testid="inline-edit-reject">Rejeitar</);
  assert.match(offered.html, /data-testid="inline-edit-refine">Refinar</);
  assert.match(offered.html, /data-testid="inline-edit-refine-instruction"/);
  // o port sabe que a edicao e do arquivo inteiro
  assert.equal(port.generations[0]?.mode, "wholefile");
  assert.equal(port.generations[0]?.originalText, ORIGINAL);
  // selecao parcial do arquivo nao e edicao do arquivo inteiro
  const parcial = await new InlineEditController({ port }).request({
    instruction: "refatore so a abertura",
    document: ORIGINAL,
    start: 0,
    end: 10,
  });
  assert.equal(parcial.accessible.mode, "selection");
  assert.equal(parcial.accessible.wholeFile, false);
  assert.equal(parcial.html.includes("inline-edit-whole-file"), false);
});

test("[INL-02] rejeitar restaura o conteudo anterior ao pedido", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });
  await controller.request({
    instruction: "refatore o arquivo inteiro",
    document: ORIGINAL,
    start: 0,
    end: ORIGINAL.length,
  });
  assert.equal(port.editorContent, ORIGINAL);
  // simulacao: previa refletida no editor durante a revisao
  port.editorContent = REFACTOR;

  const rejected = await controller.reject();
  assert.equal(rejected.accessible.phase, "rejected");
  // restauracao por a porta devolve o conteudo anterior ao pedido
  assert.deepEqual(port.restores, [{ content: ORIGINAL }]);
  assert.equal(port.editorContent, ORIGINAL, "editor restaurado ao original");
  assert.equal(port.applies.length, 0, "rejeitar nunca aplica a proposta");
  assert.equal(rejected.accessible.originalText, ORIGINAL);
});

test("[INL-02] aceitar aplica a substituicao do arquivo inteiro e refinar parte do diff existente", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });
  await controller.request({
    instruction: "refatore o arquivo inteiro",
    document: ORIGINAL,
    start: 0,
    end: ORIGINAL.length,
  });
  const applied = await controller.accept();
  assert.equal(applied.accessible.phase, "accepted");
  assert.deepEqual(port.applies, [
    { start: 0, end: ORIGINAL.length, replacement: REFACTOR },
  ]);
  assert.equal(applied.accessible.wholeFile, true);

  // novo fluxo com refino do arquivo inteiro: previousProposal acompanha
  const second = new InlineEditController({ port });
  await second.request({
    instruction: "refatore o arquivo inteiro",
    document: ORIGINAL,
    start: 0,
    end: ORIGINAL.length,
  });
  await second.refine("adicione tipagem");
  assert.equal(port.generations.length, 3);
  const refineCall = port.generations[2];
  assert.equal(refineCall?.mode, "wholefile");
  assert.equal(refineCall?.previousProposal, REFACTOR);
  assert.equal(second.snapshot.accessible.refinementCount, 1);
  assert.equal(second.snapshot.accessible.originalText, ORIGINAL);

  await second.reject();
  assert.equal(second.snapshot.accessible.phase, "rejected");
});

test("[INL-02] erro estavel INVALID_STATE sem efeito colateral", async () => {
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

  // decisao de arquivo inteiro em idle falha estavel e nao restaura nada
  await stableError(() => controller.reject());
  assert.equal(port.restores.length, 0);
  assert.equal(controller.snapshot.accessible.phase, "idle");
  assert.equal(port.generations.length, 0);

  // entrada invalida no pedido do arquivo inteiro
  await stableError(() =>
    controller.request({ instruction: "", document: ORIGINAL, start: 0, end: ORIGINAL.length }),
  );
  await stableError(() =>
    controller.request({ instruction: "x", document: ORIGINAL, start: 0, end: ORIGINAL.length + 1 }),
  );
  assert.equal(controller.snapshot.accessible.phase, "idle");
  assert.equal(port.generations.length, 0, "nenhuma geracao disparada em entrada invalida");
  assert.equal(port.restores.length, 0);
});

test("[INL-02] falha na restauracao mantem a previa em revisao e nao aplica", async () => {
  const port = makePort();
  const controller = new InlineEditController({ port });
  await controller.request({
    instruction: "refatore o arquivo inteiro",
    document: ORIGINAL,
    start: 0,
    end: ORIGINAL.length,
  });
  port.nextRestoreError = new Error("restauracao falhou");
  await assert.rejects(
    async () => controller.reject(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      return true;
    },
  );
  assert.equal(controller.snapshot.accessible.phase, "reviewing", "proposta permanece em revisao");
  assert.equal(controller.snapshot.accessible.proposal, REFACTOR);
  assert.equal(controller.snapshot.accessible.originalText, ORIGINAL);
  assert.equal(port.applies.length, 0, "falha de restauracao nao aplica");
  // segunda tentativa sem falha restaura e encerra; a porta registra as duas
  // tentativas (a primeira falhou depois de registrar)
  const rejected = await controller.reject();
  assert.equal(rejected.accessible.phase, "rejected");
  assert.deepEqual(port.restores, [{ content: ORIGINAL }, { content: ORIGINAL }]);
});

test("[INL-02] port sem restauracao permite rejeitar sem escrita", async () => {
  const port = {
    generations: [] as InlineEditGenerateInput[],
    applies: [] as InlineEditApplyEdit[],
    async generate(input: InlineEditGenerateInput): Promise<{ content: string }> {
      port.generations.push(input);
      return { content: REFACTOR };
    },
    async apply(_edit: InlineEditApplyEdit): Promise<void> {
      port.applies.push(_edit);
    },
  } satisfies InlineEditPort & {
    generations: InlineEditGenerateInput[];
    applies: InlineEditApplyEdit[];
  };
  const controller = new InlineEditController({ port });
  await controller.request({
    instruction: "refatore o arquivo inteiro",
    document: ORIGINAL,
    start: 0,
    end: ORIGINAL.length,
  });
  const rejected = await controller.reject();
  assert.equal(rejected.accessible.phase, "rejected");
  assert.equal(port.applies.length, 0);
});
