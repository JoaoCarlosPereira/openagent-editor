import type { ProtocolErrorCode } from "@openagent/protocol";

export type ToolHandler<Input, Output> = (input: Input) => Promise<Output> | Output;

export type ToolHandlerMap = Record<string, ToolHandler<unknown, unknown>>;

export type InferToolInput<T extends ToolHandlerMap, K extends keyof T> =
  T[K] extends ToolHandler<infer I, unknown> ? I : never;

export type InferToolOutput<T extends ToolHandlerMap, K extends keyof T> =
  T[K] extends ToolHandler<unknown, infer O> ? O : never;

export type ToolExecutionPhase = "running" | "cancelled";

export interface AppliedToolRecord<TOutput = unknown> {
  tool: string;
  invocationId: string;
  output: TOutput;
  appliedAt: number;
}

export interface WorkerInvokeRequest {
  kind: "invoke";
  requestId: string;
  tool: string;
  input: unknown;
}

export interface WorkerInvokeSuccess {
  kind: "result";
  requestId: string;
  output: unknown;
}

export interface WorkerInvokeFailure {
  kind: "error";
  requestId: string;
  code: ProtocolErrorCode;
  message: string;
}

export type WorkerInvokeResponse = WorkerInvokeSuccess | WorkerInvokeFailure;

export interface WorkerBootstrapMessage {
  kind: "bootstrap";
  tools: string[];
}
