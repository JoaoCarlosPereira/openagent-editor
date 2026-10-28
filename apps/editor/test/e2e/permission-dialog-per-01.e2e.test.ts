import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RunToolPermissionFlow,
  assertRunToolMayExecute,
  prepareRunToolPermission,
} from "@openagent/policy";
import { ProtocolError } from "@openagent/protocol";

import { PermissionDialogController } from "../../src/permissions/permission-dialog.js";

describe("PER-01 e2e — diálogo de permissão com ação, alvo, escopo e degradação", () => {
  it("exibe ação/alvo/escopo e só executa após aceite explícito", () => {
    const flow = new RunToolPermissionFlow();
    const dialog = new PermissionDialogController(flow);
    const prepared = flow.requestPermission({
      runId: "run-e2e-1",
      sessionId: "sess-e2e-1",
      request: {
        requestId: "req-per-01",
        capability: "file.write",
        target: { kind: "path", path: "/tmp/demo.txt" },
        offeredScopes: ["once", "session"],
      },
    });
    assert.equal(prepared.phase, "pending");
    assert.equal(prepared.canExecute, false);

    const open = dialog.openFromPrepared(
      { runId: "run-e2e-1", sessionId: "sess-e2e-1" },
      prepared,
    );
    assert.match(open.view.html, /data-testid="permission-dialog"/);
    assert.match(open.view.html, /data-testid="permission-action"/);
    assert.equal(open.view.accessible.action, prepared.prompt.action);
    assert.equal(open.view.accessible.target, prepared.prompt.target);
    assert.deepEqual(open.view.accessible.scopeLabels, ["Uma vez", "Esta sessão"]);

    assert.throws(() => assertRunToolMayExecute(prepared.gate), ProtocolError);

    const result = dialog.submit({ decision: "allow", selectedScope: "session" });
    assert.equal(result.canExecute, true);
    assert.equal(result.decision, "allow");
    assert.equal(dialog.isOpen, false);
  });

  it("recusa explícita impede execução", () => {
    const flow = new RunToolPermissionFlow();
    const dialog = new PermissionDialogController(flow);
    const prepared = flow.requestPermission({
      runId: "run-e2e-2",
      sessionId: "sess-e2e-2",
      request: {
        requestId: "req-deny",
        capability: "shell.exec",
        target: { kind: "command", command: "npm test" },
      },
    });
    assert.equal(prepared.phase, "pending");
    dialog.openFromPrepared({ runId: "run-e2e-2", sessionId: "sess-e2e-2" }, prepared);
    const result = dialog.submit({ decision: "deny", selectedScope: "once" });
    assert.equal(result.canExecute, false);
  });

  it("mostra aviso de degradação quando isolamento não é nativo", () => {
    const prepared = prepareRunToolPermission({
      runId: "run-deg",
      sessionId: "sess-deg",
      request: {
        requestId: "req-deg",
        capability: "file.write",
        target: { kind: "path", path: "/tmp/x" },
      },
      executionIsolation: {
        level: "degraded",
        degradationNotice: "Sandbox nativa indisponível neste SO.",
      },
    });
    assert.equal(prepared.phase, "pending");
    const dialog = new PermissionDialogController();
    const open = dialog.openFromPrepared({ runId: "run-deg", sessionId: "sess-deg" }, prepared);
    assert.equal(
      open.view.accessible.degradationNotice,
      "Sandbox nativa indisponível neste SO.",
    );
    assert.match(open.view.html, /data-testid="permission-degradation"/);
  });

  it("caminho de erro: escopo inválido retorna INVALID_STATE sem efeito colateral", () => {
    const flow = new RunToolPermissionFlow();
    const dialog = new PermissionDialogController(flow);
    const prepared = flow.requestPermission({
      runId: "run-err",
      sessionId: "sess-err",
      request: {
        requestId: "req-err",
        capability: "file.read",
        target: { kind: "path", path: "/tmp/read.txt" },
        offeredScopes: ["once"],
      },
    });
    assert.equal(prepared.phase, "pending");
    dialog.openFromPrepared({ runId: "run-err", sessionId: "sess-err" }, prepared);
    assert.throws(
      () => dialog.submit({ decision: "allow", selectedScope: "invalid-scope" }),
      (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
    assert.equal(dialog.isOpen, true);
    assert.ok(flow.getPending("req-err"));
  });
});
