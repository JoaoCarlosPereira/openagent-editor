const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "..");
const generator = path.join(repositoryRoot, "scripts", "inventory-cursor-artifacts.js");
const schemaPath = path.join(repositoryRoot, "schemas", "provenance.schema.json");
const committedInventoryPath = path.join(
  repositoryRoot,
  "research",
  "provenance",
  "cursor-3.24.18.inventory.json",
);
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const researchFiles = [
  "README.md",
  "pseudocode/functions.c",
  "pseudocode/manifest.tsv",
  "pseudocode/failures.tsv",
  "pseudocode/summary.txt",
];
const docsFiles = [
  "manifest.json",
  "docs/agent/overview.md",
  "docs/agent/plan-mode.md",
  "docs/agent/debug-mode.md",
  "docs.md",
  "changelog.html",
];
const appFiles = [
  "out/vs/workbench/workbench.desktop.main.js",
  "extensions/cursor-agent-exec/dist/main.js",
];

const allowedRecovery = new Set(schema.$defs.source.properties.recoveryMethod.enum);

function createFixture(base, { omitRelative, withApp } = {}) {
  const research = path.join(base, "research");
  const docs = path.join(base, "docs");

  for (const relative of researchFiles) {
    if (relative === omitRelative) continue;
    const file = path.join(research, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `fixture research: ${relative}\n`);
  }
  for (const relative of docsFiles) {
    if (relative === omitRelative) continue;
    const file = path.join(docs, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `fixture docs: ${relative}\n`);
  }

  const roots = { research, docs };
  if (withApp) {
    const app = path.join(base, "app");
    for (const relative of appFiles) {
      const file = path.join(app, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `fixture app: ${relative}\n`);
    }
    roots.app = app;
  }
  return roots;
}

function runGenerator({ research, docs, app, output }) {
  const argv = [
    generator,
    "--research-root", research,
    "--docs-root", docs,
    "--schema", schemaPath,
    "--output", output,
  ];
  if (app) {
    argv.push("--cursor-app-root", app);
  }
  // Isola o subprocesso de variáveis externas do ambiente do desenvolvedor.
  const env = { ...process.env };
  delete env.CURSOR_3_24_18_APP_ROOT;
  delete env.OPENAGENT_RESEARCH_ROOT;
  delete env.CURSOR_DOCS_ROOT;
  delete env.PROVENANCE_SCHEMA;
  delete env.INVENTORY_OUTPUT;
  return spawnSync(process.execPath, argv, { encoding: "utf8", env });
}

function assertValidProvenanceDocument(doc, { expectedCount }) {
  assert.equal(doc.$schema, schema.$schema);
  assert.equal(doc.schemaVersion, schema.properties.schemaVersion.const);
  for (const key of schema.required) {
    assert.ok(Object.hasOwn(doc, key), `faltando campo raiz obrigatório: ${key}`);
  }
  for (const key of Object.keys(doc)) {
    assert.ok(Object.hasOwn(schema.properties, key), `campo raiz fora do schema: ${key}`);
  }
  assert.equal(doc.module, "research/provenance/cursor-3-24-18");
  assert.match(doc.module, /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/);
  assert.equal(doc.strategy, "behavioral-reimplementation");
  assert.deepEqual(doc.license, { spdx: "MIT" });
  assert.equal(doc.containsCursorBrandAssets, false);
  assert.equal(doc.sources.length, expectedCount);
  assert.ok(!Object.hasOwn(doc, "artifacts"), "formato agregado antigo (artifacts) não permitido");
  assert.ok(!Object.hasOwn(doc, "aggregation"), "campo aggregation não permitido no schema");
  assert.ok(!Object.hasOwn(doc, "cursorVersion"), "cursorVersion raiz não permitido; fica em sources[]");
  assert.ok(!Object.hasOwn(doc, "defaultStrategy"), "defaultStrategy não permitido");

  for (const source of doc.sources) {
    assert.match(source.artifactSha256, /^[a-f0-9]{64}$/);
    assert.equal(source.cursorVersion, "3.24.18");
    assert.ok(allowedRecovery.has(source.recoveryMethod), `recoveryMethod inválido: ${source.recoveryMethod}`);
    assert.ok(
      !["ghidra-export", "public-docs", "bundle-js"].includes(source.recoveryMethod),
      "enums legados do inventário antigo não podem aparecer",
    );
    assert.equal(
      Object.keys(source).sort().join(","),
      "artifactPath,artifactSha256,cursorVersion,origin,recoveryMethod",
    );
    assert.ok(source.origin.bundle || /^0x[0-9a-fA-F]+$/.test(source.origin.address || ""));
    assert.ok(!Object.hasOwn(source, "license"), "license por source não existe no schema");
    assert.ok(!Object.hasOwn(source, "strategy"), "strategy por source não existe no schema");
    assert.ok(!Object.hasOwn(source, "type"), "type por source não existe no schema");
    assert.ok(!Object.hasOwn(source, "sizeBytes"), "sizeBytes por source não existe no schema");
  }
}

test("gerador produz proveniência compatível com schema task_01, hash e saída determinística", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-inventory-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const roots = createFixture(base);
  const first = path.join(base, "first.json");
  const second = path.join(base, "second.json");

  const result1 = runGenerator({ ...roots, output: first });
  assert.equal(result1.status, 0, result1.stderr);
  const result2 = runGenerator({ ...roots, output: second });
  assert.equal(result2.status, 0, result2.stderr);

  const bytes1 = fs.readFileSync(first);
  const bytes2 = fs.readFileSync(second);
  assert.deepEqual(bytes1, bytes2, "duas execuções devem produzir bytes idênticos");

  const doc = JSON.parse(bytes1);
  assertValidProvenanceDocument(doc, {
    expectedCount: researchFiles.length + docsFiles.length,
  });

  for (const item of doc.sources) {
    let fixturePath;
    if (item.artifactPath.startsWith("research/reverse-engineering/cursor-3.24.18/")) {
      fixturePath = path.join(
        roots.research,
        item.artifactPath.slice("research/reverse-engineering/cursor-3.24.18/".length),
      );
    } else if (item.artifactPath.startsWith("sources/cursor/")) {
      fixturePath = path.join(roots.docs, item.artifactPath.slice("sources/cursor/".length));
    } else {
      assert.fail(`artifactPath inesperado: ${item.artifactPath}`);
    }
    const data = fs.readFileSync(fixturePath);
    assert.equal(
      crypto.createHash("sha256").update(data).digest("hex"),
      item.artifactSha256,
    );
  }
});

test("gerador inclui bundles do app apenas quando --cursor-app-root é informado", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-inventory-app-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const roots = createFixture(base, { withApp: true });
  const out = path.join(base, "with-app.json");
  const result = runGenerator({ ...roots, app: roots.app, output: out });
  assert.equal(result.status, 0, result.stderr);
  const doc = JSON.parse(fs.readFileSync(out, "utf8"));
  assertValidProvenanceDocument(doc, {
    expectedCount: researchFiles.length + docsFiles.length + appFiles.length,
  });
  const appSources = doc.sources.filter((s) => s.recoveryMethod === "js-bundle-recovery");
  assert.equal(appSources.length, appFiles.length);
});

test("gerador falha explicitamente quando fonte obrigatória está ausente", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-inventory-missing-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const roots = createFixture(base, { omitRelative: "docs.md" });
  const out = path.join(base, "out.json");
  const result = runGenerator({ ...roots, output: out });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Arquivos de fonte obrigatórios ausentes/);
  assert.match(result.stderr, /sources\/cursor\/docs\.md/);
  assert.equal(fs.existsSync(out), false);
});

test("gerador falha quando raiz de pesquisa não existe (sem fallback externo)", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-inventory-noroot-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const docs = path.join(base, "docs");
  fs.mkdirSync(docs, { recursive: true });
  for (const relative of docsFiles) {
    const file = path.join(docs, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x\n");
  }
  const out = path.join(base, "out.json");
  const result = runGenerator({
    research: path.join(base, "research-ausente"),
    docs,
    output: out,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Fonte obrigatória ausente/);
  assert.equal(fs.existsSync(out), false);
});

test("gerador falha quando --cursor-app-root aponta para arquivos ausentes", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-inventory-appmiss-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const roots = createFixture(base);
  const emptyApp = path.join(base, "empty-app");
  fs.mkdirSync(emptyApp, { recursive: true });
  const out = path.join(base, "out.json");
  const result = runGenerator({ ...roots, app: emptyApp, output: out });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Arquivos de fonte obrigatórios ausentes/);
  assert.match(result.stderr, /workbench\.desktop\.main\.js/);
  assert.equal(fs.existsSync(out), false);
});

test("inventário commitado adere ao schema provenance da task_01", () => {
  assert.ok(fs.existsSync(committedInventoryPath), "inventário commitado ausente");
  const doc = JSON.parse(fs.readFileSync(committedInventoryPath, "utf8"));
  assert.ok(Array.isArray(doc.sources) && doc.sources.length >= researchFiles.length + docsFiles.length);
  assertValidProvenanceDocument(doc, { expectedCount: doc.sources.length });
  for (const method of doc.sources.map((s) => s.recoveryMethod)) {
    assert.ok(allowedRecovery.has(method));
  }
});
