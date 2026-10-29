import fs from "node:fs";
import path from "node:path";
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
  private nextRequestId = 0;
  private readonly extensions = new Map<string, ExtensionRegistration>();
  private readonly installing = new Set<string>();
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
      if (owner && this.extensionWorkers.get(owner) !== worker) return;

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

    worker.on("error", (error) => {
      for (const [id, entry] of this.pending) {
        if (entry.worker !== worker) continue;
        entry.reject(error);
        this.pending.delete(id);
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
    const worker = this.extensionWorkers.get(extensionId);
    if (worker) {
      this.extensionWorkers.delete(extensionId);
      for (const [id, request] of this.pending) {
        if (request.worker !== worker) continue;
        this.pending.delete(id);
        request.reject(new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "Worker da extensão encerrado."));
      }
      await worker.terminate();
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
    if (existing && !["unloaded", "deactivated", "failed"].includes(existing.state)) {
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
          if (this.installing.has(candidate.id) ||
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

    if (["active", "loading", "deactivating"].includes(registration.state)) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Extensão '${extensionId}' já está ativa.`,
      );
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
      return { extensionId: canonicalId, deactivated: true };
    }
    try {
      const result = await this.sendRequest<{
        extensionId: string;
        deactivated: true;
      }>({
        kind: "deactivate",
        extensionId: canonicalId,
      }, this.extensionWorkers.get(canonicalId));

      registration.state = "deactivated";
      this.clearExtensionRegistrations(canonicalId);
      registration.deactivatedAt = Date.now();
      return result;
    } catch (err) {
      await this.discardExtensionWorker(canonicalId);
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
    if (this.terminated) {
      return;
    }
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
    await Promise.all([this.worker, ...this.extensionWorkers.values()].map((worker) => worker.terminate()));
  }
}
