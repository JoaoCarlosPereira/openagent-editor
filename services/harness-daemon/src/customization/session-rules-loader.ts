import os from "node:os";
import path from "node:path";

import {
  formatCustomizationRulesForDisplay,
  mergeCustomizationRulesByPrecedence,
  validateSessionRulesLoadInput,
  type CustomizationRuleDisplayEntry,
  type LoadedCustomizationRule,
} from "@openagent/policy";
import {
  loadCustomizationRulesFromPaths,
  type CustomizationRuleFileReader,
} from "@openagent/tools";

export type BeginSessionCustomizationInput = {
  workspaceRoot: string;
  sessionId: string;
  rulesRef: string;
  userRulesDirectory?: string;
  reader?: CustomizationRuleFileReader;
};

export type SessionCustomizationRulesSnapshot = {
  sessionId: string;
  rulesRef: string;
  mergedRules: LoadedCustomizationRule[];
  display: CustomizationRuleDisplayEntry[];
};

function resolveDefaultUserRulesDirectory(): string {
  return path.join(os.homedir(), ".cursor", "rules");
}

/** Carrega regras de usuário e projeto aplicáveis ao iniciar sessão (CUS-01). */
export function loadSessionCustomizationRules(
  input: BeginSessionCustomizationInput,
): SessionCustomizationRulesSnapshot {
  validateSessionRulesLoadInput({
    workspaceRoot: input.workspaceRoot,
    rulesRef: input.rulesRef,
  });

  const workspaceRoot = path.resolve(input.workspaceRoot);
  const userRulesDirectory = input.userRulesDirectory ?? resolveDefaultUserRulesDirectory();
  const projectRulesDirectory = path.join(workspaceRoot, ".cursor", "rules");
  const legacyProjectRulesFile = path.join(workspaceRoot, ".cursorrules");

  const userRules = loadCustomizationRulesFromPaths({
    layer: "user",
    rulesDirectory: userRulesDirectory,
    originPrefix: "~/.cursor/rules",
    precedence: 1,
    reader: input.reader,
  });

  const projectRules = loadCustomizationRulesFromPaths({
    layer: "project",
    rulesDirectory: projectRulesDirectory,
    legacyFilePath: legacyProjectRulesFile,
    originPrefix: ".cursor/rules",
    precedence: 2,
    reader: input.reader,
  });

  const mergedRules = mergeCustomizationRulesByPrecedence(userRules, projectRules);

  return {
    sessionId: input.sessionId,
    rulesRef: input.rulesRef.trim(),
    mergedRules,
    display: formatCustomizationRulesForDisplay(mergedRules),
  };
}

/** Registro por sessão das regras carregadas e suas origens (CUS-01). */
export class WorkspaceCustomizationRules {
  private readonly bySessionId = new Map<string, SessionCustomizationRulesSnapshot>();

  beginSession(input: BeginSessionCustomizationInput): SessionCustomizationRulesSnapshot {
    const snapshot = loadSessionCustomizationRules(input);
    this.bySessionId.set(input.sessionId, snapshot);
    return snapshot;
  }

  getSessionDisplay(sessionId: string): CustomizationRuleDisplayEntry[] | undefined {
    return this.bySessionId.get(sessionId)?.display;
  }

  getSessionMergedRules(sessionId: string): LoadedCustomizationRule[] | undefined {
    return this.bySessionId.get(sessionId)?.mergedRules;
  }
}

export function createWorkspaceCustomizationRules(): WorkspaceCustomizationRules {
  return new WorkspaceCustomizationRules();
}
