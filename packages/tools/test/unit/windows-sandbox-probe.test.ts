import assert from "node:assert/strict";
import test from "node:test";

import {
  probeAppContainerVersionSupport,
  probeWindowsSandbox,
} from "../../src/sandbox/windows-sandbox-probe.js";

test("probeAppContainerVersionSupport exige NT 6.2+", () => {
  assert.equal(probeAppContainerVersionSupport("6.1.7601"), false);
  assert.equal(probeAppContainerVersionSupport("6.2.9200"), true);
  assert.equal(probeAppContainerVersionSupport("10.0.26200"), true);
});

test("probeWindowsSandbox respeita injeção AppContainer nativo", () => {
  const result = probeWindowsSandbox({
    platform: "win32",
    probeAppContainerVersion: () => true,
    probeAppContainer: () => true,
    probeJobObject: () => true,
  });

  assert.equal(result.nativeAvailable, true);
  assert.equal(result.primitive, "appcontainer");
  assert.equal(result.appContainerOperational, true);
});

test("probeWindowsSandbox usa Job Object quando AppContainer falha", () => {
  const result = probeWindowsSandbox({
    platform: "win32",
    probeAppContainerVersion: () => true,
    probeAppContainer: () => false,
    probeJobObject: () => true,
  });

  assert.equal(result.nativeAvailable, true);
  assert.equal(result.primitive, "job-object");
  assert.equal(result.appContainerOperational, false);
});

test("probeWindowsSandbox degradado sem Job Object", () => {
  const result = probeWindowsSandbox({
    platform: "win32",
    probeAppContainerVersion: () => false,
    probeAppContainer: () => false,
    probeJobObject: () => false,
  });

  assert.equal(result.nativeAvailable, false);
  assert.equal(result.primitive, null);
});

test("probeWindowsSandbox fora do Windows retorna indisponível", () => {
  const result = probeWindowsSandbox({ platform: "linux" });
  assert.equal(result.nativeAvailable, false);
});
