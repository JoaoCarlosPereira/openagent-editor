import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { spawn as spawnChildProcess, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import {
  FROZEN_EXTENSION_API_VERSION,
  formatExtensionIdentifier,
  validateExtensionManifest,
  validateVsixManifest,
} from "@openagent/extension-api";
import { isAbsolutePathInsideRoot } from "@openagent/policy";
import {
  outOfScopePathError,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
} from "@openagent/protocol";

import { installVsixPackage } from "./vsix-installer.js";
import { withGalleryVsix } from "./gallery.js";

import type {
  ExtensionHostConfig,
  ExtensionRegistration,
  ExtensionWorkerRequest,
  ExtensionWorkerRequestPayload,
  ExtensionWorkerResponse,
} from "./types.js";

const DEFAULT_WORKER_ENTRY = fileURLToPath(
  new URL("./worker-entry.mjs", import.meta.url),
);

interface ExtensionLockDescriptor {
  pid: number;
  token: string;
  generation: number;
  extensionActive: boolean;
}

// Liveness do holder só resolve no mesmo computador; hosts em máquinas
// distintas compartilham o diretório via rede e pid local não vale — o
// CONTRATO de lock vale para hosts locais (mesma máquina), o que é o
// escopo declarado da camada.
function holderProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function compareSemverPrecedence(a: string, b: string): number {
  const [, coreA = "", preA] = /^([^-+]+)(?:-([^+]+))?/.exec(a) ?? [];
  const [, coreB = "", preB] = /^([^-+]+)(?:-([^+]+))?/.exec(b) ?? [];
  const compareNumber = (x: string, y: string) => x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
  const aa = coreA.split(".");
  const bb = coreB.split(".");
  for (let i = 0; i < 3; i++) {
    const result = compareNumber(aa[i] ?? "0", bb[i] ?? "0");
    if (result) return result;
  }
  if (preA === undefined || preB === undefined) return preA === preB ? 0 : preA === undefined ? 1 : -1;
  const ap = preA.split(".");
  const bp = preB.split(".");
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const x = ap[i], y = bp[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return compareNumber(x, y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function compareVersions(a: string, b: string): number {
  // Build metadata has no SemVer precedence; prefer the lexical first version on ties.
  return compareSemverPrecedence(a, b) || (a < b ? 1 : a > b ? -1 : 0);
}

export interface IsolatedExtensionHostOptions {
  workerEntryPath?: string;
  execArgv?: string[];
  editorRequest?: (request: { extensionId: string; operation: string; args: unknown[] }) => unknown | Promise<unknown>;
  authorizeEditorRequest?: (request: { extensionId: string; operation: string; args: unknown[] }) => boolean | Promise<boolean>;
}

export type ExtensionHostEventListener = (event: {
  eventType: string;
  payload: unknown;
}) => void;

export type VsixInstallResult = ExtensionRegistration & {
  status?: "published_recovery_required";
  publication?: { extensionId: string; version: string };
  warning?: string;
  recovery?: "restart_host";
};

/**
 * Extension host isolado que gerencia extensões e executa seu código
 * em um worker thread/processo dedicado fora do renderer.
 */
export class IsolatedExtensionHost {
  private readonly config: ExtensionHostConfig;
  private readonly worker: Worker;
  private readonly options: IsolatedExtensionHostOptions;
  private readonly extensionWorkers = new Map<string, Worker>();
  private readonly stoppingWorkers = new Map<string, Promise<void>>();
  private readonly commands = new Map<string, string>();
  private readonly completionProviders = new Map<
    string,
    { extensionId: string; providerId: string; selector: unknown; triggerCharacters?: string[] }
  >();
  private readonly hoverProviders = new Map<
    string,
    { extensionId: string; providerId: string; selector: unknown }
  >();
  private terminated = false;
  private termination?: Promise<void>;
  private nextRequestId = 0;
  private readonly extensions = new Map<string, ExtensionRegistration>();
  private readonly installing = new Set<string>();
  private readonly changingEnablement = new Set<string>();
  private readonly extensionLocks = new Map<string, ExtensionLockDescriptor>();
  private readonly failingWorkers = new Set<string>();
  private reaperProcess?: ChildProcess;
  private readonly childOwners = new Map<number, string>();
  private readonly lockToken = randomUUID();
  private nextLockGeneration = 0;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      worker: Worker;
    }
  >();
  private readonly listeners = new Set<ExtensionHostEventListener>();

  private constructor(config: ExtensionHostConfig, worker: Worker, options: IsolatedExtensionHostOptions) {
    this.config = config;
    this.worker = worker;
    this.options = options;
    this.attachWorker(worker);
  }

  private attachWorker(worker: Worker, owner?: string): void {
    worker.on("message", (message: ExtensionWorkerResponse) => {
      if (!message || typeof message !== "object") {
        return;
      }
      if (owner && (this.extensionWorkers.get(owner) !== worker ||
          this.stoppingWorkers.has(owner) || this.failingWorkers.has(owner))) return;

      if (message.kind === "childProc") {
        const ownerId = owner;
        if (ownerId && typeof message.pid === "number" && Number.isSafeInteger(message.pid) && message.pid > 0) {
          if (message.eventType === "spawned") this.trackChild(ownerId, message.pid);
          if (message.eventType === "exited") this.forgetChild(message.pid, ownerId);
        }
        return;
      }

      if (message.kind === "editorRequest") {
        void (async () => {
          try {
            if (typeof message.requestId !== "string" || !/^editor-\d+$/.test(message.requestId) ||
                typeof message.extensionId !== "string" || !Array.isArray(message.args)) {
              throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Requisição de editor inválida.");
            }
            if (!owner || message.extensionId !== owner) {
              throw new ProtocolError(PROTOCOL_ERROR_CODES.PERMISSION_DENIED, "Identidade de extensão inválida.");
            }
            const extension = this.extensions.get(owner);
            if (!extension || !["loading", "active"].includes(extension.state)) {
              throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Extensão não está ativa.");
            }
            const [uri, version, edits] = message.args;
            if (!["openTextDocument", "applyTextEdits", "setDecorations"].includes(message.operation) ||
                typeof uri !== "string" || !uri || uri.includes("\0") ||
                (message.operation === "openTextDocument" && message.args.length !== 1) ||
                (message.operation !== "openTextDocument" && message.args.length !== 3) ||
                (message.operation === "applyTextEdits" && (!Number.isSafeInteger(version) || !Array.isArray(edits))) ||
                (message.operation === "setDecorations" && (!version || typeof version !== "object" || !Array.isArray(edits)))) {
              throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Operação de editor inválida.");
            }
            if (!this.options.editorRequest) throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Editor indisponível.");
            if (!this.options.authorizeEditorRequest || !await this.options.authorizeEditorRequest(message)) {
              throw new ProtocolError(PROTOCOL_ERROR_CODES.PERMISSION_DENIED, "Operação de editor não autorizada.");
            }
            if (this.terminated || this.extensionWorkers.get(owner) !== worker ||
                this.extensions.get(owner) !== extension || !["loading", "active"].includes(extension.state)) {
              throw new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "Extensão não está mais ativa.");
            }
            const output = await this.options.editorRequest(message);
            worker.postMessage({ kind: "editorResponse", requestId: message.requestId, output });
          } catch (error) {
            worker.postMessage({
              kind: "editorResponse", requestId: message.requestId,
              error: { code: error instanceof ProtocolError ? error.code : PROTOCOL_ERROR_CODES.INVALID_STATE,
                message: error instanceof Error ? error.message : String(error) },
            });
          }
        })();
        return;
      }

      if (message.kind === "event") {
        if (owner && message.eventType === "commandRegistered" && message.payload && typeof message.payload === "object") {
          const payload = message.payload as { command?: unknown };
          if (typeof payload.command === "string") this.commands.set(payload.command, owner);
        }
        if (owner && message.eventType === "completionProviderRegistered" && message.payload && typeof message.payload === "object") {
          const payload = message.payload as { providerId?: unknown; selector?: unknown; triggerCharacters?: unknown };
          if (typeof payload.providerId === "string") {
            const key = `${owner}:${payload.providerId}`;
            this.completionProviders.set(key, {
              extensionId: owner,
              providerId: payload.providerId,
              selector: payload.selector,
              triggerCharacters: Array.isArray(payload.triggerCharacters) ? payload.triggerCharacters as string[] : undefined,
            });
          }
        }
        if (message.eventType === "completionProviderUnregistered" && message.payload && typeof message.payload === "object") {
          const payload = message.payload as { providerId?: unknown };
          if (typeof payload.providerId === "string") {
            const key = owner ? `${owner}:${payload.providerId}` : payload.providerId;
            this.completionProviders.delete(key);
          }
        }
        if (owner && message.eventType === "hoverProviderRegistered" && message.payload && typeof message.payload === "object") {
          const payload = message.payload as { providerId?: unknown; selector?: unknown };
          if (typeof payload.providerId === "string") {
            const key = `${owner}:${payload.providerId}`;
            this.hoverProviders.set(key, {
              extensionId: owner,
              providerId: payload.providerId,
              selector: payload.selector,
            });
          }
        }
        if (message.eventType === "hoverProviderUnregistered" && message.payload && typeof message.payload === "object") {
          const payload = message.payload as { providerId?: unknown };
          if (typeof payload.providerId === "string") {
            const key = owner ? `${owner}:${payload.providerId}` : payload.providerId;
            this.hoverProviders.delete(key);
          }
        }
        for (const listener of this.listeners) {
          try {
            listener({ eventType: message.eventType, payload: message.payload });
          } catch {
            // ignora erro do listener
          }
        }
        return;
      }

      const pending = this.pending.get(message.requestId);
      if (!pending || pending.worker !== worker) {
        return;
      }
      this.pending.delete(message.requestId);

      if (message.kind === "result") {
        pending.resolve(message.output);
        return;
      }

      if (message.kind === "error") {
        pending.reject(
          new ProtocolError(
            message.code || PROTOCOL_ERROR_CODES.INVALID_STATE,
            message.message,
            message.details,
          ),
        );
      }
    });

    const invalidateWorker = (error: Error, exited: boolean) => {
      if (owner && this.extensionWorkers.get(owner) === worker) {
        if (exited) this.extensionWorkers.delete(owner);
        this.clearExtensionRegistrations(owner);
        const registration = this.extensions.get(owner);
        if (registration && ["loading", "active", "deactivating"].includes(registration.state)) {
          registration.state = "failed";
          registration.lastError = error.message;
        }
      }
      for (const [id, entry] of this.pending) {
        if (entry.worker !== worker) continue;
        entry.reject(error);
        this.pending.delete(id);
      }
    };
    let failedBeforeExit = false;
    worker.on("error", (error) => {
      failedBeforeExit = !!owner && this.extensionWorkers.get(owner) === worker;
      if (owner && failedBeforeExit) this.failingWorkers.add(owner);
      invalidateWorker(error, false);
    });
    worker.on("exit", (code) => {
      const wasOwner = owner && this.extensionWorkers.get(owner) === worker;
      invalidateWorker(new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, `Worker encerrado (código ${code}).`), true);
      if (owner && (wasOwner || failedBeforeExit)) {
        this.failingWorkers.delete(owner);
        this.killOwnedChildren(owner);
        if (!this.changingEnablement.has(owner)) {
          this.releaseExtensionLock(owner);
        }
      }
    });
  }

  static async spawn(
    config: ExtensionHostConfig,
    options: IsolatedExtensionHostOptions = {},
  ): Promise<IsolatedExtensionHost> {
    IsolatedExtensionHost.validateHostConfig(config);

    const workerPath = options.workerEntryPath ?? DEFAULT_WORKER_ENTRY;
    const worker = new Worker(workerPath, {
      execArgv: options.execArgv,
    });

    const host = new IsolatedExtensionHost(config, worker, options);
    try {
      await host.initWorker();
      host.restoreInstalledExtensions();
      host.startReaperProcess();
      return host;
    } catch (error) {
      await host.terminate();
      throw error;
    }
  }

  private static validateHostConfig(config: ExtensionHostConfig): void {
    if (!config || typeof config !== "object") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Configuração do Extension Host inválida.",
      );
    }
    if (typeof config.workspaceRoot !== "string" || !config.workspaceRoot.trim()) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "workspaceRoot é obrigatório.",
      );
    }
    if (
      typeof config.extensionsDirectory !== "string" ||
      !config.extensionsDirectory.trim()
    ) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "extensionsDirectory é obrigatório.",
      );
    }
  }

  addEventListener(listener: ExtensionHostEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async sendRequest<T = unknown>(
    request: ExtensionWorkerRequestPayload,
    worker: Worker = this.worker,
  ): Promise<T> {
    if (this.terminated) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Extension host já foi encerrado.",
      );
    }

    const requestId = `req-${this.nextRequestId++}`;
    const fullRequest = { ...request, requestId } as ExtensionWorkerRequest;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (v) => resolve(v as T),
        reject,
        worker,
      });
      try {
        worker.postMessage(fullRequest);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async initWorker(): Promise<void> {
    await this.sendRequest({ kind: "init", config: this.config });
  }

  private clearExtensionRegistrations(extensionId: string): void {
    for (const [command, owner] of this.commands) {
      if (owner === extensionId) this.commands.delete(command);
    }
    for (const [id, provider] of this.completionProviders) {
      if (provider.extensionId === extensionId) this.completionProviders.delete(id);
    }
    for (const [id, provider] of this.hoverProviders) {
      if (provider.extensionId === extensionId) this.hoverProviders.delete(id);
    }
  }

  private async discardExtensionWorker(extensionId: string): Promise<void> {
    const stopping = this.stoppingWorkers.get(extensionId);
    if (stopping) return stopping;
    const worker = this.extensionWorkers.get(extensionId);
    if (worker) {
      for (const [id, request] of this.pending) {
        if (request.worker !== worker) continue;
        this.pending.delete(id);
        request.reject(new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "Worker da extensão encerrado."));
      }
      const termination = worker.terminate().then(() => {
        if (this.extensionWorkers.get(extensionId) === worker) this.extensionWorkers.delete(extensionId);
        this.clearExtensionRegistrations(extensionId);
      });
      this.stoppingWorkers.set(extensionId, termination);
      try {
        await termination;
        this.killOwnedChildren(extensionId);
      } catch (error) {
        if (this.extensionWorkers.get(extensionId) === worker) this.failingWorkers.add(extensionId);
        throw error;
      } finally {
        this.stoppingWorkers.delete(extensionId);
      }
    }
    this.clearExtensionRegistrations(extensionId);
  }

  private restoreInstalledExtensions(): void {
    if (!fs.existsSync(this.config.extensionsDirectory)) return;
    const root = fs.realpathSync(this.config.extensionsDirectory);
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || entry.name.startsWith(".tmp-vsix-")) continue;
      try {
        const index = path.join(root, entry.name);
        const stageName = fs.readFileSync(index, "utf8");
        if (!/^\.tmp-vsix-[a-zA-Z0-9]+$/.test(stageName)) continue;
        const directory = path.join(root, stageName);
        if (!fs.lstatSync(directory).isDirectory()) continue;
        const marker = fs.lstatSync(path.join(directory, ".publication"));
        const indexStat = fs.lstatSync(index);
        if (!marker.isFile() || marker.dev !== indexStat.dev || marker.ino !== indexStat.ino) continue;
        const manifestPath = this.assertCanonicalPathInRoot(directory, path.join(directory, "package.json"));
        if (!fs.lstatSync(manifestPath).isFile()) continue;
        const validation = validateVsixManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
        if (!validation.valid || !validation.manifest) continue;
        const manifest = validation.manifest;
        if (entry.name !== `${formatExtensionIdentifier(manifest.publisher, manifest.name)}-${manifest.version}`) continue;
        const previous = this.extensions.get(formatExtensionIdentifier(manifest.publisher, manifest.name));
        if (previous && compareVersions(previous.manifest.version, manifest.version) >= 0) continue;
        const registration = this.inspectExtensionFromDirectory(directory, true);
        this.extensions.set(registration.id, registration);
      } catch {
        // Incomplete or invalid installations are not added to the catalog.
      }
    }
  }

  async ping(): Promise<{ pong: true }> {
    return this.sendRequest<{ pong: true }>({ kind: "ping" });
  }

  /**
   * Confinamento canônico de caminho dentro de um root permitido.
   * Lança OUT_OF_SCOPE se o caminho escapar do root via traversal ou symlink.
   */
  private assertCanonicalPathInRoot(
    rootDirectory: string,
    targetPath: string,
  ): string {
    let rootReal: string;
    try {
      rootReal = fs.realpathSync.native(path.resolve(rootDirectory));
    } catch {
      throw outOfScopePathError(targetPath);
    }

    const candidateAbsolute = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(rootReal, targetPath);

    if (!isAbsolutePathInsideRoot(rootReal, candidateAbsolute)) {
      throw outOfScopePathError(targetPath);
    }

    let candidateReal: string;
    try {
      candidateReal = fs.realpathSync.native(candidateAbsolute);
    } catch {
      throw outOfScopePathError(targetPath);
    }

    if (!isAbsolutePathInsideRoot(rootReal, candidateReal)) {
      throw outOfScopePathError(targetPath);
    }

    return candidateReal;
  }

  /**
   * Registra uma extensão inspecionando o package.json no diretório fornecido.
   */
  registerExtensionFromDirectory(extensionDirectory: string): ExtensionRegistration {
    const registration = this.inspectExtensionFromDirectory(extensionDirectory);
    const existing = this.extensions.get(registration.id);
    if (this.changingEnablement.has(registration.id) ||
        (existing && !["unloaded", "deactivated", "failed"].includes(existing.state))) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.CONFLICT, "Extensão em execução ou transição.");
    }
    this.extensions.set(registration.id, registration);
    return registration;
  }

  private inspectExtensionFromDirectory(extensionDirectory: string, isVsix = false): ExtensionRegistration {
    if (typeof extensionDirectory !== "string" || !extensionDirectory.trim()) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Diretório da extensão inválido.",
      );
    }

    const canonicalExtDir = this.assertCanonicalPathInRoot(
      this.config.extensionsDirectory,
      extensionDirectory,
    );

    const packageJsonPath = path.join(canonicalExtDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `package.json da extensão não encontrado em: ${canonicalExtDir}`,
      );
    }

    let manifestRaw: unknown;
    try {
      const canonicalManifest = this.assertCanonicalPathInRoot(canonicalExtDir, packageJsonPath);
      const content = fs.readFileSync(canonicalManifest, "utf8");
      manifestRaw = JSON.parse(content);
    } catch (err) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Falha ao analisar package.json da extensão: ${(err as Error).message}`,
      );
    }

    const validation = validateExtensionManifest(manifestRaw);
    if (!validation.valid || !validation.manifest) {
      throw validation.error ??
        new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "Manifesto de extensão inválido.",
        );
    }

    const manifest = validation.manifest;
    const extensionId = formatExtensionIdentifier(manifest.publisher, manifest.name);

    let mainAbsolutePath: string | undefined;
    const main = manifest.main ?? (isVsix ? undefined : "index.js");
    if (main !== undefined) {
      const mainCandidate = path.resolve(canonicalExtDir, main);
      mainAbsolutePath = this.assertCanonicalPathInRoot(canonicalExtDir, mainCandidate);
      if (!fs.statSync(mainAbsolutePath).isFile()) {
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Ponto de entrada não é arquivo regular.");
      }
    }

    const registration: ExtensionRegistration = {
      id: extensionId,
      extensionPath: canonicalExtDir,
      manifest,
      mainAbsolutePath,
      state: "unloaded",
      registeredCommands: manifest.contributes?.commands?.map((c) => c.command) ?? [],
    };

    return registration;
  }

  /**
   * Instala um pacote VSIX local na pasta de extensões configurada,
   * valida a integridade do manifesto e do bundle, registra no catálogo e notifica os listeners.
   * Retorna a versão selecionada no catálogo deste host, que pode ser superior à publicada.
   * Outros hosts existentes não são sincronizados; ao iniciar, cada host seleciona o maior SemVer publicado.
   * Falha operacional após commit retorna publicação e instrução de recuperação, sem rollback.
   */
  async installVsix(vsixPath: string): Promise<VsixInstallResult> {
    if (this.terminated) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Extension host já foi encerrado.",
      );
    }

    if (typeof vsixPath !== "string" || !vsixPath.trim()) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Caminho do arquivo VSIX é obrigatório.",
      );
    }

    let installingId: string | undefined;
    let candidate: ExtensionRegistration | undefined;
    try {
      const { registrationDir, manifest, extensionId, version } =
        await installVsixPackage(vsixPath, this.config.extensionsDirectory, (directory) => {
          candidate = this.inspectExtensionFromDirectory(directory, true);
          const existing = this.extensions.get(candidate.id);
          if (this.installing.has(candidate.id) || this.changingEnablement.has(candidate.id) ||
              (existing && !["unloaded", "deactivated", "failed"].includes(existing.state))) {
            throw new ProtocolError(PROTOCOL_ERROR_CODES.CONFLICT, "Extensão em execução ou transição.");
          }
          this.installing.add(candidate.id);
          installingId = candidate.id;
        });
      try {
        const previous = this.extensions.get(extensionId);
        const registration = previous && compareVersions(previous.manifest.version, version) >= 0
          ? previous
          : candidate as ExtensionRegistration;
        if (registration !== previous) {
          this.extensions.set(extensionId, registration);
        }

        for (const listener of this.listeners) {
          try {
            listener({
              eventType: "extensionInstalled",
              payload: {
                extensionId,
                version,
                extensionPath: registrationDir,
                manifest,
              },
            });
          } catch (error) {
            process.emitWarning(`Falha ao notificar instalação de ${extensionId}: ${String(error)}`);
          }
        }

        return registration;
      } catch (error) {
        return {
          ...(candidate as ExtensionRegistration),
          status: "published_recovery_required",
          publication: { extensionId, version },
          warning: `Pacote publicado; atualização local incompleta: ${error instanceof Error ? error.message : String(error)}`,
          recovery: "restart_host",
        };
      }
    } finally {
      if (installingId) this.installing.delete(installingId);
    }
  }

  async installFromGallery(identifier: string, options: { version?: string; galleryUrl?: string } = {}): Promise<VsixInstallResult> {
    if (this.terminated) throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Extension host já foi encerrado.");
    return withGalleryVsix(identifier, options.version, options.galleryUrl, (file) => this.installVsix(file));
  }

  getExtension(extensionId: string): ExtensionRegistration | undefined {
    return this.extensions.get(extensionId.toLowerCase());
  }

  listExtensions(): ExtensionRegistration[] {
    return Array.from(this.extensions.values());
  }

  private enablementPath(extensionId: string): string {
    return path.join(this.config.extensionsDirectory, `.disabled-${createHash("sha256").update(extensionId).digest("hex")}`);
  }

  // Coordenação entre hosts: um arquivo O_EXCL por extensão guarda o
  // descritor do holder (pid, token do host, generation, extensionActive).
  // Enquanto o worker existir, host externo não executa disable (CONFLICT).
  // Um activate externo pode assumir a extensão quando ela está
  // desativada no holder. Lock de holder morto (crash) vira stale e é
  // removido pela consulta seguinte: não há garantia atômica entre
  // morte do holder e recuperação, apenas recuperação eventual.
  private acquireExtensionLock(id: string, allowDeactivatedSteal = false, extensionActive = false): void {
    if (this.extensionLocks.has(id)) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.CONFLICT, "Extensão em uso ou encerramento.");
    }
    const lockPath = `${this.enablementPath(id)}.lock`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let existing: ExtensionLockDescriptor | null = null;
      try {
        existing = JSON.parse(fs.readFileSync(lockPath, "utf8")) as ExtensionLockDescriptor;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") existing = null;
      }
      if (existing) {
        const stale = !Number.isSafeInteger(existing.pid) || !holderProcessAlive(existing.pid);
        const stealable = allowDeactivatedSteal && existing.extensionActive === false && !stale;
        if (stale || stealable) {
          try {
            fs.unlinkSync(lockPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw new ProtocolError(PROTOCOL_ERROR_CODES.CONFLICT, "Extensão em uso por outro host.");
            }
          }
        } else {
          throw new ProtocolError(PROTOCOL_ERROR_CODES.CONFLICT, "Extensão em uso por outro host.");
        }
      }
      const descriptor: ExtensionLockDescriptor = {
        pid: process.pid,
        token: this.lockToken,
        generation: this.nextLockGeneration++,
        extensionActive,
      };
      try {
        const handle = fs.openSync(lockPath, "wx");
        try {
          fs.writeFileSync(handle, JSON.stringify(descriptor));
        } finally {
          fs.closeSync(handle);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST" && attempt === 0) continue;
        throw error;
      }
      this.extensionLocks.set(id, descriptor);
      return;
    }
  }

  private releaseExtensionLock(id: string): void {
    const descriptor = this.extensionLocks.get(id);
    if (!descriptor) return;
    this.extensionLocks.delete(id);
    const lockPath = `${this.enablementPath(id)}.lock`;
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, "utf8")) as ExtensionLockDescriptor;
      if (current.token === descriptor.token && current.generation === descriptor.generation) {
        fs.unlinkSync(lockPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
    }
  }

  private markExtensionLockDeactivated(id: string): void {
    const descriptor = this.extensionLocks.get(id);
    if (!descriptor) return;
    const lockPath = `${this.enablementPath(id)}.lock`;
    const updated = { ...descriptor, extensionActive: false };
    try {
      fs.writeFileSync(lockPath, JSON.stringify(updated));
      this.extensionLocks.set(id, updated);
    } catch {
      // lock perdida (roubada por outro host): o holder não impede.
    }
  }

  // Processo irmão que retransmite kills de subprocessos da extensão e
  // termina descendentes quando o host morre sem limpeza (EOF no stdin).
  // De modo degradado (spawn do reaper não disponível) o rastreamento
  // não acontece e a limitação fica documentada no README da camada.
  private startReaperProcess(): void {
    if (this.reaperProcess) return;
    try {
      const reaperPath = fileURLToPath(new URL("./child-reaper.mjs", import.meta.url));
      const proc = spawnChildProcess(process.execPath, [reaperPath], { stdio: ["pipe", "ignore", "ignore"] });
      proc.stdin?.on("error", () => {
        // reaper fora do ar: degradação silenciosa, sem rastreamento.
      });
      proc.on("error", () => {
        this.reaperProcess = undefined;
      });
      this.reaperProcess = proc;
    } catch {
      // modo degradado
    }
  }

  private commandReaper(commands: { op: string; pid: number }): void {
    const stdin = this.reaperProcess?.stdin;
    if (!stdin || !stdin.writable) return;
    try {
      stdin.write(`${JSON.stringify(commands)}\n`);
    } catch {
      // modo degradado
    }
  }

  private trackChild(owner: string, pid: number): void {
    this.childOwners.set(pid, owner);
    this.commandReaper({ op: "track", pid });
  }

  private forgetChild(pid: number, owner: string): void {
    if (this.childOwners.get(pid) !== owner) return;
    this.childOwners.delete(pid);
    this.commandReaper({ op: "forget", pid });
  }

  private killOwnedChildren(owner: string): void {
    for (const [pid, ownerOf] of this.childOwners) {
      if (ownerOf !== owner) continue;
      this.childOwners.delete(pid);
      this.commandReaper({ op: "kill", pid });
    }
  }

  private stopReaper(): void {
    for (const pid of this.childOwners.keys()) {
      this.commandReaper({ op: "kill", pid });
    }
    this.childOwners.clear();
    const proc = this.reaperProcess;
    this.reaperProcess = undefined;
    try {
      proc?.stdin?.end();
      proc?.unref?.();
    } catch {
      // já encerrado
    }
  }

  private requireExtension(extensionId: string): ExtensionRegistration {
    if (this.terminated || typeof extensionId !== "string" || !extensionId.trim()) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Host encerrado ou identificador inválido.");
    }
    const registration = this.extensions.get(extensionId.toLowerCase());
    if (!registration) throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Extensão não registrada.");
    return registration;
  }

  isExtensionEnabled(extensionId: string): boolean {
    const registration = this.requireExtension(extensionId);
    try {
      fs.lstatSync(this.enablementPath(registration.id));
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
  }

  async enableExtension(extensionId: string): Promise<void> {
    const registration = this.requireExtension(extensionId);
    const id = registration.id;
    if (this.installing.has(id) || this.changingEnablement.has(id) || this.failingWorkers.has(id) ||
        ["loading", "deactivating"].includes(registration.state)) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.CONFLICT, "Extensão em transição.");
    }
    const held = this.extensionLocks.has(id);
    if (!held) this.acquireExtensionLock(id, false, registration.state === "active");
    try {
      try {
        fs.unlinkSync(this.enablementPath(id));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } finally {
      if (!held) this.releaseExtensionLock(id);
    }
  }

  async disableExtension(extensionId: string): Promise<void> {
    const registration = this.requireExtension(extensionId);
    const id = registration.id;
    if (this.installing.has(id) || this.changingEnablement.has(id) || this.failingWorkers.has(id) ||
        ["loading", "deactivating"].includes(registration.state)) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.CONFLICT, "Extensão em transição.");
    }
    this.changingEnablement.add(id);
    try {
      if (!this.extensionLocks.has(id)) this.acquireExtensionLock(id, false, registration.state === "active");
      if (registration.state === "active") await this.deactivateExtension(id);
      await this.discardExtensionWorker(id);
      if (this.terminated) throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Extension host já foi encerrado.");
      try {
        fs.closeSync(fs.openSync(this.enablementPath(id), "wx", 0o600));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST" &&
            fs.lstatSync(this.enablementPath(id)).isFile()) return;
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE,
          `Não foi possível persistir a desabilitação; a extensão pode estar desativada e requer ativação explícita: ${String(error)}`);
      }
    } finally {
      if (!this.extensionWorkers.has(id)) this.releaseExtensionLock(id);
      this.changingEnablement.delete(id);
    }
  }

  /**
   * Ativa a extensão no worker isolado.
   */
  async activateExtension(extensionId: string): Promise<{
    extensionId: string;
    activated: true;
    apiVersion: string;
    exports: unknown;
  }> {
    if (this.terminated) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Extension host já foi encerrado.");
    }
    const canonicalId = this.requireExtension(extensionId).id;
    if (this.installing.has(canonicalId) || this.changingEnablement.has(canonicalId) ||
        this.stoppingWorkers.has(canonicalId) || this.failingWorkers.has(canonicalId)) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.CONFLICT, "Instalação da extensão em andamento.");
    }
    const registration = this.extensions.get(canonicalId);
    if (!registration) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Extensão '${extensionId}' não registrada no host.`,
      );
    }

    if (["active", "loading", "deactivating"].includes(registration.state)) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Extensão '${extensionId}' já está ativa.`,
      );
    }

    const alreadyHeld = this.extensionLocks.has(canonicalId) && this.extensionWorkers.has(canonicalId);
    if (!alreadyHeld) this.acquireExtensionLock(canonicalId, true, true);
    try {
      if (!this.isExtensionEnabled(canonicalId)) {
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Extensão desabilitada.");
      }
    } catch (error) {
      if (!alreadyHeld) this.releaseExtensionLock(canonicalId);
      throw error;
    }
    registration.state = "loading";
    if (registration.mainAbsolutePath === undefined) {
      registration.state = "active";
      registration.activatedAt = Date.now();
      return { extensionId: canonicalId, activated: true, apiVersion: FROZEN_EXTENSION_API_VERSION, exports: undefined };
    }
    let worker = this.extensionWorkers.get(canonicalId);
    try {
      if (!worker) {
        worker = new Worker(this.options.workerEntryPath ?? DEFAULT_WORKER_ENTRY, { execArgv: this.options.execArgv });
        this.extensionWorkers.set(canonicalId, worker);
        this.attachWorker(worker, canonicalId);
        await this.sendRequest({ kind: "init", config: this.config }, worker);
      }
      const result = await this.sendRequest<{
        extensionId: string;
        activated: true;
        apiVersion: string;
        exports: unknown;
      }>({
        kind: "activate",
        extensionId: canonicalId,
        mainAbsolutePath: registration.mainAbsolutePath,
        extensionPath: registration.extensionPath,
        manifest: registration.manifest,
      }, worker);

      registration.state = "active";
      registration.activatedAt = Date.now();
      return result;
    } catch (err) {
      await this.discardExtensionWorker(canonicalId);
      if (worker && this.failingWorkers.has(canonicalId)) await worker.terminate();
      this.releaseExtensionLock(canonicalId);
      registration.state = "failed";
      registration.lastError = (err as Error).message;
      throw err;
    }
  }

  /**
   * Executa um comando registrado pela extensão dentro do worker isolado.
   */
  async executeCommand<T = unknown>(
    command: string,
    ...args: unknown[]
  ): Promise<T> {
    if (typeof command !== "string" || !command.trim()) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Nome do comando é obrigatório.",
      );
    }

    const owner = this.commands.get(command.trim());
    const worker = owner ? this.extensionWorkers.get(owner) : undefined;
    if (!worker) throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, `Comando '${command}' não encontrado.`);
    return this.sendRequest<T>({
      kind: "executeCommand",
      extensionId: "*",
      command: command.trim(),
      args,
    }, worker);
  }

  /**
   * Desativa a extensão no worker isolado.
   */
  async deactivateExtension(extensionId: string): Promise<{
    extensionId: string;
    deactivated: true;
  }> {
    if (this.terminated) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Extension host já foi encerrado.");
    }
    const canonicalId = extensionId.toLowerCase();
    if (this.installing.has(canonicalId)) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.CONFLICT, "Instalação da extensão em andamento.");
    }
    const registration = this.extensions.get(canonicalId);
    if (!registration) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Extensão '${extensionId}' não registrada no host.`,
      );
    }

    if (registration.state !== "active") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Extensão '${extensionId}' não está ativa (estado atual: ${registration.state}).`,
      );
    }

    registration.state = "deactivating";
    if (registration.mainAbsolutePath === undefined) {
      registration.state = "deactivated";
      registration.deactivatedAt = Date.now();
      if (!this.changingEnablement.has(canonicalId)) this.markExtensionLockDeactivated(canonicalId);
      return { extensionId: canonicalId, deactivated: true };
    }
    const worker = this.extensionWorkers.get(canonicalId);
    try {
      const result = await this.sendRequest<{
        extensionId: string;
        deactivated: true;
      }>({
        kind: "deactivate",
        extensionId: canonicalId,
      }, worker);

      registration.state = "deactivated";
      this.clearExtensionRegistrations(canonicalId);
      registration.deactivatedAt = Date.now();
      if (!this.changingEnablement.has(canonicalId)) this.markExtensionLockDeactivated(canonicalId);
      return result;
    } catch (err) {
      await this.discardExtensionWorker(canonicalId);
      if (worker && this.failingWorkers.has(canonicalId)) await worker.terminate();
      if (!this.changingEnablement.has(canonicalId)) this.releaseExtensionLock(canonicalId);
      registration.state = "failed";
      registration.lastError = (err as Error).message;
      throw err;
    }
  }


  /**
   * Invoca providers de completion registrados pelas extensões ativas.
   */
  async provideCompletionItems<T = unknown>(
    document: string | { uri: string; version?: number; lineCount?: number; text?: string | (() => string) },
    position: { line: number; character: number },
    context?: unknown,
    extensionId?: string,
  ): Promise<T[]> {
    if (this.terminated) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Extension host já foi encerrado.");
    }

    const uri = typeof document === "string" ? document : document?.uri;
    if (typeof uri !== "string" || !uri.trim()) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "URI de documento inválida para completion.");
    }
    if (!position || typeof position !== "object" ||
        !Number.isSafeInteger(position.line) || position.line < 0 ||
        !Number.isSafeInteger(position.character) || position.character < 0) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Posição inválida para completion.");
    }

    const docPayload = typeof document === "string"
      ? { uri: document, version: 1, lineCount: 1, text: "" }
      : {
          uri: document.uri,
          version: document.version ?? 1,
          lineCount: document.lineCount ?? 1,
          text: typeof document.text === "function" ? document.text() : (document.text ?? ""),
        };

    if (extensionId) {
      const canonicalId = extensionId.toLowerCase();
      const ext = this.extensions.get(canonicalId);
      if (!ext || ext.state !== "active") {
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, `Extensão '${extensionId}' não está ativa.`);
      }
      const worker = this.extensionWorkers.get(canonicalId);
      if (!worker) {
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, `Worker da extensão '${extensionId}' não encontrado.`);
      }
      return this.sendRequest<T[]>({
        kind: "provideCompletionItems",
        extensionId: canonicalId,
        document: docPayload,
        position,
        context,
      }, worker);
    }

    const results: T[] = [];
    for (const [extId, reg] of this.extensions) {
      if (reg.state !== "active") continue;
      const worker = this.extensionWorkers.get(extId);
      if (!worker) continue;
      const hasProvider = Array.from(this.completionProviders.values()).some((p) => p.extensionId === extId);
      if (!hasProvider) continue;
      const items = await this.sendRequest<T[]>({
        kind: "provideCompletionItems",
        extensionId: extId,
        document: docPayload,
        position,
        context,
      }, worker);
      if (Array.isArray(items)) {
        results.push(...items);
      }
    }
    return results;
  }

  /**
   * Invoca providers de hover registrados pelas extensões ativas.
   */
  async provideHover<T = unknown>(
    document: string | { uri: string; version?: number; lineCount?: number; text?: string | (() => string) },
    position: { line: number; character: number },
    extensionId?: string,
  ): Promise<T | undefined> {
    if (this.terminated) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Extension host já foi encerrado.");
    }

    const uri = typeof document === "string" ? document : document?.uri;
    if (typeof uri !== "string" || !uri.trim()) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "URI de documento inválida para hover.");
    }
    if (!position || typeof position !== "object" ||
        !Number.isSafeInteger(position.line) || position.line < 0 ||
        !Number.isSafeInteger(position.character) || position.character < 0) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Posição inválida para hover.");
    }

    const docPayload = typeof document === "string"
      ? { uri: document, version: 1, lineCount: 1, text: "" }
      : {
          uri: document.uri,
          version: document.version ?? 1,
          lineCount: document.lineCount ?? 1,
          text: typeof document.text === "function" ? document.text() : (document.text ?? ""),
        };

    if (extensionId) {
      const canonicalId = extensionId.toLowerCase();
      const ext = this.extensions.get(canonicalId);
      if (!ext || ext.state !== "active") {
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, `Extensão '${extensionId}' não está ativa.`);
      }
      const worker = this.extensionWorkers.get(canonicalId);
      if (!worker) {
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, `Worker da extensão '${extensionId}' não encontrado.`);
      }
      return this.sendRequest<T | undefined>({
        kind: "provideHover",
        extensionId: canonicalId,
        document: docPayload,
        position,
      }, worker);
    }

    for (const [extId, reg] of this.extensions) {
      if (reg.state !== "active") continue;
      const worker = this.extensionWorkers.get(extId);
      if (!worker) continue;
      const hasProvider = Array.from(this.hoverProviders.values()).some((p) => p.extensionId === extId);
      if (!hasProvider) continue;
      const hover = await this.sendRequest<T | undefined>({
        kind: "provideHover",
        extensionId: extId,
        document: docPayload,
        position,
      }, worker);
      if (hover !== undefined && hover !== null) {
        return hover;
      }
    }
    return undefined;
  }

  /**
   * Resolve detalhes adicionais de um completion item através do provider correspondente.
   */
  async resolveCompletionItem<T = unknown>(
    item: unknown,
    extensionId?: string,
    providerId?: string,
  ): Promise<T> {
    if (this.terminated) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Extension host já foi encerrado.");
    }
    if (!item || typeof item !== "object") {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Item de completion inválido.");
    }
    const targetExtensionId = extensionId
      ? extensionId.toLowerCase()
      : providerId
        ? this.completionProviders.get(providerId)?.extensionId
        : Array.from(this.extensions.keys())[0];
    if (!targetExtensionId) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Extensão não identificada para resolução de completion.");
    }
    const ext = this.extensions.get(targetExtensionId);
    if (!ext || ext.state !== "active") {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, `Extensão '${targetExtensionId}' não está ativa.`);
    }
    const worker = this.extensionWorkers.get(targetExtensionId);
    if (!worker) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Worker não encontrado.");
    }
    return this.sendRequest<T>({
      kind: "resolveCompletionItem",
      extensionId: targetExtensionId,
      providerId,
      item,
    }, worker);
  }

  getRegisteredCompletionProviders(): readonly {
    extensionId: string;
    providerId: string;
    selector: unknown;
    triggerCharacters?: string[];
  }[] {
    return Array.from(this.completionProviders.values());
  }

  getRegisteredHoverProviders(): readonly {
    extensionId: string;
    providerId: string;
    selector: unknown;
  }[] {
    return Array.from(this.hoverProviders.values());
  }

  get isTerminated(): boolean {
    return this.terminated;
  }

  async terminate(): Promise<void> {
    if (this.termination) return this.termination;
    this.terminated = true;

    for (const [, entry] of this.pending) {
      entry.reject(
        new ProtocolError(
          PROTOCOL_ERROR_CODES.CANCELLED,
          "Extension host finalizado.",
        ),
      );
    }
    this.pending.clear();
    this.termination = (async () => {
      await Promise.all([
        this.worker.terminate(),
        ...Array.from(this.extensionWorkers.keys(), (id) => this.discardExtensionWorker(id)),
      ]);
      for (const id of this.extensionLocks.keys()) this.releaseExtensionLock(id);
      this.stopReaper();
    })();
    return this.termination;
  }
}
