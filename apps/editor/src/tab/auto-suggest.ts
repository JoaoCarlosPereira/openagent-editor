import fs from "node:fs";
import path from "node:path";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

// TAB-01: a sugestão automática do Tab pode ser desligada por workspace.
// A preferência vive em <workspaceRoot>/.openagent/tab.json, visível no
// projeto, com {"autoSuggestionsDisabled": true}. O arquivo continha
// apenas este estado; JSON inválido responde como erro de estado estável,
// nunca como sugestão silenciosa.

export interface TabWorkspaceSettings {
  autoSuggestionsDisabled: boolean;
}

export const TAB_SETTINGS_DIRNAME = ".openagent";
export const TAB_SETTINGS_FILENAME = "tab.json";

export function tabSettingsPath(workspaceRoot: string): string {
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim().length === 0) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Workspace inválido para configuração do Tab.");
  }
  return path.join(workspaceRoot, TAB_SETTINGS_DIRNAME, TAB_SETTINGS_FILENAME);
}

/** Lê a preferência do workspace; ausência do arquivo = habilitada. */
export function readTabAutoSuggestions(workspaceRoot: string): TabWorkspaceSettings {
  const file = tabSettingsPath(workspaceRoot);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { autoSuggestionsDisabled: false };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, `Arquivo de configuração do Tab inválido: ${file}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, `Arquivo de configuração do Tab inválido: ${file}`);
  }
  const flag = (parsed as { autoSuggestionsDisabled?: unknown }).autoSuggestionsDisabled;
  if (flag !== undefined && typeof flag !== "boolean") {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, `Campo autoSuggestionsDisabled deve ser booleano: ${file}`);
  }
  return { autoSuggestionsDisabled: flag === true };
}

/** Grava a preferência por workspace (cria o diretório .openagent se faltar). */
export function writeTabAutoSuggestions(workspaceRoot: string, disabled: boolean): void {
  if (typeof disabled !== "boolean") {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Estado de sugestão automática inválido.");
  }
  const file = tabSettingsPath(workspaceRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload: TabWorkspaceSettings = { autoSuggestionsDisabled: disabled };
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

export function removeTabAutoSuggestions(workspaceRoot: string): void {
  try {
    fs.unlinkSync(tabSettingsPath(workspaceRoot));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

