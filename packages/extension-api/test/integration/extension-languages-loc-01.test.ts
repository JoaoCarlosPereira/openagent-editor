import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  createLanguagesNamespace,
  type CompletionList,
  type Hover,
  type TextDocumentData,
} from "../../src/index.js";

function makeDoc(uri: string, content = "const x = 1;\n"): TextDocumentData {
  return {
    uri,
    get version() { return 1; },
    get lineCount() { return content.split("\n").length; },
    text() { return content; },
  };
}

async function assertLaunchError(
  action: Promise<unknown> | (() => unknown),
  expectedSubstring: string,
  expectedCode = PROTOCOL_ERROR_CODES.INVALID_STATE
): Promise<ProtocolError> {
  let caught: unknown;
  try {
    if (typeof action === "function") await action();
    else await action;
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ProtocolError, `esperado ProtocolError, recebido: ${String(caught)}`);
  const error = caught as ProtocolError;
  assert.equal(error.code, expectedCode);
  assert.ok(
    error.message.includes(expectedSubstring),
    `mensagem "${error.message}" deve conter "${expectedSubstring}"`
  );
  return error;
}

test("[LOC-01] languages: registro e consulta de completion provider com array de itens", async () => {
  const ns = createLanguagesNamespace();
  const reg = ns.registerCompletionItemProvider("typescript", {
    async provideCompletionItems() {
      return [
        { label: "log", detail: "console.log", kind: 1 },
        { label: "warn", detail: "console.warn", kind: 1, documentation: { kind: "markdown", value: "Aviso" } },
      ];
    },
  }, ".");

  assert.ok(reg && typeof reg.dispose === "function");
  const doc = makeDoc("file:///workspace/src/app.ts");
  const items = await ns.getCompletionItems(doc, { line: 0, character: 5 });

  assert.equal(items.length, 2);
  const item0 = items[0];
  const item1 = items[1];
  assert.ok(item0 && item1);
  assert.equal(item0.label, "log");
  assert.equal(item0.detail, "console.log");
  assert.equal(item1.label, "warn");
});

test("[LOC-01] languages: registro e consulta de completion provider com CompletionList", async () => {
  const ns = createLanguagesNamespace();
  ns.registerCompletionItemProvider("typescript", {
    async provideCompletionItems() {
      const list: CompletionList = {
        isIncomplete: false,
        items: [
          { label: "alpha", preselect: true },
          { label: "beta" },
        ],
      };
      return list;
    },
  });

  const doc = makeDoc("file:///workspace/src/index.ts");
  const items = await ns.getCompletionItems(doc, { line: 0, character: 1 });
  assert.equal(items.length, 2);
  const first = items[0];
  assert.ok(first);
  assert.equal(first.label, "alpha");
  assert.equal(first.preselect, true);
});

test("[LOC-01] languages: registerCompletionProvider funciona como alias", async () => {
  const ns = createLanguagesNamespace();
  const disposable = ns.registerCompletionProvider("*", {
    async provideCompletionItems() {
      return [{ label: "universal" }];
    },
  });

  const doc = makeDoc("file:///test.py");
  const items = await ns.getCompletionItems(doc, { line: 0, character: 0 });
  assert.equal(items.length, 1);
  const item = items[0];
  assert.ok(item);
  assert.equal(item.label, "universal");

  disposable.dispose();
  const empty = await ns.getCompletionItems(doc, { line: 0, character: 0 });
  assert.equal(empty.length, 0);
});

test("[LOC-01] languages: registro e consulta de hover provider com contents e range", async () => {
  const ns = createLanguagesNamespace();
  const reg = ns.registerHoverProvider({ scheme: "file", language: "typescript" }, {
    async provideHover(doc, position) {
      const hover: Hover = {
        contents: { kind: "markdown", value: `Informação em ${doc.uri}:${position.line}` },
        range: {
          start: { line: position.line, character: 0 },
          end: { line: position.line, character: 10 },
        },
      };
      return hover;
    },
  });

  assert.ok(reg && typeof reg.dispose === "function");
  const doc = makeDoc("file:///workspace/src/app.ts");
  const hover = await ns.getHover(doc, { line: 2, character: 4 });
  assert.ok(hover);
  const hoverObj = hover as Hover;
  assert.deepEqual(hoverObj.contents, { kind: "markdown", value: "Informação em file:///workspace/src/app.ts:2" });
  assert.deepEqual(hoverObj.range, {
    start: { line: 2, character: 0 },
    end: { line: 2, character: 10 },
  });
});

test("[LOC-01] languages: desregistro via disposable descarta providers", async () => {
  const ns = createLanguagesNamespace();
  const compDisp = ns.registerCompletionItemProvider("typescript", {
    provideCompletionItems: async () => [{ label: "temp" }],
  });
  const hoverDisp = ns.registerHoverProvider("typescript", {
    provideHover: async () => ({ kind: "markdown", value: "hover temp" }),
  });

  const doc = makeDoc("file:///test.ts");
  assert.equal((await ns.getCompletionItems(doc, { line: 0, character: 0 })).length, 1);
  assert.ok((await ns.getHover(doc, { line: 0, character: 0 })) !== undefined);

  compDisp.dispose();
  hoverDisp.dispose();

  assert.equal((await ns.getCompletionItems(doc, { line: 0, character: 0 })).length, 0);
  assert.equal(await ns.getHover(doc, { line: 0, character: 0 }), undefined);
});

test("[LOC-01] languages: seletor de documento filtra por scheme, extensão e padrão", async () => {
  const ns = createLanguagesNamespace();
  ns.registerCompletionItemProvider("json", {
    provideCompletionItems: async () => [{ label: "jsonOnly" }],
  });
  ns.registerCompletionItemProvider({ scheme: "file", filepath: "nested" }, {
    provideCompletionItems: async () => [{ label: "nestedOnly" }],
  });

  const tsDoc = makeDoc("file:///test.ts");
  const jsonDoc = makeDoc("file:///test.json");
  const nestedDoc = makeDoc("file:///nested/app.ts");

  const tsItems = await ns.getCompletionItems(tsDoc, { line: 0, character: 0 });
  assert.equal(tsItems.length, 0);

  const jsonItems = await ns.getCompletionItems(jsonDoc, { line: 0, character: 0 });
  assert.equal(jsonItems.length, 1);
  const firstJson = jsonItems[0];
  assert.ok(firstJson);
  assert.equal(firstJson.label, "jsonOnly");

  const nestedItems = await ns.getCompletionItems(nestedDoc, { line: 0, character: 0 });
  assert.equal(nestedItems.length, 1);
  const firstNested = nestedItems[0];
  assert.ok(firstNested);
  assert.equal(firstNested.label, "nestedOnly");
});

test("[LOC-01] languages: caminhos de erro com INVALID_STATE sem efeito colateral", async () => {
  const ns = createLanguagesNamespace();
  const initialCompCount = ns.getRegisteredCompletionProviders().length;
  const initialHoverCount = ns.getRegisteredHoverProviders().length;

  // Seletor inválido
  await assertLaunchError(() => ns.registerCompletionItemProvider("", { provideCompletionItems: async () => [] }), "Seletor de documento");
  await assertLaunchError(() => ns.registerCompletionItemProvider(null as unknown as string, { provideCompletionItems: async () => [] }), "Seletor de documento");
  await assertLaunchError(() => ns.registerCompletionItemProvider([], { provideCompletionItems: async () => [] }), "Lista de seletores");
  await assertLaunchError(() => ns.registerCompletionItemProvider({} as unknown as string, { provideCompletionItems: async () => [] }), "Seletor de documento");

  // Provider inválido
  await assertLaunchError(() => ns.registerCompletionItemProvider("typescript", null as unknown as { provideCompletionItems: () => never }), "Provider de completion");
  await assertLaunchError(() => ns.registerCompletionItemProvider("typescript", {} as unknown as { provideCompletionItems: () => never }), "provideCompletionItems");
  await assertLaunchError(() => ns.registerCompletionItemProvider("typescript", {
    provideCompletionItems: async () => [],
    resolveCompletionItem: 123 as unknown as () => never,
  }), "resolveCompletionItem");

  // Trigger characters inválido
  await assertLaunchError(() => ns.registerCompletionItemProvider("typescript", { provideCompletionItems: async () => [] }, [123 as unknown as string] as unknown as string), "trigger");

  // Hover inválido
  await assertLaunchError(() => ns.registerHoverProvider("", { provideHover: async () => undefined }), "Seletor de documento");
  await assertLaunchError(() => ns.registerHoverProvider("typescript", null as unknown as { provideHover: () => never }), "Provider de hover");
  await assertLaunchError(() => ns.registerHoverProvider("typescript", {} as unknown as { provideHover: () => never }), "provideHover");

  // Posição e documento inválidos em consulta
  const validDoc = makeDoc("file:///test.ts");
  await assertLaunchError(() => ns.getCompletionItems(null as unknown as TextDocumentData, { line: 0, character: 0 }), "Documento inválido");
  await assertLaunchError(() => ns.getCompletionItems(validDoc, { line: -1, character: 0 }), "Posição inválida");
  await assertLaunchError(() => ns.getCompletionItems(validDoc, { line: 0, character: 1.5 }), "Posição inválida");
  await assertLaunchError(() => ns.getHover(validDoc, { line: 0, character: -1 }), "Posição inválida");

  // Preservação de estado
  assert.equal(ns.getRegisteredCompletionProviders().length, initialCompCount);
  assert.equal(ns.getRegisteredHoverProviders().length, initialHoverCount);
});
