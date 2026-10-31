import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import { discoverMcpStdioTools } from "../../src/mcp/discover-mcp-stdio-tools.js";
import { parseMcpStdioServerLaunch } from "../../src/mcp/mcp-stdio-config.js";

const fixtureServerPath = fileURLToPath(
  new URL("../fixtures/mcp-stdio-discovery-server.mjs", import.meta.url),
);

test("[MCP-01] discoverMcpStdioTools lista ferramentas de servidor stdio de fixture", async () => {
  const result = await discoverMcpStdioTools({
    serverId: "fixture-stdio",
    command: process.execPath,
    args: [fixtureServerPath],
  });

  assert.equal(result.transport, "stdio");
  assert.equal(result.serverId, "fixture-stdio");
  assert.ok(result.tools.length >= 2);

  const names = result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["addNumbers", "ping"]);

  const ping = result.tools.find((tool) => tool.name === "ping");
  assert.ok(ping);
  assert.ok(ping.inputSchema !== undefined);
});

test("[MCP-01] caminho de erro: configuração inválida retorna INVALID_STATE sem spawn", async () => {
  assert.throws(
    () =>
      parseMcpStdioServerLaunch({
        serverId: "x",
        command: "",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  await assert.rejects(
    discoverMcpStdioTools({ serverId: "", command: "node", args: [] }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});

test("[MCP-01] parseMcpStdioServerLaunch normaliza comando e argumentos", () => {
  const parsed = parseMcpStdioServerLaunch({
    serverId: "  demo  ",
    command: "  node  ",
    args: ["--version"],
    cwd: path.dirname(fixtureServerPath),
  });

  assert.equal(parsed.serverId, "demo");
  assert.equal(parsed.command, "node");
  assert.deepEqual(parsed.args, ["--version"]);
  assert.equal(parsed.cwd, path.dirname(fixtureServerPath));
});
