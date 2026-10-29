import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  FROZEN_EXTENSION_API_VERSION,
  formatExtensionIdentifier,
  validateExtensionManifest,
  validateVsixManifest,
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

test("[LOC-01] validateVsixManifest aceita manifesto VSIX completo com engines e main", () => {
  const result = validateVsixManifest({
    name: "my-plugin",
    publisher: "openagent",
    version: "1.2.3",
    main: "./out/extension.js",
    engines: { vscode: "^1.96.0" },
  });
  assert.equal(result.valid, true);
  assert.ok(result.manifest);
  assert.equal(result.manifest.name, "my-plugin");
  assert.equal(result.manifest.engines?.vscode, "^1.96.0");
  assert.equal(result.manifest.main, "./out/extension.js");
});

test("[LOC-01] validateVsixManifest exige engines e aceita manifesto declarativo", () => {
  const noEngines = validateVsixManifest({
    name: "my-plugin",
    publisher: "openagent",
    version: "1.2.3",
    main: "./out/extension.js",
  });
  assert.equal(noEngines.valid, false);
  assert.equal(noEngines.error?.code, PROTOCOL_ERROR_CODES.INVALID_STATE);

  const noMain = validateVsixManifest({
    name: "my-plugin",
    publisher: "openagent",
    version: "1.2.3",
    engines: { openagent: "^0.1.0" },
  });
  assert.equal(noMain.valid, true);
  assert.equal(validateVsixManifest({
    name: "my-plugin", publisher: "openagent", version: "1.2.3",
    engines: { vscode: "*" },
  }, { requireMain: true }).valid, false);
});

test("[LOC-01] validadores rejeitam byte nulo no main", () => {
  const manifest = { name: "sample", publisher: "pub", version: "1.0.0", main: "index\0.js", engines: { vscode: "*" } };
  for (const result of [validateExtensionManifest(manifest), validateVsixManifest(manifest)]) {
    assert.equal(result.valid, false);
    assert.equal(result.error?.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  }
});

test("validadores rejeitam formatos inválidos dos campos consumidos", () => {
  const base = { name: "sample", publisher: "pub", version: "1.0.0", main: "index.js", engines: { vscode: "*" } };
  const cases = [
    { contributes: null }, { contributes: [] }, { contributes: { commands: {} } },
    { contributes: { commands: [null] } }, { contributes: { commands: ["command"] } },
    { contributes: { commands: [{}] } }, { contributes: { commands: [{ command: 42 }] } },
    { contributes: { commands: [{ command: " " }] } },
    { activationEvents: {} }, { activationEvents: ["*", 1] },
    { engines: [] }, { engines: { vscode: "*", openagent: 1 } },
    { displayName: {} }, { description: false }, { main: 1 }, { main: "" }, { main: "   " },
  ];
  for (const overrides of cases) {
    for (const validate of [validateExtensionManifest, validateVsixManifest]) {
      const result = validate({ ...base, ...overrides });
      assert.equal(result.valid, false, JSON.stringify(overrides));
      assert.equal(result.error?.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
    }
  }
});

test("validação preserva contribuições adicionais e títulos localizados", () => {
  const contributes = { commands: [{ command: "sample.hello", title: { value: "Hello", original: "Hello" } }], menus: { palette: [] } };
  const result = validateVsixManifest({ name: "sample", publisher: "pub", version: "1.0.0", main: "index.js", engines: { vscode: "*" }, contributes });
  assert.equal(result.valid, true);
  assert.deepEqual(result.manifest?.contributes, contributes);
});

test("[LOC-01] validateExtensionManifest preserva icon e recusa icon nao textual", () => {
  const base = { name: "sample", publisher: "openagent", version: "1.0.0" };
  assert.equal(validateExtensionManifest({ ...base, icon: "media/icon.svg" }).manifest?.icon, "media/icon.svg");
  const invalid = validateExtensionManifest({ ...base, icon: 42 });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.error?.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
});
