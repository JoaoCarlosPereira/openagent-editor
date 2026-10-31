import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import {
  OPENAGENT_DAEMON_PROTOCOL_VERSION,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  RPC_PROTOCOL_VERSION,
  connectLocalTransport,
  getRpcMethodSpec,
  readProtocolFrame,
  validateHarnessEventStream,
  validateRpcRequest,
  validateWorkspaceTransportAck,
  validateWorkspaceTransportHello,
  writeProtocolFrame,
  type ProtocolErrorCode,
  type RpcMethod,
  type RpcParamsMap,
  type RpcResultMap,
  type WorkspaceTransportHello,
} from "@openagent/protocol";
import { openWorkspaceDatabase } from "@openagent/storage";
import { snapshotWorkspaceFileForWrite } from "@openagent/tools";
import { startHarnessDaemon } from "../../src/index.js";
import { parsePlanAccept, parsePlanDraft } from "../../src/agent/plan-mode-input.js";
import {
  PLAN_ACCEPTED_EVENT,
  PLAN_PRESENTED_EVENT,
  PLAN_PROGRESS_EVENT,
} from "../../src/agent/plan-run-loop.js";

function buildWorkspaceHello(workspaceRoot: string): WorkspaceTransportHello {
  return {
    type: "workspace.hello",
    workspaceId: "ws-plan-loop-107",
    workspaceRoot,
    providerProfileId: "provider-local",
    mode: "plan",
    rulesRef: "rules:default",
    mcpServerIds: [],
    sessionIds: [],
  };
}

async function readJsonFrame(socket: net.Socket): Promise<Record<string, unknown>> {
  const frame = await readProtocolFrame(socket);
  return JSON.parse(frame.toString("utf8")) as Record<string, unknown>;
}

async function performClientHandshake(
  socket: net.Socket,
  workspaceHello: WorkspaceTransportHello,
): Promise<void> {
  writeProtocolFrame(
    socket,
    Buffer.from(
      JSON.stringify({
        type: "protocol.version",
        protocolVersion: OPENAGENT_DAEMON_PROTOCOL_VERSION,
        clientId: "plan-run-loop-test",
      }),
      "utf8",
    ),
  );

  const versionResponse = await readJsonFrame(socket);
  assert.equal(versionResponse.type, "protocol.version.ack");

  const workspaceValidation = validateWorkspaceTransportHello(workspaceHello);
  assert.equal(workspaceValidation.valid, true);
  writeProtocolFrame(
    socket,
    Buffer.from(JSON.stringify(workspaceValidation.value), "utf8"),
  );

  const workspaceResponse = await readJsonFrame(socket);
  const ackValidation = validateWorkspaceTransportAck(workspaceResponse);
  assert.equal(ackValidation.valid, true);
}

async function callDaemonRpc<M extends RpcMethod>(
  socket: net.Socket,
  method: M,
  params: RpcParamsMap[M],
  context: {
    workspaceId: string;
    sessionId: string;
    runId: string;
    capability?: string;
  },
): Promise<RpcResultMap[M]> {
  const requestId = randomUUID();
  const spec = getRpcMethodSpec(method);
  const envelope = {
    method,
    requestId,
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    runId: context.runId,
    expectedVersion: 0,
    capability: context.capability ?? spec.capability,
    payload: params,
    rpcVersion: RPC_PROTOCOL_VERSION,
  };
  const validation = validateRpcRequest(envelope);
  if (!validation.valid) {
    throw new Error("Requisição RPC inválida para teste.");
  }
  writeProtocolFrame(socket, Buffer.from(JSON.stringify(validation.value), "utf8"));

  const response = await readJsonFrame(socket);
  if (response.type === "protocol.error") {
    throw new ProtocolError(
      (response.code as ProtocolErrorCode | undefined) ?? PROTOCOL_ERROR_CODES.INVALID_STATE,
      String(response.message ?? "protocol.error"),
    );
  }
  assert.equal(response.type, "rpc.ok");
  assert.equal(response.requestId, requestId);
  return response.result as RpcResultMap[M];
}

const PLAN_ID = "plan-agt02-demo";

function makePlanDraftInputText(): string {
  return JSON.stringify({
    prompt: "Propor plano antes de executar",
    planDraft: {
      planId: PLAN_ID,
      title: "Implementar marcador AGT02",
      steps: [
        { stepId: "step-write", label: "Atualizar arquivo alvo" },
        { stepId: "step-shell", label: "Validar com comando" },
      ],
    },
  });
}

function makePlanAcceptInputText(workspaceRoot: string, targetFile: string): string {
  const snap = snapshotWorkspaceFileForWrite(workspaceRoot, targetFile);
  const shellCommand =
    process.platform === "win32" ? "echo AGT02_PLAN_SHELL" : "echo AGT02_PLAN_SHELL";

  return JSON.stringify({
    prompt: "Aceitar plano e executar",
    planAccept: {
      planId: PLAN_ID,
      title: "Implementar marcador AGT02",
      steps: [
        { stepId: "step-write", label: "Atualizar arquivo alvo" },
        { stepId: "step-shell", label: "Validar com comando" },
      ],
    },
    agentLoop: {
      turns: [
        {
          toolCalls: [
            {
              invocationId: "inv-plan-write",
              tool: "file.write.batch",
              permissionRequestId: "perm-plan-write",
              operations: [
                {
                  relativePath: targetFile,
                  expectedContentHashHex: snap.contentHashHex,
                  newContent: "export const AGT02_PLAN_MARKER = true;\n",
                },
              ],
            },
          ],
        },
        {
          toolCalls: [
            {
              invocationId: "inv-plan-shell",
              tool: "shell.exec",
              permissionRequestId: "perm-plan-shell",
              command: shellCommand,
            },
          ],
        },
      ],
    },
  });
}

test.describe("modo Plan no daemon (AGT-02)", { concurrency: 1 }, () => {
  test("[AGT-02] planDraft vira artefato e planAccept inicia execução com progresso visível", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-plan-loop-ws-"));
    const targetFile = "src/plan-target.ts";
    mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    const originalContent = "export const AGT02_PLAN_MARKER = false;\n";
    writeFileSync(path.join(workspaceRoot, targetFile), originalContent, "utf8");

    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-plan-loop-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const hello = buildWorkspaceHello(workspaceRoot);
    const draftRunId = `run-draft-${randomUUID()}`;
    const execRunId = `run-exec-${randomUUID()}`;

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, hello);

      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "plan" }, {
        workspaceId: hello.workspaceId,
        sessionId: `ses-${randomUUID()}`,
        runId: `run-placeholder-${randomUUID()}`,
      });

      await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        {
          mode: "plan",
          input: { text: makePlanDraftInputText() },
        },
        {
          workspaceId: hello.workspaceId,
          sessionId: created.sessionId,
          runId: draftRunId,
        },
      );

      assert.equal(readFileSync(path.join(workspaceRoot, targetFile), "utf8"), originalContent);

      await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        {
          mode: "plan",
          input: { text: makePlanAcceptInputText(workspaceRoot, targetFile) },
        },
        {
          workspaceId: hello.workspaceId,
          sessionId: created.sessionId,
          runId: execRunId,
        },
      );
    } finally {
      socket.destroy();
      await runtime.stop();
    }

    assert.equal(
      readFileSync(path.join(workspaceRoot, targetFile), "utf8"),
      "export const AGT02_PLAN_MARKER = true;\n",
    );

    const db = openWorkspaceDatabase({ dataRoot, workspaceId: hello.workspaceId });
    try {
      const draftEvents = db.listHarnessEvents(draftRunId);
      const draftTypes = draftEvents.map((event) => event.type);
      assert.ok(draftTypes.includes("run.started"));
      assert.ok(draftTypes.includes(PLAN_PRESENTED_EVENT));
      assert.equal(draftTypes.filter((type) => type === "tool.result").length, 0);

      const execEvents = db.listHarnessEvents(execRunId);
      const execTypes = execEvents.map((event) => event.type);
      assert.ok(execTypes.includes("run.started"));
      assert.ok(execTypes.includes(PLAN_ACCEPTED_EVENT));
      assert.equal(execTypes.filter((type) => type === PLAN_PROGRESS_EVENT).length, 2);
      assert.ok(execTypes.includes("diff.grouped"));
      assert.ok(execTypes.filter((type) => type === "tool.result").length >= 2);

      assert.equal(validateHarnessEventStream(draftEvents).valid, true);
      assert.equal(validateHarnessEventStream(execEvents).valid, true);
    } finally {
      db.close();
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("[AGT-02] planAccept inválido retorna INVALID_STATE sem efeito colateral", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-plan-loop-err-"));
    writeFileSync(path.join(workspaceRoot, "keep.txt"), "stable\n", "utf8");

    assert.throws(
      () =>
        parsePlanDraft({
          planId: "",
          title: "x",
          steps: [{ stepId: "a", label: "b" }],
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.throws(
      () =>
        parsePlanAccept(
          {
            planId: PLAN_ID,
            title: "Plano",
            steps: [{ stepId: "only", label: "Um passo" }],
          },
          {
            turns: [
              { toolCalls: [{ invocationId: "a", permissionRequestId: "b", tool: "shell.exec", command: "echo 1" }] },
              { toolCalls: [{ invocationId: "c", permissionRequestId: "d", tool: "shell.exec", command: "echo 2" }] },
            ],
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        assert.match(error.message, /mesmo número de turnos/);
        return true;
      },
    );

    assert.equal(readFileSync(path.join(workspaceRoot, "keep.txt"), "utf8"), "stable\n");
    await rm(workspaceRoot, { recursive: true, force: true });
  });
});
