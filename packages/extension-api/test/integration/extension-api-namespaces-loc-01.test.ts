import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  createCommandsNamespace,
  createFrozenSurface,
  createWindowNamespace,
  createWorkspaceNamespace,
  type TextEditorDecorationType,
  type WindowAdapter,
  type WorkspaceAdapter,
} from "../../src/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────────

async function assertLaunchError(
  action: Promise<unknown> | (() => unknown),
  expectedSubstring: string,
  expectedCode?: string
): Promise<Error> {
  let caught: Error | undefined;
  try {
    if (typeof action === "function") await action();
    else await action;
  } catch (error) {
    caught = error instanceof Error ? error : new Error(String(error));
  }
  assert.ok(caught, "deve lançar um erro");
  assert.ok(
    caught.message.includes(expectedSubstring),
    `mensagem contém "${expectedSubstring}": ${caught.message}`
  );
  if (expectedCode) {
    assert.ok(
      caught instanceof ProtocolError,
      `é instancia de ProtocolError (code=${expectedCode}): ${caught.constructor.name}`
    );
    assert.equal((caught as ProtocolError).code, expectedCode);
  }
  return caught;
}

// ─── Commands Namespace ───────────────────────────────────────────────────────────

test("[LOC-01] commands: registro + execução de comando com payload", async () => {
  const ns = createCommandsNamespace();
  const reg = ns.registerCommand("minha.teste.hello", (...args: unknown[]) => {
    const name = typeof args[0] === "string" ? args[0] : "";
    return `hello ${name}`;
  });
  assert.equal(reg.commandId, "minha.teste.hello");
  const result = await ns.executeCommand<string>("minha.teste.hello", "OpenAgent");
  assert.equal(result, "hello OpenAgent");
  const commands = ns.getRegisteredCommands();
  assert.ok(commands.length === 1);
  const firstCommand = commands[0];
  assert.ok(firstCommand);
  assert.equal(firstCommand.command, "minha.teste.hello");
});

test("[LOC-01] commands: comando não registrado lança erro com código estável", async () => {
  const ns = createCommandsNamespace();
  const err = await assertLaunchError(
    () => ns.executeCommand<string>("comando.inexistente"),
    "não encontrado",
    PROTOCOL_ERROR_CODES.INVALID_STATE
  );
  assert.ok((err as ProtocolError).details !== undefined);
});

test("[LOC-01] commands: desregistro remove comando", async () => {
  const ns = createCommandsNamespace();
  ns.registerCommand("minha.teste.remove", () => "ok");
  ns.unregisterCommand("minha.teste.remove");
  await assertLaunchError(
    () => ns.executeCommand<string>("minha.teste.remove"),
    "não encontrado",
    PROTOCOL_ERROR_CODES.INVALID_STATE
  );
});

test("[LOC-01] commands: ID vazio lança INVALID_STATE, estado não alterado", async () => {
  const ns = createCommandsNamespace();
  const preCount = ns.getRegisteredCommands().length;
  await assertLaunchError(
    () => ns.registerCommand("", () => 1),
    "ID de comando inválido",
    PROTOCOL_ERROR_CODES.INVALID_STATE
  );
  const postCount = ns.getRegisteredCommands().length;
  assert.equal(preCount, postCount, "registro não adicionou comando após falha");
});

test("[LOC-01] commands: callback inválido lança INVALID_STATE", async () => {
  const ns = createCommandsNamespace();
  await assertLaunchError(
    () => ns.registerCommand("bad.cb", undefined as unknown as (...args: unknown[]) => unknown),
    "Callback de comando inválido",
    PROTOCOL_ERROR_CODES.INVALID_STATE
  );
  assert.equal(ns.getRegisteredCommands().length, 0);
});

test("[LOC-01] commands: duplicata lança INVALID_STATE, estado preservado", async () => {
  const ns = createCommandsNamespace();
  ns.registerCommand("dup.cmd", () => "primeiro");
  await assertLaunchError(
    () => ns.registerCommand("dup.cmd", () => "segundo"),
    "já registrado",
    PROTOCOL_ERROR_CODES.INVALID_STATE
  );
  const cmds = ns.getRegisteredCommands();
  assert.ok(cmds.length === 1, "apenas o primeiro registro persiste");
  const first = cmds[0];
  assert.ok(first);
  assert.equal(first.callback(), "primeiro");
});

// ─── Window Namespace ─────────────────────────────────────────────────────────────

test("[LOC-01] window: showInputBox sem adapter retorna undefined", async () => {
  const ns = createWindowNamespace();
  const result = await ns.showInputBox();
  assert.equal(result, undefined);
});

test("[LOC-01] window: showInputBox com adapter — cancelamento", async () => {
  const adapter: WindowAdapter = { input() { return undefined; } };
  const ns = createWindowNamespace(adapter);
  const result = await ns.showInputBox({ placeholder: "Teste" });
  assert.equal(result, undefined);
});

test("[LOC-01] window: showInputBox com adapter — input válido", async () => {
  const adapter: WindowAdapter = { input() { return "user input"; } };
  const ns = createWindowNamespace(adapter);
  const result = await ns.showInputBox({ placeholder: "Digite" });
  assert.equal(result, "user input");
});

test("[LOC-01] window: mensagem encaminha texto/opções e retorna seleção determinística", async () => {
  const seen: { kind?: string; message?: string; options?: readonly unknown[] } = {};
  const adapter: WindowAdapter = {
    chooseMessage(kind, message, options) {
      seen.kind = kind;
      seen.message = message;
      seen.options = options;
      return options[1];
    }
  };
  const ns = createWindowNamespace(adapter);
  const result = await ns.showInformationMessage("Escolha uma ação", "Manter", "Cancelar");
  assert.equal(result, "Cancelar");
  assert.equal(seen.kind, "information");
  assert.equal(seen.message, "Escolha uma ação");
  assert.deepEqual(seen.options, ["Manter", "Cancelar"]);
});

test("[LOC-01] window: mensagem pode ser cancelada pelo adapter", async () => {
  const ns = createWindowNamespace({ chooseMessage() { return undefined; } });
  assert.equal(await ns.showWarningMessage("Aviso", "Continuar"), undefined);
});

test("[LOC-01] window: createStatusBarItem + getStatusBarItems", async () => {
  const ns = createWindowNamespace();
  const bar = ns.createStatusBarItem("status.task-159", "right");
  assert.equal(bar.id, "status.task-159");
  assert.equal(bar.alignment, "right");
  assert.equal(bar.text, "");
  bar.text = "Pronto";
  const items = ns.getStatusBarItems();
  assert.equal(items.length, 1);
  const firstItem = items[0];
  assert.ok(firstItem);
  assert.equal(firstItem.text, "Pronto");
  const bar2 = ns.createStatusBarItem("status.task-159", "right");
  assert.strictEqual(bar2, bar);
  assert.equal(ns.getStatusBarItems().length, 1);
});

// ─── Workspace Namespace — adapter injetável ──────────────────────────────────────

test("[LOC-01] workspace: rootPath + name acessíveis", () => {
  const ns = createWorkspaceNamespace("/root/does", "my-workspace");
  assert.strictEqual(ns.rootPath, "/root/does");
  assert.strictEqual(ns.name, "my-workspace");
});

test("[LOC-01] workspace: name derivado de rootPath quando não fornecido", () => {
  const ns = createWorkspaceNamespace("/home/user/my-project");
  assert.strictEqual(ns.rootPath, "/home/user/my-project");
  assert.strictEqual(ns.name, "my-project");
});

test("[LOC-01] workspace: rootPath undefined quando string vazia", () => {
  const ns = createWorkspaceNamespace("", "empty-root");
  assert.strictEqual(ns.rootPath, undefined);
  assert.strictEqual(ns.name, "empty-root");
});

test("[LOC-01] workspace: configuração injetada via adapter", () => {
  const adapter: WorkspaceAdapter = {
    files: [],
    contents: {},
    configuration: { editor: { tabSize: 2, insertSpaces: true } }
  };
  const ns = createWorkspaceNamespace("/root", "ws", adapter);
  const section = ns.getConfigurationSection("editor");
  assert.ok(section !== undefined);
  assert.strictEqual(section.tabSize, 2);
  assert.strictEqual(section.insertSpaces, true);
});

test("[LOC-01] workspace: configuração vazia retorna undefined", () => {
  const ns = createWorkspaceNamespace("/root", "ws");
  const section = ns.getConfigurationSection("nonexistent");
  assert.equal(section, undefined);
});

test("[LOC-01] workspace: openTextDocument para URI inválida lança INVALID_STATE", async () => {
  const ns = createWorkspaceNamespace("/root", "ws");
  await assertLaunchError(
    () => ns.openTextDocument(""),
    "URI de documento inválida",
    PROTOCOL_ERROR_CODES.INVALID_STATE
  );
});

test("[LOC-01] workspace: openTextDocument com adapter retorna conteúdo real", async () => {
  const adapter: WorkspaceAdapter = {
    files: [{ uri: "file:///a.txt", name: "a.txt", isDirectory: false }],
    contents: { "file:///a.txt": "linha1\nlinha2" }
  };
  const ns = createWorkspaceNamespace("/root", "ws", adapter);
  const doc = await ns.openTextDocument("file:///a.txt");
  assert.equal(doc.uri, "file:///a.txt");
  assert.equal(doc.text(), "linha1\nlinha2");
  assert.equal(doc.lineCount, 2);
});

test("[LOC-01] workspace: openTextDocument para URI sem conteúdo lança INVALID_STATE", async () => {
  const ns = createWorkspaceNamespace("/root", "ws");
  await assertLaunchError(
    () => ns.openTextDocument("file:///inexistente.txt"),
    "não disponível no workspace adapter",
    PROTOCOL_ERROR_CODES.INVALID_STATE
  );
});

test("[LOC-01] workspace: saveTextDocument delega conteúdo ao adapter", async () => {
  let savedUri = "";
  let savedContent = "";
  const adapter: WorkspaceAdapter = {
    files: [],
    contents: { "file:///save.txt": "conteúdo local" },
    save(uri, content) { savedUri = uri; savedContent = content; return true; }
  };
  const ns = createWorkspaceNamespace("/root", "ws", adapter);
  await ns.openTextDocument("file:///save.txt");
  assert.equal(await ns.saveTextDocument("file:///save.txt"), true);
  assert.equal(savedUri, "file:///save.txt");
  assert.equal(savedContent, "conteúdo local");
});

test("[LOC-01] workspace: saveTextDocument para URI não aberto retorna false", async () => {
  const ns = createWorkspaceNamespace("/root", "ws");
  const result = await ns.saveTextDocument("file:///na-aberto.txt");
  assert.equal(result, false);
});

test("[LOC-01] workspace: documento aberto é estável e tem conteúdo e linhas consistentes", async () => {
  const ns = createWorkspaceNamespace("/root", "ws", {
    files: [], contents: { "file:///doc.txt": "primeira\nsegunda\n" },
  });
  const document = await ns.openTextDocument("file:///doc.txt");
  assert.strictEqual(await ns.openTextDocument("file:///doc.txt"), document);
  assert.equal(document.version, 1);
  assert.equal(document.lineCount, 3);
  assert.equal(document.text(), "primeira\nsegunda\n");
});

test("[LOC-01] workspace: documento sem conteúdo não é aberto após INVALID_STATE", async () => {
  const ns = createWorkspaceNamespace("/root", "ws");
  await assertLaunchError(
    () => ns.openTextDocument("file:///missing.txt"),
    "não disponível no workspace adapter",
    PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
  assert.equal(ns.openTextDocuments().length, 0);
});

test("[LOC-01] workspace: findFiles filtra por padrão", async () => {
  const adapter: WorkspaceAdapter = {
    files: [
      { uri: "file:///a.ts", name: "a.ts", isDirectory: false },
      { uri: "file:///b.js", name: "b.js", isDirectory: false },
      { uri: "file:///c.md", name: "c.md", isDirectory: false }
    ],
    contents: {}
  };
  const ns = createWorkspaceNamespace("/root", "ws", adapter);
  const files = await ns.findFiles("*.ts");
  assert.ok(files.length === 1);
  const firstFile = files[0];
  assert.ok(firstFile);
  assert.equal(firstFile.name, "a.ts");
  const all = await ns.findFiles("*");
  assert.ok(all.length === 3);
});

test("[LOC-01] workspace: findFiles com maxResults limita", async () => {
  const adapter: WorkspaceAdapter = {
    files: [
      { uri: "file:///a.ts", name: "a.ts", isDirectory: false },
      { uri: "file:///b.ts", name: "b.ts", isDirectory: false },
      { uri: "file:///c.ts", name: "c.ts", isDirectory: false }
    ],
    contents: {}
  };
  const ns = createWorkspaceNamespace("/root", "ws", adapter);
  const files = await ns.findFiles("*.ts", undefined, 1);
  assert.equal(files.length, 1);
});

test("[LOC-01] workspace: findFiles com exclude filtra", async () => {
  const adapter: WorkspaceAdapter = {
    files: [
      { uri: "file:///test-a.ts", name: "test-a.ts", isDirectory: false },
      { uri: "file:///test-b.ts", name: "test-b.ts", isDirectory: false }
    ],
    contents: {}
  };
  const ns = createWorkspaceNamespace("/root", "ws", adapter);
  const files = await ns.findFiles("test-*.ts", "test-a.ts");
  assert.equal(files.length, 1);
  const remainingFile = files[0];
  assert.ok(remainingFile);
  assert.equal(remainingFile.name, "test-b.ts");
});

test("[LOC-01] workspace: findFiles casa glob sobre caminhos aninhados e aplica exclusão", async () => {
  const adapter: WorkspaceAdapter = {
    files: [
      { uri: "file:///root/src/main.ts", name: "src\\main.ts", isDirectory: false },
      { uri: "file:///root/src/nested/util.ts", name: "src/nested/util.ts", isDirectory: false },
      { uri: "file:///root/test/main.ts", name: "test/main.ts", isDirectory: false },
    ], contents: {},
  };
  const ns = createWorkspaceNamespace("/root", "ws", adapter);
  const files = await ns.findFiles("**/*.ts", "test/**");
  assert.deepEqual(files.map((file) => file.uri), ["file:///root/src/main.ts", "file:///root/src/nested/util.ts"]);
});

test("[LOC-01] workspace: findFiles rejeita argumentos inválidos com INVALID_STATE", async () => {
  const ns = createWorkspaceNamespace("/root", "ws", {
    files: [{ uri: "file:///root/a.ts", name: "a.ts", isDirectory: false }], contents: {},
  });
  for (const limit of [-1, 1.5]) {
    await assertLaunchError(ns.findFiles("**/*.ts", undefined, limit), "maxResults", PROTOCOL_ERROR_CODES.INVALID_STATE);
  }
  await assertLaunchError(ns.findFiles("../**/*.ts"), "fora do workspace", PROTOCOL_ERROR_CODES.INVALID_STATE);
  assert.equal((await ns.findFiles("**/*.ts")).length, 1, "falhas de validação não alteram os arquivos");
});

test("[LOC-01] workspace: openTextDocuments retorna docs abertos", async () => {
  const adapter: WorkspaceAdapter = {
    files: [],
    contents: { "file:///one.txt": "one", "file:///two.txt": "two" }
  };
  const ns = createWorkspaceNamespace("/root", "ws", adapter);
  await ns.openTextDocument("file:///one.txt");
  await ns.openTextDocument("file:///two.txt");
  const docs = ns.openTextDocuments();
  assert.ok(docs.length === 2);
  assert.ok(docs.some((d) => d.uri === "file:///one.txt"));
  assert.ok(docs.some((d) => d.uri === "file:///two.txt"));
});

// ─── Decorations ──────────────────────────────────────────────────────────────────

test("[LOC-01] workspace: createTextEditorDecorationType gera id único", () => {
  const ns = createWorkspaceNamespace("/root", "ws");
  const d1 = ns.createTextEditorDecorationType({ outlineColor: "red" });
  const d2 = ns.createTextEditorDecorationType({ backgroundColor: "blue" });
  assert.ok(typeof d1.id === "string" && d1.id.startsWith("decoration-"));
  assert.ok(d1.id !== d2.id);
  assert.equal(d1.outlineColor, "red");
  assert.equal(d2.backgroundColor, "blue");
});

test("[LOC-01] workspace: decorações validadas são observáveis e inválidas não alteram estado", () => {
  const ns = createWorkspaceNamespace("/root", "ws");
  const valid = ns.createTextEditorDecorationType({
    outlineColor: "#ff0000", backgroundColor: "rgba(0,0,0,.2)", opacity: 0.5, zIndex: 2,
  });
  assert.deepEqual(valid, {
    id: "decoration-0", outlineColor: "#ff0000", backgroundColor: "rgba(0,0,0,.2)", opacity: 0.5, zIndex: 2,
  });
  const invalidValues: unknown[] = [
    null,
    { opacity: "0.5" },
    { zIndex: Number.NaN },
    { outlineColor: 42 },
    { textDecoration: false },
    { hoverMessage: {} },
  ];
  for (const value of invalidValues) {
    assert.throws(
      () => ns.createTextEditorDecorationType(value as Omit<TextEditorDecorationType, "id">),
      (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );
  }
  const next = ns.createTextEditorDecorationType({ opacity: 0.25 });
  assert.equal(next.id, "decoration-1", "inválidos não registram estilos nem consomem identificadores");
  assert.equal(next.opacity, 0.25);
});

// SPEC_DEVIATION: A fixture congelada 3.24.18 define TextDocumentData somente com
// uri/version/lineCount/text() e WorkspaceNamespace não expõe edição nem editor.
// Implementar mutação ou aplicação de decoração exigiria ampliar contrato sem
// evidência diferencial; manter apenas os comportamentos representáveis na API.

// ─── Frozen Surface ───────────────────────────────────────────────────────────────

test("[LOC-01] frozen-surface: criar superfície válida e validar", async () => {
  const surface = createFrozenSurface("/some/path", "my-workspace");
  assert.equal(surface.version, "3.24.18");
});

test("[LOC-01] commands + window + workspace são funcionais na superfície", async () => {
  const adapters: { window: WindowAdapter; workspace: WorkspaceAdapter } = {
    window: { chooseMessage: (_kind, _message, options) => options[1] },
    workspace: {
      files: [{ uri: "file:///surface.txt", name: "surface.txt", isDirectory: false }],
      contents: { "file:///surface.txt": "conteúdo frozen" },
      configuration: { editor: { tabSize: 4 } },
      save: () => true
    }
  };
  const surface = createFrozenSurface("/test/root", "test", adapters.window, adapters.workspace);
  surface.commands.registerCommand("frozen.test", () => "frozen-ok");
  const cmdResult = await surface.commands.executeCommand<string>("frozen.test");
  assert.equal(cmdResult, "frozen-ok");
  assert.equal(await surface.window.showInformationMessage("prompt", "first", "second"), "second");
  assert.equal(surface.workspace.rootPath, "/test/root");
  assert.equal(surface.workspace.name, "test");
  assert.equal(surface.workspace.getConfigurationSection("editor")?.tabSize, 4);
  const discovered = await surface.workspace.findFiles("*.txt");
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0]?.name, "surface.txt");
  const opened = await surface.workspace.openTextDocument("file:///surface.txt");
  assert.equal(opened.text(), "conteúdo frozen");
  assert.equal(await surface.workspace.saveTextDocument(opened.uri), true);

  await assertLaunchError(
    () => surface.commands.executeCommand<string>("comando.nao-existe"),
    "não encontrado",
    PROTOCOL_ERROR_CODES.INVALID_STATE
  );

  const statusBar = surface.window.createStatusBarItem("frozen-status", "right");
  assert.equal(statusBar.id, "frozen-status");
  statusBar.text = "Loaded";
  const bars = surface.window.getStatusBarItems();
  assert.equal(bars.length, 1);
  const firstBar = bars[0];
  assert.ok(firstBar);
  assert.equal(firstBar.text, "Loaded");
});

test("[LOC-01] frozen-surface: output channel preserva nome", () => {
  const surface = createFrozenSurface();
  assert.equal(surface.output.createOutputChannel("task-159-output").name, "task-159-output");
});

test("[LOC-01] frozen-surface: workspace rootPath + name acessíveis na superfície", () => {
  const surface = createFrozenSurface("/root/do/workspace", "my-ws");
  const ws = surface.workspace as typeof surface.workspace & Record<string, unknown>;
  assert.strictEqual(ws.rootPath, "/root/do/workspace");
  assert.strictEqual(ws.name, "my-ws");
});
