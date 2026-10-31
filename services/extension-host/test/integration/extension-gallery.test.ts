import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { createVsixArchive, IsolatedExtensionHost } from "../../src/index.js";

test("galeria instala VSIX e rejeita erros sem publicação", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gallery-test-"));
  const workspaceRoot = path.join(root, "workspace");
  const extensionsDirectory = path.join(root, "extensions");
  fs.mkdirSync(workspaceRoot);
  fs.mkdirSync(extensionsDirectory);
  const archive = createVsixArchive({
    "extension/package.json": JSON.stringify({ publisher: "pub", name: "sample", version: "1.0.0", engines: { vscode: "*" }, main: "./index.js" }),
    "extension/index.js": "exports.activate = () => ({ gallery: true });",
  });
  let mode = "ok";
  const server = http.createServer((req, res) => {
    if (req.url === "/api/pub/sample/1.0.0") {
      res.end(JSON.stringify({ namespace: "pub", name: "sample", version: "1.0.0", files: { download: mode === "unsafe" ? "file:///etc/passwd" : "/package" } }));
    } else if (req.url === "/package") {
      if (mode === "redirect") res.writeHead(302, { location: "http://127.0.0.1:9/private" }).end();
      else res.end(mode === "corrupt" ? "not a vsix" : archive);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const galleryUrl = `http://127.0.0.1:${address.port}`;
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot, extensionsDirectory });
  try {
    const reject = (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE;
    for (mode of ["unsafe", "corrupt", "redirect"]) {
      await assert.rejects(host.installFromGallery("pub.sample", { version: "1.0.0", galleryUrl }), reject);
      assert.deepEqual(host.listExtensions(), []);
      assert.deepEqual(fs.readdirSync(extensionsDirectory), []);
    }
    await assert.rejects(host.installFromGallery("../escape", { galleryUrl }), reject);
    await assert.rejects(host.installFromGallery("pub.missing", { galleryUrl }), reject);
    mode = "ok";
    const result = await host.installFromGallery("pub.sample", { version: "1.0.0", galleryUrl });
    assert.equal(result.id, "pub.sample");
    assert.deepEqual((await host.activateExtension("pub.sample")).exports, { gallery: true });
  } finally {
    await host.terminate();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
