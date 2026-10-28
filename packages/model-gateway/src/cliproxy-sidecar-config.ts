import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type CliProxySidecarRuntimeSecrets = {
  accessToken: string;
  managementSecret: string;
};

export function generateCliProxySidecarRuntimeSecrets(): CliProxySidecarRuntimeSecrets {
  return {
    accessToken: randomBytes(32).toString("hex"),
    managementSecret: randomBytes(32).toString("hex"),
  };
}

export function renderCliProxySidecarConfigV8(input: {
  host: string;
  port: number;
  secrets: CliProxySidecarRuntimeSecrets;
}): string {
  const { host, port, secrets } = input;
  return [
    "config-version: 8",
    "server:",
    `  host: ${JSON.stringify(host)}`,
    `  port: ${port}`,
    "access:",
    "  api-keys:",
    `    - ${JSON.stringify(secrets.accessToken)}`,
    "management:",
    `  secret-key: ${JSON.stringify(secrets.managementSecret)}`,
    "",
  ].join("\n");
}

export function writeCliProxySidecarConfigFile(
  runtimeDirectory: string,
  configBody: string,
): string {
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  const configPath = path.join(runtimeDirectory, "cliproxy-config.yaml");
  fs.writeFileSync(configPath, configBody, "utf8");
  return configPath;
}
