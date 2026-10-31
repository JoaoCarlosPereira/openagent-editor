import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { applyIsolatedGitWork, createIsolatedGitWork, discardIsolatedGitWork } from "@openagent/tools";
import { buildIsolatedWorkView, type IsolatedWorkPhase, type IsolatedWorkViewSnapshot } from "./isolated-worktree-view.js";

export interface IsolatedWorktreePort {
  create(input: { workspaceRoot: string; isolatedWorkId: string; worktreesRoot: string }): Promise<{ isolatedWorkId: string; canonicalWorkspaceRoot: string; isolatedWorkspaceRoot: string; gitBranch: string }>;
  apply(input: { workspaceRoot: string; isolatedWorkspaceRoot: string }): Promise<{ applied: true; relativePaths: string[] } | { conflict: true; conflicts: Array<{ relativePath: string }> }>;
  discard(input: { workspaceRoot: string; isolatedWorkspaceRoot: string }): Promise<{ discarded: true }>;
}

export const localIsolatedWorktreePort: IsolatedWorktreePort = {
  async create(input) { return createIsolatedGitWork(input); },
  async apply(input) { return applyIsolatedGitWork(input); },
  async discard(input) { return discardIsolatedGitWork(input); },
};

function invalid(message: string, fields: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [...fields]);
}

export class IsolatedWorktreeController {
  private phase: IsolatedWorkPhase = "idle";
  private workId: string | null = null;
  private root: string | null = null;
  private branch: string | null = null;
  private code: string | null = null;
  private changedPaths: string[] = [];

  constructor(private readonly workspaceRoot: string, private readonly worktreesRoot: string, private readonly port: IsolatedWorktreePort = localIsolatedWorktreePort) {
    if (!workspaceRoot.trim() || !worktreesRoot.trim()) throw invalid("Raízes do workspace inválidas.", ["workspaceRoot", "worktreesRoot"]);
  }

  get snapshot(): IsolatedWorkViewSnapshot {
    return buildIsolatedWorkView({ phase: this.phase, isolatedWorkId: this.workId, isolatedWorkspaceRoot: this.root, gitBranch: this.branch, errorCode: this.code, changedPaths: this.changedPaths });
  }

  async create(isolatedWorkId: string): Promise<IsolatedWorkViewSnapshot> {
    if (this.phase !== "idle") throw invalid("Criação de trabalho isolado fora de estado válido.", ["state"]);
    if (typeof isolatedWorkId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(isolatedWorkId.trim())) throw invalid("Identificador de trabalho isolado inválido.", ["isolatedWorkId"]);
    this.phase = "creating";
    try {
      const created = await this.port.create({ workspaceRoot: this.workspaceRoot, worktreesRoot: this.worktreesRoot, isolatedWorkId: isolatedWorkId.trim() });
      this.workId = created.isolatedWorkId;
      this.root = created.isolatedWorkspaceRoot;
      this.branch = created.gitBranch;
      this.phase = "active";
    } catch (error) {
      this.phase = "idle";
      this.code = error instanceof ProtocolError ? error.code : PROTOCOL_ERROR_CODES.INVALID_STATE;
      throw error;
    }
    return this.snapshot;
  }

  async apply(): Promise<IsolatedWorkViewSnapshot> {
    if (this.phase !== "active" || !this.root) throw invalid("Não há trabalho isolado ativo para aplicar.", ["state"]);
    this.phase = "applying";
    try {
      const result = await this.port.apply({ workspaceRoot: this.workspaceRoot, isolatedWorkspaceRoot: this.root });
      if ("conflict" in result) { this.phase = "conflict"; this.changedPaths = result.conflicts.map((entry) => entry.relativePath); }
      else { this.phase = "applied"; this.changedPaths = [...result.relativePaths]; }
    } catch (error) { this.phase = "active"; this.code = error instanceof ProtocolError ? error.code : PROTOCOL_ERROR_CODES.INVALID_STATE; throw error; }
    return this.snapshot;
  }

  async discard(): Promise<IsolatedWorkViewSnapshot> {
    if (this.phase !== "active" || !this.root) throw invalid("Não há trabalho isolado ativo para descartar.", ["state"]);
    this.phase = "discarding";
    try { await this.port.discard({ workspaceRoot: this.workspaceRoot, isolatedWorkspaceRoot: this.root }); this.phase = "discarded"; }
    catch (error) { this.phase = "active"; this.code = error instanceof ProtocolError ? error.code : PROTOCOL_ERROR_CODES.INVALID_STATE; throw error; }
    return this.snapshot;
  }
}

export { buildIsolatedWorkView } from "./isolated-worktree-view.js";
export type { IsolatedWorkPhase, IsolatedWorkViewSnapshot } from "./isolated-worktree-view.js";
