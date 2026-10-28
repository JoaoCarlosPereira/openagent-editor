import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  applyLocalCustomizationInvocation,
  mergeLocalCustomizationAssetsByPrecedence,
  parseLocalCustomizationInvokeRef,
  type LoadedLocalCustomizationAsset,
} from "../../src/index.js";

test("[CUS-02] invoca skill aplicando instrução e retornando origem", () => {
  const assets: LoadedLocalCustomizationAsset[] = [
    {
      id: "commit",
      kind: "skill",
      layer: "user",
      origin: "~/.cursor/skills/commit/SKILL.md",
      instruction: "Gere commits descritivos.",
      precedence: 1,
    },
  ];

  const result = applyLocalCustomizationInvocation(assets, "skill:commit");
  assert.equal(result.instruction, "Gere commits descritivos.");
  assert.equal(result.display.origin, "~/.cursor/skills/commit/SKILL.md");
  assert.equal(result.display.kind, "skill");
});

test("[CUS-02] projeto sobrescreve skill de usuário com o mesmo id", () => {
  const user: LoadedLocalCustomizationAsset[] = [
    {
      id: "review",
      kind: "skill",
      layer: "user",
      origin: "~/.cursor/skills/review/SKILL.md",
      instruction: "user",
      precedence: 1,
    },
  ];
  const project: LoadedLocalCustomizationAsset[] = [
    {
      id: "review",
      kind: "skill",
      layer: "project",
      origin: ".cursor/skills/review/SKILL.md",
      instruction: "project",
      precedence: 2,
    },
  ];

  const merged = mergeLocalCustomizationAssetsByPrecedence(user, project);
  const result = applyLocalCustomizationInvocation(merged, "skill:review");
  assert.equal(result.instruction, "project");
  assert.equal(result.display.layer, "project");
});

test("[CUS-02] caminho de erro: referência inválida retorna INVALID_STATE", () => {
  assert.throws(
    () => parseLocalCustomizationInvokeRef("invalid-ref"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});

test("[CUS-02] caminho de erro: ativo ausente retorna INVALID_STATE sem efeito colateral", () => {
  assert.throws(
    () => applyLocalCustomizationInvocation([], "command:missing"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});
