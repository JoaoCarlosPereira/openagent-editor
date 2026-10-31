import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  COMPLETION_EVENT_TYPE,
  type CompletionCancelParams,
  type CompletionCancelResult,
  type CompletionEventPayload,
  type CompletionStartParams,
  type CompletionStartResult,
  RPC_METHOD,
} from "@openagent/protocol";

type EditorGhostTextStream = import("../../src/tab/index.js").GhostTextStream;

import {
  GhostTextController,
  readTabAutoSuggestions,
  removeTabAutoSuggestions,
  TAB_SETTINGS_DIRNAME,
  TAB_SETTINGS_FILENAME,
  tabSettingsPath,
  writeTabAutoSuggestions,
  type GhostTextCompletionPort,
} from "../../src/tab/index.js";

class DeferredPort implements GhostTextCompletionPort {
  readonly starts: CompletionStartParams[] = [];
  readonly cancels: CompletionCancelParams[] = [];

  start(params: CompletionStartParams): EditorGhostTextStream {
    this.starts.push(params);
    const delta: CompletionEventPayload = {
      type: COMPLETION_EVENT_TYPE.DELTA,
      completionId: params.completionId,
      attempt: 1,
      offset: 0,
      deltaText: "sugerido",
    };
    const completed: CompletionEventPayload = {
      type: COMPLETION_EVENT_TYPE.COMPLETED,
      completionId: params.completionId,
      attempt: 1,
      text: delta.deltaText,
    };
    return {
      result: Promise.resolve<CompletionStartResult>({
        completionId: params.completionId,
        state: "completed",
        attempt: 1,
      }),
      async *[Symbol.asyncIterator]() {
        yield { payload: delta };
        yield { payload: completed };
      },
    };
  }

  async cancel(params: CompletionCancelParams): Promise<CompletionCancelResult> {
    this.cancels.push(params);
    return { completionId: params.completionId, state: "cancelled", cancelled: true };
  }
}

describe("TAB-01 e2e - sugestão automática desligada por workspace", () => {
  it("[TAB-01] digitação com sugestão automática desligada não emite completion.start e fica idle", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "tab-auto-off-"));
    try {
      writeTabAutoSuggestions(root, true);
      assert.equal(readTabAutoSuggestions(root).autoSuggestionsDisabled, true);
      const port = new DeferredPort();
      const controller = new GhostTextController({
        port,
        autoSuggestionsDisabled: readTabAutoSuggestions(root).autoSuggestionsDisabled,
      });
      const view = controller.type("const x = ");
      await controller.settled();
      assert.equal(view.accessible.phase, "idle");
      assert.equal(controller.rpcLog.filter((call) => call.method === RPC_METHOD.COMPLETION_START).length, 0);
      assert.equal(port.starts.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("[TAB-01] habilitada por padrão segue ofertando sugestão (comportamento preservado)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "tab-auto-default-"));
    try {
      assert.equal(readTabAutoSuggestions(root).autoSuggestionsDisabled, false);
      const port = new DeferredPort();
      const controller = new GhostTextController({ port });
      controller.type("const y = ");
      const view = await controller.settled();
      assert.equal(view.accessible.phase, "suggesting");
      assert.equal(view.accessible.suggestion, "sugerido");
      assert.equal(port.starts.length, 1);
      assert.equal(port.starts[0]?.prefix, "const y = ");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("[TAB-01] caminho de erro: JSON inválido responde INVALID_STATE sem efeito colateral", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tab-auto-bad-"));
    try {
      const file = tabSettingsPath(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "{ não é json");
      assert.throws(() => readTabAutoSuggestions(root), /Arquivo de configuração do Tab inválido/);
      assert.equal(readFileSync(file, "utf8"), "{ não é json");
      writeFileSync(file, JSON.stringify({ autoSuggestionsDisabled: "sim" }));
      assert.throws(() => readTabAutoSuggestions(root), /autoSuggestionsDisabled deve ser booleano/);
      assert.throws(() => writeTabAutoSuggestions(root, "desligada" as unknown as boolean), /inválido/);
      assert.equal(fs.existsSync(file), true, "writeTabAutoSuggestions inválido não deve tocar o arquivo");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("[TAB-01] settings persistem entre sessões do mesmo workspace e não vazam para outro", () => {
    const first = mkdtempSync(path.join(tmpdir(), "tab-auto-ws-a-"));
    const second = mkdtempSync(path.join(tmpdir(), "tab-auto-ws-b-"));
    try {
      writeTabAutoSuggestions(first, true);
      assert.equal(readTabAutoSuggestions(first).autoSuggestionsDisabled, true);
      assert.equal(readTabAutoSuggestions(second).autoSuggestionsDisabled, false);
      writeTabAutoSuggestions(second, true);
      assert.equal(
        JSON.parse(readFileSync(tabSettingsPath(second), "utf8")).autoSuggestionsDisabled,
        true,
      );
      assert.equal(readTabAutoSuggestions(first).autoSuggestionsDisabled, true, "workspace B não altera A");
      removeTabAutoSuggestions(first);
      assert.equal(readTabAutoSuggestions(first).autoSuggestionsDisabled, false);
      removeTabAutoSuggestions(second);
      assert.equal(readTabAutoSuggestions(second).autoSuggestionsDisabled, false);
      assert.ok(tabSettingsPath(second).includes(TAB_SETTINGS_DIRNAME));
      assert.ok(tabSettingsPath(second).endsWith(TAB_SETTINGS_FILENAME));
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });
});
