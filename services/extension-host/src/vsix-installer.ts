import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import {
  type ExtensionManifest,
  formatExtensionIdentifier,
  validateVsixManifest,
} from "@openagent/extension-api";
import { isAbsolutePathInsideRoot } from "@openagent/policy";
import {
  outOfScopePathError,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
} from "@openagent/protocol";

const MAX_ARCHIVE_SIZE = 128 * 1024 * 1024;
const MAX_ENTRY_SIZE = 32 * 1024 * 1024;
const MAX_TOTAL_SIZE = 128 * 1024 * 1024;
const MAX_ENTRIES = 10000;

function archivePathOperation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENAMETOOLONG") {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Caminho do VSIX excede o limite do sistema de arquivos.");
    }
    throw error;
  }
}

// ─── Tabela e cálculo de CRC32 (IEEE 802.3) ───────────────────────────────────

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

export function computeCrc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i] ?? 0;
    const tableIndex = (crc ^ byte) & 0xff;
    crc = (crc >>> 8) ^ (CRC32_TABLE[tableIndex] ?? 0);
  }
  return ((crc ^ 0xffffffff) >>> 0);
}

// ─── Criador de pacotes VSIX / ZIP ───────────────────────────────────────────

export function createVsixArchive(files: Record<string, string | Buffer>): Buffer {
  const localEntries: {
    name: string;
    uncompressedData: Buffer;
    compressedData: Buffer;
    method: number;
    crc: number;
    localHeaderOffset: number;
  }[] = [];

  const parts: Buffer[] = [];
  let currentOffset = 0;

  for (const [name, content] of Object.entries(files)) {
    const uncompressedData = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const crc = computeCrc32(uncompressedData);
    const deflated = zlib.deflateRawSync(uncompressedData);
    const useDeflate = deflated.length < uncompressedData.length;
    const method = useDeflate ? 8 : 0;
    const compressedData = useDeflate ? deflated : uncompressedData;

    const nameBuffer = Buffer.from(name, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(uncompressedData.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localHeaderOffset = currentOffset;
    parts.push(localHeader, nameBuffer, compressedData);
    currentOffset += 30 + nameBuffer.length + compressedData.length;

    localEntries.push({
      name,
      uncompressedData,
      compressedData,
      method,
      crc,
      localHeaderOffset,
    });
  }

  const cdStartOffset = currentOffset;
  let cdSize = 0;

  for (const entry of localEntries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(0, 8);
    cdHeader.writeUInt16LE(entry.method, 10);
    cdHeader.writeUInt16LE(0, 12);
    cdHeader.writeUInt16LE(0, 14);
    cdHeader.writeUInt32LE(entry.crc, 16);
    cdHeader.writeUInt32LE(entry.compressedData.length, 20);
    cdHeader.writeUInt32LE(entry.uncompressedData.length, 24);
    cdHeader.writeUInt16LE(nameBuffer.length, 28);
    cdHeader.writeUInt16LE(0, 30);
    cdHeader.writeUInt16LE(0, 32);
    cdHeader.writeUInt16LE(0, 34);
    cdHeader.writeUInt16LE(0, 36);
    cdHeader.writeUInt32LE(0, 38);
    cdHeader.writeUInt32LE(entry.localHeaderOffset, 42);

    parts.push(cdHeader, nameBuffer);
    currentOffset += 46 + nameBuffer.length;
    cdSize += 46 + nameBuffer.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(localEntries.length, 8);
  eocd.writeUInt16LE(localEntries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStartOffset, 16);
  eocd.writeUInt16LE(0, 20);

  parts.push(eocd);
  return Buffer.concat(parts);
}

// ─── Leitor e Descompactador Seguro de Arquivo VSIX / ZIP ─────────────────────

function findEOCD(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 65557);
  let candidate = -1;
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) !== 0x06054b50 ||
        i + 22 + buffer.readUInt16LE(i + 20) !== buffer.length) continue;
    const count = buffer.readUInt16LE(i + 10);
    const size = buffer.readUInt32LE(i + 12);
    let offset = buffer.readUInt32LE(i + 16);
    if (count > MAX_ENTRIES || offset + size !== i ||
        buffer.readUInt16LE(i + 4) !== 0 || buffer.readUInt16LE(i + 6) !== 0 ||
        buffer.readUInt16LE(i + 8) !== count) continue;
    let entry = 0;
    for (; entry < count && offset + 46 <= i; entry++) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
      offset += 46 + buffer.readUInt16LE(offset + 28) +
        buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    }
    if (entry === count && offset === i) {
      candidate = i;
    }
  }
  return candidate;
}

export function parseVsixArchive(buffer: Buffer, executableModes?: Map<string, number>): Map<string, Buffer> {
  if (!buffer || buffer.length < 22 || buffer.length > MAX_ARCHIVE_SIZE) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Arquivo VSIX corrompido: tamanho menor que cabeçalho zip mínimo.",
    );
  }

  const eocdOffset = findEOCD(buffer);
  if (eocdOffset === -1) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Arquivo VSIX corrompido: cabeçalho zip (EOCD) não encontrado.",
    );
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > MAX_ENTRIES || cdOffset + cdSize !== eocdOffset ||
      eocdOffset + 22 + buffer.readUInt16LE(eocdOffset + 20) !== buffer.length ||
      buffer.readUInt16LE(eocdOffset + 4) !== 0 || buffer.readUInt16LE(eocdOffset + 6) !== 0 ||
      buffer.readUInt16LE(eocdOffset + 8) !== totalEntries) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Arquivo VSIX corrompido: Central Directory fora dos limites.",
    );
  }

  let currentCdOffset = cdOffset;
  const entries = new Map<string, Buffer>();
  let totalSize = 0;

  for (let entryIdx = 0; entryIdx < totalEntries; entryIdx++) {
    if (currentCdOffset + 46 > eocdOffset) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Arquivo VSIX corrompido: entrada do Central Directory truncada.",
      );
    }
    const sig = buffer.readUInt32LE(currentCdOffset);
    if (sig !== 0x02014b50) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Arquivo VSIX corrompido: assinatura inválida no Central Directory.",
      );
    }

    const compressionMethod = buffer.readUInt16LE(currentCdOffset + 10);
    const expectedCrc = buffer.readUInt32LE(currentCdOffset + 16);
    const compressedSize = buffer.readUInt32LE(currentCdOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(currentCdOffset + 24);
    const fileNameLen = buffer.readUInt16LE(currentCdOffset + 28);
    const extraLen = buffer.readUInt16LE(currentCdOffset + 30);
    const commentLen = buffer.readUInt16LE(currentCdOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(currentCdOffset + 42);
    const flags = buffer.readUInt16LE(currentCdOffset + 8);
    const mode = buffer.readUInt32LE(currentCdOffset + 38) >>> 16;
    const unixCreator = buffer.readUInt8(currentCdOffset + 5) === 3;
    const fileType = mode & 0xf000;
    totalSize += uncompressedSize;
    if ((flags & 1) !== 0 || (mode & 0xf000) === 0xa000 ||
        (unixCreator && fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000) ||
        uncompressedSize > MAX_ENTRY_SIZE || totalSize > MAX_TOTAL_SIZE ||
        currentCdOffset + 46 + fileNameLen + extraLen + commentLen > eocdOffset) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Entrada ZIP insegura ou limite excedido.");
    }

    const fileNameBytes = buffer.subarray(currentCdOffset + 46, currentCdOffset + 46 + fileNameLen);
    const rawFileName = fileNameBytes.toString("utf8");

    currentCdOffset += 46 + fileNameLen + extraLen + commentLen;
    if (unixCreator && ((fileType === 0x4000) !== rawFileName.endsWith("/")) && fileType !== 0) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Tipo de entrada ZIP inconsistente.");
    }

    if (localHeaderOffset + 30 > buffer.length) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Arquivo VSIX corrompido: cabeçalho local fora dos limites.",
      );
    }
    const localSig = buffer.readUInt32LE(localHeaderOffset);
    if (localSig !== 0x04034b50) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Arquivo VSIX corrompido: assinatura inválida no cabeçalho local.",
      );
    }
    const localFileNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > cdOffset ||
        !buffer.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localFileNameLen).equals(fileNameBytes) ||
        buffer.readUInt16LE(localHeaderOffset + 8) !== compressionMethod) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Arquivo VSIX corrompido: dados comprimidos fora dos limites.",
      );
    }

    if (rawFileName.endsWith("/")) {
      continue;
    }

    const compressedData = buffer.subarray(dataStart, dataEnd);
    let uncompressedData: Buffer;

    if (compressionMethod === 0) {
      uncompressedData = Buffer.from(compressedData);
    } else if (compressionMethod === 8) {
      try {
        uncompressedData = zlib.inflateRawSync(compressedData, { maxOutputLength: MAX_ENTRY_SIZE });
      } catch (err) {
        throw new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          `Arquivo VSIX corrompido: descompressão falhou para '${rawFileName}': ${(err as Error).message}`,
        );
      }
    } else {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Método de compressão não suportado no VSIX (${compressionMethod}) para '${rawFileName}'.`,
      );
    }

    if (uncompressedData.length !== uncompressedSize) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Arquivo VSIX corrompido: tamanho inconsistente para '${rawFileName}'.`,
      );
    }

    const actualCrc = computeCrc32(uncompressedData);
    if (actualCrc !== expectedCrc || entries.has(rawFileName)) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Arquivo VSIX corrompido: CRC inválido para '${rawFileName}'.`,
      );
    }

    entries.set(rawFileName, uncompressedData);
    if (unixCreator && fileType === 0x8000) {
      executableModes?.set(rawFileName, mode & 0o111);
    }
  }

  if (currentCdOffset !== eocdOffset) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Diretório ZIP inconsistente.");
  }
  return entries;
}

// ─── Resultado da Instalação do VSIX ─────────────────────────────────────────

export interface InstalledVsixResult {
  readonly registrationDir: string;
  readonly manifest: ExtensionManifest;
  readonly extensionId: string;
  readonly version: string;
}

// ─── Instalação Segura e Atômica ──────────────────────────────────────────────

export async function installVsixPackage(
  vsixPath: string,
  extensionsDirectory: string,
  validateRegistration?: (directory: string) => void,
): Promise<InstalledVsixResult> {
  if (typeof vsixPath !== "string" || !vsixPath.trim()) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Caminho do arquivo VSIX é obrigatório.",
    );
  }

  if (typeof extensionsDirectory !== "string" || !extensionsDirectory.trim()) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Diretório de extensões é obrigatório.",
    );
  }

  const resolvedVsixPath = path.resolve(vsixPath.trim());
  if (!fs.existsSync(resolvedVsixPath)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Arquivo VSIX não encontrado: ${vsixPath}`,
    );
  }

  let vsixBuffer: Buffer;
  try {
    if (fs.statSync(resolvedVsixPath).size > MAX_ARCHIVE_SIZE) {
      throw new Error("Arquivo excede o limite permitido.");
    }
    vsixBuffer = fs.readFileSync(resolvedVsixPath);
  } catch (err) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Falha ao ler arquivo VSIX: ${(err as Error).message}`,
    );
  }

  const executableModes = new Map<string, number>();
  const entries = parseVsixArchive(vsixBuffer, executableModes);
  if (entries.size === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Arquivo VSIX está vazio.",
    );
  }

  const extensionEntries = new Map<string, Buffer>();
  const extensionExecutableModes = new Map<string, number>();
  const hasExtensionPrefix = Array.from(entries.keys()).some((k) => k.startsWith("extension/"));

  for (const [rawEntryName, entryContent] of entries) {
    const normalizedSlash = rawEntryName.replace(/\\/g, "/");

    if (normalizedSlash.includes("\0")) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Caminho de arquivo inválido no VSIX (caractere nulo): ${rawEntryName}`,
      );
    }

    if (path.isAbsolute(normalizedSlash) || /^[a-zA-Z]:\//.test(normalizedSlash)) {
      throw outOfScopePathError(rawEntryName);
    }
    if (normalizedSlash.split("/").includes("..")) throw outOfScopePathError(rawEntryName);

    let relativePath: string;
    if (hasExtensionPrefix) {
      if (!normalizedSlash.startsWith("extension/")) {
        continue;
      }
      relativePath = normalizedSlash.slice("extension/".length);
    } else {
      if (normalizedSlash.startsWith("[Content_Types].xml") || normalizedSlash.startsWith("extension.vsixmanifest")) {
        continue;
      }
      relativePath = normalizedSlash;
    }

    if (!relativePath || relativePath === ".") {
      continue;
    }

    const pathSegments = relativePath.split("/");
    if (pathSegments.includes("..") || pathSegments.some((seg) => seg.trim() === "..")) {
      throw outOfScopePathError(rawEntryName);
    }

    const normalizedRelative = path.normalize(relativePath);
    if (normalizedRelative === ".." || normalizedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(normalizedRelative)) {
      throw outOfScopePathError(rawEntryName);
    }

    const firstSegment = normalizedRelative.split(path.sep)[0];
    if (firstSegment?.toLowerCase() === ".publication") {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Caminho reservado no VSIX.");
    }
    if (extensionEntries.has(normalizedRelative)) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Caminho duplicado no VSIX.");
    }
    extensionEntries.set(normalizedRelative, entryContent);
    extensionExecutableModes.set(normalizedRelative, executableModes.get(rawEntryName) ?? 0);
  }

  for (const entryPath of extensionEntries.keys()) {
    let parent = path.dirname(entryPath);
    while (parent !== ".") {
      if (extensionEntries.has(parent)) {
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Colisão entre arquivo e diretório no VSIX.");
      }
      parent = path.dirname(parent);
    }
  }

  if (extensionEntries.size === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Nenhum arquivo de extensão válido encontrado dentro do pacote VSIX.",
    );
  }

  const packageJson = extensionEntries.get("package.json");
  if (!packageJson) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Manifesto package.json ausente no pacote VSIX.");
  }
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(packageJson.toString("utf8"));
  } catch (err) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Manifesto package.json inválido no VSIX: ${(err as Error).message}`,
    );
  }
  const validation = validateVsixManifest(manifestRaw, {
    requireEngines: true,
  });
  if (!validation.valid || !validation.manifest) {
    throw validation.error ?? new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Manifesto de extensão inválido no VSIX.");
  }
  const manifest = validation.manifest;
  const extensionId = formatExtensionIdentifier(manifest.publisher, manifest.name);
  const mainRelative = manifest.main;
  const normalizedMain = mainRelative === undefined ? undefined : path.normalize(mainRelative);
  if (mainRelative !== undefined && normalizedMain !== undefined &&
      (path.isAbsolute(mainRelative) || normalizedMain === ".." ||
      normalizedMain.startsWith(`..${path.sep}`) || !extensionEntries.has(normalizedMain))) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Ponto de entrada 'main' (${mainRelative}) não encontrado no pacote VSIX.`,
    );
  }

  const extract = (tempStageDir: string): void => {
    for (const [relPath, content] of extensionEntries) {
      const destinationFile = path.resolve(tempStageDir, relPath);
      if (!isAbsolutePathInsideRoot(tempStageDir, destinationFile)) {
        throw outOfScopePathError(relPath);
      }
      try {
        archivePathOperation(() => {
          fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
          fs.writeFileSync(destinationFile, content, { flag: "wx", mode: 0o666 | (extensionExecutableModes.get(relPath) ?? 0) });
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST" || code === "ENOTDIR" || code === "EISDIR") {
          throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, `Caminho inválido ou conflitante no VSIX: ${relPath}`);
        }
        throw error;
      }
    }
  };

  const targetDirName = `${extensionId}-${manifest.version}`;
  const requestedRoot = path.resolve(extensionsDirectory);
  const createdDirectories: { path: string; dev: number; ino: number }[] = [];
  let tempStageDir: string | undefined;
  let published = false;

  try {
    const missing: string[] = [];
    let current = requestedRoot;
    while (!fs.existsSync(current)) {
      missing.push(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    for (const directory of missing.reverse()) {
      try {
        fs.mkdirSync(directory);
        const stat = fs.lstatSync(directory);
        createdDirectories.push({ path: directory, dev: stat.dev, ino: stat.ino });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (!fs.statSync(directory).isDirectory()) throw error;
      }
    }
    const root = fs.realpathSync(requestedRoot);
    tempStageDir = fs.mkdtempSync(path.join(root, ".tmp-vsix-"));
    extract(tempStageDir);
    const mainCandidate = mainRelative === undefined ? undefined : path.resolve(tempStageDir, mainRelative);
    if (mainCandidate !== undefined && (!isAbsolutePathInsideRoot(tempStageDir, mainCandidate) ||
        !archivePathOperation(() => fs.statSync(mainCandidate, { throwIfNoEntry: false }))?.isFile() ||
        !isAbsolutePathInsideRoot(tempStageDir, archivePathOperation(() => fs.realpathSync(mainCandidate))))) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Ponto de entrada 'main' (${mainRelative}) não encontrado no pacote VSIX.`,
      );
    }

    const targetDir = path.resolve(root, targetDirName);

    if (!isAbsolutePathInsideRoot(root, targetDir) || path.dirname(targetDir) !== root) {
      throw outOfScopePathError(targetDir);
    }
    validateRegistration?.(tempStageDir);
    const marker = path.join(tempStageDir, ".publication");
    fs.writeFileSync(marker, path.basename(tempStageDir), { flag: "wx" });
    try {
      archivePathOperation(() => fs.linkSync(marker, targetDir));
      published = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ProtocolError(PROTOCOL_ERROR_CODES.CONFLICT, "Versão da extensão já instalada.");
      }
      throw error;
    }

    return {
      registrationDir: tempStageDir,
      manifest,
      extensionId,
      version: manifest.version,
    };
  } catch (error) {
    try {
      if (!published && tempStageDir && fs.existsSync(tempStageDir)) {
        fs.rmSync(tempStageDir, { recursive: true, force: true });
      }
    } catch {
      // ignora erro de limpeza
    }
    for (const directory of createdDirectories.reverse()) {
      try {
        const stat = fs.lstatSync(directory.path);
        if (stat.dev === directory.dev && stat.ino === directory.ino && stat.isDirectory()) {
          fs.rmdirSync(directory.path);
        }
      } catch {
        // Concurrent use or environmental failures can prevent cleanup.
      }
    }
    throw error;
  }
}
