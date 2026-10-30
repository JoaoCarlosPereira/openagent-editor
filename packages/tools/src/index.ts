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

export {
  discoverMcpStdioTools,
  type DiscoverMcpStdioToolsOptions,
  type DiscoveredMcpStdioTool,
  type McpStdioToolDiscoveryResult,
} from "./mcp/discover-mcp-stdio-tools.js";

export {
  parseMcpStdioServerLaunch,
  type McpStdioServerLaunch,
} from "./mcp/mcp-stdio-config.js";

export {
  discoverMcpHttpTools,
  type DiscoverMcpHttpToolsOptions,
  type DiscoveredMcpHttpTool,
  type McpHttpToolDiscoveryResult,
} from "./mcp/discover-mcp-http-tools.js";

export {
  parseMcpHttpServerEndpoint,
  type McpHttpServerEndpoint,
} from "./mcp/mcp-http-config.js";

export {
  assertMcpAuthSecretRef,
  mcpAuthMaterialToHttpHeaders,
  resolveMcpHttpHeaders,
  resolveMcpStdioEnv,
  type McpAuthMaterial,
  type McpAuthSecretResolver,
} from "./mcp/mcp-auth-material.js";

export {
  assertLocalHooksAllowMcpToolInvoke,
  type McpToolHookGateInput,
} from "./mcp/local-hook-gate.js";

export {
  createNodeCustomizationRuleFileReader,
  loadCustomizationRulesFromPaths,
  type CustomizationRuleFileReader,
  type LoadCustomizationRulesFromPathsInput,
} from "./mcp/load-customization-rules.js";

export {
  loadLocalCustomizationAssetsFromPaths,
  type LoadLocalCustomizationAssetsInput,
} from "./mcp/load-local-customization-assets.js";

export {
  COMPUTER_SCREENSHOT_MOCK_BASE64,
  COMPUTER_USE_CAPABILITY,
  ComputerUseSession,
  computerActionCdpCalls,
  computerActionName,
  executePolicyComputerAction,
  formatAgentComputerToolResult,
  formatComputerActionLabel,
  preparePolicyComputerAction,
  validateComputerAction,
  type AgentComputerToolInvocationResult,
  type ComputerActionAuthorization,
  type ComputerActionInput,
  type ComputerActionResult,
  type ComputerActionType,
  type ComputerUseCapability,
  type PolicyComputerActionResult,
  type PolicyComputerToolContext,
  type PreparePolicyComputerActionInput,
} from "./computer/index.js";

export {
  buildLinuxComputerTargetArgs,
  classifyLinuxDisplayMode,
  describeLinuxComputerCapability,
  DEFAULT_CHROME_EXECUTABLE_CANDIDATES,
  LinuxComputerUseAdapter,
  prepareLinuxComputerAction,
  probeLinuxComputerDisplay,
  readLinuxDisplayEnvironment,
  type LinuxChromiumExecutableProbe,
  type LinuxComputerCapabilityResult,
  type LinuxComputerCapabilitySnapshot,
  type LinuxComputerLaunchWorker,
  type LinuxComputerProbeOptions,
  type LinuxComputerTargetLaunch,
  type LinuxComputerUseAdapterOptions,
  type LinuxComputerWorkerProcess,
  type LinuxDisplayEnvironment,
  type LinuxDisplayMode,
  type PrepareLinuxComputerActionOptions,
  type PreparedLinuxComputerAction,
} from "./computer/linux-computer-adapter.js";

export {
  validateBrowserUrl,
  CdpTargetManager,
  InMemoryCdpTransport,
  TimedCdpTransport,
  WebSocketCdpTransport,
  MOCK_SCREENSHOT_BASE64,
  executePolicyBrowserOpen,
  formatAgentBrowserToolResult,
  preparePolicyBrowserOpen,
  AuthorizedBrowserSession,
  launchBrowserWorker,
  type AgentBrowserToolInvocationResult,
  type BrowserCdpToolResult,
  type BrowserConsoleLogEntry,
  type BrowserInteraction,
  type BrowserSessionEvidence,
  type BrowserTargetInfo,
  type BrowserTargetSession,
  type BrowserUrlPolicyOptions,
  type BrowserWorkerProcess,
  type CdpEvent,
  type CdpTransport,
  type LaunchBrowserWorkerOptions,
  type OpenAuthorizedBrowserUrlInput,
  type PolicyBrowserToolContext,
  type PreparePolicyBrowserOpenInput,
} from "./browser/index.js";
