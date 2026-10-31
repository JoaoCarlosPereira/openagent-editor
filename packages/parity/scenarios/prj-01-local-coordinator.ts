import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário PRJ-01: criar um projeto com um objetivo abre um coordenador local
// que divide o objetivo em tarefas de agentes na mesma máquina e mostra cada
// resultado para aceitar ou rejeitar. Superfícies são dados puros de
// dry-drive, sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "criar-projeto-com-objetivo": [
    {
      kind: "state",
      name: "project-created",
      value: { objective: "refatorar-modulo", local: true },
    },
  ],
  "dividir-o-objetivo-em-tarefas-de-agentes": [
    {
      kind: "ui",
      name: "coordinator-plan",
      value: { tasks: 3, "same-machine": true },
    },
  ],
  "mostrar-cada-resultado-de-tarefa": [
    {
      kind: "ui",
      name: "task-results",
      value: { results: ["applied", "applied", "failed"], "per-task": true },
    },
  ],
  "aceitar-ou-rejeitar-resultado": [
    {
      kind: "ui",
      name: "result-decision",
      value: { options: ["accept", "reject"], submitted: "accept" },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const PRJ01_SCENARIO: DualScenario = {
  scenarioId: "prj-01-local-coordinator",
  requirementId: "PRJ-01",
  steps: [
    "criar-projeto-com-objetivo",
    "dividir-o-objetivo-em-tarefas-de-agentes",
    "mostrar-cada-resultado-de-tarefa",
    "aceitar-ou-rejeitar-resultado",
  ],
  cursor: {
    product: "cursor",
    productVersion: FROZEN_CURSOR_VERSION,
    platform: "linux",
    model: null,
    provider: null,
    effects: cursorEffects,
  },
  openagent: {
    product: "openagent",
    productVersion: OPENAGENT_VERSION,
    platform: "linux",
    model: null,
    provider: null,
    effects: openagentEffects,
  },
};
