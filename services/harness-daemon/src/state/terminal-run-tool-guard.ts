import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  refuseToolInTerminalRunError,
} from "@openagent/protocol";
import {
  isTerminalRunLifecycleState,
  type RunLifecycleState,
} from "./run-state.js";

function toolDispatchInvalidStateError(
  message: string,
  lifecycleState: RunLifecycleState,
): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [], {
    runState: isTerminalRunLifecycleState(lifecycleState)
      ? lifecycleState
      : undefined,
  });
}

/**
 * STA-01 (task_42): recusa ferramenta nova enquanto a execução estiver concluída
 * ou cancelada; só permite despacho com execução em andamento (`running`).
 */
export function assertMayDispatchToolForLifecycle(
  lifecycleState: RunLifecycleState,
): void {
  if (lifecycleState === "running") {
    return;
  }
  if (isTerminalRunLifecycleState(lifecycleState)) {
    throw refuseToolInTerminalRunError(lifecycleState);
  }
  throw toolDispatchInvalidStateError(
    "Ferramenta só pode ser despachada com execução em andamento.",
    lifecycleState,
  );
}
