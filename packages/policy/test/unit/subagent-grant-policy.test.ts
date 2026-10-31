import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  InMemoryGrantRegistry,
  parseSubagentDeclaredCapabilities,
  parseSubagentGrantCheck,
  prepareInheritedSubagentToolPermission,
  seedRunGrantsFromSubagentObjective,
  stripSubagentObjectiveMarkers,
} from "../../src/index.js";

test("stripSubagentObjectiveMarkers remove marcadores de integração", () => {
  const cleaned = stripSubagentObjectiveMarkers(
    "[delay:10][grant-check:file.write:src/a.ts][declared-caps:shell.exec] Objetivo real",
  );
  assert.equal(cleaned, "Objetivo real");
});

test("prepareInheritedSubagentToolPermission usa grant do run pai", () => {
  const registry = new InMemoryGrantRegistry();
  const grantContext = {
    nowMs: 1_700_000_000_000,
    sessionId: "ses-112",
    workspaceId: "ws-112",
  };
  seedRunGrantsFromSubagentObjective(
    "[run-grant-seed:session:file.write:src/inherit.ts]",
    registry,
    grantContext,
  );

  const prepared = prepareInheritedSubagentToolPermission(
    {
      runId: "run-112",
      sessionId: "ses-112",
      request: {
        requestId: "perm-sub",
        capability: "file.write",
        target: { kind: "path", path: "src/inherit.ts" },
      },
    },
    { parentGrants: registry, grantContext, declaredCapabilities: ["shell.exec"] },
  );

  assert.equal(prepared.phase, "granted");
  assert.equal(parseSubagentDeclaredCapabilities("[declared-caps:shell.exec,file.read]").length, 2);
});

test("parseSubagentGrantCheck rejeita capability desconhecida", () => {
  assert.throws(
    () => parseSubagentGrantCheck("[grant-check:unknown.cap:target]"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});
