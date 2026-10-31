#!/usr/bin/env node
/**
 * task_183 — Pacote Linux: daemon, workers e sidecar (LOC-01).
 *
 * Gera um .tar.gz auto-contido a partir do workspace:
 *   bin/openagent-daemon.mjs      daemon do harness (esbuild, node >= 20)
 *   workers/tools-worker.mjs      worker de ferramentas (esbuild)
 *   workers/extensions-worker.mjs worker do extension host (esbuild)
 *   sidecars/cliproxyapi/*        pin-manifest, SBOM, provenance e checksums
 *   editor/*                      runtime do editor Electron (recursos web)
 *   install.sh                    instalador com verificação SHA256
 *   sha256sums.txt                soma de todos os arquivos empacotados
 *   package-manifest.json         metadados + versão do protocolo
 *
 * LIMITAÇÃO (task_183): o binário do CLIProxyAPI não é baixado/fornecido aqui
 * (release offline). O pacote entrega pin-manifest + SBOM + provenance com o
 * checksum esperado; validação do binário real fica para o smoke de rede.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import os from "node:os";

const require = createRequire(import.meta.url);
// esbuild em ESM converte require de node:* para "Dynamic require" em runtime;
// injetamos um shim que redireciona para createRequire(import.meta.url).
const SEMIBANNER = `import { createRequire as __cr } from "node:module";\nconst require = __cr(import.meta.url);\n`;
const esbuild = require("esbuild");
const { execFileSync } = require("node:child_process");

// Resolve a raiz a partir de process.cwd() quando ele é o repo, subindo até achar o monorepo.
// resolvemos a raiz a partir de process.cwd() quando ele é o repo, senão subimos até achar package.json.
function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "services", "harness-daemon"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}
const repoRoot = findRepoRoot(process.cwd());

export function buildPackageLinux(options = {}) {
  const outRoot = options.outRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "openagent-linux-pkg-"));
  const staging = path.join(outRoot, "staging");
  const packageRoot = options.packageRoot ?? "openagent-editor";
  const stagedDir = path.join(staging, packageRoot);

  fs.mkdirSync(stagedDir, { recursive: true });

  const entries = {
    daemon: {
      entry: path.join(repoRoot, "services", "harness-daemon", "src", "daemon-entry.ts"),
      outfile: path.join(stagedDir, "bin", "openagent-daemon.mjs"),
    },
    toolsWorker: {
      entry: path.join(repoRoot, "packages", "tools", "src", "worker", "worker-entry.mjs"),
      outfile: path.join(stagedDir, "workers", "tools-worker.mjs"),
    },
    extensionsWorker: {
      entry: path.join(repoRoot, "services", "extension-host", "src", "worker-entry.mjs"),
      outfile: path.join(stagedDir, "workers", "extensions-worker.mjs"),
    },
  };

  for (const spec of Object.values(entries)) {
    fs.mkdirSync(path.dirname(spec.outfile), { recursive: true });
    // bundles: ESM node, externais apenas node:* — nada de npm runtime no pacote.
    esbuild.buildSync({
      entryPoints: [spec.entry],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
            banner: {
        js: SEMIBANNER,
      },
      external: ["node:*", "electron"],
      outfile: spec.outfile,
      logLevel: "silent",
      legalComments: "none",
    });
    spec.outfile = path.relative(stagedDir, spec.outfile);
  }

  // Sidecar: arquivos declarativos pin + SBOM + provenance (binário offline: ver README).
  const sidecarSourceDir = path.join(repoRoot, "packaging", "sidecars", "cliproxyapi");
  const sidecarOutDir = path.join(stagedDir, "sidecars", "cliproxyapi");
  fs.mkdirSync(sidecarOutDir, { recursive: true });
  for (const file of ["pin-manifest.json", "sbom.cdx.json", "provenance.json"]) {
    fs.copyFileSync(path.join(sidecarSourceDir, file), path.join(sidecarOutDir, file));
  }

  // Runtime do editor: recursos web + entry do Electron main.
  const editorRuntimeSrc = path.join(repoRoot, "apps", "editor", "runtime");
  const editorOutDir = path.join(stagedDir, "editor");
  fs.mkdirSync(editorOutDir, { recursive: true });
  for (const file of fs.readdirSync(editorRuntimeSrc)) {
    if (file === "README.md" || file === "main.mjs") continue; // main.mjs tsx do dev não vai pro pacote
    fs.copyFileSync(path.join(editorRuntimeSrc, file), path.join(editorOutDir, file));
  }
  // Entry Electron main do pacote (sem tsx): usa o bundle do runtime compilado no build do editor.
  fs.writeFileSync(
    path.join(editorOutDir, "main.mjs"),
    'import "./runtime.mjs";\n',
  );

  esbuild.buildSync({
    entryPoints: [path.join(editorRuntimeSrc, "runtime.ts")],
    bundle: true, platform: "node", format: "esm", target: "node20",
    external: ["node:*", "electron"],
    outfile: path.join(editorOutDir, "runtime.mjs"),
  });

  const readPackage = (pkgDir) => JSON.parse(fs.readFileSync(path.join(repoRoot, pkgDir, "package.json"), "utf8"));
  const daemonPackage = readPackage("services/harness-daemon");
  const toolsPackage = readPackage("packages/tools");
  const editorPackage = readPackage("apps/editor");
  const pinManifest = JSON.parse(fs.readFileSync(path.join(sidecarSourceDir, "pin-manifest.json"), "utf8"));

  const manifest = {
    schemaVersion: 1,
    packageName: packageRoot,
    platform: {
      os: "linux",
      arch: options.arch ?? process.arch,
    },
    packages: {
      daemon: daemonPackage.version,
      tools: toolsPackage.version,
      editor: editorPackage.version,
    },
    sidecar: {
      component: pinManifest.component,
      version: pinManifest.version,
      gitCommit: pinManifest.gitCommit,
      checksumsUrl: pinManifest.upstream.checksumsUrl,
    },
    entries,
  };
  fs.writeFileSync(
    path.join(stagedDir, "package-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  // install.sh: POSIX-safe, prefixo local, sha256 antes de copiar.
  const installScript = `#!/usr/bin/env sh
set -eu
usage() {
  cat <<USAGE
Uso: install.sh [--prefix DIR] [--verify-only] [--help]

Instala o OpenAgent Editor em $HOME/.local/share/OpenAgent por padrão.
--verify-only confere os checksums e sai.
USAGE
}
prefix=""$HOME"/.local/share/OpenAgent"
verify_only=0
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix="$2"; shift 2 ;;
    --verify-only) verify_only=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "opção desconhecida: $1" >&2; usage >&2; exit 2 ;;
  esac
done
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum ausente" >&2; exit 2; }
cd "$(dirname "$0")"
[ -f sha256sums.txt ] || { echo "sha256sums.txt ausente" >&2; exit 2; }
if ! sha256sum -c sha256sums.txt --status; then
  echo "checksum do pacote não confere" >&2
  exit 3
fi
if [ "$verify_only" = "1" ]; then
  echo "checksums OK"
  exit 0
fi
command -v node >/dev/null 2>&1 || { echo "node >= 20 ausente no PATH" >&2; exit 4; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || { echo "node >= 20 necessário (encontrado $NODE_MAJOR)" >&2; exit 4; }
mkdir -p "$prefix"
cp -r bin workers sidecars editor package-manifest.json "$prefix/"
echo "instalado em $prefix"
`;
  fs.writeFileSync(path.join(stagedDir, "install.sh"), installScript, { mode: 0o755 });

  // sha256sums.txt determinístico (ordem alfabética, sem stdbuf).
  const hashFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) hashFiles.push(full);
    }
  };
  walk(stagedDir);
  const sums = hashFiles.map((file) => {
    const hashSum = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    return `${hashSum}  ${path.relative(stagedDir, file)}`;
  }).join("\n") + "\n";
  fs.writeFileSync(path.join(stagedDir, "sha256sums.txt"), sums);

  // tarball determinístico (mtime/uid/gid fixados).
  const tarballPath = options.tarballPath ?? path.join(outRoot, `${packageRoot}-linux-${process.arch}.tar.gz`);
  const tarArgs = [
    "--create", "--gzip",
    "--file", tarballPath,
    "--directory", staging,
    "--owner", "0", "--group", "0", "--numeric-owner",
    "--mtime", "2026-01-01 00:00:00 UTC",
    "--sort", "name",
    packageRoot,
  ];
  try {
    execFileSync("tar", tarArgs, { stdio: "pipe" });
  } catch (error) {
    const fallback = new Error(`tar GNU indisponível: ${error.message}`);
    fallback.code = "TAR_UNSUPPORTED";
    throw fallback;
  }

  const packageSha256 = createHash("sha256").update(fs.readFileSync(tarballPath)).digest("hex");

  return {
    tarballPath,
    packageSha256,
    staging,
    manifest,
    entries,
  };
}

// CLI: node packaging/linux/build-package-linux.mjs [--out DIR] [--arch x64]
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const result = buildPackageLinux({
    outRoot: get("--out"),
    arch: get("--arch"),
    tarballPath: get("--tarball"),
  });
  console.log(JSON.stringify({ tarballPath: result.tarballPath, packageSha256: result.packageSha256 }, null, 2));
}
