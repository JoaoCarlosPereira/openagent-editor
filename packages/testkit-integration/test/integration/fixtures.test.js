"use strict";

const assert = require("node:assert/strict");
const { access, readFile, writeFile, mkdir } = require("node:fs/promises");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");
const { runProcess, withTempDir } = require("../../src");
const { discoverIntegrationTests } = require("../../../../scripts/test-integration");

// SPEC_DEVIATION: a validacao literal do editor instalado fica para os cards downstream de produto e empacotamento.
test("tmpdir e processo funcionam juntos em uma integração real", async () => {
  await withTempDir(async (directory) => {
    const target = path.join(directory, "resultado.txt");
    const script = [
      "const fs = require('node:fs');",
      "fs.writeFileSync(process.argv[1], 'resultado integrado');",
      "process.stdout.write('arquivo gravado');",
    ].join("");

    const result = await runProcess(process.execPath, ["-e", script, target], { cwd: directory });

    assert.equal(result.code, 0);
    assert.equal(result.stdout, "arquivo gravado");
    assert.equal(result.stderr, "");
    assert.equal(await readFile(target, "utf8"), "resultado integrado");
  });
});

test("fixture remove tmpdir mesmo quando o teste falha", async () => {
  let directory;
  await assert.rejects(
    withTempDir(async (tempDirectory) => {
      directory = tempDirectory;
      await writeFile(path.join(tempDirectory, "arquivo.txt"), "temporario");
      throw new Error("falha simulada");
    }),
    /falha simulada/,
  );

  assert.ok(directory);
  await assert.rejects(access(directory));
});

test("runner descobre testes recursivamente nos padrões de packages e services", async () => {
  await withTempDir(async (root) => {
    for (const location of [
      "packages/a/test/integration/nested/one.test.js",
      "services/b/test/integration/nested/two.test.ts",
    ]) {
      const file = path.join(root, location);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "");
    }

    assert.deepEqual(
      discoverIntegrationTests(root).map((file) => path.relative(root, file).split(path.sep).join("/")),
      [
        "packages/a/test/integration/nested/one.test.js",
        "services/b/test/integration/nested/two.test.ts",
      ],
    );
  });
});

test("runner falha com código não zero quando não encontra testes", async () => {
  await withTempDir(async (root) => {
    const result = spawnSync(process.execPath, ["-e", "process.exitCode = require(process.argv[1]).main(process.argv[2])", require.resolve("../../../../scripts/test-integration"), root], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Nenhum teste de integração encontrado/);
  });
});

test("runner propaga falha de teste com código não zero", async () => {
  await withTempDir(async (root) => {
    const testFile = path.join(root, "packages/example/test/integration/failure.test.js");
    await mkdir(path.dirname(testFile), { recursive: true });
    await writeFile(testFile, "const test = require('node:test'); test('falha', () => { throw new Error('falha esperada'); });");

    const result = spawnSync(
      process.execPath,
      ["-e", "process.exitCode = require(process.argv[1]).main(process.argv[2])", require.resolve("../../../../scripts/test-integration"), root],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /not ok 1/);
  });
});

test("runner executa teste TypeScript descoberto recursivamente", async () => {
  await withTempDir(async (root) => {
    const testFile = path.join(root, "services/example/test/integration/nested/passing.test.ts");
    await mkdir(path.dirname(testFile), { recursive: true });
    await writeFile(testFile, "import test from 'node:test'; import assert from 'node:assert/strict'; test('tsx', () => assert.equal(2 + 2, 4));");

    const result = spawnSync(
      process.execPath,
      ["-e", "process.exitCode = require(process.argv[1]).main(process.argv[2])", require.resolve("../../../../scripts/test-integration"), root],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /# tests 1/);
  });
});

test("timeout encerra a árvore de processos e confirma saída dos PIDs", async () => {
  await withTempDir(async (directory) => {
    const pidFile = path.join(directory, "descendant.pid");
    const script = [
      "const fs = require('node:fs');",
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      "fs.writeFileSync(process.argv[1], String(child.pid));",
      "setInterval(() => {}, 1000);",
    ].join("");

    const result = await runProcess(process.execPath, ["-e", script, pidFile], {
      cwd: directory,
      timeoutMs: 300,
      terminationGraceMs: 100,
    });
    assert.equal(result.timedOut, true);
    assert.notEqual(result.code, 0);

    const descendantPid = Number(await readFile(pidFile, "utf8"));
    const assertProcessExited = async (pid) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        try {
          if (process.platform === "linux") {
            const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch((error) => {
              if (error.code === "ENOENT") return null;
              throw error;
            });
            if (stat === null || stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3).match(/[ZX]/)) return;
          } else if (process.platform !== "win32") {
            process.kill(pid, 0);
          } else {
            const { spawnSync } = require("node:child_process");
            const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
            if (result.error) throw result.error;
            if (!result.stdout.includes(String(pid))) return;
          }
        } catch (error) {
          if (error.code === "ESRCH") return;
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail(`O processo ${pid} continuou ativo após o timeout.`);
    };

    await assertProcessExited(result.pid);
    await assertProcessExited(descendantPid);
  });
});

test("processo com falha preserva código, stdout e stderr", async () => {
  const result = await runProcess(
    process.execPath,
    ["-e", "process.stdout.write('saida'); process.stderr.write('erro'); process.exitCode = 7"],
  );

  assert.equal(result.code, 7);
  assert.equal(result.stdout, "saida");
  assert.equal(result.stderr, "erro");
});
