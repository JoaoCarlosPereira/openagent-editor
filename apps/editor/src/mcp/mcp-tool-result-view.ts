import type { McpToolInvocationResult } from "@openagent/tools";

export interface McpToolResultView {
  toolName: string;
  isError: boolean;
  displayText: string;
}

export interface McpToolResultViewSnapshot {
  kind: "result";
  html: string;
  accessible: {
    toolName: string;
    isError: boolean;
    displayText: string;
    dataTestId: string;
  };
}

const escapeHtml: (text: string) => string = (() => {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return function escape(text: string): string {
    return text.replace(/[&<>"']/g, (char) => map[char] ?? char);
  };
})();

export function buildMcpToolResultView(
  result: McpToolInvocationResult,
): McpToolResultViewSnapshot {
  const displayText = (() => {
    let out = "";
    for (const block of result.content) {
      if (block.type === "text" && typeof block.text === "string") {
        out += block.text;
      }
    }
    return out;
  })();

  return {
    kind: "result",
    html: `<section data-testid="mcp-tool-result" data-tool-name="${escapeHtml(result.toolName)}" data-is-error="${result.isError}">
      <h2>Ferramenta: ${escapeHtml(result.toolName)}</h2>
      <p data-testid="mcp-tool-result-status" data-error="${result.isError}">
        ${result.isError ? "Erro" : "Sucesso"}
      </p>
      <pre data-testid="mcp-tool-result-text">${escapeHtml(displayText)}</pre>
    </section>`,
    accessible: {
      toolName: result.toolName,
      isError: result.isError,
      displayText,
      dataTestId: "mcp-tool-result",
    },
  };
}

export function buildMcpToolErrorView(
  toolName: string,
  code: string,
  message: string,
): McpToolResultViewSnapshot {
  return {
    kind: "result",
    html: `<section data-testid="mcp-tool-error" data-tool-name="${toolName}" data-error="true">
      <h2>Ferramenta: ${toolName}</h2>
      <p data-testid="mcp-tool-error-code" data-error-code="${code}">${code}</p>
      <p data-testid="mcp-tool-error-message">${message}</p>
    </section>`,
    accessible: {
      toolName,
      isError: true,
      displayText: `${code}: ${message}`,
      dataTestId: "mcp-tool-error",
    },
  };
}
