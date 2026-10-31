#!/usr/bin/env node
/**
 * task_186 — Assinatura, checksums e SBOM do pacote Linux (LOC-01).
 *
 * Dado o tarball gerado por build-package-linux.mjs, produz:
 *   <tarball>.sha256          soma SHA256 do pacote
 *   <tarball>.sha256.asc     assinatura GPG (detached, ASCII) quando --key é informado;
 *                            sem --key, escreve "SIGNATURE-PENDING" marcando pendência
 *                            (o pacote já distribui checksum validável offline).
 *   <tarball>.sbom.cdx.json   SBOM CycloneDX consolidado do pacote (pin do sidecar + versões)
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function checksumPackage(tarballPath) {
  return createHash("sha256").update(fs.readFileSync(tarballPath)).digest("hex");
}

export function writeChecksumFile(tarballPath) {
  const sha = checksumPackage(tarballPath);
  const out = `${tarballPath}.sha256`;
  fs.writeFileSync(out, `${sha}  ${path.basename(tarballPath)}\n`);
  return { file: out, sha };
}

export function signPackage(tarballPath, options = {}) {
  const key = options.key ?? process.env.OPENAGENT_GPG_KEY;
  if (!key) {
    const out = `${tarballPath}.sha256.asc`;
    fs.writeFileSync(out, "SIGNATURE-PENDING: configure OPENAGENT_GPG_KEY ou --key e gere a assinatura GPG detached.\n");
    return { file: out, signed: false };
  }
  const out = `${tarballPath}.sha256.asc`;
  const result = spawnSync("gpg", [
    "--batch", "--yes", "--local-user", key, "--output", out,
    "--armor", "--detach-sig", tarballPath,
  ], { encoding: "utf8" });
  if (result.status !== 0 || !fs.existsSync(out)) {
    const error = new Error(`gpg falhou: ${result.stderr ?? result.error?.message ?? "desconhecido"}`);
    error.code = "GPG_FAILED";
    throw error;
  }
  return { file: out, signed: true };
}

export function writePackageSbom(tarballPath, stagingDir) {
  const manifestPath = path.join(stagingDir, "package-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const pinManifestPath = path.join(stagingDir, "sidecars", "cliproxyapi", "pin-manifest.json");
  const pin = JSON.parse(fs.readFileSync(pinManifestPath, "utf8"));
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:openagent-editor-package-${manifest.manifest?.platform?.os ?? "linux"}-${checksumPackage(tarballPath).slice(0, 12)}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        type: "library",
        name: manifest.manifest?.packageName ?? "openagent-editor",
        version: manifest.manifest?.packages?.editor ?? "0.1.0",
      },
      properties: {},
    },
    components: [
      {
        type: "library",
        name: manifest.manifest?.packageName ?? "openagent-editor",
        version: manifest.manifest?.packages?.editor ?? "0.1.0",
        purl: `pkg:openagent/${manifest.manifest?.packageName ?? "openagent-editor"}@${manifest.manifest?.packages?.editor ?? "0.1.0"}`,
        licenses: [{ license: { id: "MIT" } }],
      },
      {
        type: "library",
        name: "openagent-harness-daemon",
        version: manifest.manifest?.packages?.daemon ?? "0.1.0",
        purl: `pkg:openagent/openagent-harness-daemon@${manifest.manifest?.packages?.daemon ?? "0.1.0"}`,
        licenses: [{ license: { id: "MIT" } }],
      },
      {
        type: "library",
        name: "openagent-tools",
        version: manifest.manifest?.packages?.tools ?? "0.1.0",
        purl: `pkg:openagent/openagent-tools@${manifest.manifest?.packages?.tools ?? "0.1.0"}`,
        licenses: [{ license: { id: "MIT" } }],
      },
      {
        type: "application",
        name: pin.component,
        version: pin.version,
        purl: `pkg:github/${pin.upstream.repository.replace("https://github.com/", "")}@${pin.gitCommit}`,
        licenses: [{ license: { id: pin.license.spdx } }],
        hashes: [{ alg: "SHA-256", content: pin.artifacts.find((a) => a.os === "linux")?.sha256 ?? "" }],
        externalReferences: pin.upstream?.checksumsUrl
          ? [{ type: "distribution", url: pin.upstream.checksumsUrl }]
          : undefined,
      },
    ],
  };
  const out = `${tarballPath}.sbom.cdx.json`;
  fs.writeFileSync(out, JSON.stringify(sbom, null, 2) + "\n");
  return { file: out, sbom };
}

export function verifyPackageChecksum(tarballPath, expectedSha256) {
  const sha = checksumPackage(tarballPath);
  if (sha !== expectedSha256) {
    const error = new Error(`checksum do pacote não confere: ${sha} != ${expectedSha256}`);
    error.code = "CHECKSUM_MISMATCH";
    throw error;
  }
  return sha;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const tarball = process.argv[2];
  if (!tarball || !fs.existsSync(tarball)) {
    console.error("uso: node sign-package.mjs <tarball> [--staging DIR] [--key GPG-KEY]");
    process.exit(2);
  }
  const stagingIdx = process.argv.indexOf("--staging");
  const staging = stagingIdx >= 0 ? process.argv[stagingIdx + 1] : path.join(path.dirname(tarball), "staging", "openagent-editor");
  const keyIdx = process.argv.indexOf("--key");
  const key = keyIdx >= 0 ? process.argv[keyIdx + 1] : undefined;
  const sum = writeChecksumFile(tarball);
  const sig = signPackage(tarball, { key });
  const sbom = writePackageSbom(tarball, staging);
  console.log(JSON.stringify({ checksum: sum, signature: sig, sbom: sbom.file }, null, 2));
}
