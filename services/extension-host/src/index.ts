export {
  IsolatedExtensionHost,
  type ExtensionHostEventListener,
  type IsolatedExtensionHostOptions,
  type VsixInstallResult,
} from "./host.js";

export {
  computeCrc32,
  createVsixArchive,
  installVsixPackage,
  parseVsixArchive,
  type InstalledVsixResult,
} from "./vsix-installer.js";

export type {
  ExtensionHostConfig,
  ExtensionLifecycleState,
  ExtensionRegistration,
  ExtensionWorkerRequest,
  ExtensionWorkerResponse,
} from "./types.js";
