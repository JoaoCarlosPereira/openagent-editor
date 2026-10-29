import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import {
  formatExtensionIdentifier,
  validateExtensionManifest,
} from "@openagent/extension-api";
import { isAbsolutePathInsideRoot } from "@openagent/policy";
import {
  outOfScopePathError,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
} from "@openagent/protocol";

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
  private terminated = false;
  private nextRequestId = 0;
  private readonly extensions = new Map<string, ExtensionRegistration>();
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
      const content = fs.readFileSync(packageJsonPath, "utf8");
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

    const mainRelative = manifest.main ?? "index.js";
    const mainCandidate = path.resolve(canonicalExtDir, mainRelative);
    const mainAbsolutePath = this.assertCanonicalPathInRoot(
      canonicalExtDir,
      mainCandidate,
    );

    const registration: ExtensionRegistration = {
      id: extensionId,
      extensionPath: canonicalExtDir,
      manifest,
      mainAbsolutePath,
      state: "unloaded",
      registeredCommands: manifest.contributes?.commands?.map((c) => c.command) ?? [],
    };

    this.extensions.set(extensionId, registration);
    return registration;
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
    const canonicalId = extensionId.toLowerCase();
    const registration = this.extensions.get(canonicalId);
    if (!registration) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Extensão '${extensionId}' não registrada no host.`,
      );
    }

    if (registration.state === "active") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Extensão '${extensionId}' já está ativa.`,
      );
    }

    registration.state = "loading";
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
    const canonicalId = extensionId.toLowerCase();
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
    try {
      const result = await this.sendRequest<{
        extensionId: string;
        deactivated: true;
      }>({
        kind: "deactivate",
        extensionId: canonicalId,
      }, this.extensionWorkers.get(canonicalId));

      registration.state = "deactivated";
      for (const [command, owner] of this.commands) {
        if (owner === canonicalId) this.commands.delete(command);
      }
      registration.deactivatedAt = Date.now();
      return result;
    } catch (err) {
      registration.state = "failed";
      registration.lastError = (err as Error).message;
      throw err;
    }
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
