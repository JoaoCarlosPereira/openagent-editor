import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { resolveCliProxyArtifactForPlatform } from "./resolve-cliproxy-artifact.js";
import type { CliProxySidecarArch, CliProxySidecarOs, CliProxySidecarPinManifest } from "./types.js";

function sha256File(path: string): string {
  const digest = createHash("sha256");
  digest.update(readFileSync(path));
  return digest.digest("hex");
}

/**
 * Verifica o SHA-256 de um arquivo de release empacotado contra o pin congelado.
 */
export function verifyCliProxyArchiveChecksum(
  manifest: CliProxySidecarPinManifest,
  archivePath: string,
  platform: { os: CliProxySidecarOs; arch: CliProxySidecarArch },
): void {
  const artifact = resolveCliProxyArtifactForPlatform(manifest, platform);
  let actual: string;
  try {
    actual = sha256File(archivePath);
  } catch {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Arquivo do sidecar CLIProxyAPI ilegível ou ausente.",
      [archivePath],
    );
  }
  if (actual !== artifact.sha256) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Checksum do sidecar CLIProxyAPI diverge do pin.",
      [artifact.archiveFileName],
    );
  }
}
