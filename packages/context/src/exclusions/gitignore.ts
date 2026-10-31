/**
 * Extrai padrões utilizáveis de um arquivo .gitignore (comentários e linhas vazias omitidos).
 */
export function parseGitignoreLines(content: string): string[] {
  const patterns: string[] = [];
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("!")) {
      continue;
    }
    patterns.push(line);
  }
  return patterns;
}
