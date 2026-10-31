import test from "node:test";
import assert from "node:assert/strict";

import { ProtocolError } from "@openagent/protocol";

import {
  createLocalStructuredLogger,
  validateStructuredLogWriteInput,
} from "../../src/logger.js";
import { STANDARD_LOG_REDACTED } from "../../src/redaction.js";

test("[PRV-02] writeToolAction registra ação de ferramenta omitindo campos sensíveis", () => {
  const lines: string[] = [];
  const logger = createLocalStructuredLogger(
    { traceId: "trace-1", sessionId: "sess-1", runId: "run-1" },
    (line) => lines.push(line),
  );

  logger.writeToolAction({
    tool: "file.read",
    target: "src/index.ts",
    credential: "secret-key",
    excludedFileContent: "conteudo-excluido",
    rawModelResponseBody: '{"raw":"model"}',
  });

  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.ok(line);
  const parsed = JSON.parse(line) as Record<string, unknown>;
  assert.equal(parsed.kind, "tool_action");
  assert.equal(parsed.tool, "file.read");
  assert.equal(parsed.traceId, "trace-1");
  assert.equal(parsed.sessionId, "sess-1");
  assert.equal(parsed.runId, "run-1");
  assert.equal(parsed.credential, STANDARD_LOG_REDACTED);
  assert.equal(parsed.excludedFileContent, STANDARD_LOG_REDACTED);
  assert.equal(parsed.rawModelResponseBody, STANDARD_LOG_REDACTED);
  assert.ok(!line.includes("secret-key"));
  assert.ok(!line.includes("conteudo-excluido"));
});

test("[PRV-02] write emite log estruturado redigido com correlação", () => {
  const lines: string[] = [];
  const logger = createLocalStructuredLogger({ agentId: "agent-a" }, (line) =>
    lines.push(line),
  );

  logger.write({
    level: "info",
    message: "tool finished",
    tool: "shell.exec",
    durationMs: 42,
    state: "ok",
    token: "must-redact",
  });

  assert.equal(lines.length, 1);
  const structuredLine = lines[0];
  assert.ok(structuredLine);
  const parsed = JSON.parse(structuredLine) as Record<string, unknown>;
  assert.equal(parsed.kind, "structured_log");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.message, "tool finished");
  assert.equal(parsed.agentId, "agent-a");
  assert.equal(parsed.token, STANDARD_LOG_REDACTED);
});

test("[PRV-02] entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
  const invalid = validateStructuredLogWriteInput({ level: "verbose", message: "x" });
  assert.equal(invalid.valid, false);
  if (!invalid.valid) {
    assert.equal(invalid.code, "INVALID_STATE");
  }

  const lines: string[] = [];
  const logger = createLocalStructuredLogger({}, (line) => lines.push(line));
  assert.throws(
    () => logger.write({ level: "info", message: "  " } as never),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "INVALID_STATE");
      return true;
    },
  );
  assert.equal(lines.length, 0);
});
