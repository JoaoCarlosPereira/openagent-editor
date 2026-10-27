#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const externalResearchRoot = path.resolve(repositoryRoot, "..", "..", "openagent-editor", "research");
const researchRoot = fs.existsSync(path.join(repositoryRoot, "research", "reverse-engineering"))
  ? path.join(repositoryRoot, "research")
  : externalResearchRoot;
const reverseEngineeringRoot = path.join(researchRoot, "reverse-engineering", "cursor-3.24.18");
const docsRoot = path.resolve(repositoryRoot, "..", "..", "openagent-editor", "sources", "cursor");
const windowsInstallRoot = process.env.CURSOR_3_24_18_APP_ROOT
  || "/mnt/Dados/dsv/REA/artifacts/windows-3.24.18/code$GetDestDir/resources/app";
const outputPath = path.join(
  repositoryRoot,
  "research",
  "provenance",
  "cursor-3.24.18.inventory.json",
);

const sources = [
  {
    root: reverseEngineeringRoot,
    prefix: "research/reverse-engineering/cursor-3.24.18",
    type: "pseudocódigo nativo",
    recoveryMethod: "ghidra-export",
    files: ["README.md", "pseudocode/functions.c", "pseudocode/manifest.tsv", "pseudocode/failures.tsv", "pseudocode/summary.txt"],
  },
  {
    root: docsRoot,
    prefix: "sources/cursor",
    type: "doc",
    recoveryMethod: "public-docs",
    files: ["manifest.json", "docs/agent/overview.md", "docs/agent/plan-mode.md", "docs/agent/debug-mode.md", "docs.md", "changelog.html"],
  },
];

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function inventoryFile(source, relativeFile) {
  const artifactPath = path.join(source.root, relativeFile);
  const metadata = await fs.promises.stat(artifactPath);
  return {
    artifactSha256: await sha256(artifactPath),
    artifactPath: `${source.prefix}/${relativeFile}`,
    sizeBytes: metadata.size,
    type: source.type,
    cursorVersion: "3.24.18",
    origin: {
      bundle: `${source.prefix}/${relativeFile}`,
    },
    recoveryMethod: source.recoveryMethod,
    license: "LicenseRef-Cursor-Source",
    strategy: "behavioral-reimplementation",
  };
}

async function main() {
  const artifacts = [];
  for (const source of sources) {
    for (const relativeFile of source.files) {
      if (!fs.existsSync(path.join(source.root, relativeFile))) continue;
      const fileType = relativeFile.endsWith(".md") ? "doc" : source.type;
      artifacts.push(await inventoryFile({ ...source, type: fileType }, relativeFile));
    }
  }

  const bundleSources = [
    {
      root: windowsInstallRoot,
      path: "out/vs/workbench/workbench.desktop.main.js",
    },
    {
      root: windowsInstallRoot,
      path: "extensions/cursor-agent-exec/dist/main.js",
    },
  ];
  for (const bundle of bundleSources) {
    const filePath = path.join(bundle.root, bundle.path);
    if (!fs.existsSync(filePath)) continue;
    const artifactPath = `resources/app/${bundle.path}`;
    artifacts.push({
      artifactSha256: await sha256(filePath),
      artifactPath,
      sizeBytes: (await fs.promises.stat(filePath)).size,
      type: "bundle JS",
      cursorVersion: "3.24.18",
      origin: { bundle: artifactPath },
      recoveryMethod: "bundle-js",
      license: "LicenseRef-Cursor-Source",
      strategy: "behavioral-reimplementation",
      notes: "Artefato de consulta não distribuído; registrado por bundle.",
    });
  }

  const inventory = {
    schemaVersion: 1,
    cursorVersion: "3.24.18",
    defaultStrategy: "behavioral-reimplementation",
    aggregation: {
      criterion: "Um item por arquivo representativo e por artefato/bundle. O pseudocódigo nativo de ~1,2 GB é identificado por arquivo, nunca por função.",
      nativeFunctionsVisited: 536750,
      nativeFunctionsExported: 536634,
      nativeExportFailures: 116,
      sourceRoots: [...sources.map((source) => source.prefix), "resources/app", "runtime-observation/cursor-3.24.18"],
    },
    artifacts,
  };

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
  process.stdout.write(`Inventariados ${artifacts.length} itens em ${path.relative(repositoryRoot, outputPath)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
