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
  CrossFileSuggestionController,
  type CrossFileOfferInput,
  type CrossFileSuggestionControllerOptions,
  type CrossFileSuggestionPort,
  type CrossFileSuggestionPhase,
  type CrossFileSuggestionViewSnapshot,
  buildCrossFileSuggestionView,
  crossFileStatusLabel,
} from "./cross-file-suggestion.js";
