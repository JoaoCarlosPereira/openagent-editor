import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("gravação externa durante preparação impede substituição e remove temporário", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "openagent-save-race-"));
  const file = path.join(root, "a.txt");
  writeFileSync(file, "original");
  const original = fs.fsyncSync;
  try {
    t.mock.method(fs, "fsyncSync", (fd: number) => {
      original(fd);
      const writer = spawnSync(process.execPath, ["-e", "require('fs').writeFileSync(process.argv[1], 'externo')", file]);
      assert.equal(writer.status, 0);
    });
    syncBuiltinESMExports();
    const { openTextEditorDocument, applyTextEditorEdit, saveTextEditorDocument } =
      await import("../../src/workbench/text-editor.js");
    const document = applyTextEditorEdit(openTextEditorDocument(root, "a.txt"), "local");
    assert.throws(() => saveTextEditorDocument(root, document), /alterado fora/);
    assert.equal(readFileSync(file, "utf8"), "externo");
    assert.deepEqual(readdirSync(root), ["a.txt"]);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});
