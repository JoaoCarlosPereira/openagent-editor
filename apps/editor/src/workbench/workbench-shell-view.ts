import {
  OPENAGENT_ICON_RELATIVE_PATH,
  OPENAGENT_PRODUCT_NAME,
  type ElectronProductIdentity,
} from "../main/product-identity.js";

export type WorkbenchCapabilitySlot =
  | "editor"
  | "terminal"
  | "git"
  | "debug"
  | "extension-host";

export const WORKBENCH_CAPABILITY_SLOTS: readonly WorkbenchCapabilitySlot[] = [
  "editor",
  "terminal",
  "git",
  "debug",
  "extension-host",
] as const;

export interface WorkbenchShellViewInput {
  identity: ElectronProductIdentity;
  folderPath: string | null;
  platform: string;
  /** Main ligado ao daemon (task_119); renderer permanece sem ferramentas. */
  daemonConnected?: boolean;
  toolsAllowedInRenderer?: false;
}

export interface WorkbenchShellViewSnapshot {
  html: string;
  accessible: {
    productName: typeof OPENAGENT_PRODUCT_NAME;
    iconRelativePath: typeof OPENAGENT_ICON_RELATIVE_PATH;
    folderPath: string | null;
    capabilitySlots: readonly WorkbenchCapabilitySlot[];
    focusOrder: readonly string[];
    daemonConnected: boolean;
    toolsAllowedInRenderer: false;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderCapabilitySlot(slot: WorkbenchCapabilitySlot): string {
  return [
    `<section data-testid="workbench-slot-${slot}" data-capability="${slot}"`,
    ` role="region" aria-label="${escapeHtml(slot)}" tabindex="0">`,
    `<h3>${escapeHtml(slot)}</h3>`,
    `</section>`,
  ].join("");
}

/** LOC-01 (118): shell do workbench com identidade OpenAgent e slots de capacidade. */
export function buildWorkbenchShellView(
  input: WorkbenchShellViewInput,
): WorkbenchShellViewSnapshot {
  const daemonConnected = input.daemonConnected === true;
  const toolsAllowedInRenderer = false as const;

  const focusOrder = [
    "workbench-product-name",
    "workbench-product-icon",
    "workbench-folder",
    "workbench-daemon-link",
    "workbench-renderer-tools",
    ...WORKBENCH_CAPABILITY_SLOTS.map((slot) => `workbench-slot-${slot}`),
  ] as const;

  const folderLabel = input.folderPath ?? "Nenhuma pasta aberta";
  const slotsHtml = WORKBENCH_CAPABILITY_SLOTS.map(renderCapabilitySlot).join("");
  const daemonLabel = daemonConnected
    ? "Main ligado ao harness-daemon"
    : "Main sem ligação ao daemon";

  const html = [
    `<main role="application" aria-label="${escapeHtml(input.identity.displayName)}"`,
    ` data-testid="workbench-shell" data-platform="${escapeHtml(input.platform)}"`,
    ` data-daemon-connected="${daemonConnected ? "true" : "false"}"`,
    ` data-tools-allowed-in-renderer="false">`,
    `<header data-testid="workbench-branding">`,
    `<img data-testid="workbench-product-icon" src="${escapeHtml(input.identity.iconRelativePath)}"`,
    ` alt="${escapeHtml(OPENAGENT_PRODUCT_NAME)}" tabindex="0" />`,
    `<h1 id="workbench-product-name" data-testid="workbench-product-name" tabindex="0">`,
    `${escapeHtml(OPENAGENT_PRODUCT_NAME)}</h1>`,
    `</header>`,
    `<p data-testid="workbench-folder" aria-live="polite" tabindex="0">`,
    `${escapeHtml(folderLabel)}</p>`,
    `<p data-testid="workbench-daemon-link" aria-live="polite" tabindex="0"`,
    ` data-connected="${daemonConnected ? "true" : "false"}">`,
    `${escapeHtml(daemonLabel)}</p>`,
    `<p data-testid="workbench-renderer-tools" aria-live="polite" tabindex="0"`,
    ` data-tools-allowed="false">Renderer sem ferramentas</p>`,
    `<div data-testid="workbench-capabilities">${slotsHtml}</div>`,
    `</main>`,
  ].join("");

  return {
    html,
    accessible: {
      productName: OPENAGENT_PRODUCT_NAME,
      iconRelativePath: OPENAGENT_ICON_RELATIVE_PATH,
      folderPath: input.folderPath,
      capabilitySlots: WORKBENCH_CAPABILITY_SLOTS,
      focusOrder,
      daemonConnected,
      toolsAllowedInRenderer,
    },
  };
}
