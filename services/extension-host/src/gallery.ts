import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { parseVsixArchive } from "./vsix-installer.js";

export const DEFAULT_GALLERY_URL = "https://open-vsx.org";
const MAX_METADATA = 1024 * 1024;
const MAX_PACKAGE = 100 * 1024 * 1024;

function invalid(message: string): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message);
}

function safeUrl(value: string, base?: string): URL {
  let url: URL;
  try { url = new URL(value, base); } catch { throw invalid("URL da galeria inválida."); }
  if (url.username || url.password || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw invalid("URL da galeria não permitida.");
  }
  return url;
}

async function readResponse(url: URL, limit: number, signal: AbortSignal, allowOpenVsxRedirect = false): Promise<Buffer> {
  let response = await fetch(url, { redirect: "manual", signal });
  if (allowOpenVsxRedirect && [301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) throw invalid("Redirecionamento inválido.");
    const destination = safeUrl(location, url.href);
    if (url.origin !== DEFAULT_GALLERY_URL || destination.origin !== "https://openvsx.eclipsecontent.org") {
      throw invalid("Redirecionamento da galeria não permitido.");
    }
    await response.body?.cancel();
    response = await fetch(destination, { redirect: "manual", signal });
  }
  if (!response.ok || !response.body) throw invalid("Falha ao consultar a galeria.");
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw invalid("Resposta da galeria excede o limite.");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw invalid("Resposta da galeria excede o limite.");
      chunks.push(Buffer.from(chunk));
    }
  } finally {
    await response.body.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

/** Consulta a API Open VSX e entrega um arquivo temporário ao instalador existente. */
export async function withGalleryVsix<T>(
  identifier: string,
  version: string | undefined,
  galleryUrl: string | undefined,
  install: (file: string) => Promise<T>,
): Promise<T> {
  if (typeof identifier !== "string" || !/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i.test(identifier) ||
      (version !== undefined && (typeof version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)))) {
    throw invalid("Identidade ou versão de extensão inválida.");
  }
  const [publisher, name] = identifier.split(".") as [string, string];
  const base = safeUrl(galleryUrl ?? DEFAULT_GALLERY_URL);
  if (base.search) throw invalid("URL da galeria inválida.");
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/api/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}${version ? `/${encodeURIComponent(version)}` : ""}`;
  const signal = AbortSignal.timeout(30000);
  let archive: Buffer;
  try {
    const metadata: unknown = JSON.parse((await readResponse(base, MAX_METADATA, signal)).toString("utf8"));
    if (!metadata || typeof metadata !== "object") throw invalid("Metadados da galeria inválidos.");
    const info = metadata as { namespace?: unknown; name?: unknown; version?: unknown; files?: { download?: unknown } };
    if (typeof info.namespace !== "string" || info.namespace.toLowerCase() !== publisher.toLowerCase() ||
        typeof info.name !== "string" || info.name.toLowerCase() !== name.toLowerCase() ||
        typeof info.version !== "string" || (version !== undefined && info.version !== version) ||
        typeof info.files?.download !== "string") throw invalid("Metadados da extensão não correspondem à solicitação.");
    const download = safeUrl(info.files.download, base.href);
    if (download.origin !== base.origin) throw invalid("Download fora da origem da galeria.");
    archive = await readResponse(download, MAX_PACKAGE, signal, true);
    const files = parseVsixArchive(archive);
    const manifestFile = files.get("extension/package.json");
    if (!manifestFile) throw invalid("Manifesto VSIX ausente.");
    const manifest = JSON.parse(manifestFile.toString("utf8")) as { publisher?: unknown; name?: unknown; version?: unknown };
    if (typeof manifest.publisher !== "string" || manifest.publisher.toLowerCase() !== publisher.toLowerCase() ||
        typeof manifest.name !== "string" || manifest.name.toLowerCase() !== name.toLowerCase() ||
        manifest.version !== info.version) throw invalid("Identidade do VSIX diverge da galeria.");
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw invalid("Falha ao obter extensão da galeria.");
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openagent-gallery-"));
  try {
    const file = path.join(temporary, "extension.vsix");
    await fs.writeFile(file, archive, { mode: 0o600 });
    return await install(file);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
