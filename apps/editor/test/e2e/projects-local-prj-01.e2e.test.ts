import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProtocolError, RPC_METHOD } from "@openagent/protocol";
import { LocalProjectCoordinator, ProjectsLocalController, decomposeObjective, type ProjectsLocalCoordinator } from "../../src/index.js";

function isInvalidState(error: unknown): boolean {
  return error instanceof ProtocolError && error.code === "INVALID_STATE";
}

function coordinatorWith(overrides: Partial<ProjectsLocalCoordinator>, inner = new LocalProjectCoordinator()): ProjectsLocalCoordinator {
  return {
    create: (input) => inner.create(input),
    accept: (input) => inner.accept(input),
    reject: (input) => inner.reject(input),
    tasksOf: (projectId) => inner.tasksOf(projectId),
    ...overrides,
  };
}

const OBJECTIVE = "Criar modulo de login; Escrever testes do login; Documentar o login";

describe("PRJ-01 e2e - Projects local pela UI: aceitar e rejeitar resultados", () => {
  it("[PRJ-01] QUANDO cria projeto com objetivo ENTAO coordenador local divide em tarefas e mostra aceitar/rejeitar", async () => {
    const controller = new ProjectsLocalController(new LocalProjectCoordinator());
    assert.match(controller.snapshot.html, /data-testid="project-create"/);

    const view = await controller.createProject(OBJECTIVE);
    assert.equal(view.accessible.phase, "review");
    assert.equal(view.accessible.nodes.length, 3);
    assert.deepEqual(view.accessible.nodes.map((n) => n.title), ["Criar modulo de login", "Escrever testes do login", "Documentar o login"]);
    assert.equal(view.accessible.pendingCount, 3);
    assert.equal((view.html.match(/data-testid="project-node-accept"/g) ?? []).length, 3);
    assert.equal((view.html.match(/data-testid="project-node-reject"/g) ?? []).length, 3);
    assert.match(view.html, /data-phase="review"/);

    const [first, second, third] = view.accessible.nodes;
    assert.ok(first && second && third);

    const afterAccept = await controller.accept(first.nodeId);
    assert.equal(afterAccept.accessible.acceptedCount, 1);
    assert.equal(afterAccept.accessible.phase, "review");

    const afterReject = await controller.reject(second.nodeId);
    assert.equal(afterReject.accessible.rejectedCount, 1);
    assert.equal(afterReject.accessible.pendingCount, 1);
    assert.equal((afterReject.html.match(/data-testid="project-node-accept"/g) ?? []).length, 1);

    const done = await controller.accept(third.nodeId);
    assert.equal(done.accessible.phase, "completed");
    assert.deepEqual(done.accessible.nodes.map((n) => n.status), ["accepted", "rejected", "accepted"]);
    assert.doesNotMatch(done.html, /data-testid="project-node-accept"/);
    assert.match(done.html, /data-phase="completed"/);
  });

  it("[PRJ-01] estado terminal e consistente: decidir de novo ou criar outro projeto retorna INVALID_STATE", async () => {
    const controller = new ProjectsLocalController();
    const view = await controller.createProject("Unica tarefa");
    const node = view.accessible.nodes[0];
    assert.ok(node);
    await controller.reject(node.nodeId);
    const before = JSON.stringify(controller.snapshot.accessible);

    await assert.rejects(controller.accept(node.nodeId), isInvalidState);
    await assert.rejects(controller.reject(node.nodeId), isInvalidState);
    await assert.rejects(controller.createProject("Outro"), isInvalidState);
    assert.equal(JSON.stringify(controller.snapshot.accessible), before);
    assert.equal(controller.snapshot.accessible.phase, "completed");
  });

  it("[PRJ-01] caminho de erro: objetivo invalido retorna INVALID_STATE sem efeito colateral", async () => {
    let calls = 0;
    const controller = new ProjectsLocalController(coordinatorWith({
      async create() { calls += 1; return { projectId: "p" }; },
      async accept() { calls += 1; return { accepted: true }; },
      async reject() { calls += 1; return { rejected: true }; },
    }));

    for (const bad of ["", "   ", null as unknown as string, 42 as unknown as string, "x".repeat(2001), ` ${"x".repeat(2001)} `]) {
      await assert.rejects(controller.createProject(bad), isInvalidState);
    }
    assert.equal(calls, 0);
    assert.equal(controller.snapshot.accessible.phase, "idle");
    assert.equal(controller.snapshot.accessible.nodes.length, 0);
  });

  it("[PRJ-01] caminho de erro: aceitar/rejeitar sem projeto ou com nodeId invalido retorna INVALID_STATE sem efeito colateral", async () => {
    const controller = new ProjectsLocalController();
    await assert.rejects(controller.accept("n1"), isInvalidState);
    await assert.rejects(controller.reject("n1"), isInvalidState);

    const view = await controller.createProject("A; B");
    const before = JSON.stringify(view.accessible);
    await assert.rejects(controller.accept("inexistente"), isInvalidState);
    await assert.rejects(controller.reject(undefined as unknown as string), isInvalidState);
    assert.equal(JSON.stringify(controller.snapshot.accessible), before);
    assert.equal(controller.snapshot.accessible.pendingCount, 2);
  });

  it("[PRJ-01] falha da porta ao criar volta a idle com codigo estavel e permite nova tentativa", async () => {
    let fail = true;
    const inner = new LocalProjectCoordinator();
    const controller = new ProjectsLocalController(coordinatorWith({
      async create(input) { if (fail) throw new Error("falha"); return inner.create(input); },
      tasksOf: (projectId) => inner.tasksOf(projectId),
    }, inner));
    await assert.rejects(controller.createProject("Tarefa"), (error: unknown) => error instanceof Error);
    assert.equal(controller.snapshot.accessible.phase, "idle");
    assert.equal(controller.snapshot.accessible.errorCode, "INVALID_STATE");
    assert.match(controller.snapshot.html, /data-testid="project-error"/);

    fail = false;
    const view = await controller.createProject("Tarefa");
    assert.equal(view.accessible.phase, "review");
    assert.equal(view.accessible.errorCode, null);
  });

  it("[PRJ-01] falha da porta ao decidir preserva o resultado aguardando revisao", async () => {
    const inner = new LocalProjectCoordinator();
    let failAccept = true;
    const controller = new ProjectsLocalController(coordinatorWith({
      async accept(input) { if (failAccept) throw new Error("falha"); return inner.accept(input); },
    }, inner));
    const view = await controller.createProject("Tarefa");
    const node = view.accessible.nodes[0];
    assert.ok(node);

    await assert.rejects(controller.accept(node.nodeId), (error: unknown) => error instanceof Error);
    assert.equal(controller.snapshot.accessible.pendingCount, 1);
    assert.equal(controller.snapshot.accessible.phase, "review");

    failAccept = false;
    const done = await controller.accept(node.nodeId);
    assert.equal(done.accessible.phase, "completed");
  });

  it("[PRJ-01] decomposeObjective ignora marcadores de lista e escapa HTML na view", async () => {
    assert.deepEqual(decomposeObjective("1. Primeiro\n- Segundo\n\n* Terceiro"), ["Primeiro", "Segundo", "Terceiro"]);
    const controller = new ProjectsLocalController();
    const view = await controller.createProject('<b>"x"</b>');
    assert.doesNotMatch(view.html, /<b>/);
    assert.match(view.html, /&lt;b&gt;/);
  });

  it("[PRJ-01] a porta recebe o envelope RPC_METHOD.PROJECT_* com params exatos do protocolo", async () => {
    const inner = new LocalProjectCoordinator();
    const seen: unknown[] = [];
    const controller = new ProjectsLocalController(coordinatorWith({
      async create(input) { seen.push(input); return inner.create(input); },
      async accept(input) { seen.push(input); return inner.accept(input); },
      async reject(input) { seen.push(input); return inner.reject(input); },
    }, inner));

    const view = await controller.createProject("  A; B  ");
    const [a, b] = view.accessible.nodes;
    assert.ok(a && b);
    await controller.accept(a.nodeId);
    await controller.reject(b.nodeId);

    assert.deepEqual(seen, [
      { method: RPC_METHOD.PROJECT_CREATE, params: { objective: "A; B" } },
      { method: RPC_METHOD.PROJECT_ACCEPT, params: { nodeId: a.nodeId } },
      { method: RPC_METHOD.PROJECT_REJECT, params: { nodeId: b.nodeId } },
    ]);
  });

  it("[PRJ-01] ProtocolError da porta com outro codigo e propagado e a view restaura o estado", async () => {
    const inner = new LocalProjectCoordinator();
    let failCreate = true;
    let failDecide = true;
    const controller = new ProjectsLocalController(coordinatorWith({
      async create(input) {
        if (failCreate) throw new ProtocolError("PERMISSION_DENIED", "negado", []);
        return inner.create(input);
      },
      async reject(input) {
        if (failDecide) throw new ProtocolError("CONFLICT", "conflito", []);
        return inner.reject(input);
      },
    }, inner));

    await assert.rejects(controller.createProject("Tarefa"), (error: unknown) => error instanceof ProtocolError && error.code === "PERMISSION_DENIED");
    assert.equal(controller.snapshot.accessible.phase, "idle");
    assert.equal(controller.snapshot.accessible.errorCode, "PERMISSION_DENIED");
    assert.match(controller.snapshot.html, /data-code="PERMISSION_DENIED"/);

    failCreate = false;
    const view = await controller.createProject("Tarefa");
    const node = view.accessible.nodes[0];
    assert.ok(node);

    await assert.rejects(controller.reject(node.nodeId), (error: unknown) => error instanceof ProtocolError && error.code === "CONFLICT");
    assert.equal(controller.snapshot.accessible.errorCode, "CONFLICT");
    assert.equal(controller.snapshot.accessible.phase, "review");
    assert.equal(controller.snapshot.accessible.pendingCount, 1);
    assert.match(controller.snapshot.html, /data-code="CONFLICT"/);

    failDecide = false;
    const done = await controller.reject(node.nodeId);
    assert.equal(done.accessible.phase, "completed");
    assert.equal(done.accessible.errorCode, null);
  });

  it("[PRJ-01] coordenador sem tarefas retorna INVALID_STATE e volta a idle", async () => {
    const controller = new ProjectsLocalController(coordinatorWith({
      async create() { return { projectId: "p" }; },
      async tasksOf() { return []; },
    }));

    await assert.rejects(controller.createProject("Tarefa"), (error: unknown) => isInvalidState(error) && (error as Error).message === "Coordenador nao produziu tarefas.");
    assert.equal(controller.snapshot.accessible.phase, "idle");
    assert.equal(controller.snapshot.accessible.projectId, null);
    assert.equal(controller.snapshot.accessible.nodes.length, 0);
    assert.equal(controller.snapshot.accessible.errorCode, "INVALID_STATE");
  });

  it("[PRJ-01] construtor com porta invalida lanca INVALID_STATE", () => {
    const valid = new LocalProjectCoordinator();
    const invalidPorts: unknown[] = [
      null,
      {},
      { create: valid.create, accept: valid.accept, reject: valid.reject },
      { ...coordinatorWith({}), reject: "nao" },
    ];
    for (const port of invalidPorts) {
      assert.throws(() => new ProjectsLocalController(port as ProjectsLocalCoordinator), isInvalidState);
    }
  });

  it("[PRJ-01] decisoes concorrentes no mesmo no: uma vence, a outra retorna INVALID_STATE sem decisao dupla", async () => {
    const inner = new LocalProjectCoordinator();
    let accepts = 0;
    let rejects = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const controller = new ProjectsLocalController(coordinatorWith({
      async accept(input) { accepts += 1; await gate; return inner.accept(input); },
      async reject(input) { rejects += 1; await gate; return inner.reject(input); },
    }, inner));
    const view = await controller.createProject("Tarefa");
    const node = view.accessible.nodes[0];
    assert.ok(node);

    const first = controller.accept(node.nodeId);
    await assert.rejects(controller.reject(node.nodeId), isInvalidState);
    await assert.rejects(controller.accept(node.nodeId), isInvalidState);
    release();
    const done = await first;

    assert.equal(accepts, 1);
    assert.equal(rejects, 0);
    assert.equal(done.accessible.phase, "completed");
    assert.deepEqual(done.accessible.nodes.map((n) => n.status), ["accepted"]);
  });
});
