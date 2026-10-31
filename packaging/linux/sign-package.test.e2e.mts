/**
 * task_186 — e2e: checksum, SBOM e assinatura pendente do pacote Linux.
 *
 * Fluxo: build do pacote -> checksum .sha256 determinístico, SBOM CycloneDX
 * contendo pin+daemon+tools -> assinatura GPG pendente (sem chave) e caminho de
 * erro: checksum informado inválido falha estavelmente sem efeito colateral.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import { buildPackageLinux } from "./build-package-linux.mjs";
import {
  checksumPackage,
  writeChecksumFile,
  signPackage,
  writePackageSbom,
  verifyPackageChecksum,
} from "./sign-package.mjs";

const tmpParent = await mkdtemp(path.join(os.tmpdir(), "oa-186-"));

let pkg;
test("[LOC-01] build do pacote para assinatura", async () => {
  const result = buildPackageLinux({ outRoot: tmpParent });
  pkg = {
    tarballPath: result.tarballPath,
    stagedDir: path.join(result.staging, "openagent-editor"),
  };
  assert.ok(fs.existsSync(pkg.tarballPath));
});

test("[LOC-01] checksum do pacote é determinístico e o arquivo .sha256 referees o arquivo correto", async () => {
  const first = checksumPackage(pkg.tarballPath);
  const written = writeChecksumFile(pkg.tarballPath);
  assert.equal(written.sha, first);
  assert.ok(fs.existsSync(written.file));
  const content = fs.readFileSync(written.file, "utf8");
  assert.match(content.trim(), new RegExp(`^${first}  ${path.basename(pkg.tarballPath)}$`));
});

test("[LOC-01] SBOM do pacote contém editor, daemon, tools e sidecar CLIProxyAPI", async () => {
  const { file, sbom } = writePackageSbom(pkg.tarballPath, pkg.stagedDir);
  assert.ok(fs.existsSync(file));
  assert.equal(sbom.bomFormat, "CycloneDX");
  const names = sbom.components.map((c) => c.name);
  assert.ok(names.includes("openagent-editor"));
  assert.ok(names.includes("openagent-harness-daemon"));
  assert.ok(names.includes("openagent-tools"));
  assert.ok(names.includes("CLIProxyAPI"));
  const sidecar = sbom.components.find((c) => c.name === "CLIProxyAPI");
  assert.equal(sidecar.version, "8.0.45");
  assert.ok(sidecar.hashes?.[0]?.content?.length === 64);
});

test("[LOC-01] assinatura sem chave GPG marca SIGNATURE-PENDING de forma estável", async () => {
  const { file, signed } = signPackage(pkg.tarballPath, {});
  assert.equal(signed, false);
  assert.ok(fs.existsSync(file));
  const content = fs.readFileSync(file, "utf8");
  assert.match(content, /SIGNATURE-PENDING/);
});

test("[LOC-01] verificação com checksum inválido falha estável sem efeito colateral", async () => {
  const good = checksumPackage(pkg.tarballPath);
  const bogus = good.replace(/^./, good[0] === "0" ? "1" : "0");
  await assert.rejects(
    Promise.resolve().then(() => verifyPackageChecksum(pkg.tarballPath, bogus)),
    (error: unknown) => (error as { code?: string }).code === "CHECKSUM_MISMATCH",
  );
  // checksum correto ainda funciona após o erro
  assert.equal(verifyPackageChecksum(pkg.tarballPath, good), good);
});

test.after(async () => {
  await rm(tmpParent, { recursive: true, force: true });
});
