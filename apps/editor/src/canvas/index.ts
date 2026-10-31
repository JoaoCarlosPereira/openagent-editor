/**
 * Fundação de canvas persistente no painel para CAN-01.
 */
import type { CanvasArtifact } from "./canvas-artifact.js";

export type { CanvasArtifact } from "./canvas-artifact.js";

export {
  CANVAS_OPEN_EVENT,
  CanvasPanelController,
  RUN_COMPLETED_EVENT,
  type CanvasArtifactPort,
  type CanvasPanelPushInput,
  type CanvasPanelPushResult,
  type CanvasPanelSessionState,
} from "./canvas-panel.js";
export {
  CANVAS_PANEL_FOCUS_TARGETS,
  buildCanvasPanelView,
  canvasPanelStatusLabel,
  type CanvasPanelArtifactRow,
  type CanvasPanelFocusTarget,
  type CanvasPanelUiPhase,
  type CanvasPanelViewSnapshot,
} from "./canvas-panel-view.js";
export {
  resolveCanvasPanelFocusNeighbor,
  resolveCanvasPanelKeyboardDirection,
  type CanvasPanelKeyboardDirection,
  type CanvasPanelKeyboardEvent,
} from "./canvas-panel-keyboard.js";

export interface CanvasPanelState {
  activeCanvasId: string | null;
  artifacts: readonly CanvasArtifact[];
}
