import fs from "node:fs";
import path from "node:path";
import type { WorkspaceTransportHello } from "@openagent/protocol";
import { openWorkspaceDatabase } from "@openagent/storage";
import { resolveHarnessWorkspaceBindingsPath } from "./runtime-paths.js";

export type WorkspaceBindingState = {
  workspaceId: string;
  workspaceRoot: string;
  providerProfileId: string;
  mode: string;
  rulesRef: string;
  mcpServerIds: string[];
  sessionIds: string[];
};

export type WorkspaceStateRegistryOptions = {
  dataRoot: string;
  runtimeDirectory: string;
};

export class WorkspaceStateRegistry {
  private readonly bindings = new Map<string, WorkspaceBindingState>();
  private readonly dataRoot: string;
  private readonly bindingsPath: string;

  constructor(options: WorkspaceStateRegistryOptions) {
    this.dataRoot = options.dataRoot;
    this.bindingsPath = resolveHarnessWorkspaceBindingsPath(options.runtimeDirectory);
    this.loadPersistedBindings();
  }

  upsertFromHello(hello: WorkspaceTransportHello): WorkspaceBindingState {
    const stored = this.bindings.get(hello.workspaceId);
    const sessionIds = this.mergeSessionIds(hello);

    if (!stored) {
      const initial: WorkspaceBindingState = {
        workspaceId: hello.workspaceId,
        workspaceRoot: hello.workspaceRoot,
        providerProfileId: hello.providerProfileId,
        mode: hello.mode,
        rulesRef: hello.rulesRef,
        mcpServerIds: [...hello.mcpServerIds],
        sessionIds,
      };
      this.bindings.set(hello.workspaceId, initial);
      this.persistBindings();
      return initial;
    }

    const next: WorkspaceBindingState = {
      ...stored,
      workspaceRoot: hello.workspaceRoot || stored.workspaceRoot,
      sessionIds: this.mergeUnique(stored.sessionIds, sessionIds),
    };
    this.bindings.set(hello.workspaceId, next);
    this.persistBindings();
    return next;
  }

  get(workspaceId: string): WorkspaceBindingState | undefined {
    return this.bindings.get(workspaceId);
  }

  private loadPersistedBindings(): void {
    if (!fs.existsSync(this.bindingsPath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.bindingsPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return;
      }
      for (const entry of parsed) {
        if (
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as WorkspaceBindingState).workspaceId === "string"
        ) {
          const binding = entry as WorkspaceBindingState;
          this.bindings.set(binding.workspaceId, {
            ...binding,
            mcpServerIds: [...binding.mcpServerIds],
            sessionIds: [...binding.sessionIds],
          });
        }
      }
    } catch {
      // Bindings corrompidos são ignorados; o próximo hello reidrata.
    }
  }

  private persistBindings(): void {
    fs.mkdirSync(path.dirname(this.bindingsPath), { recursive: true });
    const payload = JSON.stringify([...this.bindings.values()], null, 0);
    const tempPath = `${this.bindingsPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${payload}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, this.bindingsPath);
  }

  private mergeSessionIds(hello: WorkspaceTransportHello): string[] {
    try {
      const database = openWorkspaceDatabase({
        dataRoot: this.dataRoot,
        workspaceId: hello.workspaceId,
      });
      try {
        const fromStorage = database.listSessionResumes().map((row) => row.sessionId);
        return this.mergeUnique(hello.sessionIds, fromStorage);
      } finally {
        database.close();
      }
    } catch {
      return this.mergeUnique(hello.sessionIds, []);
    }
  }

  private mergeUnique(primary: readonly string[], secondary: readonly string[]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const id of [...primary, ...secondary]) {
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
    return merged;
  }
}
