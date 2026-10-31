import assert from "node:assert/strict";
import test from "node:test";

import { probeMacosSandbox } from "../../src/sandbox/macos-sandbox-probe.js";

test("probeMacosSandbox respeita injeção de dependências", () => {
  const result = probeMacosSandbox({
    platform: "darwin",
    hasCommand: (cmd) => cmd === "sandbox-exec",
    probeSeatbelt: () => true,
  });

  assert.equal(result.nativeAvailable, true);
  assert.equal(result.primitive, "sandbox-exec");
  assert.equal(result.sandboxExecAvailable, true);
  assert.equal(result.seatbeltOperational, true);
});

test("probeMacosSandbox degradado quando Seatbelt não responde", () => {
  const result = probeMacosSandbox({
    platform: "darwin",
    hasCommand: (cmd) => cmd === "sandbox-exec",
    probeSeatbelt: () => false,
  });

  assert.equal(result.nativeAvailable, false);
  assert.equal(result.primitive, null);
  assert.equal(result.sandboxExecAvailable, true);
  assert.equal(result.seatbeltOperational, false);
});

test("probeMacosSandbox degradado sem sandbox-exec", () => {
  const result = probeMacosSandbox({
    platform: "darwin",
    hasCommand: () => false,
    probeSeatbelt: () => false,
  });

  assert.equal(result.nativeAvailable, false);
  assert.equal(result.sandboxExecAvailable, false);
});
