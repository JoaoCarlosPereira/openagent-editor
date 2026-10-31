export function createCloseCoordinator(options: {
  requestRenderer: () => void;
  confirmDiscard: () => boolean;
  closeWindow: () => void;
  resumeRenderer: () => void;
}) {
  let state: "idle" | "waiting" | "approved" = "idle";
  return {
    request(): boolean {
      if (state === "approved") return true;
      if (state === "idle") {
        state = "waiting";
        options.requestRenderer();
      }
      return false;
    },
    ready(ok: boolean): void {
      if (state !== "waiting") return;
      if (ok && options.confirmDiscard()) {
        state = "approved";
        options.closeWindow();
      } else {
        state = "idle";
        options.resumeRenderer();
      }
    },
  };
}
