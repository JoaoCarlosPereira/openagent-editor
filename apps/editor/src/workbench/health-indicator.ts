import { ProtocolError } from "@openagent/protocol";

export const WORKBENCH_HEALTH_SUBSYSTEMS = [
  "daemon",
  "sandbox",
  "index",
  "cliproxyapi",
] as const;

export type WorkbenchHealthSubsystem = (typeof WORKBENCH_HEALTH_SUBSYSTEMS)[number];

export const WORKBENCH_HEALTH_STATUSES = [
  "ready",
  "degraded",
  "offline",
  "connected",
  "disconnected",
] as const;

export type WorkbenchHealthStatus = (typeof WORKBENCH_HEALTH_STATUSES)[number];

export type WorkbenchSubsystemHealth = {
  subsystem: WorkbenchHealthSubsystem;
  status: WorkbenchHealthStatus;
  message: string;
};

export type WorkbenchHealthSnapshot = Record<
  WorkbenchHealthSubsystem,
  WorkbenchSubsystemHealth
>;

export const WORKBENCH_HEALTH_INVALID_MESSAGE =
  "Subsistema, estado ou mensagem de saúde do workbench inválido.";

const SUBSYSTEM_LABELS: Record<WorkbenchHealthSubsystem, string> = {
  daemon: "Daemon",
  sandbox: "Sandbox",
  index: "Índice",
  cliproxyapi: "CLIProxyAPI",
};

export function createDefaultWorkbenchHealth(): WorkbenchHealthSnapshot {
  return {
    daemon: { subsystem: "daemon", status: "disconnected", message: "Desconectado" },
    sandbox: { subsystem: "sandbox", status: "degraded", message: "Isolamento nativo não confirmado" },
    index: { subsystem: "index", status: "offline", message: "Índice indisponível" },
    cliproxyapi: { subsystem: "cliproxyapi", status: "offline", message: "Sidecar não iniciado" },
  };
}

export function assertWorkbenchHealthSubsystem(
  value: unknown,
): WorkbenchHealthSubsystem {
  if (
    typeof value !== "string" ||
    !WORKBENCH_HEALTH_SUBSYSTEMS.includes(value as WorkbenchHealthSubsystem)
  ) {
    throw new ProtocolError("INVALID_STATE", WORKBENCH_HEALTH_INVALID_MESSAGE, [
      `subsystem=${String(value)}`,
    ]);
  }
  return value as WorkbenchHealthSubsystem;
}

export function assertWorkbenchHealthStatus(value: unknown): WorkbenchHealthStatus {
  if (
    typeof value !== "string" ||
    !WORKBENCH_HEALTH_STATUSES.includes(value as WorkbenchHealthStatus)
  ) {
    throw new ProtocolError("INVALID_STATE", WORKBENCH_HEALTH_INVALID_MESSAGE, [
      `status=${String(value)}`,
    ]);
  }
  return value as WorkbenchHealthStatus;
}

export function assertWorkbenchHealthMessage(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 240) {
    throw new ProtocolError("INVALID_STATE", WORKBENCH_HEALTH_INVALID_MESSAGE, [
      "message",
    ]);
  }
  return value.trim();
}

export function updateWorkbenchSubsystemHealth(
  health: WorkbenchHealthSnapshot,
  subsystemValue: unknown,
  statusValue: unknown,
  messageValue: unknown,
): WorkbenchHealthSnapshot {
  const subsystem = assertWorkbenchHealthSubsystem(subsystemValue);
  const status = assertWorkbenchHealthStatus(statusValue);
  const message = assertWorkbenchHealthMessage(messageValue);
  return {
    ...health,
    [subsystem]: { subsystem, status, message },
  };
}

export function describeWorkbenchHealthStatus(status: WorkbenchHealthStatus): string {
  const labels: Record<WorkbenchHealthStatus, string> = {
    ready: "Pronto",
    degraded: "Degradado",
    offline: "Offline",
    connected: "Conectado",
    disconnected: "Desconectado",
  };
  return labels[status];
}

export function describeWorkbenchHealthSubsystem(
  subsystem: WorkbenchHealthSubsystem,
): string {
  return SUBSYSTEM_LABELS[subsystem];
}
