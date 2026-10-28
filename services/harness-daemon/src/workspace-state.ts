import type { WorkspaceTransportHello } from "@openagent/protocol";
import { openWorkspaceDatabase } from "@openagent/storage";

export type WorkspaceBindingState = {
  workspaceId: string;
  workspaceRoot: string;
  providerProfileId: string;
  mode: string;
  rulesRef: string;
  mcpServerIds: string[];
  sessionIds: string[];
};

export class WorkspaceStateRegistry {
  private readonly bindings = new Map<string, WorkspaceBindingState>();
  private readonly dataRoot: string;

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot;
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
      return initial;
    }

    const next: WorkspaceBindingState = {
      ...stored,
      workspaceRoot: hello.workspaceRoot || stored.workspaceRoot,
      sessionIds: this.mergeUnique(stored.sessionIds, sessionIds),
    };
    this.bindings.set(hello.workspaceId, next);
    return next;
  }

  get(workspaceId: string): WorkspaceBindingState | undefined {
    return this.bindings.get(workspaceId);
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
