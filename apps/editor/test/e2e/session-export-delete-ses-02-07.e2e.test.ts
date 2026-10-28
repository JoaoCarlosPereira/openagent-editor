import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError, RPC_METHOD } from "@openagent/protocol";

import {
  SessionDeleteController,
  SessionExportController,
  SessionExportDeleteController,
  type SessionDeletePort,
  type SessionExportPort,
} from "../../src/agents/session-export-delete.js";

const TEST_SESSION_ID = "ses-test-ses-02-07";

const INITIAL_MESSAGES = [
  { id: "msg-1", role: "user" as const, content: "Olá agente, preciso exportar e apagar esta sessão." },
  { id: "msg-2", role: "assistant" as const, content: "Com certeza, exportação em arquivo de texto pronta." },
];

describe("SES-02 / SES-07 e2e — Exportar e apagar sessão pela UI", () => {
  it("[SES-02] exportar sessão grava arquivo de texto com mensagens da sessão via diálogo/RPC", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "openagent-ses02-"));
    const exportedFilePath = join(tempDir, `${TEST_SESSION_ID}.txt`);

    try {
      const controller = new SessionExportDeleteController(TEST_SESSION_ID, INITIAL_MESSAGES);

      // Baseline inicial observável
      assert.match(controller.snapshot.html, /data-testid="session-export-panel"/);
      assert.equal(controller.snapshot.accessible.exportPhase, "idle");
      assert.equal(controller.snapshot.accessible.exportRef, null);
      assert.equal(controller.snapshot.accessible.messageCount, 2);
      assert.equal(controller.messages.length, 2);

      // 1. requestExport gera RPC session.export
      const pending = controller.requestExport({ format: "text", outputPath: exportedFilePath });
      assert.equal(pending.rpc.method, RPC_METHOD.SESSION_EXPORT);
      assert.equal(pending.rpc.sessionId, TEST_SESSION_ID);
      assert.deepEqual(pending.rpc.payload, { format: "text" });
      assert.equal(controller.snapshot.accessible.exportPhase, "pending");
      assert.match(controller.snapshot.html, /data-phase="pending"/);

      // 2. acceptExport recebe exportRef e atualiza UI
      const exportedView = controller.acceptExport({ exportRef: exportedFilePath });
      assert.equal(exportedView.accessible.exportPhase, "exported");
      assert.equal(exportedView.accessible.exportRef, exportedFilePath);
      assert.match(exportedView.html, /data-phase="exported"/);
      assert.match(exportedView.html, new RegExp(exportedFilePath));

      // 3. Teste ponta a ponta com SessionExportPort gravando arquivo de texto
      const port: SessionExportPort = {
        async exportSession(input) {
          assert.equal(input.sessionId, TEST_SESSION_ID);
          assert.equal(input.method, RPC_METHOD.SESSION_EXPORT);
          const fileContent = INITIAL_MESSAGES.map((m) => `[${m.role}]\n${m.content}`).join("\n\n") + "\n";
          writeFileSync(exportedFilePath, fileContent, "utf8");
          return { exportRef: exportedFilePath };
        },
      };

      const freshController = new SessionExportController(TEST_SESSION_ID, INITIAL_MESSAGES);
      const res = await freshController.exportViaPort(port, { format: "text" });

      assert.equal(res.exportRef, exportedFilePath);
      assert.equal(res.view.accessible.exported, true);
      assert.equal(res.view.accessible.exportRef, exportedFilePath);

      // Verifica se o arquivo de texto gravado no disco contém exatamente as mensagens da sessão (SES-02)
      const diskContent = readFileSync(exportedFilePath, "utf8");
      assert.match(diskContent, /Olá agente, preciso exportar/);
      assert.match(diskContent, /Com certeza, exportação em arquivo de texto pronta/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("[SES-07] apagar sessão remove mensagens locais e registros locais via RPC", async () => {
    const controller = new SessionExportDeleteController(TEST_SESSION_ID, INITIAL_MESSAGES);

    // Baseline com 2 mensagens
    assert.equal(controller.messages.length, 2);
    assert.equal(controller.snapshot.accessible.deleted, false);
    assert.equal(controller.snapshot.accessible.localMessagesRemoved, false);
    assert.match(controller.snapshot.html, /data-session-deleted="false"/);
    assert.match(controller.snapshot.html, /data-message-id="msg-1"/);

    // 1. requestDeleteConfirm abre diálogo de confirmação
    const confirmingView = controller.requestDeleteConfirm();
    assert.equal(confirmingView.accessible.deletePhase, "confirming");
    assert.match(confirmingView.html, /data-testid="session-delete-dialog"/);
    assert.match(confirmingView.html, /Confirmar exclusão/);

    // 2. Cancelar confirmação volta para idle sem efeitos
    const cancelledView = controller.cancelDeleteConfirm();
    assert.equal(cancelledView.accessible.deletePhase, "idle");
    assert.equal(controller.messages.length, 2);

    // 3. requestDelete gera RPC session.delete
    controller.requestDeleteConfirm();
    const pendingDelete = controller.requestDelete();
    assert.equal(pendingDelete.rpc.method, RPC_METHOD.SESSION_DELETE);
    assert.equal(pendingDelete.rpc.sessionId, TEST_SESSION_ID);
    assert.equal(controller.snapshot.accessible.deletePhase, "pending");

    // 4. acceptDelete limpa mensagens locais observáveis (SES-07)
    const deletedView = controller.acceptDelete({ deleted: true });
    assert.equal(deletedView.accessible.deletePhase, "deleted");
    assert.equal(deletedView.accessible.deleted, true);
    assert.equal(deletedView.accessible.localMessagesRemoved, true);
    assert.equal(deletedView.accessible.messageCount, 0);
    assert.equal(controller.messages.length, 0);
    assert.match(deletedView.html, /data-session-deleted="true"/);
    assert.match(deletedView.html, /data-empty="true"/);

    // 5. Teste ponta a ponta com SessionDeletePort
    let portCalled = false;
    const deletePort: SessionDeletePort = {
      async deleteSession(input) {
        assert.equal(input.sessionId, TEST_SESSION_ID);
        assert.equal(input.method, RPC_METHOD.SESSION_DELETE);
        portCalled = true;
        return { deleted: true };
      },
    };

    const freshDeleteController = new SessionDeleteController(TEST_SESSION_ID, INITIAL_MESSAGES);
    assert.equal(freshDeleteController.currentMessages.length, 2);

    const deleteRes = await freshDeleteController.deleteViaPort(deletePort);
    assert.equal(portCalled, true);
    assert.equal(deleteRes.view.accessible.deleted, true);
    assert.equal(deleteRes.view.accessible.localMessagesRemoved, true);
    assert.equal(freshDeleteController.currentMessages.length, 0);
  });

  it("[SES-02 / SES-07] caminhos de erro: entrada/estado inválidos (INVALID_STATE) e fora de escopo (OUT_OF_SCOPE) sem efeito colateral", async () => {
    const controller = new SessionExportDeleteController(TEST_SESSION_ID, INITIAL_MESSAGES);
    const baseline = controller.snapshot;

    // 1. sessionId inválido no construtor
    assert.throws(
      () => new SessionExportController("   "),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    // 2. format inválido lança INVALID_STATE
    assert.throws(
      () => controller.requestExport({ format: "json" as unknown as "text" }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    // Baseline preservado sem efeito colateral
    assert.equal(controller.snapshot.accessible.exportPhase, baseline.accessible.exportPhase);
    assert.equal(controller.messages.length, 2);

    // 3. Path traversal no caminho de exportação lança OUT_OF_SCOPE
    assert.throws(
      () => controller.requestExport({ outputPath: "../escaped/export.txt" }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
        return true;
      },
    );
    assert.equal(controller.snapshot.accessible.exportPhase, "idle");

    // 4. Caminho fora do allowedRoot lança OUT_OF_SCOPE
    assert.throws(
      () => controller.requestExport({ outputPath: "/etc/passwd", allowedRoot: "/workspace/project" }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
        return true;
      },
    );
    assert.equal(controller.snapshot.accessible.exportPhase, "idle");

    // 5. acceptExport chamado fora de fase pending lança INVALID_STATE
    assert.throws(
      () => controller.acceptExport({ exportRef: "/tmp/ref.txt" }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    // 6. requestDelete sem confirmação prévia lança INVALID_STATE
    assert.throws(
      () => controller.requestDelete(),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    // 7. requestDelete com workspace divergente lança OUT_OF_SCOPE
    controller.requestDeleteConfirm();
    assert.throws(
      () =>
        controller.requestDelete({
          targetWorkspaceId: "ws-outro",
          allowedWorkspaceId: "ws-correto",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
        return true;
      },
    );
    // Cancela confirmação e volta ao idle
    controller.cancelDeleteConfirm();
    assert.equal(controller.snapshot.accessible.deletePhase, "idle");
    assert.equal(controller.messages.length, 2);

    // 8. acceptDelete com payload inválido ou sem deleted:true lança INVALID_STATE
    controller.requestDeleteConfirm();
    controller.requestDelete();
    assert.throws(
      () => controller.acceptDelete({ deleted: false }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    // 9. Falha de transporte via port restaura fase para idle sem perder mensagens
    const failingExportPort: SessionExportPort = {
      async exportSession() {
        throw new Error("Erro de conexão RPC com o daemon");
      },
    };
    const failingExportController = new SessionExportController(TEST_SESSION_ID, INITIAL_MESSAGES);
    await assert.rejects(
      () => failingExportController.exportViaPort(failingExportPort),
      /Erro de conexão RPC com o daemon/,
    );
    assert.equal(failingExportController.snapshot.accessible.phase, "idle");

    const failingDeletePort: SessionDeletePort = {
      async deleteSession() {
        throw new Error("Falha no daemon ao apagar banco");
      },
    };
    const failingDeleteController = new SessionDeleteController(TEST_SESSION_ID, INITIAL_MESSAGES);
    await assert.rejects(
      () => failingDeleteController.deleteViaPort(failingDeletePort),
      /Falha no daemon ao apagar banco/,
    );
    assert.equal(failingDeleteController.snapshot.accessible.phase, "idle");
    assert.equal(failingDeleteController.currentMessages.length, 2);
  });
});
