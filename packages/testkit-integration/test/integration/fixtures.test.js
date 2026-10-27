"use strict";

const assert = require("node:assert/strict");
const { access, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { runProcess, withTempDir } = require("../../src");

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

test("timeout encerra o processo e registra o timeout", async () => {
  const result = await runProcess(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { timeoutMs: 100 },
  );

  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
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
