import test from "node:test";
import assert from "node:assert/strict";
import {
  ProtocolError,
  assertCommandEnvelope,
  assertMutableCommandEnvelope,
  validateCommandEnvelope,
  validateMutableCommandEnvelope,
  type CommandEnvelope,
  type MutableCommandEnvelope,
} from "../../src/index.js";

const VALID_SAMPLE: MutableCommandEnvelope<{ path: string; content: string }> = {
  requestId: "req-123e4567-e89b-12d3-a456-426614174000",
  workspaceId: "ws-openagent-dev",
  sessionId: "ses-987fcdeb-51a2-43f7-9012-345678901234",
  runId: "run-456e7890-e12b-34c5-d678-901234567890",
  expectedVersion: 0,
  capability: "file.write",
  payload: {
    path: "src/app.ts",
    content: "console.log('hello');",
  },
  timestamp: 1729000000000,
  metadata: {
    client: "cli",
  },
};

test("[CLI-01] Envelope válido completo é validado com sucesso", () => {
  const result = validateCommandEnvelope(VALID_SAMPLE);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.value.requestId, VALID_SAMPLE.requestId);
    assert.equal(result.value.workspaceId, VALID_SAMPLE.workspaceId);
    assert.equal(result.value.sessionId, VALID_SAMPLE.sessionId);
    assert.equal(result.value.runId, VALID_SAMPLE.runId);
    assert.equal(result.value.expectedVersion, 0);
    assert.equal(result.value.capability, "file.write");
    assert.deepEqual(result.value.payload, VALID_SAMPLE.payload);
    assert.equal(result.value.timestamp, VALID_SAMPLE.timestamp);
    assert.deepEqual(result.value.metadata, { client: "cli" });
  }
});

test("[SES-01] assertCommandEnvelope aceita envelope válido e garante type narrowing", () => {
  const raw: unknown = {
    requestId: "req-editor-1",
    workspaceId: "workspace-ses-01",
    sessionId: "ses-main-1",
    runId: "run-step-1",
    expectedVersion: 42,
    capability: "session.resume",
  };

  assert.doesNotThrow(() => {
    assertCommandEnvelope(raw);
  });

  const typed: CommandEnvelope = raw as CommandEnvelope;
  assert.equal(typed.expectedVersion, 42);
  assert.equal(typed.sessionId, "ses-main-1");
  assert.equal(typed.workspaceId, "workspace-ses-01");
});

test("Aliases validateMutableCommandEnvelope e assertMutableCommandEnvelope funcionam de forma idêntica", () => {
  const res = validateMutableCommandEnvelope(VALID_SAMPLE);
  assert.equal(res.valid, true);
  assert.doesNotThrow(() => {
    assertMutableCommandEnvelope(VALID_SAMPLE);
  });
});

test("[CLI-01] Rejeita entradas nulas, indefinidas ou não-objetos", () => {
  const invalidInputs = [null, undefined, "not-an-object", 123, true, []];
  for (const input of invalidInputs) {
    const res = validateCommandEnvelope(input);
    assert.equal(res.valid, false);
    if (!res.valid) {
      assert.equal(res.code, "INVALID_STATE");
      assert.ok(res.errors.length > 0);
    }

    assert.throws(
      () => assertCommandEnvelope(input),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, "INVALID_STATE");
        return true;
      },
    );
  }
});

test("[CLI-01] Validação de requestId: rejeita ausente, não-string ou string vazia", () => {
  const badSamples = [
    { ...VALID_SAMPLE, requestId: undefined },
    { ...VALID_SAMPLE, requestId: "" },
    { ...VALID_SAMPLE, requestId: "   " },
    { ...VALID_SAMPLE, requestId: 12345 },
  ];

  for (const sample of badSamples) {
    const res = validateCommandEnvelope(sample);
    assert.equal(res.valid, false);
    if (!res.valid) {
      assert.equal(res.code, "INVALID_STATE");
      assert.ok(res.errors.some((msg) => msg.includes("requestId")));
    }
  }
});

test("[CLI-01] Validação de workspaceId: rejeita ausente, não-string ou string vazia", () => {
  const badSamples = [
    { ...VALID_SAMPLE, workspaceId: undefined },
    { ...VALID_SAMPLE, workspaceId: "" },
    { ...VALID_SAMPLE, workspaceId: "   " },
    { ...VALID_SAMPLE, workspaceId: null },
  ];

  for (const sample of badSamples) {
    const res = validateCommandEnvelope(sample);
    assert.equal(res.valid, false);
    if (!res.valid) {
      assert.equal(res.code, "INVALID_STATE");
      assert.ok(res.errors.some((msg) => msg.includes("workspaceId")));
    }
  }
});

test("[SES-01] Validação de sessionId: rejeita ausente, não-string ou string vazia", () => {
  const badSamples = [
    { ...VALID_SAMPLE, sessionId: undefined },
    { ...VALID_SAMPLE, sessionId: "" },
    { ...VALID_SAMPLE, sessionId: "\t" },
    { ...VALID_SAMPLE, sessionId: {} },
  ];

  for (const sample of badSamples) {
    const res = validateCommandEnvelope(sample);
    assert.equal(res.valid, false);
    if (!res.valid) {
      assert.equal(res.code, "INVALID_STATE");
      assert.ok(res.errors.some((msg) => msg.includes("sessionId")));
    }
  }
});

test("[SES-01] Validação de runId: rejeita ausente, não-string ou string vazia", () => {
  const badSamples = [
    { ...VALID_SAMPLE, runId: undefined },
    { ...VALID_SAMPLE, runId: "" },
    { ...VALID_SAMPLE, runId: "  \n" },
    { ...VALID_SAMPLE, runId: true },
  ];

  for (const sample of badSamples) {
    const res = validateCommandEnvelope(sample);
    assert.equal(res.valid, false);
    if (!res.valid) {
      assert.equal(res.code, "INVALID_STATE");
      assert.ok(res.errors.some((msg) => msg.includes("runId")));
    }
  }
});

test("Validação de capability: rejeita ausente, não-string ou string vazia", () => {
  const badSamples = [
    { ...VALID_SAMPLE, capability: undefined },
    { ...VALID_SAMPLE, capability: "" },
    { ...VALID_SAMPLE, capability: "  " },
    { ...VALID_SAMPLE, capability: 99 },
  ];

  for (const sample of badSamples) {
    const res = validateCommandEnvelope(sample);
    assert.equal(res.valid, false);
    if (!res.valid) {
      assert.equal(res.code, "INVALID_STATE");
      assert.ok(res.errors.some((msg) => msg.includes("capability")));
    }
  }
});

test("Validação de expectedVersion: aceita inteiros não-negativos e rejeita negativos, floats, NaN ou ausente", () => {
  // Casos aceitos
  assert.equal(validateCommandEnvelope({ ...VALID_SAMPLE, expectedVersion: 0 }).valid, true);
  assert.equal(validateCommandEnvelope({ ...VALID_SAMPLE, expectedVersion: 1 }).valid, true);
  assert.equal(validateCommandEnvelope({ ...VALID_SAMPLE, expectedVersion: 999999 }).valid, true);

  // Casos rejeitados
  const badVersions = [-1, -100, 1.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, "0", null, undefined];
  for (const expectedVersion of badVersions) {
    const res = validateCommandEnvelope({ ...VALID_SAMPLE, expectedVersion });
    assert.equal(res.valid, false, `Deveria rejeitar expectedVersion: ${expectedVersion}`);
    if (!res.valid) {
      assert.equal(res.code, "INVALID_STATE");
      assert.ok(res.errors.some((msg) => msg.includes("expectedVersion")));
    }
  }
});

test("Validação de timestamp e metadata opcionais: rejeita quando tipos são inválidos", () => {
  const badTimestamp = { ...VALID_SAMPLE, timestamp: "not-a-number" };
  const resTimestamp = validateCommandEnvelope(badTimestamp);
  assert.equal(resTimestamp.valid, false);
  if (!resTimestamp.valid) {
    assert.ok(resTimestamp.errors.some((msg) => msg.includes("timestamp")));
  }

  const badMetadata = { ...VALID_SAMPLE, metadata: "string-metadata" };
  const resMetadata = validateCommandEnvelope(badMetadata);
  assert.equal(resMetadata.valid, false);
  if (!resMetadata.valid) {
    assert.ok(resMetadata.errors.some((msg) => msg.includes("metadata")));
  }
});

test("[CLI-01] ProtocolError armazena código estável, mensagem e detalhes de validação", () => {
  try {
    assertCommandEnvelope({});
    assert.fail("assertCommandEnvelope deveria ter lançado ProtocolError");
  } catch (err: unknown) {
    assert.ok(err instanceof ProtocolError);
    assert.equal(err.code, "INVALID_STATE");
    assert.ok(err.details.length >= 6); // todos os 6 campos obrigatórios faltantes
    assert.match(err.message, /Envelope de comando inválido/);
  }
});
