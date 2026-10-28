/**
 * Fundação de canvas persistente no painel para CAN-01.
 */
export interface CanvasArtifact {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasPanelState {
  activeCanvasId: string | null;
  artifacts: readonly CanvasArtifact[];
}
