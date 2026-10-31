import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário LOC-01: abrir pasta e oferecer edição, terminal, Git, depuração,
// extensão compatível com a API do editor e identidade própria OpenAgent.
// Efeitos são dados sintéticos de superfície (dry-drive), brand-neutral por
// design: nada referencia marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "abrir-pasta": [
    { kind: "state", name: "workspace-opened", value: { folder: true } },
  ],
  "editar-arquivo": [
    { kind: "state", name: "file-edited", value: { saved: true } },
  ],
  "abrir-terminal": [
    { kind: "ui", name: "terminal-panel", value: { open: true } },
  ],
  "abrir-git": [
    { kind: "ui", name: "git-panel", value: { status: true, diff: true } },
  ],
  "abrir-debug": [
    { kind: "ui", name: "debug-session", value: { breakpoint: true } },
  ],
  "instalar-extensao-compativel": [
    { kind: "ui", name: "extension-installed", value: { api: "editor", enabled: true } },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
  "abrir-pasta": [
    { kind: "state", name: "workspace-opened", value: { folder: true } },
    { kind: "ui", name: "package-identity", value: { name: "OpenAgent", icon: "openagent" } },
  ],
};

export const LOC01_SCENARIO: DualScenario = {
  scenarioId: "loc-01-open-folder",
  requirementId: "LOC-01",
  steps: [
    "abrir-pasta",
    "editar-arquivo",
    "abrir-terminal",
    "abrir-git",
    "abrir-debug",
    "instalar-extensao-compativel",
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
