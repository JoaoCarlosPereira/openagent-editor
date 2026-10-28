import http from "node:http";
import { once } from "node:events";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

function createMcpServer() {
  const server = new McpServer({
    name: "openagent-fixture-mcp-http",
    version: "0.0.1",
  });

  server.tool(
    "ping",
    { message: z.string().optional() },
    async ({ message }) => ({
      content: [{ type: "text", text: message ?? "pong" }],
    }),
  );

  server.tool(
    "addNumbers",
    { a: z.number(), b: z.number() },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }),
  );

  return server;
}

function methodNotAllowed(res) {
  res.writeHead(405, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
  );
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Sobe um servidor MCP HTTP stateless (Streamable HTTP) em loopback para testes de integração.
 */
export async function withMcpHttpDiscoveryServer(run) {
  const httpServer = http.createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404);
      res.end();
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      methodNotAllowed(res);
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    const mcpServer = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await mcpServer.connect(transport);
      const body = await readJsonBody(req);
      await transport.handleRequest(req, res, body);
      res.on("close", () => {
        transport.close().catch(() => undefined);
        mcpServer.close().catch(() => undefined);
      });
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      }
      console.error("fixture MCP HTTP:", error);
    }
  });

  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Endereço do fixture MCP HTTP inválido.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}/mcp`;
  try {
    await run(baseUrl);
  } finally {
    httpServer.close();
    await once(httpServer, "close");
  }
}
