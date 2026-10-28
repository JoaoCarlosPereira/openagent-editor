import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

import {
  cancelledError,
  ProtocolError,
  PROTOCOL_ERROR_CODES,
  refuseToolInTerminalRunError,
} from "@openagent/protocol";

import type { WorkerInvokeRequest, WorkerInvokeResponse } from "./types.js";

const WORKER_ENTRY = fileURLToPath(new URL("./worker-entry.mjs", import.meta.url));

export interface IsolatedWorkerThreadHostOptions {
  /** Reservado para loaders futuros; worker usa entry .mjs nativo. */
  execArgv?: string[];
}

/**
 * Host que despacha invocações tipadas para um worker thread isolado.
 */
export class IsolatedWorkerThreadHost {
  private readonly worker: Worker;
  private terminated = false;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private nextRequestId = 0;

  private constructor(worker: Worker) {
    this.worker = worker;
    worker.on("message", (message: WorkerInvokeResponse) => {
      const entry = this.pending.get(message.requestId);
      if (!entry) {
        return;
      }
      this.pending.delete(message.requestId);
      if (message.kind === "result") {
        entry.resolve(message.output);
        return;
      }
      entry.reject(
        new ProtocolError(message.code, message.message),
      );
    });
    worker.on("error", (error) => {
      for (const [, entry] of this.pending) {
        entry.reject(error);
      }
      this.pending.clear();
    });
  }

  static async spawn(
    toolNames: readonly string[],
    options: IsolatedWorkerThreadHostOptions = {},
  ): Promise<IsolatedWorkerThreadHost> {
    const worker = new Worker(WORKER_ENTRY, {
      execArgv: options.execArgv,
    });
    const host = new IsolatedWorkerThreadHost(worker);
    await host.bootstrap([...toolNames]);
    return host;
  }

  private bootstrap(tools: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const onMessage = (message: WorkerInvokeResponse) => {
        if (message.requestId !== "bootstrap") {
          return;
        }
        this.worker.off("message", onMessage);
        if (message.kind === "error") {
          reject(new ProtocolError(message.code, message.message));
          return;
        }
        resolve();
      };
      this.worker.on("message", onMessage);
      try {
        this.worker.postMessage({ kind: "bootstrap", tools });
      } catch (error) {
        reject(error);
      }
    });
  }

  async invoke(tool: string, input: unknown): Promise<unknown> {
    if (this.terminated) {
      throw refuseToolInTerminalRunError("cancelled");
    }
    const requestId = `req-${this.nextRequestId++}`;
    const request: WorkerInvokeRequest = {
      kind: "invoke",
      requestId,
      tool,
      input,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        this.worker.postMessage(request);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  get isTerminated(): boolean {
    return this.terminated;
  }

  async terminate(): Promise<void> {
    if (this.terminated) {
      return;
    }
    this.terminated = true;
    for (const [, entry] of this.pending) {
      entry.reject(cancelledError());
    }
    this.pending.clear();
    await this.worker.terminate();
  }
}

export async function dispatchInIsolatedWorker(
  tool: string,
  input: unknown,
  registeredTools: readonly string[],
): Promise<unknown> {
  if (!registeredTools.includes(tool)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Ferramenta não registrada para dispatch isolado: ${tool}`,
    );
  }
  const host = await IsolatedWorkerThreadHost.spawn(registeredTools);
  try {
    return await host.invoke(tool, input);
  } finally {
    await host.terminate();
  }
}
