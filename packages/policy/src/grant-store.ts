import fs from "node:fs";
import path from "node:path";

import type { PermissionGrant } from "./grants.js";

export function resolvePermissionGrantsPath(dataRoot: string, workspaceId: string): string {
  return path.join(dataRoot, "workspaces", workspaceId, "permission-grants.json");
}

function isPermissionGrant(value: unknown): value is PermissionGrant {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row["grantId"] === "string" &&
    typeof row["scope"] === "string" &&
    typeof row["capability"] === "string" &&
    typeof row["targetPattern"] === "string" &&
    row["decision"] === "allow" &&
    typeof row["createdAtMs"] === "number" &&
    typeof row["sessionId"] === "string" &&
    typeof row["workspaceId"] === "string" &&
    typeof row["consumed"] === "boolean" &&
    (row["expiresAtMs"] === null || typeof row["expiresAtMs"] === "number")
  );
}

export class WorkspaceGrantStore {
  private readonly grantsPath: string;
  private loaded = false;
  private readonly grants = new Map<string, PermissionGrant>();

  constructor(
    private readonly dataRoot: string,
    private readonly workspaceId: string,
  ) {
    this.grantsPath = resolvePermissionGrantsPath(dataRoot, workspaceId);
  }

  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    if (!fs.existsSync(this.grantsPath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.grantsPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return;
      }
      for (const entry of parsed) {
        if (isPermissionGrant(entry)) {
          this.grants.set(entry.grantId, entry);
        }
      }
    } catch {
      // Arquivo corrompido: próxima persistência reescreve.
    }
  }

  persistGrant(grant: PermissionGrant): void {
    this.ensureLoaded();
    this.grants.set(grant.grantId, grant);
    fs.mkdirSync(path.dirname(this.grantsPath), { recursive: true });
    const payload = JSON.stringify([...this.grants.values()], null, 0);
    const tempPath = `${this.grantsPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${payload}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, this.grantsPath);
  }

  getGrant(grantId: string): PermissionGrant | undefined {
    this.ensureLoaded();
    return this.grants.get(grantId);
  }

  listGrants(): readonly PermissionGrant[] {
    this.ensureLoaded();
    return [...this.grants.values()];
  }
}
