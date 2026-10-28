/** Mapa relativo → SHA-256 hex do conteúdo do arquivo naquele instante. */
export type CheckpointFileHashes = Record<string, string>;

export type StoredCheckpointRecord = {
  checkpointId: string;
  runId: string;
  label: string | null;
  baseHashesRef: string;
  resultHashesRef: string;
  patchRef: string;
  createdAt: string;
};

export type CheckpointHashesPayload = {
  files: CheckpointFileHashes;
};
