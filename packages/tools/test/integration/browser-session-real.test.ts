import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { AuthorizedBrowserSession } from "../../src/browser/browser-session.js";
import { CdpTargetManager } from "../../src/browser/cdp-target-manager.js";
import { WebSocketCdpTransport } from "../../src/browser/cdp-transport.js";

test("browser real: abertura, permissão, clique, evidência e cancelamento", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openagent-browser-"));
  let redirectDestinationRequests = 0;
  let slowStarted: () => void = () => {};
  const slowRequest = new Promise<void>((resolve) => { slowStarted = resolve; });
  const server = createServer((request, response) => {
    if (request.url === "/slow") {
      slowStarted();
      request.on("close", () => response.destroy());
      return;
    }
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/redirect-destination" });
      response.end();
      return;
    }
    if (request.url === "/redirect-destination") redirectDestinationRequests++;
    response.setHeader("content-type", "text/html");
    response.end('<button id="ok" onclick="this.textContent=\'clicado\'; console.log(\'clicou\')">original</button>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  const chrome = spawn("/usr/bin/google-chrome", [
    "--headless", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=0",
    `--user-data-dir=${dir}`, "about:blank",
  ], { stdio: "ignore" });
  let browser: AuthorizedBrowserSession | undefined;
  try {
    let endpoint = "";
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const [port, path] = (await readFile(join(dir, "DevToolsActivePort"), "utf8")).trim().split("\n");
        endpoint = `ws://127.0.0.1:${port}${path}`;
        break;
      } catch {
        await delay(50);
      }
    }
    assert.ok(endpoint, "Chrome não iniciou o endpoint CDP");
    const transport = new WebSocketCdpTransport(endpoint);
    await transport.connect();
    browser = new AuthorizedBrowserSession("run-1", "session-1",
      { agentMode: "agent", executionMode: "standard" }, new CdpTargetManager(transport));
    browser.prepare("open", { type: "open", url });
    browser.decide("open", "allow");
    const opened = await browser.execute("open");
    assert.equal(Buffer.from(opened.screenshot, "base64").subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    await delay(200);
    browser.prepare("deny", { type: "click", targetId: opened.targetId, url, selector: "#ok" });
    browser.decide("deny", "deny");
    await assert.rejects(browser.execute("deny"), { code: "OUT_OF_SCOPE" });
    const targets = await transport.send("Target.getTargets");
    const target = (targets["targetInfos"] as Array<{ targetId: string }>).find((item) => item.targetId === opened.targetId);
    assert.ok(target);
    const attached = await transport.send("Target.attachToTarget", { targetId: opened.targetId, flatten: true });
    const inspect = async () => transport.send("Runtime.evaluate", {
      expression: "document.querySelector('#ok').textContent", returnByValue: true,
    }, String(attached["sessionId"]));
    assert.equal(((await inspect())["result"] as { value: string }).value, "original");
    assert.throws(() => browser?.prepare("wrong-target", {
      type: "click", targetId: "wrong", url, selector: "#ok",
    }), { code: "INVALID_STATE" });
    const action = { type: "click" as const, targetId: opened.targetId, url, selector: "#ok" };
    browser.prepare("click", action);
    action.selector = "#missing";
    browser.decide("click", "allow");
    const clicked = await browser.execute("click");
    assert.equal(clicked.targetId, opened.targetId);
    assert.ok(clicked.consoleLogs.some((entry) => entry.text === "clicou"));
    assert.equal(((await inspect())["result"] as { value: string }).value, "clicado");
    browser.prepare("missing", { type: "click", targetId: opened.targetId, url, selector: "#missing" });
    browser.decide("missing", "allow");
    await assert.rejects(browser.execute("missing"), { code: "INVALID_STATE" });
    assert.equal(browser.getEvidence().length, 2);
    await browser.close();
    assert.throws(() => browser?.prepare("later", { type: "open", url }), { code: "CANCELLED" });
    const redirectTransport = new WebSocketCdpTransport(endpoint);
    await redirectTransport.connect();
    const redirected = new AuthorizedBrowserSession("run-2", "session-2",
      { agentMode: "agent", executionMode: "standard" }, new CdpTargetManager(redirectTransport));
    try {
      redirected.prepare("redirect", { type: "open", url: `${url}redirect` });
      redirected.decide("redirect", "allow");
      await assert.rejects(redirected.execute("redirect"), { code: "OUT_OF_SCOPE" });
      assert.equal(redirectDestinationRequests, 0);
      assert.equal(redirected.getEvidence().length, 0);
    } finally {
      await redirected.close();
    }
    const slowTransport = new WebSocketCdpTransport(endpoint);
    await slowTransport.connect();
    const slow = new AuthorizedBrowserSession("run-3", "session-3",
      { agentMode: "agent", executionMode: "standard" }, new CdpTargetManager(slowTransport));
    try {
      slow.prepare("slow", { type: "open", url: `${url}slow` });
      slow.decide("slow", "allow");
      const operation = slow.execute("slow");
      const failure = assert.rejects(operation);
      await slowRequest;
      const before = Date.now();
      await slow.close();
      await failure;
      assert.ok(Date.now() - before < 2_000, "Cancelamento excedeu dois segundos.");
      assert.equal(slow.getEvidence().length, 0);
      assert.throws(() => slow.prepare("after-cancel", { type: "open", url }), { code: "CANCELLED" });
    } finally {
      await slow.close();
    }
  } finally {
    await browser?.close();
    chrome.kill("SIGKILL");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
