import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ProvenanceValidationError,
  assertProvenance,
  loadAndValidateProvenanceFile,
  loadProvenanceSchema,
  validateProvenance,
  type ProvenanceDocument,
} from "../../src/index.js";

const rootDir = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const directAuthorizedPath = join(
  rootDir,
  "schemas/examples/direct-authorized.provenance.json",
);
const behavioralPath = join(
  rootDir,
  "schemas/examples/behavioral-reimplementation.provenance.json",
);

test("loadProvenanceSchema carrega o schema canônico Draft 2020-12", () => {
  const schema = loadProvenanceSchema();
  assert.equal(typeof schema, "object");
  assert.notEqual(schema, null);
  const record = schema as { $schema?: string; title?: string };
  assert.equal(record.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(record.title, "provenance.json do OpenAgent Editor");
});

test("casos positivos: valida com sucesso os exemplos canônicos", async () => {
  const directDoc = await loadAndValidateProvenanceFile(directAuthorizedPath);
  assert.equal(directDoc.strategy, "direct-authorized");
  assert.equal(directDoc.schemaVersion, 1);
  assert.equal(directDoc.containsCursorBrandAssets, false);
  assert.ok(directDoc.authorization !== undefined);
  assert.equal(directDoc.authorization?.documentRef, "legal/authorizations/cursor-3.24.18.md");

  const behavioralDoc = await loadAndValidateProvenanceFile(behavioralPath);
  assert.equal(behavioralDoc.strategy, "behavioral-reimplementation");
  assert.equal(behavioralDoc.schemaVersion, 1);
  assert.equal(behavioralDoc.containsCursorBrandAssets, false);
  assert.equal(behavioralDoc.sources.length, 2);

  const res1 = validateProvenance(directDoc);
  assert.equal(res1.valid, true);
  assert.deepEqual(res1.errors, []);
  if (res1.valid) {
    assert.equal(res1.data.module, "packages/extension-api/src/shims");
  }

  const res2 = validateProvenance(behavioralDoc);
  assert.equal(res2.valid, true);
  assert.deepEqual(res2.errors, []);
  if (res2.valid) {
    assert.equal(res2.data.module, "services/harness-daemon/src/queue");
  }
});

test("assertProvenance passa em documento válido e não lança exceção", async () => {
  const doc = await loadAndValidateProvenanceFile(directAuthorizedPath);
  assert.doesNotThrow(() => {
    assertProvenance(doc);
  });
});

test("caso negativo: campos obrigatórios ausentes são rejeitados com erro estruturado", () => {
  const cases: Array<{ label: string; payload: unknown; expectedKeyword: string }> = [
    {
      label: "payload não objeto",
      payload: "not-an-object",
      expectedKeyword: "type",
    },
    {
      label: "objeto vazio",
      payload: {},
      expectedKeyword: "required",
    },
    {
      label: "sem module",
      payload: {
        schemaVersion: 1,
        strategy: "behavioral-reimplementation",
        sources: [
          {
            artifactSha256: "a".repeat(64),
            artifactPath: "foo",
            cursorVersion: "3.24.18",
            origin: { bundle: "b.js" },
            recoveryMethod: "js-bundle-recovery",
          },
        ],
        license: { spdx: "MIT" },
        containsCursorBrandAssets: false,
      },
      expectedKeyword: "required",
    },
    {
      label: "sem sources",
      payload: {
        schemaVersion: 1,
        module: "packages/core",
        strategy: "behavioral-reimplementation",
        license: { spdx: "MIT" },
        containsCursorBrandAssets: false,
      },
      expectedKeyword: "required",
    },
    {
      label: "sources vazio (minItems: 1)",
      payload: {
        schemaVersion: 1,
        module: "packages/core",
        strategy: "behavioral-reimplementation",
        sources: [],
        license: { spdx: "MIT" },
        containsCursorBrandAssets: false,
      },
      expectedKeyword: "minItems",
    },
    {
      label: "sem license",
      payload: {
        schemaVersion: 1,
        module: "packages/core",
        strategy: "behavioral-reimplementation",
        sources: [
          {
            artifactSha256: "a".repeat(64),
            artifactPath: "foo",
            cursorVersion: "3.24.18",
            origin: { bundle: "b.js" },
            recoveryMethod: "js-bundle-recovery",
          },
        ],
        containsCursorBrandAssets: false,
      },
      expectedKeyword: "required",
    },
    {
      label: "sem containsCursorBrandAssets",
      payload: {
        schemaVersion: 1,
        module: "packages/core",
        strategy: "behavioral-reimplementation",
        sources: [
          {
            artifactSha256: "a".repeat(64),
            artifactPath: "foo",
            cursorVersion: "3.24.18",
            origin: { bundle: "b.js" },
            recoveryMethod: "js-bundle-recovery",
          },
        ],
        license: { spdx: "MIT" },
      },
      expectedKeyword: "required",
    },
  ];

  for (const c of cases) {
    const result = validateProvenance(c.payload);
    assert.equal(result.valid, false, `Esperava falso para: ${c.label}`);
    assert.ok(result.errors.length > 0);
    assert.ok(
      result.errors.some((err) => err.keyword === c.expectedKeyword),
      `Esperava erro com keyword ${c.expectedKeyword} em ${c.label}, obtido: ${JSON.stringify(result.errors)}`,
    );

    assert.throws(
      () => {
        assertProvenance(c.payload);
      },
      (err: unknown) => {
        assert.ok(err instanceof ProvenanceValidationError);
        assert.equal(err.code, "INVALID_PROVENANCE_SCHEMA");
        assert.ok(err.details.length > 0);
        return true;
      },
    );
  }
});

test("caso negativo: direct-authorized sem authorization é rejeitado (regra allOf / conditional schema)", () => {
  const invalidDirect: ProvenanceDocument = {
    schemaVersion: 1,
    module: "packages/core",
    strategy: "direct-authorized",
    sources: [
      {
        artifactSha256: "a".repeat(64),
        artifactPath: "foo",
        cursorVersion: "3.24.18",
        origin: { bundle: "b.js" },
        recoveryMethod: "js-bundle-recovery",
      },
    ],
    license: { spdx: "LicenseRef-Custom" },
    containsCursorBrandAssets: false,
  };

  const result = validateProvenance(invalidDirect);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (err) => err.keyword === "required" && err.params?.missingProperty === "authorization",
    ) ||
      result.errors.some((err) => err.keyword === "if" || err.keyword === "allOf"),
    `Esperava erro apontando falta de authorization: ${JSON.stringify(result.errors)}`,
  );

  assert.throws(
    () => {
      assertProvenance(invalidDirect);
    },
    (err: unknown) => {
      assert.ok(err instanceof ProvenanceValidationError);
      assert.equal(err.code, "INVALID_PROVENANCE_SCHEMA");
      return true;
    },
  );
});

test("caso negativo: containsCursorBrandAssets true é terminantemente rejeitado", () => {
  const invalid = {
    schemaVersion: 1,
    module: "packages/core",
    strategy: "behavioral-reimplementation",
    sources: [
      {
        artifactSha256: "b".repeat(64),
        artifactPath: "resources/app/out/vs/workbench/workbench.desktop.main.js",
        cursorVersion: "3.24.18",
        origin: { bundle: "workbench.desktop.main.js" },
        recoveryMethod: "js-bundle-recovery",
      },
    ],
    license: { spdx: "MIT" },
    containsCursorBrandAssets: true,
  };

  const result = validateProvenance(invalid);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((err) => err.keyword === "const"),
    `Esperava violação de const: ${JSON.stringify(result.errors)}`,
  );
});

test("caso negativo: caminhos maliciosos, traversal, barras invertidas e esquemas de URI em module e documentRef", () => {
  const baseValid: ProvenanceDocument = {
    schemaVersion: 1,
    module: "packages/ok",
    strategy: "direct-authorized",
    sources: [
      {
        artifactSha256: "c".repeat(64),
        artifactPath: "resources/main.js",
        cursorVersion: "3.24.18",
        origin: { bundle: "main.js" },
        recoveryMethod: "js-bundle-recovery",
      },
    ],
    license: { spdx: "LicenseRef-Test" },
    authorization: {
      documentRef: "legal/authorizations/ok.md",
      documentSha256: "d".repeat(64),
      scope: "Uso restrito",
    },
    containsCursorBrandAssets: false,
  };

  const maliciousModules = [
    "../outside",
    "..",
    ".",
    "pkg/../outside",
    "pkg/./outside",
    "/absolute/path",
    "pkg\\outside",
    "pkg//double-slash",
  ];

  for (const badModule of maliciousModules) {
    const candidate = { ...baseValid, module: badModule };
    const result = validateProvenance(candidate);
    assert.equal(result.valid, false, `Deveria rejeitar module inseguro: ${badModule}`);
    assert.ok(
      result.errors.some((err) => err.instancePath === "/module" && err.keyword === "pattern"),
      `Esperava erro de pattern em /module para ${badModule}: ${JSON.stringify(result.errors)}`,
    );
  }

  const maliciousRefs = [
    "../outside.md",
    "foo/..",
    "foo/./auth.md",
    "/absolute/auth.md",
    "https://example.test/auth.md",
    "javascript:alert(1)",
    "foo\\bar.md",
    "C:/auth.md",
    "auth.md#fragment",
  ];

  for (const badRef of maliciousRefs) {
    const candidate = {
      ...baseValid,
      authorization: {
        documentRef: badRef,
        documentSha256: "d".repeat(64),
        scope: "Uso restrito",
      },
    };
    const result = validateProvenance(candidate);
    assert.equal(result.valid, false, `Deveria rejeitar documentRef inseguro: ${badRef}`);
    assert.ok(
      result.errors.some(
        (err) => err.instancePath === "/authorization/documentRef" && err.keyword === "pattern",
      ),
      `Esperava erro de pattern em /authorization/documentRef para ${badRef}: ${JSON.stringify(result.errors)}`,
    );
  }
});

test("caso negativo: hashes SHA-256 fora do formato", () => {
  const invalidHashes = [
    "A".repeat(64), // maiúsculas são rejeitadas pelo pattern ^[a-f0-9]{64}$
    "a".repeat(63), // curto
    "a".repeat(65), // longo
    "not-a-hash",
    "12345",
  ];

  for (const badHash of invalidHashes) {
    const candidate = {
      schemaVersion: 1,
      module: "packages/test",
      strategy: "behavioral-reimplementation",
      sources: [
        {
          artifactSha256: badHash,
          artifactPath: "foo.js",
          cursorVersion: "3.24.18",
          origin: { bundle: "foo.js" },
          recoveryMethod: "js-bundle-recovery",
        },
      ],
      license: { spdx: "MIT" },
      containsCursorBrandAssets: false,
    };
    const result = validateProvenance(candidate);
    assert.equal(result.valid, false, `Deveria rejeitar hash inválido: ${badHash}`);
    assert.ok(
      result.errors.some(
        (err) => err.instancePath === "/sources/0/artifactSha256" && err.keyword === "pattern",
      ),
    );
  }
});

test("caso negativo: valores fora do enum (cursorVersion, strategy, recoveryMethod)", () => {
  const badVersion = {
    schemaVersion: 1,
    module: "packages/test",
    strategy: "behavioral-reimplementation",
    sources: [
      {
        artifactSha256: "0".repeat(64),
        artifactPath: "foo.js",
        cursorVersion: "4.0.0", // const "3.24.18"
        origin: { bundle: "foo.js" },
        recoveryMethod: "js-bundle-recovery",
      },
    ],
    license: { spdx: "MIT" },
    containsCursorBrandAssets: false,
  };
  assert.equal(validateProvenance(badVersion).valid, false);

  const badStrategy = {
    schemaVersion: 1,
    module: "packages/test",
    strategy: "copy-paste", // inválido
    sources: [
      {
        artifactSha256: "0".repeat(64),
        artifactPath: "foo.js",
        cursorVersion: "3.24.18",
        origin: { bundle: "foo.js" },
        recoveryMethod: "js-bundle-recovery",
      },
    ],
    license: { spdx: "MIT" },
    containsCursorBrandAssets: false,
  };
  assert.equal(validateProvenance(badStrategy).valid, false);

  const badRecovery = {
    schemaVersion: 1,
    module: "packages/test",
    strategy: "behavioral-reimplementation",
    sources: [
      {
        artifactSha256: "0".repeat(64),
        artifactPath: "foo.js",
        cursorVersion: "3.24.18",
        origin: { bundle: "foo.js" },
        recoveryMethod: "magic-decompilation", // inválido
      },
    ],
    license: { spdx: "MIT" },
    containsCursorBrandAssets: false,
  };
  assert.equal(validateProvenance(badRecovery).valid, false);
});

test("loadAndValidateProvenanceFile lida com arquivo inexistente e JSON malformado", async () => {
  await assert.rejects(
    async () => {
      await loadAndValidateProvenanceFile("/caminho/certamente/inexistente/provenance.json");
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    },
  );

  const tmp = await mkdtemp(join(tmpdir(), "openagent-prov-test-"));
  try {
    const malformedPath = join(tmp, "malformed.json");
    await writeFile(malformedPath, "{ invalid json", "utf8");

    await assert.rejects(
      async () => {
        await loadAndValidateProvenanceFile(malformedPath);
      },
      (err: unknown) => {
        assert.ok(err instanceof SyntaxError);
        return true;
      },
    );

    const invalidSchemaPath = join(tmp, "invalid-schema.json");
    await writeFile(invalidSchemaPath, JSON.stringify({ schemaVersion: 99 }), "utf8");

    await assert.rejects(
      async () => {
        await loadAndValidateProvenanceFile(invalidSchemaPath);
      },
      (err: unknown) => {
        assert.ok(err instanceof ProvenanceValidationError);
        assert.equal(err.code, "INVALID_PROVENANCE_SCHEMA");
        assert.ok(err.details.length > 0);
        return true;
      },
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
