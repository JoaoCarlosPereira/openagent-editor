export type AgentHistoryRole = "user" | "assistant" | "system";

export interface AgentHistoryMessage {
  id: string;
  role: AgentHistoryRole;
  content: string;
}

export function formatAgentHistoryRoleLabel(role: AgentHistoryRole): string {
  switch (role) {
    case "user":
      return "Você";
    case "assistant":
      return "Agente";
    case "system":
      return "Sistema";
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

export function createAgentHistoryMessage(
  role: AgentHistoryRole,
  content: string,
  id?: string,
): AgentHistoryMessage {
  return {
    id: id ?? `msg-${role}-${Date.now()}`,
    role,
    content,
  };
}
