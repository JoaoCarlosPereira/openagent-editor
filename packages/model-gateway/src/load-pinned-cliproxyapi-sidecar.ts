import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadAndValidateProvenanceFile } from "@openagent/provenance";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { resolveCliProxySidecarPackagingDirectory } from "./paths.js";
import type {
  CliProxySidecarArtifact,
  CliProxySidecarPinManifest,
  CliProxySidecarSbom,
  LoadedCliProxySidecarPin,
} from "./types.js";

const EXPECTED_VERSION = "8.0.45";
const EXPECTED_COMMIT_PREFIX = "ad8bdd3";
const SUPPORTED_TRIPLES: { os: CliProxySidecarArtifact["os"]; arch: CliProxySidecarArtifact["arch"] }[] = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "amd64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "amd64" },
  { os: "win32", arch: "arm64" },
  { os: "win32", arch: "amd64" },
];

function pinInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    pinInvalid("Pin do CLIProxyAPI ilegível ou ausente.");
  }
}

function assertSha256(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    pinInvalid(`Pin do CLIProxyAPI: ${field} inválido.`);
  }
}

function parseManifest(raw: unknown): CliProxySidecarPinManifest {
  if (!raw || typeof raw !== "object") {
    pinInvalid("Pin do CLIProxyAPI malformado.");
  }
  const manifest = raw as CliProxySidecarPinManifest;
  if (manifest.schemaVersion !== 1) {
    pinInvalid("Pin do CLIProxyAPI: schemaVersion não suportada.");
  }
  if (manifest.component !== "CLIProxyAPI") {
    pinInvalid("Pin do CLIProxyAPI: component divergente.");
  }
  if (manifest.version !== EXPECTED_VERSION) {
    pinInvalid("Pin do CLIProxyAPI: versão divergente do pin ADR-005.", ["version"]);
  }
  if (
    typeof manifest.gitCommit !== "string" ||
    !manifest.gitCommit.startsWith(EXPECTED_COMMIT_PREFIX)
  ) {
    pinInvalid("Pin do CLIProxyAPI: commit divergente do pin ADR-005.", ["gitCommit"]);
  }
  if (manifest.packagingModule !== "packaging/sidecars/cliproxyapi") {
    pinInvalid("Pin do CLIProxyAPI: packagingModule divergente.");
  }
  if (typeof manifest.defaultOpenAiBaseUrl !== "string" || !manifest.defaultOpenAiBaseUrl.trim()) {
    pinInvalid("Pin do CLIProxyAPI: defaultOpenAiBaseUrl inválido.");
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    pinInvalid("Pin do CLIProxyAPI: artifacts ausentes.");
  }

  for (const artifact of manifest.artifacts) {
    assertSha256(artifact.sha256, `sha256 de ${artifact.archiveFileName}`);
    if (typeof artifact.archiveFileName !== "string" || !artifact.archiveFileName.trim()) {
      pinInvalid("Pin do CLIProxyAPI: archiveFileName inválido.");
    }
  }

  for (const triple of SUPPORTED_TRIPLES) {
    const found = manifest.artifacts.some(
      (artifact) => artifact.os === triple.os && artifact.arch === triple.arch,
    );
    if (!found) {
      pinInvalid("Pin do CLIProxyAPI: checksum ausente para plataforma suportada.", [
        `${triple.os}/${triple.arch}`,
      ]);
    }
  }

  return manifest;
}

function parseSbom(raw: unknown, manifest: CliProxySidecarPinManifest): CliProxySidecarSbom {
  if (!raw || typeof raw !== "object") {
    pinInvalid("SBOM do CLIProxyAPI malformado.");
  }
  const sbom = raw as CliProxySidecarSbom;
  if (sbom.bomFormat !== "CycloneDX") {
    pinInvalid("SBOM do CLIProxyAPI: bomFormat inválido.");
  }
  if (typeof sbom.specVersion !== "string" || !sbom.specVersion.startsWith("1.")) {
    pinInvalid("SBOM do CLIProxyAPI: specVersion inválida.");
  }
  const meta = sbom.metadata?.component;
  if (meta?.name !== "CLIProxyAPI" || meta.version !== manifest.version) {
    pinInvalid("SBOM do CLIProxyAPI: metadados divergentes do pin.");
  }
  return sbom;
}

/**
 * Carrega o pin v8.0.45 (ad8bdd3), valida checksums por SO/arquitetura e SBOM CycloneDX.
 */
export async function loadPinnedCliProxyApiSidecar(): Promise<LoadedCliProxySidecarPin> {
  const packagingDirectory = resolveCliProxySidecarPackagingDirectory();
  const provenancePath = join(packagingDirectory, "provenance.json");
  const provenance = await loadAndValidateProvenanceFile(provenancePath);
  if (provenance.module !== "packaging/sidecars/cliproxyapi") {
    pinInvalid("Proveniência do CLIProxyAPI: module divergente.", [provenance.module]);
  }
  if (provenance.containsCursorBrandAssets !== false) {
    pinInvalid("Proveniência do CLIProxyAPI: marca Cursor proibida.");
  }

  const manifest = parseManifest(readJsonFile(join(packagingDirectory, "pin-manifest.json")));
  const sbomRelative = manifest.sbomRelativePath?.trim();
  if (!sbomRelative) {
    pinInvalid("Pin do CLIProxyAPI: sbomRelativePath ausente.");
  }
  const sbom = parseSbom(readJsonFile(join(packagingDirectory, sbomRelative)), manifest);

  return {
    manifest,
    sbom,
    packagingDirectory,
    provenanceModule: provenance.module,
  };
}
