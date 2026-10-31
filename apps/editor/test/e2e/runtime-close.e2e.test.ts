import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { createCloseCoordinator } from "../../runtime/close-coordinator.js";

test("fechamento aguarda fila do renderer e permite cancelamento", async () => {
  const listeners = new Map<string, (...args: never[]) => void>();
  const elements = new Map<string, { [key: string]: unknown }>();
  for (const id of ["folder", "save", "workspace", "files", "filename", "content", "error"]) {
    elements.set(`#${id}`, { value: "", disabled: false, addEventListener: (name: string, cb: (...args: never[]) => void) => listeners.set(`${id}:${name}`, cb), replaceChildren() {} });
  }
  let release!: (value: unknown) => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => { started = resolve; });
  let request!: () => void;
  let cancel!: () => void;
  const state = { folder: null, entries: [], document: { content: "", relativePath: "a", dirty: false } };
  const outcomes: boolean[] = [];
  const editor = {
    state: async () => state,
    edit: () => { started(); return new Promise((resolve) => { release = resolve; }); },
    onCloseRequest: (cb: () => void) => { request = cb; },
    onCloseCancelled: (cb: () => void) => { cancel = cb; },
    closeReady: (ok: boolean) => outcomes.push(ok),
  };
  const document = { querySelector: (id: string) => elements.get(id), addEventListener() {} };
  vm.runInNewContext(readFileSync(new URL("../../runtime/renderer.js", import.meta.url), "utf8"), { document, window: { editor } });
  await new Promise((resolve) => setImmediate(resolve));
  const content = elements.get("#content");
  const input = listeners.get("content:input");
  assert.ok(content);
  assert.ok(input);
  content.value = "edição pendente";
  input();
  await begun;
  request();
  assert.equal(content.readOnly, true);
  assert.deepEqual(outcomes, []);
  release(state);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(outcomes, [true]);
  cancel();
  assert.equal(content.readOnly, false);
});

test("coordenador não fecha antes da confirmação e aceita nova tentativa", () => {
  let requests = 0;
  let closes = 0;
  let resumes = 0;
  let discard = false;
  const coordinator = createCloseCoordinator({
    requestRenderer: () => { requests++; },
    confirmDiscard: () => discard,
    closeWindow: () => { closes++; },
    resumeRenderer: () => { resumes++; },
  });
  assert.equal(coordinator.request(), false);
  assert.equal(coordinator.request(), false);
  assert.equal(requests, 1);
  coordinator.ready(false);
  assert.equal(closes, 0);
  assert.equal(resumes, 1);
  coordinator.request();
  coordinator.ready(true);
  assert.equal(closes, 0);
  assert.equal(resumes, 2);
  discard = true;
  coordinator.request();
  coordinator.ready(true);
  assert.equal(closes, 1);
  assert.equal(coordinator.request(), true);
});
