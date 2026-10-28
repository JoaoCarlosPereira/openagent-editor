import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspaceDatabase } from "@openagent/storage";
import { filterExistingAttachmentsJson } from "../../src/sessions/session-resume.js";

test("[SES-01] filterExistingAttachmentsJson remove anexos com blob ausente", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-resume-filter-"));
  const workspaceId = "ws-filter";
  try {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const put = db.putCasBlob(Buffer.from("ok", "utf8"));
    const filtered = filterExistingAttachmentsJson(
      db,
      JSON.stringify([
        { id: "a", contentRef: put.contentRef },
        { id: "b", contentRef: "sha256:missing" },
        { id: "c", kind: "selection" },
      ]),
    );
    db.close();
    assert.deepEqual(JSON.parse(filtered), [
      { id: "a", contentRef: put.contentRef },
      { id: "c", kind: "selection" },
    ]);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
