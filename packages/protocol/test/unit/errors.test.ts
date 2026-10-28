import test from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL_ERROR_CODES,
  cancelledError,
  conflictError,
  incompleteStreamError,
  isProtocolError,
  isProviderErrorCode,
  isStableProtocolErrorCode,
  outOfScopePathError,
  permissionDeniedError,
  providerFailureError,
  refuseToolInTerminalRunError,
} from "../../src/index.js";

test("[STA-01] execução concluída recusa nova ferramenta com INVALID_STATE até nova mensagem", () => {
  const err = refuseToolInTerminalRunError("completed");
  assert.ok(isProtocolError(err));
  assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  assert.match(err.message, /mensagem nova/i);
  assert.equal(err.hints?.runState, "completed");
  assert.equal(err.hints?.requiresNewUserMessage, true);
});

test("[STA-01] execução cancelada recusa nova ferramenta com INVALID_STATE até nova mensagem", () => {
  const err = refuseToolInTerminalRunError("cancelled");
  assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  assert.equal(err.hints?.runState, "cancelled");
  assert.equal(err.hints?.requiresNewUserMessage, true);
});

test("[ERR-02] caminho fora do workspace retorna OUT_OF_SCOPE e registra mensagem fixa", () => {
  const err = outOfScopePathError("/etc/passwd");
  assert.equal(err.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
  assert.ok(err.details.includes("Caminho fora do escopo."));
  assert.equal(err.hints?.requestedPath, "/etc/passwd");
});

test("[ERR-03] queda no streaming retorna INCOMPLETE_STREAM com retry idempotente", () => {
  const err = incompleteStreamError();
  assert.equal(err.code, PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM);
  assert.equal(err.hints?.idempotentRetry, true);
  assert.equal(err.hints?.skipRepeatedMutations, true);
});

test("[API-02] timeout do provedor expõe causa e preserva prompt e diff", () => {
  const err = providerFailureError("timeout", "upstream deadline exceeded");
  assert.equal(err.code, "PROVIDER_TIMEOUT");
  assert.equal(err.hints?.providerCause, "upstream deadline exceeded");
  assert.equal(err.hints?.preservePrompt, true);
  assert.equal(err.hints?.preserveDiff, true);
});

test("[API-02] rate limit do provedor usa código PROVIDER_RATE_LIMIT", () => {
  const err = providerFailureError("rate_limit", "429 Too Many Requests");
  assert.equal(err.code, "PROVIDER_RATE_LIMIT");
  assert.equal(err.hints?.providerCause, "429 Too Many Requests");
  assert.equal(err.hints?.preservePrompt, true);
  assert.equal(err.hints?.preserveDiff, true);
});

test("[API-02] capacidade ausente do provedor usa código PROVIDER_CAPABILITY_MISSING", () => {
  const err = providerFailureError("capability_missing", "model does not support tools");
  assert.equal(err.code, "PROVIDER_CAPABILITY_MISSING");
  assert.equal(err.hints?.providerCause, "model does not support tools");
});

test("[STA-01] catálogo expõe todos os códigos estáveis base da TechSpec", () => {
  assert.deepEqual(Object.keys(PROTOCOL_ERROR_CODES).sort(), [
    "CANCELLED",
    "CONFLICT",
    "INCOMPLETE_STREAM",
    "INVALID_STATE",
    "OUT_OF_SCOPE",
    "PERMISSION_DENIED",
  ]);
  for (const code of Object.values(PROTOCOL_ERROR_CODES)) {
    assert.equal(isStableProtocolErrorCode(code), true);
  }
});

test("isProviderErrorCode reconhece prefixo PROVIDER_ sem aceitar códigos arbitrários", () => {
  assert.equal(isProviderErrorCode("PROVIDER_TIMEOUT"), true);
  assert.equal(isProviderErrorCode("PROVIDER_CUSTOM"), true);
  assert.equal(isProviderErrorCode("INVALID_STATE"), false);
  assert.equal(isProviderErrorCode("NOT_PROVIDER"), false);
});

test("permissionDeniedError, conflictError e cancelledError usam códigos estáveis", () => {
  assert.equal(permissionDeniedError("negado").code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
  assert.equal(conflictError("versão").code, PROTOCOL_ERROR_CODES.CONFLICT);
  assert.equal(cancelledError().code, PROTOCOL_ERROR_CODES.CANCELLED);
});

test("ProtocolError serializa code, details e hints sem efeito colateral externo", () => {
  const err = outOfScopePathError("../outside");
  const snapshot = {
    code: err.code,
    message: err.message,
    details: [...err.details],
    hints: err.hints ? { ...err.hints } : undefined,
  };
  err.details.push("mutação");
  assert.deepEqual(snapshot.details, ["Caminho fora do escopo."]);
  assert.equal(snapshot.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
});
