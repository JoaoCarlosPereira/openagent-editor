import type { ProviderCapabilities } from "@openagent/storage";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  DEFAULT_CONTEXT_TOKEN_LIMIT,
  validateContextTokenLimitInput,
} from "@openagent/context";

export interface SettingsProviderInput {
  endpoint: string;
  model: string;
  credential: string;
  profileId?: string;
}

export interface SettingsProviderResult {
  capabilities: ProviderCapabilities;
  secretRef: string;
}

export interface SettingsProviderPort {
  testAndSaveProvider(input: {
    endpoint: string;
    model: string;
    credential: string;
    profileId: string;
  }): Promise<SettingsProviderResult>;
  persistContextLimitTokens?(value: number): Promise<void>;
}

export interface SettingsState {
  providerEndpoint: string | null;
  providerModel: string | null;
  hasCredential: boolean;
  detectedCapabilities: ProviderCapabilities | null;
  savedSecretRef: string | null;
  contextLimitTokens: number | null;
  isTestingConnection: boolean;
  isSavingCredential: boolean;
  errorMessage: string | null;
}

export type SettingsListener = (state: SettingsState) => void;

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [...details]);
}

function normalizeEndpoint(raw: string): string {
  const url = new URL(raw.trim().endsWith("/") ? raw.trim() : `${raw.trim()}/`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Endpoint deve usar http ou https.");
  }
  return url.toString().replace(/\/$/, "");
}

/** Controlador reativo para capacidades do provedor e teto de contexto. */
export class SettingsController {
  private value: SettingsState;
  private readonly listeners = new Set<SettingsListener>();

  constructor(private readonly port?: SettingsProviderPort, initial?: {
    providerEndpoint?: string | null;
    providerModel?: string | null;
    hasCredential?: boolean;
    detectedCapabilities?: ProviderCapabilities | null;
    savedSecretRef?: string | null;
    contextLimitTokens?: number | null;
  }) {
    this.value = {
      providerEndpoint: initial?.providerEndpoint ?? null,
      providerModel: initial?.providerModel ?? null,
      hasCredential: initial?.hasCredential ?? false,
      detectedCapabilities: initial?.detectedCapabilities ?? null,
      savedSecretRef: initial?.savedSecretRef ?? null,
      contextLimitTokens: initial?.contextLimitTokens ?? null,
      isTestingConnection: false,
      isSavingCredential: false,
      errorMessage: null,
    };
  }

  get snapshot(): Readonly<SettingsState> {
    return { ...this.value };
  }

  get effectiveContextLimitTokens(): number {
    return this.value.contextLimitTokens ?? DEFAULT_CONTEXT_TOKEN_LIMIT;
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async testAndSaveProvider(input: SettingsProviderInput): Promise<Readonly<SettingsState>> {
    const endpointRaw = input.endpoint?.trim() ?? "";
    const model = input.model?.trim() ?? "";
    const credential = input.credential?.trim() ?? "";
    const profileId = input.profileId?.trim() || "default-profile";
    const details = [
      ...(!endpointRaw ? ["endpoint"] : []),
      ...(!model ? ["model"] : []),
      ...(!credential ? ["credential"] : []),
    ];
    if (details.length) {
      throw invalidState("Dados do provedor incompletos ou inválidos.", details);
    }

    let endpoint: string;
    try {
      endpoint = normalizeEndpoint(endpointRaw);
    } catch {
      throw invalidState("Endpoint deve ser uma URL http ou https válida.", ["endpoint"]);
    }
    if (this.value.isTestingConnection || this.value.isSavingCredential) {
      throw invalidState("Já existe uma operação de configuração em andamento.", ["state"]);
    }
    if (!this.port) {
      throw invalidState("A porta de configuração do provedor não está disponível.", ["port"]);
    }

    const previous = this.value;
    this.value = {
      ...previous,
      isTestingConnection: true,
      errorMessage: null,
    };
    this.notify();

    try {
      const result = await this.port.testAndSaveProvider({
        endpoint,
        model,
        credential,
        profileId,
      });
      this.value = {
        ...this.value,
        providerEndpoint: result.capabilities.endpoint,
        providerModel: result.capabilities.model,
        hasCredential: true,
        detectedCapabilities: result.capabilities,
        savedSecretRef: result.secretRef,
        isTestingConnection: false,
        isSavingCredential: false,
        errorMessage: null,
      };
      this.notify();
      return this.snapshot;
    } catch (error) {
      this.value = {
        ...previous,
        isTestingConnection: false,
        isSavingCredential: false,
        errorMessage: error instanceof Error ? error.message : "Falha no teste de conexão.",
      };
      this.notify();
      if (error instanceof ProtocolError) throw error;
      throw new ProtocolError("PROVIDER_CONNECTION_FAILED", "Falha no teste de conexão com o provedor.");
    }
  }

  async setContextLimitTokens(raw: unknown): Promise<Readonly<SettingsState>> {
    const validation = validateContextTokenLimitInput(raw);
    if (!validation.valid) {
      throw new ProtocolError(validation.code, validation.errors[0] ?? "Teto de contexto inválido.");
    }
    if (this.value.isTestingConnection || this.value.isSavingCredential) {
      throw invalidState("Não é possível alterar o teto durante outra operação.", ["state"]);
    }
    if (!this.port?.persistContextLimitTokens) {
      throw invalidState("A persistência do teto de contexto não está disponível.", ["port"]);
    }
    const previous = this.value;
    this.value = { ...previous, isSavingCredential: true, errorMessage: null };
    this.notify();
    try {
      await this.port.persistContextLimitTokens(validation.value);
    } catch {
      this.value = previous;
      this.notify();
      throw invalidState("Não foi possível persistir o teto de contexto.", ["persistence"]);
    }
    this.value = {
      ...this.value,
      contextLimitTokens: validation.value,
      isSavingCredential: false,
      errorMessage: null,
    };
    this.notify();
    return this.snapshot;
  }

  private notify(): void {
    const snapshot = this.snapshot as SettingsState;
    for (const listener of this.listeners) listener(snapshot);
  }
}
