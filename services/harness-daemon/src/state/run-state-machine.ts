import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  refuseToolInTerminalRunError,
  type TerminalRunState,
} from "@openagent/protocol";
import {
  isTerminalRunLifecycleState,
  type RunLifecycleState,
} from "./run-state.js";

function invalidRunTransitionError(
  message: string,
  from: RunLifecycleState,
): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [], {
    runState: isTerminalRunLifecycleState(from) ? from : undefined,
  });
}

export type RunStateMachineSnapshot = {
  lifecycleState: RunLifecycleState;
  awaitingNewUserMessage: boolean;
};

/**
 * Máquina de estados de uma execução (Run) no daemon.
 * Transições inválidas retornam INVALID_STATE sem alterar o snapshot.
 */
export class RunStateMachine {
  private lifecycleState: RunLifecycleState;
  private awaitingNewUserMessage: boolean;

  constructor(initial: RunLifecycleState = "idle") {
    this.lifecycleState = initial;
    this.awaitingNewUserMessage = isTerminalRunLifecycleState(initial);
  }

  snapshot(): RunStateMachineSnapshot {
    return {
      lifecycleState: this.lifecycleState,
      awaitingNewUserMessage: this.awaitingNewUserMessage,
    };
  }

  start(): void {
    const from = this.lifecycleState;
    if (from === "running") {
      throw invalidRunTransitionError("Execução já está em andamento.", from);
    }
    if (isTerminalRunLifecycleState(from) && this.awaitingNewUserMessage) {
      throw invalidRunTransitionError(
        "Execução terminal: inicie uma nova execução somente após uma mensagem nova do usuário.",
        from,
      );
    }
    if (from !== "idle") {
      throw invalidRunTransitionError(
        `Transição start inválida a partir de ${from}.`,
        from,
      );
    }
    this.lifecycleState = "running";
    this.awaitingNewUserMessage = false;
  }

  complete(): void {
    this.transitionFromRunning("completed", "complete");
  }

  cancel(): void {
    this.transitionFromRunning("cancelled", "cancel");
  }

  onNewUserMessage(): void {
    const from = this.lifecycleState;
    if (!isTerminalRunLifecycleState(from)) {
      throw invalidRunTransitionError(
        "Mensagem nova só reaplica após execução concluída ou cancelada.",
        from,
      );
    }
    this.lifecycleState = "idle";
    this.awaitingNewUserMessage = false;
  }

  assertMayDispatchTool(): void {
    if (this.lifecycleState !== "running") {
      if (isTerminalRunLifecycleState(this.lifecycleState)) {
        throw refuseToolInTerminalRunError(
          this.lifecycleState satisfies TerminalRunState,
        );
      }
      throw invalidRunTransitionError(
        "Ferramenta só pode ser despachada com execução em andamento.",
        this.lifecycleState,
      );
    }
  }

  private transitionFromRunning(
    target: "completed" | "cancelled",
    action: string,
  ): void {
    const from = this.lifecycleState;
    if (from !== "running") {
      throw invalidRunTransitionError(
        `Transição ${action} inválida a partir de ${from}.`,
        from,
      );
    }
    this.lifecycleState = target;
    this.awaitingNewUserMessage = true;
  }
}
