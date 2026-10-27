import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);
const runnerPath = join(repositoryRoot, "scripts/run-unit-tests.mjs");
const nodeModulesPath = join(repositoryRoot, "node_modules");

async function runRunner(
  setup: (root: string) => Promise<void>,
): Promise<{ status: number | null; output: string }> {
  const root = await mkdtemp(join(tmpdir(), "openagent-unit-runner-"));

  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(
      join(root, "scripts/run-unit-tests.mjs"),
      await readFile(runnerPath, "utf8"),
    );
    await symlink(nodeModulesPath, join(root, "node_modules"), "junction");
    await setup(root);

    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/run-unit-tests.mjs")],
      { cwd: root, encoding: "utf8" },
    );
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeFixture(
  root: string,
  relativePath: string,
  source: string,
): Promise<void> {
  const filePath = join(root, relativePath);
  await mkdir(filePath.slice(0, filePath.lastIndexOf("/")), {
    recursive: true,
  });
  await writeFile(filePath, source);
}

test("descobre testes packages e services/unit com extensao .ts", async () => {
  const result = await runRunner(async (root) => {
    await writeFixture(
      root,
      "packages/example/test/nested/package.test.ts",
      'import test from "node:test"; test("package", () => {});',
    );
    await writeFixture(
      root,
      "services/example/test/unit/nested/runner.ts",
      'import test from "node:test"; test("service", () => {});',
    );
  });

  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /# tests 2/);
  assert.match(result.output, /# pass 2/);
});

test("falha com mensagem explicita quando nao ha testes", async () => {
  const result = await runRunner(async () => {});

  assert.equal(result.status, 1);
  assert.match(result.output, /Nenhum teste unitário encontrado\./);
});

test("retorna zero quando o teste encontrado passa", async () => {
  const result = await runRunner((root) =>
    writeFixture(
      root,
      "packages/example/test/runner.test.ts",
      'import test from "node:test"; test("passa", () => {});',
    ),
  );

  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /# pass 1/);
  assert.match(result.output, /# fail 0/);
});

test("propaga falha e codigo diferente de zero quando teste falha", async () => {
  const result = await runRunner((root) =>
    writeFixture(
      root,
      "services/example/test/unit/runner.ts",
      'import test from "node:test"; test("falha", () => { throw new Error("falha-fixture"); });',
    ),
  );

  assert.notEqual(result.status, 0);
  assert.match(result.output, /falha-fixture/);
  assert.match(result.output, /# fail 1/);
});
