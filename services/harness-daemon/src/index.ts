export {
  isTerminalRunLifecycleState,
  type RunLifecycleState,
} from "./state/run-state.js";
export {
  RunStateMachine,
  type RunStateMachineSnapshot,
} from "./state/run-state-machine.js";
export { assertMayDispatchToolForLifecycle } from "./state/terminal-run-tool-guard.js";

export {
  RunMessageQueue,
  type RunQueueItem,
  type RunQueueItemState,
} from "./queue/run-message-queue.js";

export {
  resolveHarnessDataRoot,
  resolveHarnessRuntimeDirectory,
  resolveHarnessDaemonAddress,
  resolveHarnessUserLockPath,
  resolveHarnessWorkspaceBindingsPath,
} from "./runtime-paths.js";

export {
  acquireUserDaemonLock,
  isUserDaemonLockHeld,
  isHarnessDaemonProcessAlive,
  readUserDaemonLockPath,
  readUserDaemonLockRecord,
  removeUserDaemonLockFile,
  type UserDaemonLock,
  type UserDaemonLockRecord,
} from "./user-lock.js";

export {
  inspectHarnessDaemonOrphanState,
  isHarnessDaemonTransportReady,
  reconcileOrphanHarnessDaemon,
  type HarnessDaemonOrphanState,
} from "./daemon-health.js";

export {
  shutdownHarnessDaemonSupervised,
  type ShutdownHarnessDaemonSupervisedOptions,
} from "./supervised-shutdown.js";

export {
  startHarnessDaemonServer,
  type HarnessDaemonServer,
  type StartHarnessDaemonServerOptions,
} from "./daemon-server.js";

export {
  startHarnessDaemon,
  type HarnessDaemonRuntime,
  type StartHarnessDaemonOptions,
} from "./lifecycle.js";

export { ensureHarnessDaemonReady, type EnsureHarnessDaemonOptions } from "./on-demand.js";

export { WorkspaceStateRegistry, type WorkspaceBindingState } from "./workspace-state.js";

export { readPeerCredentialFromSocket } from "./peer-credential.js";

export {
  WorkspaceCustomizationHooks,
  createWorkspaceCustomizationHooks,
} from "./customization/local-hook-engine.js";
