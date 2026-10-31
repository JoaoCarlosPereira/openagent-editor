import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário ERR-03: quando a conexão cai durante o streaming, o produto marca
// a resposta como Incompleta e permite tentar de novo sem repetir alteração
// já gravada. Ordem verificada: recebimento parcial < queda da conexão <
// marcação como Incompleta < preservação da gravação parcial < retry sem
// duplicar escrita. Superfícies são dados puros de dry-drive, sem acoplamento
// a marca ou binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de ERR-03 (packages/
// model-gateway + services/harness-daemon); este cenário modela o contrato
// pelas tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "streamar-parcial": [
    {
      kind: "state",
      name: "stream-partial-received",
      value: { run: "runa-0009", chunks: 3 },
    },
  ],
  "queda-do-streaming": [
    {
      kind: "event",
      name: "stream-connection-dropped",
      value: { run: "runa-0009", afterChunks: 3 },
    },
  ],
  "marcar-incompleta": [
    {
      kind: "ui",
      name: "response-marked-incomplete",
      value: { run: "runa-0009", status: "Incompleta" },
    },
  ],
  "tentar-de-novo": [
    {
      kind: "state",
      name: "partial-record-preserved",
      value: { run: "runa-0009", partialRecorded: true, unchanged: true },
    },
    {
      kind: "state",
      name: "retry-issued",
      value: { run: "runa-0010", retryOf: "runa-0009", noDuplicateWrite: true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const ERR03_SCENARIO: DualScenario = {
  scenarioId: "err-03-incomplete-stream-retry",
  requirementId: "ERR-03",
  steps: [
    "streamar-parcial",
    "queda-do-streaming",
    "marcar-incompleta",
    "tentar-de-novo",
  ],
  cursor: {
    product: "cursor",
    productVersion: FROZEN_CURSOR_VERSION,
    platform: "linux",
    model: "modelo-local",
    provider: "cliproxy-v8.0.45",
    effects: cursorEffects,
  },
  openagent: {
    product: "openagent",
    productVersion: OPENAGENT_VERSION,
    platform: "linux",
    model: "modelo-local",
    provider: "cliproxy-v8.0.45",
    effects: openagentEffects,
  },
};
