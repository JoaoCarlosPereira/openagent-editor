/**
 * Entrada de mensagem do usuário no protocolo (run.start / run.queue.add).
 * VAL-01: texto ou anexo obrigatório antes do envio.
 */

/** Texto exibido ao recusar envio vazio (PRD VAL-01, frase exata). */
export const USER_INPUT_EMPTY_MESSAGE =
  "Escreva uma mensagem ou anexe um contexto." as const;

/** Referência a anexo de contexto já resolvido ou pendente de materialização. */
export interface UserContextAttachment {
  ref: string;
}

export interface UserInput {
  text?: string;
  attachments?: UserContextAttachment[];
}

export type UserInputValidationResult =
  | {
      valid: true;
      value: UserInput;
    }
  | {
      valid: false;
      code: "INVALID_STATE";
      /** Mensagem para UI quando a recusa é VAL-01 (envio vazio). */
      userMessage?: string;
      errors: string[];
    };
