/** Estados de execução (Run) no daemon — alinhado ao campo `run.state` persistido. */
export type RunLifecycleState = "idle" | "running" | "completed" | "cancelled";

export function isTerminalRunLifecycleState(
  state: RunLifecycleState,
): state is "completed" | "cancelled" {
  return state === "completed" || state === "cancelled";
}
