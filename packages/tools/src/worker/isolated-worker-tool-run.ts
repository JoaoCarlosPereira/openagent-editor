import {
  createTypedToolDispatchRegistry,
  TypedToolDispatchRegistry,
} from "./dispatch-registry.js";
import { IsolatedWorkerThreadHost } from "./isolated-worker-thread.js";
import {
  ToolRunCoordinator,
  type ToolRunCoordinatorOptions,
  type ToolRunSnapshot,
} from "./tool-run-coordinator.js";
import type { InferToolInput, InferToolOutput } from "./types.js";

const DEFAULT_WORKER_TOOLS = ["echo", "slowEcho"] as const;

type WorkerToolName = (typeof DEFAULT_WORKER_TOOLS)[number];

type WorkerToolHandlers = {
  [K in WorkerToolName]: (input: unknown) => Promise<unknown>;
};

function createWorkerBackedRegistry(
  host: IsolatedWorkerThreadHost,
  toolNames: readonly string[],
): TypedToolDispatchRegistry<WorkerToolHandlers> {
  const handlers = {} as WorkerToolHandlers;
  for (const tool of toolNames) {
    const name = tool as WorkerToolName;
    handlers[name] = (input) => host.invoke(name, input);
  }
  return createTypedToolDispatchRegistry(handlers);
}

export interface IsolatedWorkerToolRunOptions
  extends Omit<ToolRunCoordinatorOptions, "onCancel"> {
  toolNames?: readonly string[];
}

/**
 * Execução PER-02 com dispatch tipado em worker thread isolado;
 * cancelamento encerra o worker e bloqueia novos dispatches.
 */
export class IsolatedWorkerToolRun {
  private readonly host: IsolatedWorkerThreadHost;
  private readonly coordinator: ToolRunCoordinator<WorkerToolHandlers>;

  private constructor(
    host: IsolatedWorkerThreadHost,
    coordinator: ToolRunCoordinator<WorkerToolHandlers>,
  ) {
    this.host = host;
    this.coordinator = coordinator;
  }

  static async spawn(
    options: IsolatedWorkerToolRunOptions = {},
  ): Promise<IsolatedWorkerToolRun> {
    const toolNames = options.toolNames ?? DEFAULT_WORKER_TOOLS;
    const host = await IsolatedWorkerThreadHost.spawn([...toolNames]);
    const coordinator = new ToolRunCoordinator(
      createWorkerBackedRegistry(host, toolNames),
      {
        ...options,
        onCancel: async () => {
          await host.terminate();
        },
      },
    );
    return new IsolatedWorkerToolRun(host, coordinator);
  }

  get workerHost(): IsolatedWorkerThreadHost {
    return this.host;
  }

  snapshot(): ToolRunSnapshot {
    return this.coordinator.snapshot();
  }

  async cancel(): Promise<ToolRunSnapshot> {
    return this.coordinator.cancel();
  }

  async dispatch<K extends WorkerToolName>(
    tool: K,
    input: InferToolInput<WorkerToolHandlers, K>,
    invocationId: string,
  ): Promise<InferToolOutput<WorkerToolHandlers, K>> {
    return this.coordinator.dispatch(tool, input, invocationId);
  }

  assertMayDispatch(): void {
    this.coordinator.assertMayDispatch();
  }
}
