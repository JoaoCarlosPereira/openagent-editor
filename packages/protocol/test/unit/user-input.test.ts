import test from "node:test";
import assert from "node:assert/strict";
import {
  ProtocolError,
  USER_INPUT_EMPTY_MESSAGE,
  assertUserInput,
  validateUserInput,
} from "../../src/index.js";

test("[VAL-01] Recusa mensagem sem texto e sem anexo com texto exato do PRD", () => {
  const cases: unknown[] = [
    {},
    { text: "" },
    { text: "   " },
    { text: "", attachments: [] },
    { attachments: [] },
  ];

  for (const input of cases) {
    const result = validateUserInput(input);
    assert.equal(result.valid, false, JSON.stringify(input));
    if (!result.valid) {
      assert.equal(result.code, "INVALID_STATE");
      assert.equal(result.userMessage, USER_INPUT_EMPTY_MESSAGE);
      assert.deepEqual(result.errors, [USER_INPUT_EMPTY_MESSAGE]);
    }
  }
});

test("[VAL-01] Aceita texto não-vazio sem anexos", () => {
  const result = validateUserInput({ text: "Olá, agente." });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.value.text, "Olá, agente.");
    assert.equal(result.value.attachments, undefined);
  }
});

test("[VAL-01] Aceita anexo sem texto", () => {
  const result = validateUserInput({
    attachments: [{ ref: "blob:abc123" }],
  });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.value.text, undefined);
    assert.deepEqual(result.value.attachments, [{ ref: "blob:abc123" }]);
  }
});

test("[VAL-01] Entrada estruturalmente inválida retorna INVALID_STATE sem efeito colateral", () => {
  const invalidInputs = [null, undefined, "string", 42, []];

  for (const input of invalidInputs) {
    const result = validateUserInput(input);
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.equal(result.code, "INVALID_STATE");
      assert.equal(result.userMessage, undefined);
      assert.ok(result.errors.length > 0);
    }
  }

  assert.throws(
    () => assertUserInput({ attachments: [{ ref: "" }] }),
    (err: unknown) => {
      assert.ok(err instanceof ProtocolError);
      assert.equal(err.code, "INVALID_STATE");
      assert.notEqual(err.message, USER_INPUT_EMPTY_MESSAGE);
      return true;
    },
  );
});
