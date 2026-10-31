/**
 * PRJ-01: divisão local determinística do objetivo em tarefas de agentes.
 * Sem modelo remoto — o coordenador local produz pelo menos duas tarefas.
 */

export function divideObjectiveIntoAgentTasks(objective: string): string[] {
  const trimmed = objective.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const explicitTasks = lines
    .map((line) => {
      const match = /^TASK:\s*(.+)$/i.exec(line);
      return match?.[1]?.trim() ?? "";
    })
    .filter((task) => task.length > 0);
  if (explicitTasks.length >= 2) {
    return explicitTasks;
  }

  const numbered = [...trimmed.matchAll(/(?:^|\n)\s*\d+[.)]\s*(.+)/g)]
    .map((match) => (match[1] ?? "").trim())
    .filter((task) => task.length > 0);
  if (numbered.length >= 2) {
    return numbered;
  }

  const parts = trimmed
    .split(/\r?\n+|;\s*|\s+\|\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length >= 2) {
    return parts;
  }

  return [`Planejar: ${trimmed}`, `Executar: ${trimmed}`];
}
