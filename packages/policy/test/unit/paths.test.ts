import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import test from "node:test";
import assert from "node:assert/strict";

import { PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import {
  formatOutOfScopePathLog,
  isAbsolutePathInsideRoot,
  OUT_OF_SCOPE_PATH_LOG_MESSAGE,
  resolveCanonicalWorkspacePath,
  validateWorkspacePathInputs,
} from "../../src/paths.js";

function withTempWorkspace(
  setup: (root: string, outside: string) => void,
  run: (root: string) => void,
): void {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-policy-paths-"));
  const workspace = path.join(base, "workspace");
  const outside = path.join(base, "outside");
  fs.mkdirSync(workspace);
  fs.mkdirSync(outside);
  try {
    setup(workspace, outside);
    run(workspace);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test("[ERR-02] Caminho relativo dentro do workspace é canonicalizado", () => {
  withTempWorkspace(
    (root) => {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "src", "app.ts"), "ok");
    },
    (root) => {
      const result = resolveCanonicalWorkspacePath(root, "src/app.ts");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(
          result.canonicalPath,
          fs.realpathSync.native(path.join(root, "src", "app.ts")),
        );
      }
    },
  );
});

test("[ERR-02] Caminho fora do workspace retorna OUT_OF_SCOPE e mensagem estável", () => {
  withTempWorkspace(
    (_root, outside) => {
      fs.writeFileSync(path.join(outside, "secret.txt"), "x");
    },
    (root) => {
      const outsideFile = path.join(path.dirname(root), "outside", "secret.txt");
      const result = resolveCanonicalWorkspacePath(root, outsideFile);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
        assert.equal(result.error.message, OUT_OF_SCOPE_PATH_LOG_MESSAGE);
        assert.deepEqual(result.error.details, [OUT_OF_SCOPE_PATH_LOG_MESSAGE]);
        assert.equal(formatOutOfScopePathLog(result.error), OUT_OF_SCOPE_PATH_LOG_MESSAGE);
      }
    },
  );
});

test("[ERR-02] Symlink que aponta para fora do workspace é negado", () => {
  withTempWorkspace(
    (root, outside) => {
      fs.writeFileSync(path.join(outside, "leak.txt"), "secret");
      fs.symlinkSync(path.join(outside, "leak.txt"), path.join(root, "link.txt"));
    },
    (root) => {
      const result = resolveCanonicalWorkspacePath(root, "link.txt");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
      }
    },
  );
});

test("[ERR-02] Entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
  const invalid = validateWorkspacePathInputs("", "src/a.ts");
  assert.equal(invalid.valid, false);
  if (!invalid.valid) {
    assert.equal(invalid.code, "INVALID_STATE");
  }
});

test("isAbsolutePathInsideRoot reprova prefixo irmão", () => {
  assert.equal(
    isAbsolutePathInsideRoot("/project", "/project/src/file.js"),
    true,
  );
  assert.equal(
    isAbsolutePathInsideRoot("/project", "/project-other/file.js"),
    false,
  );
});
