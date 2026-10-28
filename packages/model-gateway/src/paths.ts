import { fileURLToPath } from "node:url";

/** Diretório `packaging/sidecars/cliproxyapi` na raiz do repositório. */
export function resolveCliProxySidecarPackagingDirectory(): string {
  return fileURLToPath(new URL("../../../packaging/sidecars/cliproxyapi/", import.meta.url));
}
