import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { fileWriteConflictProtocolError } from "@openagent/tools";

import {
  ApplyConflictController,
  APPLY_CONFLICT_DEFAULT_MESSAGE,
} from "../../src/review/apply-conflict.js";

describe("ERR-01 e2e — conflito mostra as duas versões sem aplicar", () => {
  it("exibe versão atual e proposta e bloqueia aplicação direta", () => {
    const dialog = new ApplyConflictController();
    const current = "const a = 2;\n";
    const proposed = "const a = 99;\n";

    const view = dialog.present([
      {
        relativePath: "src/a.ts",
        currentContent: current,
        proposedContent: proposed,
      },
    ]);

    assert.match(view.html, /data-testid="apply-conflict"/);
    assert.match(view.html, /data-testid="apply-conflict-current-body"/);
    assert.match(view.html, /data-testid="apply-conflict-proposed-body"/);
    assert.match(view.html, /disabled/);
    assert.equal(view.accessible.canApplyDirectly, false);
    assert.equal(view.accessible.entries[0]?.currentContent, current);
    assert.equal(view.accessible.entries[0]?.proposedContent, proposed);
    assert.notEqual(
      view.accessible.entries[0]?.currentContent,
      view.accessible.entries[0]?.proposedContent,
    );

    assert.throws(() => dialog.assertApplyBlocked(), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.CONFLICT);
      return true;
    });
  });

  it("reconstrói a UI a partir do ProtocolError CONFLICT do worker de escrita", () => {
    const conflict = {
      status: "conflict" as const,
      relativePath: "src/b.ts",
      expectedContentHashHex: "a".repeat(64),
      currentContentHashHex: "b".repeat(64),
      currentContent: "export const v = 2;\n",
      proposedContent: "export const v = 99;\n",
    };
    const protocolError = fileWriteConflictProtocolError(conflict);
    const dialog = new ApplyConflictController();
    const view = dialog.presentFromProtocolError(protocolError);

    assert.equal(view.accessible.message, protocolError.message);
    assert.equal(view.accessible.entries.length, 1);
    assert.equal(view.accessible.entries[0]?.relativePath, conflict.relativePath);
    assert.equal(view.accessible.entries[0]?.currentContent, conflict.currentContent);
    assert.equal(view.accessible.entries[0]?.proposedContent, conflict.proposedContent);
    assert.match(view.html, new RegExp(escapeRegExp(conflict.currentContent.trim())));
    assert.match(view.html, new RegExp(escapeRegExp(conflict.proposedContent.trim())));
  });

  it("estado inválido sem payload de conflito retorna INVALID_STATE", () => {
    const dialog = new ApplyConflictController();
    assert.throws(
      () =>
        dialog.presentFromProtocolError(
          new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "hash inválido", []),
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.throws(
      () => dialog.present([]),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
  });

  it("mensagem padrão alinha com ERR-01 de escrita", () => {
    const view = new ApplyConflictController().present([
      {
        relativePath: "x.ts",
        currentContent: "a",
        proposedContent: "b",
      },
    ]);
    assert.equal(view.accessible.message, APPLY_CONFLICT_DEFAULT_MESSAGE);
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
