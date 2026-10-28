export {
  describeSandboxCapability,
  type DescribeSandboxCapabilityOptions,
  type SandboxCapabilitySnapshot,
  type SandboxIsolationLevel,
} from "./sandbox/sandbox-capability.js";

export {
  probeLinuxSandbox,
  probeUnshareUserNamespaceAvailability,
  type LinuxSandboxProbe,
  type LinuxSandboxProbeResult,
  type LinuxNativeSandboxPrimitive,
} from "./sandbox/linux-sandbox-probe.js";

export {
  probeMacosSandbox,
  probeSeatbeltOperational,
  type MacosSandboxProbe,
  type MacosSandboxProbeResult,
  type MacNativeSandboxPrimitive,
} from "./sandbox/macos-sandbox-probe.js";

export {
  probeWindowsSandbox,
  probeAppContainerOperational,
  probeAppContainerVersionSupport,
  probeJobObjectAvailability,
  type WindowsSandboxProbe,
  type WindowsSandboxProbeResult,
  type WindowsNativeSandboxPrimitive,
} from "./sandbox/windows-sandbox-probe.js";

export {
  prepareSandboxToolDispatch,
  sandboxDegradationNoticeForPermission,
  type SandboxToolDispatchInput,
  type SandboxToolDispatchPrepareResult,
} from "./sandbox/tool-sandbox-dispatch.js";

export {
  createTypedToolDispatchRegistry,
  TypedToolDispatchRegistry,
} from "./worker/dispatch-registry.js";

export {
  invalidToolInputError,
  ToolRunCoordinator,
  type ToolRunCoordinatorOptions,
  type ToolRunSnapshot,
} from "./worker/tool-run-coordinator.js";

export {
  dispatchInIsolatedWorker,
  IsolatedWorkerThreadHost,
} from "./worker/isolated-worker-thread.js";

export {
  IsolatedWorkerToolRun,
  type IsolatedWorkerToolRunOptions,
} from "./worker/isolated-worker-tool-run.js";

export type {
  AppliedToolRecord,
  InferToolInput,
  InferToolOutput,
  ToolExecutionPhase,
  ToolHandler,
  ToolHandlerMap,
} from "./worker/types.js";
