#!/usr/bin/env node
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runProvenanceGateCli } from "@openagent/provenance";

const defaultRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requiredManifests = [
  "packages/extension-api/provenance.json",
  "services/extension-host/provenance.json",
];

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root" || arg === "-r") {
      options.rootDir = argv[i + 1];
      i += 1;
    } else if (arg === "--silent" || arg === "-s") {
      options.silent = true;
    } else if (arg === "--no-hash-check") {
      options.verifyDocumentHash = false;
    } else if (arg === "--ignore") {
      options.ignore = [];
      i += 1;
      while (i < argv.length && !argv[i].startsWith("--")) {
        options.ignore.push(argv[i]);
        i += 1;
      }
      i -= 1;
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const rootDir = options.rootDir ? resolve(options.rootDir) : defaultRoot;

const scopedManifests = requiredManifests
  .map((manifest) => relative(rootDir, resolve(defaultRoot, manifest)))
  .filter((manifest) => manifest !== ".." && !manifest.startsWith(`..${sep}`) && !isAbsolute(manifest));

const exitCode = await runProvenanceGateCli({ ...options, rootDir, requiredManifests: scopedManifests });
process.exit(exitCode);
