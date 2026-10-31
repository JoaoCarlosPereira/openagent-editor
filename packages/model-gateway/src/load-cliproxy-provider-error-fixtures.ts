import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { resolveCliProxySidecarPackagingDirectory } from "./paths.js";

export type CliProxyProviderErrorFixtureSample = {
  httpStatus: number;
  body: { error?: { message?: string; type?: string } };
  expectedCode: string;
};

export type CliProxyProviderErrorFixtures = {
  description: string;
  pinVersion: string;
  gitCommitShort: string;
  samples: Record<string, CliProxyProviderErrorFixtureSample>;
};

function fixturesInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function parseFixtures(raw: unknown): CliProxyProviderErrorFixtures {
  if (!raw || typeof raw !== "object") {
    fixturesInvalid("Fixtures de erro do CLIProxyAPI malformadas.");
  }
  const doc = raw as CliProxyProviderErrorFixtures;
  if (typeof doc.description !== "string" || !doc.description.trim()) {
    fixturesInvalid("Fixtures de erro do CLIProxyAPI: description ausente.");
  }
  if (doc.pinVersion !== "8.0.45" || doc.gitCommitShort !== "ad8bdd3") {
    fixturesInvalid("Fixtures de erro do CLIProxyAPI: pin divergente do ADR-005.");
  }
  if (!doc.samples || typeof doc.samples !== "object") {
    fixturesInvalid("Fixtures de erro do CLIProxyAPI: samples ausentes.");
  }
  for (const [key, sample] of Object.entries(doc.samples)) {
    if (typeof sample.httpStatus !== "number" || sample.httpStatus < 400) {
      fixturesInvalid(`Fixtures de erro do CLIProxyAPI: httpStatus inválido em ${key}.`);
    }
    if (typeof sample.expectedCode !== "string" || !sample.expectedCode.startsWith("PROVIDER_")) {
      fixturesInvalid(`Fixtures de erro do CLIProxyAPI: expectedCode inválido em ${key}.`);
    }
  }
  return doc;
}

/** Carrega fixtures congeladas em packaging/sidecars/cliproxyapi (contrato API-02). */
export function loadCliProxyProviderErrorFixtures(): CliProxyProviderErrorFixtures {
  const path = join(resolveCliProxySidecarPackagingDirectory(), "provider-error-fixtures.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    fixturesInvalid("Fixtures de erro do CLIProxyAPI ilegíveis ou ausentes.");
  }
  return parseFixtures(raw);
}
