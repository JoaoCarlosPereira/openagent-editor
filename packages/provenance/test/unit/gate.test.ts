import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  checkProvenanceGate,
  assertProvenanceGate,
  ProvenanceGateError,
  runProvenanceGateCli,
} from "../../src/index.js";

// Helper para criar fixtures de teste em pastas temporárias
async function createFixtureDir(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "openagent-gate-test-"));
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

test("descobre ambos os nomes e rejeita manifesto inválido", async () => {
  const { dir, cleanup } = await createFixtureDir();
  try {
    await mkdir(join(dir, "module"), { recursive: true });
    await writeFile(join(dir, "module", "provenance.json"), "{}");
    await writeFile(join(dir, "module", "extra.provenance.json"), "{");
    const report = await checkProvenanceGate({ rootDir: dir });
    assert.equal(report.filesScanned, 2);
    assert.equal(report.ok, false);
    assert.equal(report.violations.filter((v) => v.code === "INVALID_SCHEMA").length, 2);
  } finally {
    await cleanup();
  }
});

test("cobertura declarada reprova ausência e não exige módulos não declarados", async () => {
  const { dir, cleanup } = await createFixtureDir();
  try {
    const report = await checkProvenanceGate({
      rootDir: dir,
      requiredManifests: ["packages/required/provenance.json"],
    });
    assert.equal(report.ok, false);
    assert.equal(report.violations[0]?.code, "MISSING_PROVENANCE");
    assert.equal((await checkProvenanceGate({ rootDir: dir })).ok, true);
  } finally {
    await cleanup();
  }
});

test("erro de leitura da raiz não resulta em sucesso silencioso", async () => {
  const { dir, cleanup } = await createFixtureDir();
  try {
    await assert.rejects(checkProvenanceGate({ rootDir: join(dir, "inexistente") }));
  } finally {
    await cleanup();
  }
});

test("gate aceita repositório com behavioral-reimplementation válido", async () => {
  const { dir, cleanup } = await createFixtureDir();
  try {
    const provDir = join(dir, "packages/feature");
    await mkdir(provDir, { recursive: true });

    const doc = {
      schemaVersion: 1,
      module: "packages/feature",
      strategy: "behavioral-reimplementation",
      sources: [
        {
          artifactSha256: "1".repeat(64),
          artifactPath: "resources/app/out/vs/workbench/workbench.desktop.main.js",
          cursorVersion: "3.24.18",
          origin: { bundle: "workbench.desktop.main.js" },
          recoveryMethod: "js-bundle-recovery",
        },
      ],
      license: { spdx: "MIT" },
      containsCursorBrandAssets: false,
    };

    await writeFile(
      join(provDir, "feature.provenance.json"),
      JSON.stringify(doc, null, 2),
      "utf8",
    );

    const report = await checkProvenanceGate({
      rootDir: dir,
      requiredManifests: ["packages/feature/feature.provenance.json"],
    });
    assert.equal(report.ok, true);
    assert.equal(report.filesScanned, 1);
    assert.equal(report.filesPassed, 1);
    assert.equal(report.violations.length, 0);
  } finally {
    await cleanup();
  }
});

test("gate aceita direct-authorized quando o documento de autorização existe e confere", async () => {
  const { dir, cleanup } = await createFixtureDir();
  try {
    const authRelPath = "legal/authorizations/cursor-3.24.18.md";
    const authAbsPath = join(dir, authRelPath);
    await mkdir(join(dir, "legal/authorizations"), { recursive: true });
    const authContent = "# Autorização de Reutilização de Código\\nAutorizado.";
    await writeFile(authAbsPath, authContent, "utf8");
    const authSha = sha256(authContent);

    const provDir = join(dir, "packages/direct-module");
    await mkdir(provDir, { recursive: true });

    const doc = {
      schemaVersion: 1,
      module: "packages/direct-module",
      strategy: "direct-authorized",
      sources: [
        {
          artifactSha256: "2".repeat(64),
          artifactPath: "resources/app/out/vs/workbench/workbench.desktop.main.js",
          cursorVersion: "3.24.18",
          origin: { bundle: "workbench.desktop.main.js" },
          recoveryMethod: "js-bundle-recovery",
        },
      ],
      license: { spdx: "LicenseRef-Custom" },
      authorization: {
        documentRef: authRelPath,
        documentSha256: authSha,
        scope: "Reutilizacao autorizada de shims",
      },
      containsCursorBrandAssets: false,
    };

    await writeFile(
      join(provDir, "direct.provenance.json"),
      JSON.stringify(doc, null, 2),
      "utf8",
    );

    const report = await checkProvenanceGate({ rootDir: dir });
    assert.equal(report.ok, true);
    assert.equal(report.filesScanned, 1);
    assert.equal(report.filesPassed, 1);
    assert.equal(report.violations.length, 0);

    // assertProvenanceGate não deve lançar exceção
    const assertedReport = await assertProvenanceGate({ rootDir: dir });
    assert.equal(assertedReport.ok, true);
  } finally {
    await cleanup();
  }
});

test("gate rejeita direct-authorized quando o documento referenciado não existe no disco", async () => {
  const { dir, cleanup } = await createFixtureDir();
  try {
    const provDir = join(dir, "packages/orphan-direct");
    await mkdir(provDir, { recursive: true });

    const doc = {
      schemaVersion: 1,
      module: "packages/orphan-direct",
      strategy: "direct-authorized",
      sources: [
        {
          artifactSha256: "3".repeat(64),
          artifactPath: "resources/app/out/vs/workbench/workbench.desktop.main.js",
          cursorVersion: "3.24.18",
          origin: { bundle: "workbench.desktop.main.js" },
          recoveryMethod: "js-bundle-recovery",
        },
      ],
      license: { spdx: "LicenseRef-Custom" },
      authorization: {
        documentRef: "legal/authorizations/nao-existe.md",
        documentSha256: "4".repeat(64),
        scope: "Escopo",
      },
      containsCursorBrandAssets: false,
    };

    await writeFile(
      join(provDir, "orphan.provenance.json"),
      JSON.stringify(doc, null, 2),
      "utf8",
    );

    const report = await checkProvenanceGate({ rootDir: dir });
    assert.equal(report.ok, false);
    assert.equal(report.filesScanned, 1);
    assert.equal(report.filesPassed, 0);
    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0]?.code, "AUTHORIZATION_DOCUMENT_NOT_FOUND");
    assert.ok(report.violations[0]?.message.includes("nao-existe.md"));

    await assert.rejects(
      async () => {
        await assertProvenanceGate({ rootDir: dir });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProvenanceGateError);
        assert.equal(err.report.ok, false);
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test("gate rejeita direct-authorized quando authorization está ausente ou vazio", async () => {
  const { dir, cleanup } = await createFixtureDir();
  try {
    const provDir = join(dir, "packages/no-auth");
    await mkdir(provDir, { recursive: true });

    // Payload sem bloco authorization
    const docSemAuth = {
      schemaVersion: 1,
      module: "packages/no-auth",
      strategy: "direct-authorized",
      sources: [
        {
          artifactSha256: "5".repeat(64),
          artifactPath: "resources/app/out/vs/workbench/workbench.desktop.main.js",
          cursorVersion: "3.24.18",
          origin: { bundle: "workbench.desktop.main.js" },
          recoveryMethod: "js-bundle-recovery",
        },
      ],
      license: { spdx: "LicenseRef-Custom" },
      containsCursorBrandAssets: false,
    };

    await writeFile(
      join(provDir, "no-auth.provenance.json"),
      JSON.stringify(docSemAuth, null, 2),
      "utf8",
    );

    const report = await checkProvenanceGate({ rootDir: dir });
    assert.equal(report.ok, false);
    assert.ok(report.violations.length >= 1);
    assert.ok(
      report.violations.some(
        (v) => v.code === "MISSING_AUTHORIZATION" || v.code === "INVALID_SCHEMA",
      ),
    );
  } finally {
    await cleanup();
  }
});

test("gate rejeita direct-authorized quando o hash SHA-256 do documento no disco diverge", async () => {
  const { dir, cleanup } = await createFixtureDir();
  try {
    const authRelPath = "legal/authorizations/cursor-3.24.18.md";
    const authAbsPath = join(dir, authRelPath);
    await mkdir(join(dir, "legal/authorizations"), { recursive: true });
    await writeFile(authAbsPath, "# Documento real modificado", "utf8");

    const provDir = join(dir, "packages/hash-mismatch");
    await mkdir(provDir, { recursive: true });

    const doc = {
      schemaVersion: 1,
      module: "packages/hash-mismatch",
      strategy: "direct-authorized",
      sources: [
        {
          artifactSha256: "6".repeat(64),
          artifactPath: "resources/app/out/vs/workbench/workbench.desktop.main.js",
          cursorVersion: "3.24.18",
          origin: { bundle: "workbench.desktop.main.js" },
          recoveryMethod: "js-bundle-recovery",
        },
      ],
      license: { spdx: "LicenseRef-Custom" },
      authorization: {
        documentRef: authRelPath,
        documentSha256: "f".repeat(64), // hash incorreto
        scope: "Escopo",
      },
      containsCursorBrandAssets: false,
    };

    await writeFile(
      join(provDir, "mismatch.provenance.json"),
      JSON.stringify(doc, null, 2),
      "utf8",
    );

    const report = await checkProvenanceGate({ rootDir: dir });
    assert.equal(report.ok, false);
    assert.ok(
      report.violations.some((v) => v.code === "AUTHORIZATION_HASH_MISMATCH"),
    );
  } finally {
    await cleanup();
  }
});

test("gate rejeita terminantemente se containsCursorBrandAssets for true", async () => {
  const { dir, cleanup } = await createFixtureDir();
  try {
    const provDir = join(dir, "packages/branded");
    await mkdir(provDir, { recursive: true });

    const doc = {
      schemaVersion: 1,
      module: "packages/branded",
      strategy: "behavioral-reimplementation",
      sources: [
        {
          artifactSha256: "7".repeat(64),
          artifactPath: "resources/app/out/vs/workbench/workbench.desktop.main.js",
          cursorVersion: "3.24.18",
          origin: { bundle: "workbench.desktop.main.js" },
          recoveryMethod: "js-bundle-recovery",
        },
      ],
      license: { spdx: "MIT" },
      containsCursorBrandAssets: true,
    };

    await writeFile(
      join(provDir, "branded.provenance.json"),
      JSON.stringify(doc, null, 2),
      "utf8",
    );

    const report = await checkProvenanceGate({ rootDir: dir });
    assert.equal(report.ok, false);
    assert.ok(
      report.violations.some(
        (v) =>
          v.code === "CURSOR_BRAND_ASSETS_FORBIDDEN" ||
          v.code === "INVALID_SCHEMA",
      ),
    );
  } finally {
    await cleanup();
  }
});

test("gate rejeita arquivo com JSON sintaticamente malformado", async () => {
  const { dir, cleanup } = await createFixtureDir();
  try {
    const provDir = join(dir, "packages/malformed");
    await mkdir(provDir, { recursive: true });

    await writeFile(
      join(provDir, "bad.provenance.json"),
      "{ json invalido sem fechar",
      "utf8",
    );

    const report = await checkProvenanceGate({ rootDir: dir });
    assert.equal(report.ok, false);
    assert.ok(
      report.violations.some(
        (v) => v.code === "FILE_READ_ERROR" || v.code === "INVALID_SCHEMA",
      ),
    );
  } finally {
    await cleanup();
  }
});

test("gate ignora pastas configuradas como node_modules, .git, schemas/examples", async () => {
  const { dir, cleanup } = await createFixtureDir();
  try {
    const ignoredDir = join(dir, "schemas/examples");
    await mkdir(ignoredDir, { recursive: true });

    // Exemplo com direct-authorized apontando para documento inexistente
    const exampleDoc = {
      schemaVersion: 1,
      module: "packages/example",
      strategy: "direct-authorized",
      sources: [
        {
          artifactSha256: "8".repeat(64),
          artifactPath: "resources/app/out/vs/workbench/workbench.desktop.main.js",
          cursorVersion: "3.24.18",
          origin: { bundle: "workbench.desktop.main.js" },
          recoveryMethod: "js-bundle-recovery",
        },
      ],
      license: { spdx: "LicenseRef-Custom" },
      authorization: {
        documentRef: "legal/authorizations/inexistente.md",
        documentSha256: "8".repeat(64),
        scope: "Exemplo ilustrativo",
      },
      containsCursorBrandAssets: false,
    };

    await writeFile(
      join(ignoredDir, "direct-authorized.provenance.json"),
      JSON.stringify(exampleDoc, null, 2),
      "utf8",
    );

    // Com o ignore padrão, schemas/examples é ignorado e reporta ok
    const report = await checkProvenanceGate({ rootDir: dir });
    assert.equal(report.ok, true);
    assert.equal(report.filesScanned, 0);

    // Se remover schemas/examples do ignore, o arquivo é escaneado e rejeitado
    const strictReport = await checkProvenanceGate({
      rootDir: dir,
      ignore: ["**/node_modules/**", "**/.git/**"],
    });
    assert.equal(strictReport.ok, false);
    assert.equal(strictReport.filesScanned, 1);
  } finally {
    await cleanup();
  }
});

test("runProvenanceGateCli sai com código 0 no sucesso e código 1 no erro", async () => {
  const { dir, cleanup } = await createFixtureDir();
  try {
    const provDir = join(dir, "packages/ok");
    await mkdir(provDir, { recursive: true });

    const doc = {
      schemaVersion: 1,
      module: "packages/ok",
      strategy: "behavioral-reimplementation",
      sources: [
        {
          artifactSha256: "9".repeat(64),
          artifactPath: "resources/app/out/vs/workbench/workbench.desktop.main.js",
          cursorVersion: "3.24.18",
          origin: { bundle: "workbench.desktop.main.js" },
          recoveryMethod: "js-bundle-recovery",
        },
      ],
      license: { spdx: "MIT" },
      containsCursorBrandAssets: false,
    };

    await writeFile(
      join(provDir, "ok.provenance.json"),
      JSON.stringify(doc, null, 2),
      "utf8",
    );

    const prevExitCode = process.exitCode;
    try {
      const exit0 = await runProvenanceGateCli({ rootDir: dir, silent: true });
      assert.equal(exit0, 0);

      // Agora adiciona arquivo com erro
      await writeFile(
        join(provDir, "fail.provenance.json"),
        JSON.stringify({ ...doc, containsCursorBrandAssets: true }, null, 2),
        "utf8",
      );

      const exit1 = await runProvenanceGateCli({ rootDir: dir, silent: true });
      assert.equal(exit1, 1);
    } finally {
      process.exitCode = prevExitCode;
    }
  } finally {
    await cleanup();
  }
});
