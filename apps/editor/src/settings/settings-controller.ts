import type { ProviderCapabilities } from "@openagent/storage";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  DEFAULT_CONTEXT_TOKEN_LIMIT,
  parseWorkspaceExclusionPatterns,
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

/** Tamanho descritivo do índice de contexto (CTX-04). */
export interface IndexSizeSnapshot {
  indexedFileCount: number;
  chunkCount: number;
  lexicalBytes: number;
}

export interface SettingsProviderPort {
  testAndSaveProvider(input: {
    endpoint: string;
    model: string;
    credential: string;
    profileId: string;
  }): Promise<SettingsProviderResult>;
  persistContextLimitTokens?(value: number): Promise<void>;
  /** CTX-03: retorna os padrões atuais de exclusão do workspace. */
  getExclusionPatterns?(): Promise<string[]>;
  /** CTX-03: grava os padrões de exclusão do workspace (array de glob). */
  setExclusionPatterns?(patterns: string[]): Promise<void>;
  /** CTX-04: descrepe escopo e tamanho do índice antes de limpar. */
  describeIndexSize?(): Promise<IndexSizeSnapshot>;
  /** CTX-04: confirma e executa a limpeza do índice local. */
  confirmAndClearIndex?(): Promise<{ cleared: true; scope: "workspace"; size: IndexSizeSnapshot }>;
}

/** Fragmento de uma regra de exclusão em exibição. */
export interface ExclusionRuleDisplay {
  pattern: string;
  /** "project-ignore" ou "workspace-config". */
  source: "project-ignore" | "workspace-config";
  removable: boolean;
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
  /** CTX-03: lista de regras de exclusão ativas para exibição. */
  exclusionRules: ExclusionRuleDisplay[];
  /** CTX-04: tamanho descritivo do índice antes de limpeza. */
  indexSizeSnapshot: IndexSizeSnapshot | null;
  /** CTX-04: true enquanto a limpeza está em andamento. */
  isClearingIndex: boolean;
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
  private configuredExclusionPatterns: string[] = [];
  private readonly projectExclusionPatterns: string[] = [];
  private operationInProgress = false;

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
      exclusionRules: [],
      indexSizeSnapshot: null,
      isClearingIndex: false,
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

  /** Carrega padrões editáveis do workspace e regras herdadas de .gitignore. */
  async loadExclusionRules(projectIgnorePatterns: readonly string[] = []): Promise<Readonly<SettingsState>> {
    const configured = this.port?.getExclusionPatterns
      ? await this.port.getExclusionPatterns()
      : this.configuredExclusionPatterns;
    const parsed = parseWorkspaceExclusionPatterns(configured);
    if (!parsed.valid || !Array.isArray(projectIgnorePatterns) || projectIgnorePatterns.some((pattern) => typeof pattern !== "string" || !pattern.trim())) {
      throw invalidState("Regras de exclusão inválidas.", ["exclusions"]);
    }
    this.configuredExclusionPatterns = [...parsed.patterns];
    this.projectExclusionPatterns.splice(0, this.projectExclusionPatterns.length, ...projectIgnorePatterns.map((pattern) => pattern.trim()));
    this.value = {
      ...this.value,
      exclusionRules: [
        ...this.projectExclusionPatterns.map((pattern) => ({ pattern, source: "project-ignore" as const, removable: false })),
        ...this.configuredExclusionPatterns.map((pattern) => ({ pattern, source: "workspace-config" as const, removable: true })),
      ],
    };
    this.notify();
    return this.snapshot;
  }

  /** Persiste apenas regras de workspace; invalidação ocorre antes da chamada externa. */
  async setExclusionPatterns(rawPatterns: readonly unknown[]): Promise<Readonly<SettingsState>> {
    if (!Array.isArray(rawPatterns) || rawPatterns.some((pattern) => typeof pattern !== "string" || !pattern.trim())) {
      throw invalidState("Cada regra deve ser um padrão glob não-vazio.", ["exclusions"]);
    }
    const patterns = rawPatterns.map((pattern) => (pattern as string).trim());
    if (new Set(patterns).size !== patterns.length) {
      throw invalidState("Regras de exclusão duplicadas.", ["exclusions"]);
    }
    if (this.operationInProgress || this.value.isClearingIndex || this.value.isTestingConnection || this.value.isSavingCredential) {
      throw invalidState("Já existe uma operação de configuração em andamento.", ["state"]);
    }
    if (!this.port?.setExclusionPatterns) {
      throw invalidState("A persistência das regras de exclusão não está disponível.", ["port"]);
    }
    this.operationInProgress = true;
    try {
      await this.port.setExclusionPatterns(patterns);
    } catch {
      throw invalidState("Não foi possível persistir as regras de exclusão.", ["persistence"]);
    } finally {
      this.operationInProgress = false;
    }
    this.configuredExclusionPatterns = [...patterns];
    this.value = {
      ...this.value,
      exclusionRules: [
        ...this.projectExclusionPatterns.map((pattern) => ({ pattern, source: "project-ignore" as const, removable: false })),
        ...patterns.map((pattern) => ({ pattern, source: "workspace-config" as const, removable: true })),
      ],
      errorMessage: null,
    };
    this.notify();
    return this.snapshot;
  }

  /** Obtém metadados exibíveis, sem limpar dados. */
  async describeIndexSize(): Promise<Readonly<SettingsState>> {
    if (!this.port?.describeIndexSize) {
      throw invalidState("A descrição do índice não está disponível.", ["port"]);
    }
    const size = await this.port.describeIndexSize();
    if (!size || ![size.indexedFileCount, size.chunkCount, size.lexicalBytes].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw invalidState("Tamanho do índice inválido.", ["indexSize"]);
    }
    this.value = { ...this.value, indexSizeSnapshot: { ...size } };
    this.notify();
    return this.snapshot;
  }

  /** Executa limpeza somente após confirmação explícita e mantendo o resultado observável. */
  async clearIndex(confirmed: boolean, expectedSize?: IndexSizeSnapshot): Promise<Readonly<SettingsState>> {
    if (confirmed !== true) throw invalidState("A limpeza exige confirmação explícita.", ["confirmed"]);
    if (this.operationInProgress || this.value.isClearingIndex || this.value.isTestingConnection || this.value.isSavingCredential) {
      throw invalidState("Já existe uma operação de configuração em andamento.", ["state"]);
    }
    if (!this.port?.confirmAndClearIndex) throw invalidState("A limpeza do índice não está disponível.", ["port"]);
    if (!this.value.indexSizeSnapshot) throw invalidState("Consulte o escopo e tamanho antes da limpeza.", ["indexSize"]);
    const baseline = expectedSize ?? this.value.indexSizeSnapshot;
    if (JSON.stringify(baseline) !== JSON.stringify(this.value.indexSizeSnapshot)) {
      throw invalidState("O tamanho do índice mudou; atualize a prévia antes de confirmar.", ["indexSize"]);
    }
    this.operationInProgress = true;
    this.value = { ...this.value, isClearingIndex: true, errorMessage: null };
    this.notify();
    try {
      const result = await this.port.confirmAndClearIndex();
      if (result.cleared !== true || result.scope !== "workspace" || !result.size) {
        throw invalidState("Resultado de limpeza inválido.", ["result"]);
      }
      this.value = { ...this.value, isClearingIndex: false, indexSizeSnapshot: { ...result.size } };
      this.notify();
      return this.snapshot;
    } catch (error) {
      this.value = { ...this.value, isClearingIndex: false };
      this.notify();
      if (error instanceof ProtocolError) throw error;
      throw invalidState("Não foi possível limpar o índice do workspace.", ["clear"]);
    } finally {
      this.operationInProgress = false;
    }
  }

  private notify(): void {
    const snapshot = this.snapshot as SettingsState;
    for (const listener of this.listeners) listener(snapshot);
  }
}
