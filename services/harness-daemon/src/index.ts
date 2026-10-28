export {
  resolveHarnessDataRoot,
  resolveHarnessRuntimeDirectory,
  resolveHarnessDaemonAddress,
  resolveHarnessUserLockPath,
} from "./runtime-paths.js";

export {
  acquireUserDaemonLock,
  isUserDaemonLockHeld,
  readUserDaemonLockPath,
  type UserDaemonLock,
  type UserDaemonLockRecord,
} from "./user-lock.js";

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
