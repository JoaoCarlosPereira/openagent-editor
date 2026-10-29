import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { launchBrowserWorker } from "../../src/browser/browser-worker-launcher.js";

async function startLocalHttpServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end("<p>ok</p>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test.describe("launchBrowserWorker aplica a sandbox nativa detectada (ADR-006)", { concurrency: 1 }, () => {
  test("host com bubblewrap/unshare disponível: worker roda com isolamento nativo real", async (t) => {
    const probe = (await import("../../src/sandbox/linux-sandbox-probe.js")).probeLinuxSandbox();
    if (process.platform !== "linux" || !probe.nativeAvailable) {
      t.skip("bubblewrap/unshare indisponível neste host; sem isolamento nativo para validar.");
      return;
    }
    const { url, close } = await startLocalHttpServer();
    const worker = await launchBrowserWorker();
    try {
      assert.equal(worker.sandbox.level, "native");
      assert.equal(worker.sandbox.nativePrimitive, probe.primitive);
      // O worker lançado dentro do wrapper nativo ainda deve navegar e responder via CDP real.
      const targets = await worker.transport.send("Target.createTarget", { url });
      assert.ok(typeof targets["targetId"] === "string" && targets["targetId"]);
    } finally {
      await worker.terminate();
      await close();
    }
  });

  test("host degradado (sem sandbox nativa): cai para --no-sandbox do Chrome como fallback documentado", async () => {
    const { url, close } = await startLocalHttpServer();
    const worker = await launchBrowserWorker({
      sandboxOptions: {
        linuxProbe: () => ({ nativeAvailable: false, primitive: null, unshareUserNsAvailable: false }),
        platform: "linux",
      },
    });
    try {
      assert.equal(worker.sandbox.level, "degraded");
      assert.ok(worker.sandbox.degradationNotice && worker.sandbox.degradationNotice.length > 0);
      const targets = await worker.transport.send("Target.createTarget", { url });
      assert.ok(typeof targets["targetId"] === "string" && targets["targetId"]);
    } finally {
      await worker.terminate();
      await close();
    }
  });

  test("sandbox snapshot reportado é exposto no BrowserWorkerProcess retornado", async () => {
    const worker = await launchBrowserWorker({
      sandboxOptions: {
        linuxProbe: () => ({ nativeAvailable: true, primitive: "bubblewrap", unshareUserNsAvailable: true }),
        platform: "linux",
      },
    });
    try {
      assert.equal(worker.sandbox.level, "native");
      assert.equal(worker.sandbox.nativePrimitive, "bubblewrap");
    } finally {
      await worker.terminate();
    }
  });
});
