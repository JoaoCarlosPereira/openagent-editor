import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { executeContextSendRpc } from "../../src/index.js";

function fixtureWorkspace(): { root: string; publicPath: string; secretPath: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-prv01-"));
  writeFileSync(path.join(root, ".gitignore"), "secrets/\n");
  mkdirSync(path.join(root, "secrets"), { recursive: true });
  mkdirSync(path.join(root, "src"), { recursive: true });
  const publicPath = "src/open.ts";
  const secretPath = "secrets/token.txt";
  writeFileSync(path.join(root, publicPath), "export const visible = true;\n");
  writeFileSync(path.join(root, secretPath), "super-secret-token\n");
  return { root, publicPath, secretPath };
}

test("[PRV-01] executeContextSendRpc só envia após explicitSendAcknowledged", () => {
  assert.throws(
    () =>
      executeContextSendRpc({
        attachments: [
          {
            id: "file-1",
            kind: "file",
            path: "/proj/a.ts",
            previewText: "const x = 1;",
          },
        ],
        messageText: "pergunta",
        explicitSendAcknowledged: false,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      assert.match(error.message, /confirmação explícita/i);
      return true;
    },
  );

  const result = executeContextSendRpc({
    attachments: [
      {
        id: "file-1",
        kind: "file",
        path: "/proj/a.ts",
        previewText: "const x = 1;",
      },
    ],
    messageText: "pergunta",
    explicitSendAcknowledged: true,
  });

  assert.match(result.content, /pergunta/);
  assert.match(result.content, /const x = 1;/);
  assert.deepEqual(result.includedPaths, ["/proj/a.ts"]);
  assert.ok(result.totalTokenCount > result.messageTokenCount);
});

test("[PRV-01] executeContextSendRpc não inclui caminho excluído no payload externo", () => {
  const { root, publicPath, secretPath } = fixtureWorkspace();

  const result = executeContextSendRpc(
    {
      attachments: [
        {
          id: "pub",
          kind: "file",
          path: path.join(root, publicPath),
          previewText: "export const visible = true;",
        },
        {
          id: "sec",
          kind: "file",
          path: path.join(root, secretPath),
          previewText: "super-secret-token",
        },
      ],
      messageText: "analise",
      explicitSendAcknowledged: true,
    },
    { workspaceRoot: root },
  );

  assert.equal(result.includedPaths.length, 1);
  assert.match(result.includedPaths[0] ?? "", /open\.ts$/);
  assert.match(result.content, /visible/);
  assert.doesNotMatch(result.content, /super-secret-token/);
  assert.doesNotMatch(result.content, /secrets\/token\.txt/);
});

test("[PRV-01] entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
  assert.throws(
    () =>
      executeContextSendRpc({
        attachments: [{ id: "bad", kind: "file", path: "" }],
        explicitSendAcknowledged: true,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});
