import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  FROZEN_EXTENSION_API_VERSION,
  formatExtensionIdentifier,
  validateExtensionManifest,
} from "../../src/index.js";

test("[LOC-01] extension-api expõe versão congelada do contrato Cursor 3.24.18 (ADR-007)", () => {
  assert.equal(FROZEN_EXTENSION_API_VERSION, "3.24.18");
});

test("[LOC-01] formatExtensionIdentifier normaliza identificador canônico publisher.name", () => {
  assert.equal(formatExtensionIdentifier("OpenAgent", "SampleExt"), "openagent.sampleext");
  assert.equal(formatExtensionIdentifier("ms-python", "python"), "ms-python.python");
});

test("[LOC-01] validateExtensionManifest aceita manifesto válido", () => {
  const result = validateExtensionManifest({
    name: "sample-plugin",
    publisher: "openagent",
    version: "1.0.0",
    main: "./out/extension.js",
    activationEvents: ["onCommand:sample.hello"],
    contributes: {
      commands: [{ command: "sample.hello", title: "Sample: Hello" }],
    },
  });
  assert.equal(result.valid, true);
  assert.ok(result.manifest);
  assert.equal(result.manifest.name, "sample-plugin");
  assert.equal(result.manifest.publisher, "openagent");
  assert.equal(result.manifest.main, "./out/extension.js");
});

test("[LOC-01] validateExtensionManifest caminho de erro: campos obrigatórios ausentes retornam INVALID_STATE sem efeito colateral", () => {
  const cases: unknown[] = [
    null,
    undefined,
    "not-an-object",
    [],
    {},
    { name: "test", publisher: "" },
    { name: "", publisher: "pub", version: "1.0.0" },
    { name: "test", publisher: "pub", version: "" },
  ];

  for (const input of cases) {
    const result = validateExtensionManifest(input);
    assert.equal(result.valid, false);
    assert.ok(result.error instanceof ProtocolError);
    assert.equal(result.error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  }
});
