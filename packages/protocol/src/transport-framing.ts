import { PROTOCOL_ERROR_CODES, ProtocolError } from "./errors.js";

/** Cabeçalho de framing: uint32 BE com o tamanho do corpo UTF-8/JSON. */
export const PROTOCOL_FRAME_LENGTH_BYTES = 4;

/** Limite defensivo do corpo de um frame (16 MiB). */
export const PROTOCOL_MAX_FRAME_BYTES = 16 * 1024 * 1024;

export function encodeProtocolFrame(body: Uint8Array): Buffer {
  if (body.byteLength > PROTOCOL_MAX_FRAME_BYTES) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Frame excede o tamanho máximo permitido.",
      [`bodyBytes=${body.byteLength}`, `maxBytes=${PROTOCOL_MAX_FRAME_BYTES}`],
    );
  }
  const header = Buffer.alloc(PROTOCOL_FRAME_LENGTH_BYTES);
  header.writeUInt32BE(body.byteLength, 0);
  return Buffer.concat([header, Buffer.from(body)]);
}

export class ProtocolFrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): void {
    if (chunk.length === 0) {
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  drain(): Buffer[] {
    const frames: Buffer[] = [];
    while (this.buffer.length >= PROTOCOL_FRAME_LENGTH_BYTES) {
      const bodyLength = this.buffer.readUInt32BE(0);
      if (bodyLength > PROTOCOL_MAX_FRAME_BYTES) {
        throw new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "Frame com tamanho inválido.",
          [`declaredLength=${bodyLength}`, `maxBytes=${PROTOCOL_MAX_FRAME_BYTES}`],
        );
      }
      const frameSize = PROTOCOL_FRAME_LENGTH_BYTES + bodyLength;
      if (this.buffer.length < frameSize) {
        break;
      }
      frames.push(this.buffer.subarray(PROTOCOL_FRAME_LENGTH_BYTES, frameSize));
      this.buffer = this.buffer.subarray(frameSize);
    }
    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
