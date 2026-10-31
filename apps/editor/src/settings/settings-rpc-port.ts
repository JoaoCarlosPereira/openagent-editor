import { PROTOCOL_ERROR_CODES, ProtocolError, RPC_METHOD, type HarnessClient } from "@openagent/protocol";
import type { SettingsProviderPort } from "./settings-controller.js";

export function createSettingsRpcPort(
  client: HarnessClient,
  provider: Pick<SettingsProviderPort, "testAndSaveProvider" | "persistContextLimitTokens">,
): SettingsProviderPort {
  let previewToken: string | undefined;
  return {
    ...provider,
    async getExclusionPatterns() {
      return (await client.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_GET, {})).patterns;
    },
    async setExclusionPatterns(patterns) {
      await client.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_SET, { patterns });
    },
    async describeIndexSize() {
      const preview = await client.callRpc(RPC_METHOD.CONTEXT_CLEAR_PREVIEW, {});
      previewToken = preview.previewToken;
      return preview.size;
    },
    async confirmAndClearIndex() {
      const result = await client.callRpc(RPC_METHOD.CONTEXT_CLEAR, {
        scope: "workspace",
        previewToken,
      });
      previewToken = undefined;
      if (!result.sizeAfter) throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Resultado de limpeza incompleto.");
      return { ...result, size: result.sizeAfter };
    },
  };
}
