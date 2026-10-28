import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import type { InferToolInput, InferToolOutput, ToolHandlerMap } from "./types.js";

/**
 * Registro tipado de ferramentas — o dispatch só aceita chaves conhecidas do mapa.
 */
export class TypedToolDispatchRegistry<TTools extends ToolHandlerMap> {
  constructor(private readonly handlers: TTools) {}

  listTools(): (keyof TTools & string)[] {
    return Object.keys(this.handlers) as (keyof TTools & string)[];
  }

  async invoke<K extends keyof TTools & string>(
    tool: K,
    input: InferToolInput<TTools, K>,
  ): Promise<InferToolOutput<TTools, K>> {
    const handler = this.handlers[tool];
    if (!handler) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Ferramenta desconhecida: ${String(tool)}.`,
      );
    }
    return (await handler(input)) as InferToolOutput<TTools, K>;
  }
}

export function createTypedToolDispatchRegistry<TTools extends ToolHandlerMap>(
  handlers: TTools,
): TypedToolDispatchRegistry<TTools> {
  return new TypedToolDispatchRegistry(handlers);
}
