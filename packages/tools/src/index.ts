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
  executePolicyFileWrite,
  preparePolicyFileRead,
  preparePolicyFileSearch,
  preparePolicyFileWrite,
  snapshotPolicyFileWriteBase,
  type PolicyFileToolContext,
  type PreparePolicyFileReadInput,
  type PreparePolicyFileSearchInput,
  type PreparePolicyFileWriteInput,
} from "./files/policy-file-tools.js";

export {
  executeAgentFileWriteBatch,
  summarizeAgentFileWriteBatch,
  type AgentFileWriteBatchResult,
  type AgentFileWriteOperation,
} from "./files/agent-file-write-batch.js";

export {
  applyWorkspaceFileWrite,
  fileWriteConflictProtocolError,
  snapshotWorkspaceFileForWrite,
  FILE_WRITE_CONFLICT_MESSAGE,
  type FileWriteAppliedResult,
  type FileWriteConflictResult,
  type WriteWorkspaceFileResult,
  type WorkspaceFileSnapshot,
} from "./files/write-workspace-file.js";

export { sha256HexUtf8, isSha256Hex } from "./files/file-content-hash.js";

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
  execWorkspaceCommand,
  type ExecWorkspaceCommandResult,
} from "./shell/exec-workspace-command.js";

export {
  executePolicyShellExec,
  formatAgentShellToolResult,
  preparePolicyShellExec,
  type AgentShellToolInvocationResult,
  type PolicyShellToolContext,
  type PreparePolicyShellExecInput,
} from "./shell/policy-shell-tools.js";

export {
  buildCheckpointHashesFromAgentWriteBatch,
  type CheckpointWriteBatchHashes,
} from "./git/checkpoint-from-write-batch.js";

export {
  buildCheckpointPatchFromFileChanges,
  parseCheckpointPatchText,
  type CheckpointPatchFileChange,
  type ParsedCheckpointPatchEntry,
} from "./git/checkpoint-patch.js";

export {
  restoreCheckpointOnWorkspace,
  type CheckpointRestoreConflictEntry,
  type CheckpointRestoreInput,
  type CheckpointRestoreResult,
} from "./git/checkpoint-restore.js";

export {
  createIsolatedGitWork,
  removeIsolatedGitWork,
  collectWorkspaceFileContents,
  type CreateIsolatedGitWorkInput,
  type CreateIsolatedGitWorkResult,
} from "./git/isolated-worktree.js";

export {
  applyIsolatedGitWork,
  discardIsolatedGitWork,
  finalizeIsolatedGitWork,
  type ApplyIsolatedGitWorkResult,
  type FinalizeIsolatedGitWorkResult,
  type IsolatedWorkApplyConflictEntry,
  type IsolatedWorkDecision,
} from "./git/isolated-work-resolve.js";

export {
  executePolicyGitDiffInWorker,
  executePolicyGitStatusInWorker,
  formatAgentGitDiffToolResult,
  formatAgentGitStatusToolResult,
  GIT_WORKER_TOOL_NAMES,
  preparePolicyGitDiff,
  preparePolicyGitStatus,
  type AgentGitDiffToolInvocationResult,
  type AgentGitStatusToolInvocationResult,
  type GitCliCaptureResult,
  type GitDiffWorkerResult,
  type GitWorkerToolName,
  type PolicyGitToolContext,
  type PreparePolicyGitDiffInput,
  type PreparePolicyGitStatusInput,
} from "./git/policy-git-tools.js";

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
  buildToolResultEventPayload,
  persistToolInvocationResult,
  TOOL_RESULT_EVENT,
  type PersistToolInvocationInput,
  type PersistToolInvocationResult,
  type ToolInvocationRecord,
  type ToolInvocationRecordWriter,
  type ToolInvocationResultPayload,
} from "./worker/tool-invocation-record.js";

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
