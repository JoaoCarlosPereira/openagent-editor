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
  private terminated = false;
  private nextRequestId = 0;
  private readonly extensions = new Map<string, ExtensionRegistration>();
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly listeners = new Set<ExtensionHostEventListener>();

  private constructor(config: ExtensionHostConfig, worker: Worker) {
    this.config = config;
    this.worker = worker;

    this.worker.on("message", (message: ExtensionWorkerResponse) => {
      if (!message || typeof message !== "object") {
        return;
      }

      if (message.kind === "event") {
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
      if (!pending) {
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

    this.worker.on("error", (error) => {
      for (const [, entry] of this.pending) {
        entry.reject(error);
      }
      this.pending.clear();
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

    const host = new IsolatedExtensionHost(config, worker);
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
      });
      try {
        this.worker.postMessage(fullRequest);
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
    try {
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
      });

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

    return this.sendRequest<T>({
      kind: "executeCommand",
      extensionId: "*",
      command: command.trim(),
      args,
    });
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
      });

      registration.state = "deactivated";
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
    await this.worker.terminate();
  }
}
