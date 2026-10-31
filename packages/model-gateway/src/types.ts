export type CliProxySidecarOs = "darwin" | "linux" | "win32";
export type CliProxySidecarArch = "arm64" | "amd64";

export type CliProxySidecarArtifact = {
  os: CliProxySidecarOs;
  arch: CliProxySidecarArch;
  archiveFileName: string;
  archiveFormat: "tar.gz" | "zip";
  sha256: string;
  binaryName: string;
};

export type CliProxySidecarPinManifest = {
  schemaVersion: 1;
  component: "CLIProxyAPI";
  version: string;
  gitCommit: string;
  gitCommitShort: string;
  license: { spdx: string };
  upstream: {
    repository: string;
    releaseTag: string;
    releaseUrl: string;
    checksumsUrl: string;
  };
  packagingModule: string;
  defaultOpenAiBaseUrl: string;
  defaultListenPort: number;
  sbomRelativePath: string;
  artifacts: CliProxySidecarArtifact[];
};

export type CliProxySidecarSbom = {
  bomFormat: "CycloneDX";
  specVersion: string;
  version: number;
  metadata?: {
    component?: {
      name?: string;
      version?: string;
    };
  };
};

export type LoadedCliProxySidecarPin = {
  manifest: CliProxySidecarPinManifest;
  sbom: CliProxySidecarSbom;
  packagingDirectory: string;
  provenanceModule: string;
};
