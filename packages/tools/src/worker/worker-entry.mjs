import { parentPort } from "node:worker_threads";

/** @typedef {{ kind: 'invoke', requestId: string, tool: string, input: unknown }} WorkerInvokeRequest */
/** @typedef {{ kind: 'bootstrap', tools: string[] }} WorkerBootstrapMessage */

/** @type {Map<string, (input: unknown) => Promise<unknown> | unknown>} */
const handlers = new Map();

function registerBuiltinWorkerTools() {
  handlers.set("echo", (input) => input);
  handlers.set("slowEcho", async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return input;
  });
}

registerBuiltinWorkerTools();

/** @param {import('./types.js').WorkerInvokeResponse} message */
function post(message) {
  parentPort?.postMessage(message);
}

parentPort?.on("message", async (message) => {
  if (message.kind === "bootstrap") {
    for (const tool of message.tools) {
      if (!handlers.has(tool)) {
        post({
          kind: "error",
          requestId: "bootstrap",
          code: "INVALID_STATE",
          message: `Ferramenta não registrada no worker: ${tool}`,
        });
        return;
      }
    }
    post({ kind: "result", requestId: "bootstrap", output: { ready: true } });
    return;
  }

  if (message.kind !== "invoke") {
    return;
  }

  const handler = handlers.get(message.tool);
  if (!handler) {
    post({
      kind: "error",
      requestId: message.requestId,
      code: "INVALID_STATE",
      message: `Ferramenta desconhecida no worker: ${message.tool}`,
    });
    return;
  }

  try {
    const output = await handler(message.input);
    post({ kind: "result", requestId: message.requestId, output });
  } catch (error) {
    post({
      kind: "error",
      requestId: message.requestId,
      code: "INVALID_STATE",
      message: error instanceof Error ? error.message : "Falha no worker.",
    });
  }
});
