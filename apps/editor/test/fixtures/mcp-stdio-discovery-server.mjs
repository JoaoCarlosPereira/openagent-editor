import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "openagent-fixture-mcp-stdio",
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

const transport = new StdioServerTransport();
await server.connect(transport);
