export interface McpToolView {
  name: string;
  description: string | null;
  inputSchema: unknown;
}

export interface McpToolListViewSnapshot {
  kind: "tool-list";
  serverId: string;
  transport: "stdio" | "http";
  tools: readonly McpToolView[];
  html: string;
  accessible: {
    serverLabel: string;
    toolNames: readonly string[];
    empty: boolean;
  };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

export function buildMcpToolListView(input: {
  serverId: string;
  transport: "stdio" | "http";
  tools: readonly McpToolView[];
}): McpToolListViewSnapshot {
  const tools = input.tools.map((tool) => ({
    name: String(tool.name),
    description: tool.description === null ? null : String(tool.description),
    inputSchema: tool.inputSchema,
  }));
  const listHtml = tools.length
    ? tools.map((tool) => `<li data-testid="mcp-tool" data-tool-name="${escapeHtml(tool.name)}">
        <strong>${escapeHtml(tool.name)}</strong>
        ${tool.description ? `<p>${escapeHtml(tool.description)}</p>` : ""}
        <button type="button" data-testid="mcp-tool-run" data-tool-name="${escapeHtml(tool.name)}">Executar</button>
      </li>`).join("")
    : `<li data-testid="mcp-tool-empty">Nenhuma ferramenta encontrada.</li>`;

  return {
    kind: "tool-list",
    serverId: input.serverId,
    transport: input.transport,
    tools,
    html: `<section data-testid="mcp-tool-list" data-server-id="${escapeHtml(input.serverId)}" data-transport="${input.transport}">
      <h2>Ferramentas de ${escapeHtml(input.serverId)}</h2>
      <ul>${listHtml}</ul>
    </section>`,
    accessible: {
      serverLabel: input.serverId,
      toolNames: tools.map((tool) => tool.name),
      empty: tools.length === 0,
    },
  };
}
