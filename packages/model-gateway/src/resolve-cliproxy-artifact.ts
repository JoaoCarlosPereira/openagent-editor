import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import type {
  CliProxySidecarArtifact,
  CliProxySidecarArch,
  CliProxySidecarOs,
  CliProxySidecarPinManifest,
} from "./types.js";

export function resolveCliProxyArtifactForPlatform(
  manifest: CliProxySidecarPinManifest,
  platform: { os: CliProxySidecarOs; arch: CliProxySidecarArch },
): CliProxySidecarArtifact {
  const artifact = manifest.artifacts.find(
    (entry) => entry.os === platform.os && entry.arch === platform.arch,
  );
  if (!artifact) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Plataforma não suportada pelo pin do CLIProxyAPI.",
      [`${platform.os}/${platform.arch}`],
    );
  }
  return artifact;
}
