import test from "node:test";
import assert from "node:assert/strict";

import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import { discoverMcpHttpTools } from "../../src/mcp/discover-mcp-http-tools.js";
import { parseMcpHttpServerEndpoint } from "../../src/mcp/mcp-http-config.js";
import { withMcpHttpDiscoveryServer } from "../fixtures/mcp-http-discovery-server.mjs";

test("[MCP-01] discoverMcpHttpTools lista ferramentas de servidor HTTP de fixture", async () => {
  await withMcpHttpDiscoveryServer(async (mcpUrl: string) => {
    const result = await discoverMcpHttpTools({
      serverId: "fixture-http",
      url: mcpUrl,
    });

    assert.equal(result.transport, "http");
    assert.equal(result.serverId, "fixture-http");
    assert.ok(result.tools.length >= 2);

    const names = result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ["addNumbers", "ping"]);

    const ping = result.tools.find((tool) => tool.name === "ping");
    assert.ok(ping);
    assert.ok(ping.inputSchema !== undefined);
  });
});

test("[MCP-01] caminho de erro: configuração HTTP inválida retorna INVALID_STATE sem conectar", async () => {
  assert.throws(
    () =>
      parseMcpHttpServerEndpoint({
        serverId: "x",
        url: "ftp://example.com/mcp",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  await assert.rejects(
    discoverMcpHttpTools({ serverId: "", url: "http://127.0.0.1:9/mcp" }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});

test("[MCP-01] parseMcpHttpServerEndpoint normaliza URL e cabeçalhos", () => {
  const parsed = parseMcpHttpServerEndpoint({
    serverId: "  demo  ",
    url: "  http://127.0.0.1:8080/mcp  ",
    headers: { Authorization: "Bearer test" },
  });

  assert.equal(parsed.serverId, "demo");
  assert.equal(parsed.url, "http://127.0.0.1:8080/mcp");
  assert.deepEqual(parsed.headers, { Authorization: "Bearer test" });
});
