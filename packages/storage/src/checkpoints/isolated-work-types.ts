export type IsolatedWorkState = "active" | "applied" | "discarded";

export type StoredIsolatedWorkRecord = {
  id: string;
  runId: string;
  canonicalRoot: string;
  isolatedRoot: string;
  gitBranch: string;
  state: IsolatedWorkState;
  createdAt: string;
};
