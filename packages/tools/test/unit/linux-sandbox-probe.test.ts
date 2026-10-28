import assert from "node:assert/strict";
import test from "node:test";

import { probeLinuxSandbox } from "../../src/sandbox/linux-sandbox-probe.js";

test("probeLinuxSandbox respeita injeção de dependências", () => {
  const result = probeLinuxSandbox({
    hasCommand: (cmd) => cmd === "bwrap",
    probeUserNs: () => true,
  });

  assert.equal(result.nativeAvailable, true);
  assert.equal(result.primitive, "bubblewrap");
  assert.equal(result.unshareUserNsAvailable, true);
});

test("probeLinuxSandbox degradado quando não há primitive", () => {
  const result = probeLinuxSandbox({
    hasCommand: () => false,
    probeUserNs: () => false,
  });

  assert.equal(result.nativeAvailable, false);
  assert.equal(result.primitive, null);
  assert.equal(result.unshareUserNsAvailable, false);
});
