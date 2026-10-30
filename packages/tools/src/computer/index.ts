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
