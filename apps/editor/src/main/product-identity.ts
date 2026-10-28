import path from "node:path";
import { fileURLToPath } from "node:url";

/** Identidade de produto OpenAgent (LOC-01) — nome e ícone próprios. */
export const OPENAGENT_PRODUCT_NAME = "OpenAgent";
export const OPENAGENT_PRODUCT_DISPLAY_NAME = "OpenAgent Editor";
export const OPENAGENT_ICON_RELATIVE_PATH = "media/icon.svg";

const REPO_ROOT_FROM_THIS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);

/** Resolve o ícone OpenAgent a partir da raiz do monorepo. */
export function resolveOpenAgentIconPath(repoRoot: string = REPO_ROOT_FROM_THIS_FILE): string {
  return path.join(repoRoot, OPENAGENT_ICON_RELATIVE_PATH);
}

export interface ElectronProductIdentity {
  productName: typeof OPENAGENT_PRODUCT_NAME;
  displayName: typeof OPENAGENT_PRODUCT_DISPLAY_NAME;
  iconPath: string;
  iconRelativePath: typeof OPENAGENT_ICON_RELATIVE_PATH;
}

export function createOpenAgentProductIdentity(
  repoRoot: string = REPO_ROOT_FROM_THIS_FILE,
): ElectronProductIdentity {
  return {
    productName: OPENAGENT_PRODUCT_NAME,
    displayName: OPENAGENT_PRODUCT_DISPLAY_NAME,
    iconPath: resolveOpenAgentIconPath(repoRoot),
    iconRelativePath: OPENAGENT_ICON_RELATIVE_PATH,
  };
}
