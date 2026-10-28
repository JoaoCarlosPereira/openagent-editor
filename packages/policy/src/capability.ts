import type { PolicyCapability, PolicyValidationResult } from "./types.js";

const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

const CAPABILITY_ACTION_LABELS: Record<string, string> = {
  "file.read": "Ler arquivo",
  "file.write": "Gravar arquivo",
  "file.search": "Buscar em arquivos",
  "shell.exec": "Executar comando",
  "git.status": "Consultar status Git",
  "git.diff": "Consultar diff Git",
  "browser.open": "Abrir URL no navegador",
  "browser.navigate": "Navegar no navegador",
  "tool.invoke": "Executar ferramenta",
  "run.write": "Controlar execução",
  "run.queue": "Alterar fila da execução",
  "session.write": "Alterar sessão",
  "session.read": "Ler sessão",
  "permission.grant": "Decidir permissão",
  "checkpoint.write": "Alterar checkpoint",
  "agent.spawn": "Criar subagente",
  "project.write": "Alterar projeto local",
  "context.write": "Alterar contexto",
  "context.read": "Ler contexto",
  "extension.install": "Instalar extensão",
  "extension.manage": "Gerenciar extensão",
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validatePolicyCapability(raw: unknown): PolicyValidationResult<PolicyCapability> {
  if (!isNonEmptyString(raw)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Campo 'capability' ausente ou inválido (string não-vazia)."],
    };
  }
  const capability = raw.trim();
  if (!CAPABILITY_PATTERN.test(capability)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: [`Capability '${capability}' não segue o padrão namespace.ação.`],
    };
  }
  return { valid: true, value: capability };
}

export function describeCapabilityAction(capability: PolicyCapability): string {
  const known = CAPABILITY_ACTION_LABELS[capability];
  if (known) {
    return known;
  }
  const segments = capability.split(".");
  const actionSegment = segments[segments.length - 1] ?? capability;
  return `Executar '${actionSegment}' (${capability})`;
}
