/* global document, window */
const folder = document.querySelector("#folder");
const save = document.querySelector("#save");
const workspace = document.querySelector("#workspace");
const files = document.querySelector("#files");
const filename = document.querySelector("#filename");
const content = document.querySelector("#content");
const error = document.querySelector("#error");
let queue = Promise.resolve();
let closing = false;
let editFailed = false;
let editGeneration = 0;
let switching = false;
let documentIdentity = null;

function render(state, preserveContent = false) {
  workspace.textContent = state.folder ?? "Nenhuma pasta aberta";
  files.replaceChildren();
  for (const entry of state.entries) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.textContent = `${entry.kind === "directory" ? "▸ " : ""}${entry.relativePath}`;
    button.addEventListener("click", () => entry.kind === "directory"
      ? perform(() => window.editor.expand(entry.relativePath))
      : switchDocument(() => window.editor.open(entry.relativePath)));
    item.append(button);
    files.append(item);
  }
  const doc = state.document;
  documentIdentity = doc ? { folder: state.folder, path: doc.relativePath, version: state.documentVersion } : null;
  filename.textContent = doc ? `${doc.relativePath}${doc.dirty ? " *" : ""}` : "Abra um arquivo para editar";
  content.disabled = !doc;
  save.disabled = !doc;
  if (!preserveContent) content.value = doc?.content ?? "";
}

function perform(action, preserveContent = false, isEdit = false) {
  if (closing) return;
  const generation = editGeneration;
  queue = queue.then(async () => {
    try {
      if (editFailed && !isEdit) throw new Error("A edição não foi sincronizada; edite novamente antes de continuar.");
      const state = await action();
      if (isEdit) editFailed = false;
      render(state, preserveContent || generation !== editGeneration);
      error.textContent = "";
    } catch (cause) {
      if (isEdit) editFailed = true;
      error.textContent = cause instanceof Error ? cause.message : "Erro no editor.";
    }
  });
  return queue;
}

function switchDocument(action) {
  if (closing || switching) return;
  switching = true;
  content.readOnly = true;
  folder.disabled = true;
  files.inert = true;
  const operation = perform(action);
  operation.finally(() => {
    switching = false;
    if (!closing) {
      content.readOnly = false;
      folder.disabled = false;
      files.inert = false;
    }
  });
}

window.editor.onCloseRequest(async () => {
  if (closing) return;
  closing = true;
  content.readOnly = true;
  folder.disabled = true;
  save.disabled = true;
  files.inert = true;
  await queue;
  window.editor.closeReady(!editFailed);
});

window.editor.onCloseCancelled(() => {
  closing = false;
  content.readOnly = switching;
  folder.disabled = switching;
  save.disabled = content.disabled;
  files.inert = switching;
});

folder.addEventListener("click", () => switchDocument(() => window.editor.folder()));
save.addEventListener("click", () => perform(() => window.editor.save()));
content.addEventListener("input", () => {
  if (switching || closing || !documentIdentity) return;
  const value = content.value;
  const identity = documentIdentity;
  editGeneration++;
  perform(() => window.editor.edit({ ...identity, content: value }), true, true);
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (!save.disabled) perform(() => window.editor.save());
  }
});
perform(() => window.editor.state());
