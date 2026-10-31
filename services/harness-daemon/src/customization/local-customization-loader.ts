import os from "node:os";
import path from "node:path";

import {
  applyLocalCustomizationInvocation,
  invokeLocalCustomizationWithGrantPolicy,
  mergeLocalCustomizationAssetsByPrecedence,
  type LoadedLocalCustomizationAsset,
  type LocalCustomizationInvocationOutcome,
  type LocalCustomizationInvokeResult,
} from "@openagent/policy";
import {
  loadLocalCustomizationAssetsFromPaths,
  type CustomizationRuleFileReader,
} from "@openagent/tools";

export type LoadWorkspaceLocalCustomizationInput = {
  workspaceRoot: string;
  userBaseDirectory?: string;
  reader?: CustomizationRuleFileReader;
};

function resolveDefaultUserBaseDirectory(): string {
  return path.join(os.homedir(), ".cursor");
}

/** Carrega comandos, skills e plugins locais aplicáveis ao workspace (CUS-02). */
export function loadWorkspaceLocalCustomizationAssets(
  input: LoadWorkspaceLocalCustomizationInput,
): LoadedLocalCustomizationAsset[] {
  const workspaceRoot = path.resolve(input.workspaceRoot.trim());
  const userBase = input.userBaseDirectory ?? resolveDefaultUserBaseDirectory();
  const projectBase = path.join(workspaceRoot, ".cursor");

  const userAssets = loadLocalCustomizationAssetsFromPaths({
    layer: "user",
    skillsDirectory: path.join(userBase, "skills"),
    commandsDirectory: path.join(userBase, "commands"),
    pluginsDirectory: path.join(userBase, "plugins"),
    originSkillsPrefix: "~/.cursor/skills",
    originCommandsPrefix: "~/.cursor/commands",
    originPluginsPrefix: "~/.cursor/plugins",
    precedence: 1,
    reader: input.reader,
  });

  const projectAssets = loadLocalCustomizationAssetsFromPaths({
    layer: "project",
    skillsDirectory: path.join(projectBase, "skills"),
    commandsDirectory: path.join(projectBase, "commands"),
    pluginsDirectory: path.join(projectBase, "plugins"),
    originSkillsPrefix: ".cursor/skills",
    originCommandsPrefix: ".cursor/commands",
    originPluginsPrefix: ".cursor/plugins",
    precedence: 2,
    reader: input.reader,
  });

  return mergeLocalCustomizationAssetsByPrecedence(userAssets, projectAssets);
}

/** Registro por workspace de ativos locais invocáveis (CUS-02). */
export class WorkspaceLocalCustomizationAssets {
  private assets: LoadedLocalCustomizationAsset[] = [];

  reload(input: LoadWorkspaceLocalCustomizationInput): LoadedLocalCustomizationAsset[] {
    this.assets = loadWorkspaceLocalCustomizationAssets(input);
    return this.assets;
  }

  listLoaded(): LoadedLocalCustomizationAsset[] {
    return [...this.assets];
  }

  invoke(invokeRef: string): LocalCustomizationInvokeResult {
    return applyLocalCustomizationInvocation(this.assets, invokeRef);
  }

  /** Invoca com emissão observável e sem ampliar grants de plugin (CUS-02). */
  invokeWithPolicy(
    invokeRef: string,
    input: { sessionId: string; emittedAt?: number },
  ): LocalCustomizationInvocationOutcome {
    return invokeLocalCustomizationWithGrantPolicy(this.assets, invokeRef, input);
  }
}

export function createWorkspaceLocalCustomizationAssets(): WorkspaceLocalCustomizationAssets {
  return new WorkspaceLocalCustomizationAssets();
}
