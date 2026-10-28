import test from "node:test";
import assert from "node:assert/strict";

import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import { createTypedToolDispatchRegistry } from "../../src/worker/dispatch-registry.js";

test("TypedToolDispatchRegistry rejeita ferramenta desconhecida com INVALID_STATE", async () => {
  const registry = createTypedToolDispatchRegistry({
    ping: () => "pong",
  });

  await assert.rejects(
    registry.invoke("missing" as "ping", undefined as never),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});
