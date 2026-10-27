const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "..");
const inventoryPath = path.join(
  repositoryRoot,
  "research",
  "provenance",
  "cursor-3.24.18.inventory.json",
);
const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));

test("inventário contém metadados válidos de proveniência", () => {
  assert.ok(Array.isArray(inventory.artifacts));
  assert.ok(inventory.artifacts.length > 0);

  const paths = new Set();
  for (const item of inventory.artifacts) {
    assert.equal(typeof item.artifactSha256, "string");
    assert.match(item.artifactSha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof item.artifactPath, "string");
    assert.ok(item.artifactPath.length > 0);
    assert.ok(!paths.has(item.artifactPath), `caminho duplicado: ${item.artifactPath}`);
    paths.add(item.artifactPath);

    assert.equal(item.cursorVersion, "3.24.18");
    assert.ok(["bundle-js", "ghidra-export", "runtime-observation", "public-docs"].includes(item.recoveryMethod));
    assert.ok(["bundle JS", "pseudocódigo nativo", "doc"].includes(item.type));
    assert.ok(Number.isSafeInteger(item.sizeBytes) && item.sizeBytes >= 0);
    assert.equal(item.strategy, "behavioral-reimplementation");
    assert.ok(item.license);
    assert.ok(item.origin);

    const sourcePath = resolveArtifactPath(item.artifactPath);
    if (sourcePath) {
      const bytes = fs.readFileSync(sourcePath);
      assert.equal(bytes.length, item.sizeBytes);
      assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), item.artifactSha256);
    }
  }
});

function resolveArtifactPath(artifactPath) {
  const candidates = [
    path.join(repositoryRoot, artifactPath),
    path.join(repositoryRoot, "..", "openagent-editor", artifactPath),
    path.join("/mnt/Dados/dsv/REA/artifacts/windows-3.24.18/code$GetDestDir", artifactPath),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}
