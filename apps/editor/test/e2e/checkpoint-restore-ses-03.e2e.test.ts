import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError, RPC_METHOD } from "@openagent/protocol";

import {
  CHECKPOINT_RESTORE_CONFLICT_MESSAGE,
  CHECKPOINT_RESTORE_OK_MESSAGE,
  CheckpointRestoreController,
} from "../../src/review/checkpoint-restore.js";

const CHECKPOINT_ID = "ckpt-ses-03-e2e-001";
const RUN_FILE = "src/run-touched.ts";
const OTHER_FILE = "src/manual-edit.ts";

describe("SES-03 e2e — restaurar checkpoint pela UI", () => {
  it("[SES-03] restauração bem-sucedida lista só arquivos da execução e emite checkpoint.restore", () => {
    const ui = new CheckpointRestoreController();
    assert.equal(ui.phase, "idle");
    assert.match(ui.snapshot.html, /data-testid="checkpoint-restore"/);
    assert.match(ui.snapshot.html, /data-testid="checkpoint-restore-action"/);

    const request = ui.requestRestore(CHECKPOINT_ID);
    assert.equal(request.rpc.method, RPC_METHOD.CHECKPOINT_RESTORE);
    assert.deepEqual(request.rpc.params, { checkpointId: CHECKPOINT_ID });
    assert.equal(request.view.accessible.checkpointId, CHECKPOINT_ID);

    const view = ui.acceptOutcome({
      result: { restored: true },
      restoredPaths: [RUN_FILE],
    });

    assert.equal(view.accessible.phase, "restored");
    assert.equal(view.accessible.message, CHECKPOINT_RESTORE_OK_MESSAGE);
    assert.deepEqual(view.accessible.restoredPaths, [RUN_FILE]);
    assert.equal(view.accessible.conflicts.length, 0);
    assert.equal(view.accessible.canOverwrite, false);
    assert.match(view.html, /data-phase="restored"/);
    assert.match(view.html, /data-testid="checkpoint-restore-path"/);
    assert.match(view.html, new RegExp(escapeRegExp(RUN_FILE)));
    assert.doesNotMatch(view.html, new RegExp(escapeRegExp(OTHER_FILE)));
    assert.ok(!view.accessible.restoredPaths.includes(OTHER_FILE));
  });

  it("[SES-03] conflito mostra as duas versões e bloqueia sobrescrita sem gravar por cima", () => {
    const ui = new CheckpointRestoreController();
    ui.requestRestore(CHECKPOINT_ID);

    const current = "export const v = 99;\n";
    const proposed = "export const v = 1;\n";
    const view = ui.acceptOutcome({
      result: {
        conflict: true,
        conflicts: [
          {
            relativePath: RUN_FILE,
            expectedContentHashHex: "a".repeat(64),
            currentContentHashHex: "b".repeat(64),
            currentContent: current,
            proposedContent: proposed,
          },
        ],
      },
    });

    assert.equal(view.accessible.phase, "conflict");
    assert.equal(view.accessible.message, CHECKPOINT_RESTORE_CONFLICT_MESSAGE);
    assert.equal(view.accessible.canOverwrite, false);
    assert.equal(view.accessible.restoredPaths.length, 0);
    assert.equal(view.accessible.conflicts.length, 1);
    assert.equal(view.accessible.conflicts[0]?.relativePath, RUN_FILE);
    assert.equal(view.accessible.conflicts[0]?.currentContent, current);
    assert.equal(view.accessible.conflicts[0]?.proposedContent, proposed);
    assert.notEqual(
      view.accessible.conflicts[0]?.currentContent,
      view.accessible.conflicts[0]?.proposedContent,
    );
    assert.match(view.html, /data-testid="checkpoint-restore-current-body"/);
    assert.match(view.html, /data-testid="checkpoint-restore-proposed-body"/);
    assert.match(view.html, /data-testid="checkpoint-restore-overwrite"/);
    assert.match(view.html, /disabled/);
    assert.match(view.html, new RegExp(escapeRegExp(current.trim())));
    assert.match(view.html, new RegExp(escapeRegExp(proposed.trim())));

    assert.throws(() => ui.assertOverwriteBlocked(), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.CONFLICT);
      return true;
    });
  });

  it("[SES-03] entrada ou estado inválido retorna INVALID_STATE sem efeito colateral", () => {
    const ui = new CheckpointRestoreController();
    const before = ui.snapshot.html;

    assert.throws(() => ui.requestRestore(""), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    });
    assert.throws(() => ui.requestRestore("   "), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    });
    assert.throws(() => ui.requestRestore(null), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    });

    assert.equal(ui.phase, "idle");
    assert.equal(ui.snapshot.html, before);
    assert.equal(ui.snapshot.accessible.checkpointId, null);

    assert.throws(
      () => ui.acceptOutcome({ result: { restored: true }, restoredPaths: [RUN_FILE] }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    ui.requestRestore(CHECKPOINT_ID);
    assert.throws(
      () => ui.acceptOutcome({ result: { restored: true }, restoredPaths: [] }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.throws(
      () =>
        ui.acceptOutcome({
          result: { conflict: true, conflicts: [] },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.equal(ui.phase, "idle");
    assert.equal(ui.snapshot.accessible.restoredPaths.length, 0);
    assert.equal(ui.snapshot.accessible.conflicts.length, 0);

    assert.throws(() => ui.assertOverwriteBlocked(), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    });
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
