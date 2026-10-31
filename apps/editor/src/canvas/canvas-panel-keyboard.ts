/**
 * IPv-AGPN-15: teclado do painel de canvas.
 * Tab / Shift+Tab / setas movem o foco; tecla inválida → INVALID_STATE.
 */

import { ProtocolError } from "@openagent/protocol";

export type CanvasPanelKeyboardDirection = "next" | "previous";

export interface CanvasPanelKeyboardEvent {
  key: string;
  shiftKey?: boolean;
}

/** Cíclico entre alvos focáveis enquanto um canvas está aberto. */
export function resolveCanvasPanelFocusNeighbor<T extends string>(
  current: T,
  targets: readonly T[],
  direction: CanvasPanelKeyboardDirection,
): T {
  const index = targets.indexOf(current);
  const fallback = targets[0] ?? current;
  if (index < 0) {
    return fallback;
  }
  const nextIndex = direction === "next"
    ? (index + 1) % targets.length
    : (index - 1 + targets.length) % targets.length;
  return targets[nextIndex] ?? fallback;
}

export function resolveCanvasPanelKeyboardDirection(
  event: CanvasPanelKeyboardEvent,
): CanvasPanelKeyboardDirection {
  if (event.key === "Tab") {
    return event.shiftKey === true ? "previous" : "next";
  }
  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
    return "next";
  }
  if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
    return "previous";
  }
  throw new ProtocolError(
    "INVALID_STATE",
    `Tecla de navegação inválida no painel do canvas: ${String(event.key)}.`,
    [`key=${String(event.key)}`],
  );
}
