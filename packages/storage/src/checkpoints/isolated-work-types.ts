export type StoredIsolatedWorkRecord = {
  id: string;
  runId: string;
  canonicalRoot: string;
  isolatedRoot: string;
  gitBranch: string;
  state: "active";
  createdAt: string;
};
