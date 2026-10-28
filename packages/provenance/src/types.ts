export type ProvenanceStrategy =
  | "direct-authorized"
  | "behavioral-reimplementation";

export type ProvenanceRecoveryMethod =
  | "js-bundle-recovery"
  | "ghidra-pseudocode"
  | "runtime-observation"
  | "differential-test"
  | "public-documentation";

export interface ProvenanceOrigin {
  bundle?: string;
  address?: string;
  symbol?: string;
}

export interface ProvenanceSource {
  artifactSha256: string;
  artifactPath: string;
  cursorVersion: "3.24.18";
  origin: ProvenanceOrigin;
  recoveryMethod: ProvenanceRecoveryMethod;
}

export interface ProvenanceLicense {
  spdx: string;
}

export interface ProvenanceAuthorization {
  documentRef: string;
  documentSha256: string;
  scope: string;
}

export interface ProvenanceDocument {
  $schema?: string;
  schemaVersion: 1;
  module: string;
  strategy: ProvenanceStrategy;
  sources: ProvenanceSource[];
  license: ProvenanceLicense;
  authorization?: ProvenanceAuthorization;
  containsCursorBrandAssets: false;
  notes?: string;
}

export interface ValidationErrorDetail {
  keyword: string;
  instancePath: string;
  schemaPath: string;
  message?: string;
  params?: Record<string, unknown>;
}

export type ValidationResult =
  | {
      valid: true;
      data: ProvenanceDocument;
      errors: [];
    }
  | {
      valid: false;
      data?: undefined;
      errors: ValidationErrorDetail[];
    };
