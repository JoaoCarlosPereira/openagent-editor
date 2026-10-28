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
  prepareSandboxToolDispatch,
  sandboxDegradationNoticeForPermission,
  type SandboxToolDispatchInput,
  type SandboxToolDispatchPrepareResult,
} from "./sandbox/tool-sandbox-dispatch.js";

export {
  executePolicyFileRead,
  executePolicyFileSearch,
  preparePolicyFileRead,
  preparePolicyFileSearch,
  type PolicyFileToolContext,
  type PreparePolicyFileReadInput,
  type PreparePolicyFileSearchInput,
} from "./files/policy-file-tools.js";

export {
  readWorkspaceFile,
  type ReadWorkspaceFileResult,
} from "./files/read-workspace-file.js";

export {
  searchWorkspaceFiles,
  type SearchWorkspaceFilesResult,
  type WorkspaceSearchHit,
} from "./files/search-workspace-files.js";

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
