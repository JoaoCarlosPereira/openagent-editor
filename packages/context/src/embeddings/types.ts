export type LocalEmbeddingModelLicense = {
  spdx: string;
  redistributable: true;
};

export type LocalEmbeddingModelManifest = {
  schemaVersion: 1;
  modelId: string;
  displayName: string;
  dimensions: number;
  license: LocalEmbeddingModelLicense;
  upstream: {
    repository: string;
    revision: string;
  };
  packaging: {
    relativeArtifactPath: string;
    format: string;
    checksumSha256: string | null;
  };
  provenanceModule: string;
};

export type RegisteredLocalEmbeddingModel = {
  manifest: LocalEmbeddingModelManifest;
  provenanceModule: string;
};

export type ChunkEmbeddingVector = {
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  lexicalText: string;
  vector: Float32Array;
};

export type IndexedPathEmbeddings = {
  path: string;
  contentHash: string;
  chunks: ChunkEmbeddingVector[];
};

export type ReindexPathEmbeddingsOnSaveInput = {
  path: string;
  content: string;
  contentHash?: string;
};

export type ReindexPathEmbeddingsOnSaveResult = {
  path: string;
  contentHash: string;
  chunkCount: number;
  indexed: boolean;
  skippedReason?: "unchanged";
};

export type EmbeddingSearchHit = {
  path: string;
  chunkIndex: number;
  score: number;
  lexicalText: string;
};
