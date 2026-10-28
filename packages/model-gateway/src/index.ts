export type {
  CliProxySidecarArch,
  CliProxySidecarArtifact,
  CliProxySidecarOs,
  CliProxySidecarPinManifest,
  CliProxySidecarSbom,
  LoadedCliProxySidecarPin,
} from "./types.js";
export { resolveCliProxySidecarPackagingDirectory } from "./paths.js";
export { loadPinnedCliProxyApiSidecar } from "./load-pinned-cliproxyapi-sidecar.js";
export { resolveCliProxyArtifactForPlatform } from "./resolve-cliproxy-artifact.js";
export { verifyCliProxyArchiveChecksum } from "./verify-cliproxy-archive-checksum.js";
export {
  registerCliProxyProviderProfile,
  type RegisterCliProxyProviderInput,
} from "./register-cliproxy-provider.js";
export {
  catalogCliProxyProviderCapabilities,
  resolveCliProxyOpenAiBaseUrl,
  type CliProxyProviderCapabilitiesCatalog,
  type CliProxyProviderConnectionInput,
} from "./cliproxy-provider-connection-catalog.js";
export {
  registerSupervisedCliProxyProviderProfile,
  type RegisterSupervisedCliProxyProviderInput,
  type RegisterSupervisedCliProxyProviderResult,
} from "./register-supervised-cliproxy-provider.js";
export { allocateLoopbackPort, buildLoopbackOpenAiBaseUrl } from "./cliproxy-ephemeral-bind.js";
export {
  generateCliProxySidecarRuntimeSecrets,
  renderCliProxySidecarConfigV8,
  writeCliProxySidecarConfigFile,
  type CliProxySidecarRuntimeSecrets,
} from "./cliproxy-sidecar-config.js";
export {
  checkCliProxySidecarHealth,
  type CliProxySidecarHealthInput,
} from "./cliproxy-sidecar-health.js";
export {
  startCliProxySidecarSupervised,
  shutdownCliProxySidecarSupervised,
  type CliProxySidecarSupervisorHandle,
  type CliProxySidecarLaunchContext,
  type SidecarProcessSpawnInput,
  type StartCliProxySidecarSupervisorOptions,
} from "./cliproxy-sidecar-supervisor.js";
export {
  inferCliProxyProviderFailureReason,
  mapCliProxyChatCompletionHttpFailure,
  mapCliProxyFetchNetworkError,
  mapCliProxyFetchTimeoutError,
  mapCliProxyInlineStreamErrorObject,
  mapCliProxyOpenAiHttpFailure,
  parseOpenAiCompatibleErrorBody,
  providerFailurePreservationHints,
} from "./cliproxy-provider-errors.js";
export { probeCliProxyOpenAiCompatibleProvider } from "./cliproxy-provider-probe.js";
export {
  CLI_PROXY_STREAM_HARNESS_EVENT_TYPES,
  CliProxyStreamHarnessNormalizer,
  assertCliProxyStreamHarnessNormalizerInput,
  consumeOpenAiSseResponse,
  parseOpenAiStreamErrorObject,
  toHarnessEventFromNormalization,
  type CliProxyStreamHarnessNormalization,
  type CliProxyStreamHarnessNormalizerInput,
} from "./cliproxy-stream-harness-normalizer.js";
