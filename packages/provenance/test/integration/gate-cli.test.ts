import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const script = join(root, "scripts/check-provenance-gate.mjs");

test("CLI verifica raízes padrão e parcial, ausência e manifesto inválido", async () => {
  const dir = await mkdtemp(join(tmpdir(), "provenance-cli-"));
  try {
    await mkdir(join(dir, "scripts"), { recursive: true });
    await mkdir(join(dir, "packages/extension-api"), { recursive: true });
    await mkdir(join(dir, "services/extension-host"), { recursive: true });
    await copyFile(script, join(dir, "scripts/check-provenance-gate.mjs"));
    await symlink(join(root, "node_modules"), join(dir, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    await writeFile(join(dir, "package.json"), '{"type":"module"}');
    const manifest = {
      schemaVersion: 1,
      module: "packages/extension-api",
      strategy: "behavioral-reimplementation",
      sources: [{
        artifactSha256: "1".repeat(64),
        artifactPath: "fixture.js",
        cursorVersion: "3.24.18",
        origin: { bundle: "fixture.js" },
        recoveryMethod: "runtime-observation",
      }],
      license: { spdx: "MIT" },
      containsCursorBrandAssets: false,
    };
    await writeFile(join(dir, "packages/extension-api/provenance.json"), JSON.stringify(manifest));
    const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(dir, "scripts/check-provenance-gate.mjs"), ...args], {
      cwd: dir,
      encoding: "utf8",
    });
    const partial = run("--root", "packages/extension-api");
    assert.equal(partial.status, 0, partial.stderr);
    assert.match(partial.stdout, /1 arquivo\(s\) analisado\(s\), 1 aprovado\(s\)/);
    const missing = run();
    assert.equal(missing.status, 1, missing.stderr);
    assert.match(missing.stderr, /MISSING_PROVENANCE.*services\/extension-host\/provenance\.json/);
    assert.doesNotMatch(missing.stderr, /MISSING_PROVENANCE.*packages\/extension-api/);

    await writeFile(join(dir, "services/extension-host/provenance.json"), JSON.stringify({ ...manifest, module: "services/extension-host" }));
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /2 arquivo\(s\) analisado\(s\), 2 aprovado\(s\)/);

    await mkdir(join(dir, "services/harness-daemon"), { recursive: true });
    await writeFile(join(dir, "services/harness-daemon/provenance.json"), "{}");
    const invalid = run();
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.match(invalid.stderr, /INVALID_SCHEMA.*services\/harness-daemon\/provenance\.json/);
    assert.doesNotMatch(invalid.stderr, /MISSING_PROVENANCE/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
