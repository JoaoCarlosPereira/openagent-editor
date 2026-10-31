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
  proposalQueue: string[];
}

function makePort(proposals: string[]): CapturedInlineEditPort {
  const generations: InlineEditGenerateInput[] = [];
  const applies: InlineEditApplyEdit[] = [];
  const port = {
    generations,
    applies,
    proposalQueue: [...proposals],
    async generate(input: InlineEditGenerateInput): Promise<{ content: string }> {
      const next = port.proposalQueue.shift();
      if (next === undefined) {
        throw new Error("fila de propostas vazia");
      }
      generations.push(input);
      return { content: next };
    },
    async apply(edit: InlineEditApplyEdit): Promise<void> {
      applies.push(edit);
    },
  };
  return port;
}

const DOCUMENT = "const x = 1;\nuso(x);\n";
const SELECTED = "const x = 1;\n";

test("[INL-01] refinamento usa o diff existente: previousProposal no port e novo diff sem perder o original", async () => {
  const port = makePort(["x = 42; // melhorado", "let x = 42 /* conciso */"]);
  const controller = new InlineEditController({ port });
  await controller.request({
    instruction: "melhore o codigo",
    document: DOCUMENT,
    start: 0,
    end: 13,
  });
  const first = controller.snapshot.accessible;
  assert.equal(first.proposal, "x = 42; // melhorado");
  assert.equal(first.refinementCount, 0);

  const refined = await controller.refine("torne mais conciso");
  const second = refined.accessible;
  // a proposta atual (diff existente) acompanha a instrucao de refino
  assert.equal(port.generations.length, 2);
  assert.equal(port.generations[1]?.instruction, "torne mais conciso");
  assert.equal(port.generations[1]?.previousProposal, "x = 42; // melhorado");
  assert.equal(port.generations[1]?.originalText, SELECTED);
  // novo diff em revisao sobre o MESMO original preservado
  assert.equal(second.phase, "reviewing");
  assert.equal(second.proposal, "let x = 42 /* conciso */");
  assert.notEqual(second.proposal, first.proposal);
  assert.equal(second.originalText, SELECTED);
  assert.equal(second.preservesOriginal, true);
  assert.equal(second.showsDiff, true);
  assert.equal(second.canAccept, true);
  assert.equal(second.canReject, true);
  assert.equal(second.canRefine, true);
  assert.equal(second.refinementCount, 1);
  assert.match(refined.html, /data-testid="inline-edit-diff"/);
  assert.match(refined.html, /data-refinements="1"/);
});

test("[INL-01] rodadas sucessivas de refino contam e rejeitar em qualquer rodada nao escreve", async () => {
  const port = makePort(["primeira", "segunda refino", "terceira refino"]);
  const controller = new InlineEditController({ port });
  await controller.request({
    instruction: "melhore o codigo",
    document: DOCUMENT,
    start: 0,
    end: 13,
  });
  const afterFirst = await controller.refine("aprimorar");
  assert.equal(afterFirst.accessible.refinementCount, 1);
  assert.equal(afterFirst.accessible.originalText, SELECTED);
  const afterSecond = await controller.refine("mais claro");
  assert.equal(afterSecond.accessible.refinementCount, 2);
  assert.equal(afterSecond.accessible.originalText, SELECTED);
  assert.match(afterSecond.html, /data-refinements="2"/);
  // a 2a rodada tambem partiu do diff existente
  assert.equal(port.generations[2]?.previousProposal, "segunda refino");

  const rejected = await controller.reject();
  assert.equal(rejected.accessible.phase, "rejected");
  assert.equal(rejected.accessible.originalText, SELECTED);
  assert.equal(port.applies.length, 0, "rejeitar nunca escreve no editor");
});

test("[INL-01] falha de refino restaura proposta e contagem da rodada anterior", async () => {
  const port = makePort(["proposta 1", "proposta 2"]);
  const controller = new InlineEditController({ port });
  await controller.request({
    instruction: "melhore o codigo",
    document: DOCUMENT,
    start: 0,
    end: 13,
  });
  const refined = await controller.refine("encurtar");
  assert.equal(refined.accessible.proposal, "proposta 2");
  assert.equal(refined.accessible.refinementCount, 1);

  // a porta agora nao tem proposta: a proxima geracao falha
  await assert.rejects(
    async () => controller.refine("mais claro"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      return true;
    },
  );
  // a rodada anterior permanece integralmente em revisao
  assert.equal(controller.snapshot.accessible.phase, "reviewing");
  assert.equal(controller.snapshot.accessible.proposal, "proposta 2");
  assert.equal(controller.snapshot.accessible.refinementCount, 1);
  assert.equal(controller.snapshot.accessible.originalText, SELECTED);
  assert.equal(port.applies.length, 0, "falha de refino nao escreve");
});

test("[INL-01] caminho de erro do refino: instrucao invalida e estado invalido sem efeito colateral", async () => {
  const port = makePort(["so a primeira"]);
  const controller = new InlineEditController({ port });

  // refino em idle falha estavel e nao gera nada
  await assert.rejects(
    async () => controller.refine("teste"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.equal(controller.snapshot.accessible.phase, "idle");
  assert.equal(port.generations.length, 0);

  await controller.request({
    instruction: "melhore o codigo",
    document: DOCUMENT,
    start: 0,
    end: 13,
  });
  const before = controller.snapshot.accessible;

  // instrucao vazia/espacos falha estavel e preserva a proposta da rodada 0
  for (const bad of ["", "   "]) {
    await assert.rejects(
      async () => controller.refine(bad),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
  }
  assert.equal(controller.snapshot.accessible.phase, "reviewing");
  assert.equal(controller.snapshot.accessible.proposal, before.proposal);
  assert.equal(controller.snapshot.accessible.refinementCount, 0);
  assert.equal(port.generations.length, 1, "nenhuma geracao extra disparada");
});
