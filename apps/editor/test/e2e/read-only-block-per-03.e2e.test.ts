import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE } from "@openagent/policy";
import { ProtocolError } from "@openagent/protocol";

import {
  ReadOnlyExecutionBlockController,
  evaluateReadOnlyExecutionBlock,
} from "../../src/permissions/read-only-block.js";

describe("PER-03 e2e — bloqueio Somente leitura visível na UI", () => {
  it("bloqueia gravação de arquivo e exibe mensagem fixa", () => {
    const controller = new ReadOnlyExecutionBlockController();
    const result = controller.attempt({
      executionMode: "read_only",
      capability: "file.write",
      target: { kind: "path", path: "/tmp/demo.txt" },
    });
    assert.equal(result.outcome, "blocked");
    if (result.outcome !== "blocked") {
      return;
    }
    assert.equal(result.error.code, "PERMISSION_DENIED");
    assert.equal(result.view.accessible.message, EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE);
    assert.match(result.view.html, /data-testid="read-only-block"/);
    assert.match(result.view.html, /data-testid="read-only-block-message"/);
    assert.equal(result.view.accessible.action, "Gravar arquivo");
    assert.equal(result.view.accessible.target, "/tmp/demo.txt");
    assert.equal(controller.isBlockedVisible, true);
  });

  it("bloqueia comando shell que altera o workspace", () => {
    const result = evaluateReadOnlyExecutionBlock({
      executionMode: "read_only",
      capability: "shell.exec",
      target: { kind: "command", command: "npm test" },
    });
    assert.equal(result.outcome, "blocked");
    if (result.outcome !== "blocked") {
      return;
    }
    assert.equal(result.view.accessible.message, EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE);
    assert.equal(result.view.accessible.action, "Executar comando");
    assert.equal(result.view.accessible.target, "npm test");
  });

  it("permite leitura/busca em Somente leitura", () => {
    const controller = new ReadOnlyExecutionBlockController();
    const read = controller.attempt({
      executionMode: "read_only",
      capability: "file.read",
      target: { kind: "path", path: "/tmp/read.txt" },
    });
    assert.equal(read.outcome, "allowed");
    assert.equal(controller.isBlockedVisible, false);

    const search = controller.attempt({
      executionMode: "read_only",
      capability: "file.search",
      target: { kind: "path", path: "/tmp" },
    });
    assert.equal(search.outcome, "allowed");
    assert.equal(controller.isBlockedVisible, false);
  });

  it("caminho de erro: capability inválida retorna INVALID_STATE sem efeito colateral", () => {
    const controller = new ReadOnlyExecutionBlockController();
    controller.attempt({
      executionMode: "read_only",
      capability: "file.write",
      target: { kind: "path", path: "/tmp/x" },
    });
    assert.throws(
      () =>
        controller.attempt({
          executionMode: "read_only",
          capability: "",
          target: { kind: "path", path: "/tmp/x" },
        }),
      (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
    assert.equal(controller.isBlockedVisible, true);
    const view = controller.currentView();
    assert.ok(view);
    assert.equal(view?.accessible.message, EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE);
  });
});
