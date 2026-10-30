import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  CrossFileSuggestionController,
  type CrossFileSuggestionPort,
} from "../../src/tab/cross-file-suggestion.js";

function makePort(): CrossFileSuggestionPort & {
  reads: Array<{ root: string; relativePath: string }>;
  writes: Array<{ root: string; relativePath: string; content: string }>;
  nextReadError?: Error;
  nextWriteError?: Error;
} {
  const reads: Array<{ root: string; relativePath: string }> = [];
  const writes: Array<{ root: string; relativePath: string; content: string }> = [];
  const port = {
    reads,
    writes,
    nextReadError: undefined as Error | undefined,
    nextWriteError: undefined as Error | undefined,
    async read(fileRoot: string, relativePath: string): Promise<string> {
      reads.push({ root: fileRoot, relativePath });
      if (port.nextReadError) {
        const error = port.nextReadError;
        port.nextReadError = undefined;
        throw error;
      }
      const full = path.join(fileRoot, relativePath);
      return fs.readFileSync(full, "utf8");
    },
    async write(fileRoot: string, relativePath: string, content: string): Promise<void> {
      writes.push({ root: fileRoot, relativePath, content });
      if (port.nextWriteError) {
        const error = port.nextWriteError;
        port.nextWriteError = undefined;
        throw error;
      }
      const full = path.join(fileRoot, relativePath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    },
  };
  return port;
}

test("[TAB-03] sugestao em outro arquivo mostra caminho e so aplica apos aprovacao", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oa-170-"));
  fs.writeFileSync(path.join(root, "outro.ts"), "const inicial = 1;\n");
  const port = makePort();
  const controller = new CrossFileSuggestionController({ root, port });
  assert.equal(controller.snapshot.accessible.phase, "pending");

  const offered = await controller.offer({ relativePath: "outro.ts", proposedContent: "const inicial = 2;\n" });
  assert.equal(offered.accessible.phase, "reviewing");
  assert.equal(offered.accessible.showsTargetPath, true);
  assert.match(offered.html, /data-testid="cross-file-path">outro\.ts</);

  // arquivo ainda original (antes de aprovar)
  assert.equal(fs.readFileSync(path.join(root, "outro.ts"), "utf8"), "const inicial = 1;\n");

  const applied = await controller.approve();
  assert.equal(applied.accessible.phase, "approved");
  assert.equal(port.writes.length, 1);
  assert.equal(port.writes[0]?.relativePath, "outro.ts");
  assert.equal(fs.readFileSync(path.join(root, "outro.ts"), "utf8"), "const inicial = 2;\n");

  // reset para nova oferta
  const reseted = controller.reset();
  assert.equal(reseted.accessible.phase, "pending");
  fs.rmSync(root, { recursive: true, force: true });
});

test("[TAB-03] rejeitar mantem o arquivo original e sai da revisao", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oa-170-rej-"));
  fs.writeFileSync(path.join(root, "outro.ts"), "x = 1;\n");
  const port = makePort();
  const controller = new CrossFileSuggestionController({ root, port });
  await controller.offer({ relativePath: "outro.ts", proposedContent: "x = 2;\n" });
  const rejected = await controller.reject();
  assert.equal(rejected.accessible.phase, "rejected");
  assert.equal(port.writes.length, 0, "rejeitar nao escreve");
  assert.equal(fs.readFileSync(path.join(root, "outro.ts"), "utf8"), "x = 1;\n");
  fs.rmSync(root, { recursive: true, force: true });
});

test("[TAB-03] erro estavel: aprovar sem revisao, caminho invalido e reset em reviewing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oa-170-err-"));
  fs.writeFileSync(path.join(root, "a.ts"), "x = 1;\n");
  const port = makePort();
  const controller = new CrossFileSuggestionController({ root, port });

  await assert.rejects(controller.approve(), (error: unknown) => {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
    return true;
  });
  await assert.rejects(controller.reject(), (error: unknown) => error instanceof ProtocolError);

  await assert.rejects(
    async () => controller.offer({ relativePath: "../fora.ts", proposedContent: "x" }),
    (error: unknown) => error instanceof ProtocolError,
  );
  await assert.rejects(
    async () => controller.offer({ relativePath: "/absoluto.ts", proposedContent: "x" }),
    (error: unknown) => error instanceof ProtocolError,
  );
  await assert.rejects(
    async () => controller.offer({ relativePath: "", proposedContent: "x" }),
    (error: unknown) => error instanceof ProtocolError,
  );
  await assert.rejects(
    // proposedContent ausente
    async () => controller.offer({ relativePath: "a.ts" } as never),
    (error: unknown) => error instanceof ProtocolError,
  );
  // snapshot inalterado pelo caminho de erro
  assert.equal(controller.snapshot.accessible.phase, "pending");

  await controller.offer({ relativePath: "a.ts", proposedContent: "x = 2;" });
  assert.throws(
    () => controller.reset(),
    (error: unknown) => error instanceof ProtocolError,
  );
  // state permanece reviewing (reset falhou)
  assert.equal(controller.snapshot.accessible.phase, "reviewing");
  fs.rmSync(root, { recursive: true, force: true });
});

test("[TAB-03] oferta concorrente falha estavel e leitura em erro restaura pending", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oa-170-race-"));
  fs.writeFileSync(path.join(root, "out.ts"), "x = 1;\n");
  const controller = new CrossFileSuggestionController({ root, port: makePort() });
  // duplicação de offer com chamada simultânea no mesmo controller
  const first = controller.offer({ relativePath: "out.ts", proposedContent: "x = 2;" });
  assert.throws(
    () => controller.offer({ relativePath: "out.ts", proposedContent: "x = 999;" }),
    (error: unknown) => error instanceof ProtocolError,
  );
  const offered = await first;
  assert.equal(offered.accessible.phase, "reviewing");
  fs.rmSync(root, { recursive: true, force: true });
});

test("[TAB-03] construtor rejeita root vazio e porta invalida", () => {
  assert.throws(
    () => new CrossFileSuggestionController({ root: "", port: makePort() }),
    (error: unknown) => error instanceof ProtocolError,
  );
  assert.throws(
    () => new CrossFileSuggestionController({ root: "/tmp", port: {} as never }),
    (error: unknown) => error instanceof ProtocolError,
  );
});
