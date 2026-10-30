export {
  GhostTextController,
  GHOST_TEXT_PREFIX_LIMIT,
  GHOST_TEXT_SUFFIX_LIMIT,
  buildGhostTextView,
  createHarnessGhostTextPort,
  ghostTextStatusLabel,
  type GhostTextCompletionPort,
  type GhostTextControllerOptions,
  type GhostTextPhase,
  type GhostTextRpcCall,
  type GhostTextStream,
  type GhostTextViewSnapshot,
} from "./ghost-text.js";
export {
  readTabAutoSuggestions,
  removeTabAutoSuggestions,
  TAB_SETTINGS_DIRNAME,
  TAB_SETTINGS_FILENAME,
  tabSettingsPath,
  writeTabAutoSuggestions,
  type TabWorkspaceSettings,
} from "./auto-suggest.js";
