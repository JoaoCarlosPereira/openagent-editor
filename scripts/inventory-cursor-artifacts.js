#!/usr/bin/env node
"use strict";

// Usage:
//   node scripts/inventory-cursor-artifacts.js
//     [--research-root DIR] [--docs-root DIR] [--cursor-app-root DIR]
//     [--schema FILE] [--output FILE]
// Env: OPENAGENT_RESEARCH_ROOT, CURSOR_DOCS_ROOT, CURSOR_3_24_18_APP_ROOT,
//      PROVENANCE_SCHEMA, INVENTORY_OUTPUT
//
// Defaults apontam apenas para caminhos DENTRO deste checkout.
// Fontes ausentes falham com exit 1 (nunca sucesso silencioso).
// Bundle do app Cursor só entra se --cursor-app-root / CURSOR_3_24_18_APP_ROOT
// for informado; não há path externo hardcoded.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const researchRoot = path.resolve(
  args["research-root"]
    || process.env.OPENAGENT_RESEARCH_ROOT
    || path.join(repositoryRoot, "research", "reverse-engineering", "cursor-3.24.18"),
);
const docsRoot = path.resolve(
  args["docs-root"]
    || process.env.CURSOR_DOCS_ROOT
    || path.join(repositoryRoot, "sources", "cursor"),
);
const appRoot = args["cursor-app-root"] || process.env.CURSOR_3_24_18_APP_ROOT || null;
const schemaPath = path.resolve(
  args.schema
    || process.env.PROVENANCE_SCHEMA
    || path.join(repositoryRoot, "schemas", "provenance.schema.json"),
);
const outputPath = path.resolve(
  args.output
    || process.env.INVENTORY_OUTPUT
    || path.join(repositoryRoot, "research", "provenance", "cursor-3.24.18.inventory.json"),
);

const schemaUri = "https://json-schema.org/draft/2020-12/schema";
const moduleId = "research/provenance/cursor-3-24-18";

const artifactGroups = [
  {
    root: researchRoot,
    prefix: "research/reverse-engineering/cursor-3.24.18",
    method: "ghidra-pseudocode",
    files: [
      "README.md",
      "pseudocode/functions.c",
      "pseudocode/manifest.tsv",
      "pseudocode/failures.tsv",
      "pseudocode/summary.txt",
    ],
    originFor(relative) {
      return { bundle: `research/reverse-engineering/cursor-3.24.18/${relative}` };
    },
  },
  {
    root: docsRoot,
    prefix: "sources/cursor",
    method: "public-documentation",
    files: [
      "manifest.json",
      "docs/agent/overview.md",
      "docs/agent/plan-mode.md",
      "docs/agent/debug-mode.md",
      "docs.md",
      "changelog.html",
    ],
    originFor(relative) {
      return { bundle: `sources/cursor/${relative}` };
    },
  },
];

if (appRoot) {
  artifactGroups.push({
    root: path.resolve(appRoot),
    prefix: "resources/app",
    method: "js-bundle-recovery",
    files: [
      "out/vs/workbench/workbench.desktop.main.js",
      "extensions/cursor-agent-exec/dist/main.js",
    ],
    originFor(relative) {
      return { bundle: `resources/app/${relative}` };
    },
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--") || argv[i + 1] === undefined) {
      throw new Error(`Argumento inválido: ${token}`);
    }
    parsed[token.slice(2)] = argv[++i];
  }
  const allowed = new Set([
    "research-root",
    "docs-root",
    "cursor-app-root",
    "schema",
    "output",
  ]);
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) throw new Error(`Opção desconhecida: --${key}`);
  }
  return parsed;
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(`Validação provenance.schema.json: ${message}`);
}

function validateSchema(schema) {
  assert(schema && schema.$schema === schemaUri, "$schema inválido");
  assert(schema.type === "object" && schema.additionalProperties === false, "schema-raiz inesperado");
  assert(schema.properties.schemaVersion.const === 1, "schemaVersion deve ser 1");
  for (const key of ["module", "strategy", "sources", "license", "containsCursorBrandAssets"]) {
    assert(schema.required.includes(key), `campo obrigatório ausente no schema: ${key}`);
  }
  assert(
    schema.properties.strategy.enum.includes("behavioral-reimplementation"),
    "strategy incompatível",
  );
  const methods = schema.$defs.source.properties.recoveryMethod.enum;
  for (const method of ["ghidra-pseudocode", "public-documentation", "js-bundle-recovery"]) {
    assert(methods.includes(method), `recoveryMethod sem ${method}`);
  }
  assert(schema.$defs.license.required.includes("spdx"), "license.spdx obrigatório no schema");
}

function validateInventory(doc, schema) {
  validateSchema(schema);
  assert(doc && typeof doc === "object" && !Array.isArray(doc), "raiz deve ser objeto");
  const allowed = new Set(Object.keys(schema.properties));
  for (const key of Object.keys(doc)) {
    assert(allowed.has(key), `propriedade raiz não permitida: ${key}`);
  }
  for (const key of schema.required) {
    assert(Object.hasOwn(doc, key), `campo obrigatório ausente: ${key}`);
  }
  assert(doc.$schema === schemaUri && doc.schemaVersion === 1, "versão/schema inválidos");
  assert(
    typeof doc.module === "string"
      && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(doc.module),
    "module inválido (sem pontos; segmentos [A-Za-z0-9_-]+)",
  );
  assert(doc.strategy === "behavioral-reimplementation", "strategy inválida");
  assert(doc.containsCursorBrandAssets === false, "containsCursorBrandAssets deve ser false");
  assert(
    doc.license
      && typeof doc.license.spdx === "string"
      && doc.license.spdx.length > 0
      && Object.keys(doc.license).length === 1,
    "license deve ser {spdx}",
  );
  assert(Array.isArray(doc.sources) && doc.sources.length > 0, "sources deve conter ao menos uma origem");

  const sourceSchema = schema.$defs.source;
  const sourceAllowed = new Set(Object.keys(sourceSchema.properties));
  for (const [i, item] of doc.sources.entries()) {
    assert(item && typeof item === "object" && !Array.isArray(item), `sources[${i}] deve ser objeto`);
    for (const k of Object.keys(item)) {
      assert(sourceAllowed.has(k), `sources[${i}] propriedade não permitida: ${k}`);
    }
    for (const k of sourceSchema.required) {
      assert(Object.hasOwn(item, k), `sources[${i}] campo obrigatório ausente: ${k}`);
    }
    assert(/^[a-f0-9]{64}$/.test(item.artifactSha256), `sources[${i}] SHA-256 inválido`);
    assert(
      typeof item.artifactPath === "string" && item.artifactPath.length > 0,
      `sources[${i}] artifactPath inválido`,
    );
    assert(item.cursorVersion === "3.24.18", `sources[${i}] cursorVersion inválida`);
    assert(
      item.origin
        && typeof item.origin === "object"
        && !Array.isArray(item.origin)
        && Object.keys(item.origin).length > 0,
      `sources[${i}] origin inválido`,
    );
    for (const k of Object.keys(item.origin)) {
      assert(["bundle", "address", "symbol"].includes(k), `sources[${i}] origin.${k} não permitido`);
    }
    const hasBundle = typeof item.origin.bundle === "string" && item.origin.bundle.length > 0;
    const hasAddress = /^0x[0-9a-fA-F]+$/.test(item.origin.address || "");
    assert(hasBundle || hasAddress, `sources[${i}] origin exige bundle ou address`);
    assert(
      sourceSchema.properties.recoveryMethod.enum.includes(item.recoveryMethod),
      `sources[${i}] recoveryMethod inválido`,
    );
  }
  if (doc.notes !== undefined) assert(typeof doc.notes === "string", "notes deve ser string");
}

async function sha256(file) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function main() {
  if (!fs.existsSync(schemaPath)) {
    fail(`Schema obrigatório ausente: ${schemaPath}. Configure --schema ou PROVENANCE_SCHEMA.`);
  }
  const schema = JSON.parse(await fs.promises.readFile(schemaPath, "utf8"));
  validateSchema(schema);

  const sources = [];
  const missing = [];

  for (const group of artifactGroups) {
    if (!fs.existsSync(group.root) || !fs.statSync(group.root).isDirectory()) {
      fail(
        `Fonte obrigatória ausente: ${group.root}. `
          + "Configure --research-root / --docs-root / --cursor-app-root "
          + "(ou variáveis documentadas no cabeçalho). Não há fallback externo.",
      );
    }
    for (const relative of group.files) {
      const file = path.join(group.root, relative);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        missing.push(`${group.prefix}/${relative}`);
        continue;
      }
      sources.push({
        artifactSha256: await sha256(file),
        artifactPath: `${group.prefix}/${relative}`,
        cursorVersion: "3.24.18",
        origin: group.originFor(relative),
        recoveryMethod: group.method,
      });
    }
  }

  if (missing.length) {
    fail(
      `Arquivos de fonte obrigatórios ausentes (${missing.length}):\n- ${missing.join("\n- ")}\n`
        + "Nenhum item foi omitido; restaure as fontes ou corrija as raízes.",
    );
  }

  const inventory = {
    $schema: schemaUri,
    schemaVersion: 1,
    module: moduleId,
    strategy: "behavioral-reimplementation",
    sources,
    license: { spdx: "MIT" },
    containsCursorBrandAssets: false,
    notes:
      "Inventário agregado de metadados das fontes do Cursor 3.24.18 (ADR-002/ADR-007). "
      + "Artefatos proprietários não são redistribuídos; hashes só são emitidos quando a fonte completa está disponível. "
      + "Formato alinhado ao provenance.schema.json da task_01.",
  };

  validateInventory(inventory, schema);
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
  process.stdout.write(
    `Inventariadas ${sources.length} fontes em ${path.relative(repositoryRoot, outputPath)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
