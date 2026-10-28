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
