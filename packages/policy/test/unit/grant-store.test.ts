import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { WorkspaceGrantStore } from "../../src/grant-store.js";
import type { PermissionGrant } from "../../src/grants.js";

const sampleGrant: PermissionGrant = {
  grantId: "g-1",
  scope: "session",
  capability: "file.write",
  targetPattern: "src/a.ts",
  decision: "allow",
  createdAtMs: 1_700_000_000_000,
  expiresAtMs: 1_700_000_360_000,
  sessionId: "sess-a",
  workspaceId: "ws-a",
  consumed: false,
};

test("WorkspaceGrantStore persiste e recarrega grants", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-grant-store-"));
  try {
    const store = new WorkspaceGrantStore(dataRoot, "ws-a");
    store.persistGrant(sampleGrant);
    const reopened = new WorkspaceGrantStore(dataRoot, "ws-a");
    assert.deepEqual(reopened.getGrant("g-1"), sampleGrant);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
