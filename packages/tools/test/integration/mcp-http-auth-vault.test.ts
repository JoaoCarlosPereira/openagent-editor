import assert from "node:assert/strict";
import test from "node:test";
import {
  createInMemorySystemSecretVault,
  createMcpAuthVaultResolver,
  registerMcpAuthCredential,
} from "@openagent/storage";
import { discoverMcpHttpTools } from "../../src/mcp/discover-mcp-http-tools.js";
import { parseMcpHttpServerEndpoint } from "../../src/mcp/mcp-http-config.js";
import { withMcpHttpDiscoveryServer } from "../fixtures/mcp-http-discovery-server.mjs";

test("[MCP-01] discoverMcpHttpTools usa token do cofre via authSecretRef", async () => {
  const vault = createInMemorySystemSecretVault();
  const accessToken = "vault-mcp-bearer-77";
  const { secretRef } = await registerMcpAuthCredential(
    { serverId: "fixture-http", kind: "bearer", accessToken },
    { vault },
  );
  const resolveAuth = createMcpAuthVaultResolver(vault);

  await withMcpHttpDiscoveryServer(
    async (mcpUrl: string) => {
      const result = await discoverMcpHttpTools(
        {
          serverId: "fixture-http",
          url: mcpUrl,
          authSecretRef: secretRef,
        },
        { resolveAuth },
      );

      assert.equal(result.transport, "http");
      assert.equal(result.serverId, "fixture-http");
      assert.ok(result.tools.some((tool) => tool.name === "ping"));
    },
    { expectedBearer: accessToken },
  );
});

test("[MCP-01] caminho de erro: authSecretRef sem resolver retorna INVALID_STATE", async () => {
  await assert.rejects(
    () =>
      discoverMcpHttpTools({
        serverId: "x",
        url: "http://127.0.0.1:9/mcp",
        authSecretRef: "sysvault:memory:openagent-editor/mcp/x",
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /cofre/i);
      return true;
    },
  );
});

test("[MCP-01] parseMcpHttpServerEndpoint rejeita Authorization em headers quando authSecretRef existe", () => {
  assert.throws(
    () =>
      parseMcpHttpServerEndpoint({
        serverId: "s",
        url: "http://127.0.0.1/mcp",
        authSecretRef: "sysvault:memory:openagent-editor/mcp/s",
        headers: { Authorization: "Bearer leak" },
      }),
    /authSecretRef/,
  );
});
