/**
 * Fundação de computer use para AUT-02.
 */
export type ComputerActionType =
  | "mouse_move"
  | "mouse_click"
  | "mouse_down"
  | "mouse_up"
  | "key_press"
  | "key_down"
  | "key_up"
  | "screenshot";

export interface ComputerActionInput {
  action: ComputerActionType;
  coordinate?: { x: number; y: number };
  button?: "left" | "right" | "middle";
  text?: string;
  key?: string;
}

export interface ComputerActionResult {
  action: ComputerActionType;
  executed: boolean;
  screenshot?: string;
  timestamp: number;
}

/**
 * AUT-02: adaptador policy/execução do computer use.
 * Uma ação por vez, nomeada na permissão e com resultado visível.
 */
export {
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
  type ComputerUseCapability,
  type PolicyComputerActionResult,
  type PolicyComputerToolContext,
  type PreparePolicyComputerActionInput,
} from "./policy-computer-tools.js";
export { COMPUTER_SCREENSHOT_MOCK_BASE64 } from "./policy-computer-tools.js";

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
} from "./linux-computer-adapter.js";

export {
  describeMacosComputerCapability,
  MACOS_CHROME_EXECUTABLE_CANDIDATES,
  MACOS_PERMISSIONS_NOTICE,
  MACOS_REQUIRED_COMPUTER_PERMISSIONS,
  MacosComputerUseAdapter,
  prepareMacosComputerAction,
  probeMacosComputerCapability,
  type MacosChromeExecutableProbe,
  type MacosComputerCapabilityResult,
  type MacosComputerCapabilitySnapshot,
  type MacosComputerLaunchWorker,
  type MacosComputerPermission,
  type MacosComputerProbeOptions,
  type MacosComputerTargetLaunch,
  type MacosComputerUseAdapterOptions,
  type MacosComputerWorkerProcess,
  type PrepareMacosComputerActionOptions,
  type PreparedMacosComputerAction,
} from "./mac-computer-adapter.js";

export {
  describeWindowsComputerCapability,
  WINDOWS_CHROME_EXECUTABLE_CANDIDATES,
  WINDOWS_COMPUTER_PIPE,
  WindowsComputerUseAdapter,
  prepareWindowsComputerAction,
  probeWindowsComputerCapability,
  resolveWindowsChromeAppType,
  type PrepareWindowsComputerActionOptions,
  type PreparedWindowsComputerAction,
  type WindowsChromeAppType,
  type WindowsChromeExecutableProbe,
  type WindowsComputerCapabilityResult,
  type WindowsComputerCapabilitySnapshot,
  type WindowsComputerLaunchWorker,
  type WindowsComputerProbeOptions,
  type WindowsComputerTargetLaunch,
  type WindowsComputerUseAdapterOptions,
  type WindowsComputerWorkerProcess,
} from "./win-computer-adapter.js";
