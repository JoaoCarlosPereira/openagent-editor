import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  IsolatedExtensionHost,
  createVsixArchive,
} from "../../src/index.js";

interface TestEnvironment {
  root: string;
  workspaceRoot: string;
  extensionsDirectory: string;
  cleanup: () => void;
}

function makeTestEnvironment(): TestEnvironment {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-vsix-test-"));
  const workspaceRoot = path.join(root, "workspace");
  const extensionsDirectory = path.join(root, "extensions");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(extensionsDirectory, { recursive: true });

  return {
    root,
    workspaceRoot,
    extensionsDirectory,
    cleanup: () => {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        // ignora erro de limpeza
      }
    },
  };
}

function makeValidVsixBuffer(options?: {
  name?: string;
  publisher?: string;
  version?: string;
  main?: string;
  commandName?: string;
  source?: string;
}): Buffer {
  const name = options?.name ?? "sample-vsix";
  const publisher = options?.publisher ?? "openagent";
  const version = options?.version ?? "1.0.0";
  const main = options?.main ?? "./extension.js";
  const commandName = options?.commandName ?? "openagent.vsix.hello";

  const manifest = {
    name,
    publisher,
    version,
    displayName: "Sample VSIX Extension",
    description: "Extensão empacotada em VSIX para teste de integração.",
    main,
    engines: {
      vscode: "^1.96.0",
      openagent: "^0.1.0",
    },
    activationEvents: [`onCommand:${commandName}`],
    contributes: {
      commands: [
        { command: commandName, title: "Say Hello from VSIX" },
      ],
    },
  };

  const extensionSource = `'use strict';

function activate(context, api) {
  context.subscriptions.push(
    api.commands.registerCommand("${commandName}", (arg) => {
      return "vsix hello: " + (arg || "world");
    }),
  );
  return { activated: true, fromVsix: true };
}

function deactivate() {}

module.exports = { activate, deactivate };
`;

  return createVsixArchive({
    "[Content_Types].xml": '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "extension.vsixmanifest": '<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0"/>',
    "extension/package.json": JSON.stringify(manifest, null, 2),
    "extension/extension.js": options?.source ?? extensionSource,
    "extension/README.md": "# Sample VSIX\nDocumentação da extensão.",
  });
}

function setZipMode(archive: Buffer, name: string, mode: number, creator = 3): void {
  const eocd = archive.length - 22;
  let offset = archive.readUInt32LE(eocd + 16);
  const count = archive.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    if (archive.subarray(offset + 46, offset + 46 + nameLength).toString() === name) {
      archive.writeUInt8(creator, offset + 5);
      archive.writeUInt32LE((mode << 16) >>> 0, offset + 38);
      return;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Entrada ausente: ${name}`);
}

test("registro direto sem main executa index.js e mantém confinamento", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const directory = path.join(env.extensionsDirectory, "direct");
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({
      name: "direct", publisher: "pub", version: "1.0.0", engines: { vscode: "*" },
    }));
    fs.writeFileSync(path.join(directory, "index.js"), "exports.activate = () => ({ direct: true });");
    const registration = host.registerExtensionFromDirectory(directory);
    assert.equal(registration.mainAbsolutePath, path.join(directory, "index.js"));
    assert.deepEqual((await host.activateExtension("pub.direct")).exports, { direct: true });
    await host.deactivateExtension("pub.direct");

    fs.unlinkSync(path.join(directory, "index.js"));
    const outside = path.join(env.root, "outside.js");
    fs.writeFileSync(outside, "exports.activate = () => ({ escaped: true });");
    fs.symlinkSync(outside, path.join(directory, "index.js"));
    assert.throws(() => host.registerExtensionFromDirectory(directory),
      (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
    assert.equal(host.getExtension("pub.direct")?.state, "deactivated");
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("instala e redescobre tema declarativo sem executar código", async () => {
  const env = makeTestEnvironment();
  const config = { workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory };
  let host = await IsolatedExtensionHost.spawn(config);
  try {
    const file = path.join(env.root, "theme.vsix");
    const manifest = {
      name: "theme", publisher: "pub", version: "1.0.0", engines: { vscode: "*" },
      contributes: { themes: [{ label: "Theme", uiTheme: "vs-dark", path: "./themes/theme.json" }] },
    };
    fs.writeFileSync(file, createVsixArchive({
      "extension/package.json": JSON.stringify(manifest),
      "extension/themes/theme.json": JSON.stringify({ colors: {} }),
      "extension/index.js": "throw new Error('index.js não deve ser executado');",
    }));
    const installed = await host.installVsix(file);
    assert.equal(installed.mainAbsolutePath, undefined);
    assert.deepEqual(installed.manifest.contributes, manifest.contributes);
    assert.equal((await host.activateExtension("pub.theme")).exports, undefined);
    assert.equal(host.getExtension("pub.theme")?.state, "active");
    await host.deactivateExtension("pub.theme");
    await host.terminate();
    host = await IsolatedExtensionHost.spawn(config);
    assert.equal(host.getExtension("pub.theme")?.state, "unloaded");
    assert.deepEqual(host.getExtension("pub.theme")?.manifest.contributes, manifest.contributes);
    await host.activateExtension("pub.theme");
    assert.equal(host.getExtension("pub.theme")?.state, "active");
    await host.deactivateExtension("pub.theme");
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("recusa transições após encerramento sem alterar extensões declarativas ou executáveis", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    for (const name of ["inactive", "active"]) {
      const file = path.join(env.root, `${name}.vsix`);
      fs.writeFileSync(file, createVsixArchive({
        "extension/package.json": JSON.stringify({ name, publisher: "pub", version: "1.0.0", engines: { vscode: "*" } }),
      }));
      await host.installVsix(file);
    }
    const executable = path.join(env.root, "executable.vsix");
    fs.writeFileSync(executable, makeValidVsixBuffer());
    await host.installVsix(executable);
    await host.activateExtension("pub.inactive");
    await host.deactivateExtension("pub.inactive");
    await host.activateExtension("pub.active");
    await host.activateExtension("openagent.sample-vsix");
    assert.equal(await host.executeCommand("openagent.vsix.hello", "antes"), "vsix hello: antes");
    await host.terminate();

    for (const [id, operation] of [
      ["pub.inactive", "activate"],
      ["pub.active", "deactivate"],
      ["openagent.sample-vsix", "deactivate"],
    ] as const) {
      const before = { ...host.getExtension(id) };
      await assert.rejects(
        operation === "activate" ? host.activateExtension(id) : host.deactivateExtension(id),
        (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
      );
      assert.deepEqual(host.getExtension(id), before);
    }
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("rejeita main presente inválido sem publicar extensão", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    for (const main of ["", " ", null, 1, "../outside.js", "/tmp/outside.js", "missing.js", "index\0.js", "dir"]) {
      const file = path.join(env.root, "invalid.vsix");
      fs.writeFileSync(file, createVsixArchive({
        "extension/package.json": JSON.stringify({ name: "invalid", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main }),
        "extension/dir/file.js": "module.exports = {};",
      }));
      await assert.rejects(host.installVsix(file), (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_STATE");
      assert.deepEqual(fs.readdirSync(env.extensionsDirectory), []);
      assert.equal(host.getExtension("pub.invalid"), undefined);
    }
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("instala VSIX com assinatura EOCD falsa no comentário e rejeita ZIP truncado", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const archive = makeValidVsixBuffer();
    const eocd = archive.length - 22;
    const comment = Buffer.alloc(50);
    comment.writeUInt32LE(0x06054b50, 4);
    comment.writeUInt16LE(24, 4 + 20);
    comment.writeUInt32LE(archive.length + 4, 4 + 16);
    archive.writeUInt16LE(comment.length, eocd + 20);
    const commented = Buffer.concat([archive, comment]);
    const file = path.join(env.root, "comment.vsix");
    fs.writeFileSync(file, commented);
    const registration = await host.installVsix(file);
    assert.equal(registration.manifest.name, "sample-vsix");

    const badComment = Buffer.from(commented);
    const badDirectory = Buffer.from(commented);
    badComment.writeUInt16LE(0xffff, eocd + 20);
    badDirectory.writeUInt16LE(0xffff, archive.readUInt32LE(eocd + 16) + 28);
    const malformed = [commented.subarray(0, commented.length - 1), badComment, badDirectory];
    for (const invalid of malformed) {
      fs.writeFileSync(file, invalid);
      await assert.rejects(host.installVsix(file), (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_STATE");
    }
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("preserva execução Unix sem restaurar privilégios e ignora modos não Unix", async (t) => {
  if (process.platform === "win32") { t.skip("Permissões e execução Unix indisponíveis"); return; }
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const archive = createVsixArchive({
      "extension/package.json": JSON.stringify({ name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js" }),
      "extension/index.js": "module.exports = {};",
      "extension/bin/tool": "#!/bin/sh\nprintf 'executado'\n",
      "extension/plain": "plain",
      "extension/no-metadata": "plain",
      "extension/dos-mode": "plain",
    });
    setZipMode(archive, "extension/bin/tool", 0o107755);
    setZipMode(archive, "extension/plain", 0o100644);
    setZipMode(archive, "extension/dos-mode", 0o100755, 0);
    const file = path.join(env.root, "modes.vsix");
    fs.writeFileSync(file, archive);
    const registration = await host.installVsix(file);
    const tool = path.join(registration.extensionPath, "bin/tool");
    const mode = fs.statSync(tool).mode;
    assert.equal(mode & 0o7000, 0);
    assert.equal(mode & 0o111, 0o111 & ~process.umask());
    assert.equal(spawnSync(tool, { encoding: "utf8" }).stdout, "executado");
    for (const name of ["plain", "no-metadata", "dos-mode"]) {
      assert.equal(fs.statSync(path.join(registration.extensionPath, name)).mode & 0o111, 0);
    }
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("rejeita tipos Unix especiais e diretórios inconsistentes sem publicar", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    for (const [name, mode] of [["extension/evil", 0o120777], ["extension/evil", 0o010755], ["extension/evil", 0o020755], ["extension/evil", 0o140755], ["extension/evil", 0o040755], ["extension/evil/", 0o100755]] as const) {
      const archive = createVsixArchive({
        "extension/package.json": JSON.stringify({ name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js" }),
        "extension/index.js": "module.exports = {};",
        [name]: "x",
      });
      setZipMode(archive, name, mode);
      const file = path.join(env.root, "special.vsix");
      fs.writeFileSync(file, archive);
      await assert.rejects(host.installVsix(file), (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_STATE");
      assert.deepEqual(fs.readdirSync(env.extensionsDirectory), []);
    }
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("[LOC-01] instala pacote VSIX válido localmente, registra no catálogo e executa comando via worker isolado", async () => {
  const env = makeTestEnvironment();
  let host: IsolatedExtensionHost | undefined;

  try {
    const currentHost = await IsolatedExtensionHost.spawn({
      workspaceRoot: env.workspaceRoot,
      extensionsDirectory: env.extensionsDirectory,
    });
    host = currentHost;

    const vsixBuffer = makeValidVsixBuffer({
      name: "sample-vsix",
      publisher: "openagent",
      version: "1.0.0",
    });

    const vsixPath = path.join(env.root, "sample-vsix-1.0.0.vsix");
    fs.writeFileSync(vsixPath, vsixBuffer);

    // Escuta evento extensionInstalled
    const events: { eventType: string; payload: unknown }[] = [];
    const unsubscribe = host.addEventListener((evt) => {
      events.push(evt);
    });

    const registration = await host.installVsix(vsixPath);
    unsubscribe();

    // 1. Verificação do registro retornado
    assert.equal(registration.id, "openagent.sample-vsix");
    assert.equal(registration.manifest.name, "sample-vsix");
    assert.equal(registration.manifest.publisher, "openagent");
    assert.equal(registration.manifest.version, "1.0.0");
    assert.equal(registration.state, "unloaded");
    assert.deepEqual(registration.registeredCommands, ["openagent.vsix.hello"]);

    // 2. Verificação dos arquivos no disco de forma versionada
    const installedDir = registration.extensionPath;
    assert.equal(fs.existsSync(installedDir), true);
    assert.equal(fs.existsSync(path.join(installedDir, "package.json")), true);
    assert.equal(fs.existsSync(path.join(installedDir, "extension.js")), true);
    assert.equal(fs.existsSync(path.join(installedDir, "README.md")), true);

    // 3. Verificação de ausência de arquivos temporários de estágio
    const rootFiles = fs.readdirSync(env.extensionsDirectory);
    assert.equal(rootFiles.filter((f) => f.startsWith(".tmp-vsix-")).length, 1);

    // 4. Verificação do evento emitido
    assert.equal(events.length, 1);
    const installEvent = events[0];
    assert.ok(installEvent);
    assert.equal(installEvent.eventType, "extensionInstalled");
    const payload = installEvent.payload as { extensionId?: string; version?: string };
    assert.equal(payload.extensionId, "openagent.sample-vsix");
    assert.equal(payload.version, "1.0.0");

    // 5. Verificação no catálogo do host
    const found = host.getExtension("openagent.sample-vsix");
    assert.ok(found);
    assert.equal(found.id, "openagent.sample-vsix");
    assert.equal(host.listExtensions().length, 1);

    // 6. Ativação da extensão instalada
    const activation = await host.activateExtension("openagent.sample-vsix");
    assert.equal(activation.extensionId, "openagent.sample-vsix");
    assert.equal(activation.activated, true);

    // 7. Execução do comando exposto pelo VSIX
    const commandResult = await host.executeCommand<string>("openagent.vsix.hello", "mundo");
    assert.equal(commandResult, "vsix hello: mundo");

    // 8. Desativação limpa
    const deactivation = await host.deactivateExtension("openagent.sample-vsix");
    assert.equal(deactivation.deactivated, true);
  } finally {
    if (host && !host.isTerminated) {
      await host.terminate();
    }
    env.cleanup();
  }
});

test("processos concorrentes não substituem a mesma versão", async () => {
  const env = makeTestEnvironment();
  try {
    const vsix = path.join(env.root, "test.vsix");
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    const modulePath = path.resolve("services/extension-host/src/vsix-installer.ts");
    const script = `import { installVsixPackage } from ${JSON.stringify(modulePath)}; try { await installVsixPackage(process.argv[1], process.argv[2]); process.exit(0); } catch (e) { process.exit(e.code === "CONFLICT" ? 2 : 3); }`;
    const run = () => new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, vsix, env.extensionsDirectory], { stdio: "ignore" });
      child.on("error", reject);
      child.on("exit", resolve);
    });
    assert.deepEqual((await Promise.all([run(), run()])).sort(), [0, 2]);
    const stage = fs.readFileSync(path.join(env.extensionsDirectory, "openagent.sample-vsix-1.0.0"), "utf8");
    assert.ok(fs.statSync(path.join(env.extensionsDirectory, stage, "extension.js")).isFile());
  } finally {
    env.cleanup();
  }
});

test("SIGKILL antes do commit permite nova instalação sem remover estágio órfão", async () => {
  const env = makeTestEnvironment();
  try {
    const vsix = path.join(env.root, "test.vsix");
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    const modulePath = path.resolve("services/extension-host/src/vsix-installer.ts");
    const script = `import fs from "node:fs"; import { installVsixPackage } from ${JSON.stringify(modulePath)}; fs.linkSync = () => process.kill(process.pid, "SIGKILL"); await installVsixPackage(process.argv[1], process.argv[2]);`;
    const signal = await new Promise<NodeJS.Signals | null>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, vsix, env.extensionsDirectory], { stdio: "ignore" });
      child.on("error", reject);
      child.on("exit", (_code, sig) => resolve(sig));
    });
    assert.equal(signal, "SIGKILL");
    const orphan = fs.readdirSync(env.extensionsDirectory);
    assert.equal(orphan.length, 1);
    assert.ok(orphan[0]);
    const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    try {
      assert.equal(host.getExtension("openagent.sample-vsix"), undefined);
      await host.installVsix(vsix);
      assert.ok(fs.existsSync(path.join(env.extensionsDirectory, orphan[0])));
    } finally {
      await host.terminate();
    }
  } finally {
    env.cleanup();
  }
});

test("publicador parado não tem estágio removido por concorrente", async (t) => {
  if (process.platform === "win32") { t.skip("SIGSTOP indisponível no Windows"); return; }
  const env = makeTestEnvironment();
  const vsix = path.join(env.root, "test.vsix");
  fs.writeFileSync(vsix, makeValidVsixBuffer());
  const modulePath = path.resolve("services/extension-host/src/vsix-installer.ts");
  const script = `import fs from "node:fs"; import { installVsixPackage } from ${JSON.stringify(modulePath)}; const link = fs.linkSync; fs.linkSync = (...args) => { fs.writeSync(1, "ready\\n"); process.kill(process.pid, "SIGSTOP"); return link(...args); }; try { await installVsixPackage(process.argv[1], process.argv[2]); process.exit(0); } catch (e) { process.exit(e.code === "CONFLICT" ? 2 : 3); }`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, vsix, env.extensionsDirectory], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Publicador terminou antes da barreira")));
    });
    const stage = fs.readdirSync(env.extensionsDirectory)[0];
    assert.ok(stage);
    const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    try {
      await host.installVsix(vsix);
      assert.ok(fs.existsSync(path.join(env.extensionsDirectory, stage, "extension.js")));
    } finally {
      await host.terminate();
    }
    const result = new Promise<number | null>((resolve) => child.once("exit", resolve));
    child.kill("SIGCONT");
    assert.equal(await result, 2);
    assert.ok(fs.existsSync(path.join(env.extensionsDirectory, "openagent.sample-vsix-1.0.0")));
  } finally {
    child.kill("SIGKILL");
    env.cleanup();
  }
});

test("seleção de versões é estável em ambas ordens e após reinício", async () => {
  const cases = [
    { versions: ["1.0.0+z", "1.0.0+a"], expected: "1.0.0+a" },
    { versions: ["1.0.0", "1.0.0+z"], expected: "1.0.0" },
    { versions: ["2.0.0-beta.11", "2.0.0-beta.2"], expected: "2.0.0-beta.11" },
    { versions: ["2.0.0-rc.1", "2.0.0"], expected: "2.0.0" },
    { versions: ["2.0.0+z", "10.0.0+a"], expected: "10.0.0+a" },
  ];
  for (const { versions, expected } of cases) {
    for (const order of [versions, [...versions].reverse()]) {
      const env = makeTestEnvironment();
      let host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
      try {
        for (const version of order) {
          const file = path.join(env.root, `${version}.vsix`);
          fs.writeFileSync(file, makeValidVsixBuffer({ version }));
          await host.installVsix(file);
        }
        assert.equal(host.getExtension("openagent.sample-vsix")?.manifest.version, expected, order.join(", "));
        await host.terminate();
        host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
        assert.equal(host.getExtension("openagent.sample-vsix")?.manifest.version, expected, order.join(", "));
      } finally {
        await host.terminate();
        env.cleanup();
      }
    }
  }
});

test("recuperação escolhe maior semver e rejeita main com symlink externo", async (t) => {
  if (process.platform === "win32") { t.skip("Criação de symlink requer privilégios no Windows"); return; }
  const env = makeTestEnvironment();
  let host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    for (const version of ["2.0.0", "10.0.0-beta.2", "10.0.0-beta.11", "10.0.0"]) {
      const file = path.join(env.root, `${version}.vsix`);
      fs.writeFileSync(file, makeValidVsixBuffer({ version }));
      await host.installVsix(file);
    }
    await host.terminate();
    host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    assert.equal(host.getExtension("openagent.sample-vsix")?.manifest.version, "10.0.0");
    const registration = host.getExtension("openagent.sample-vsix");
    assert.ok(registration);
    const outside = path.join(env.root, "external.js");
    fs.writeFileSync(outside, "module.exports = {}");
    fs.unlinkSync(path.join(registration.extensionPath, "extension.js"));
    fs.symlinkSync(outside, path.join(registration.extensionPath, "extension.js"));
    await host.terminate();
    host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    assert.equal(host.getExtension("openagent.sample-vsix")?.manifest.version, "10.0.0-beta.11");
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("reinício reconstrói catálogo após publicação sem registro", async () => {
  const env = makeTestEnvironment();
  let host: IsolatedExtensionHost | undefined;
  try {
    const vsix = path.join(env.root, "test.vsix");
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    const modulePath = path.resolve("services/extension-host/src/vsix-installer.ts");
    const script = `import { installVsixPackage } from ${JSON.stringify(modulePath)}; await installVsixPackage(process.argv[1], process.argv[2]); process.kill(process.pid, "SIGKILL");`;
    const signal = await new Promise<NodeJS.Signals | null>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, vsix, env.extensionsDirectory], { stdio: "ignore" });
      child.on("error", reject);
      child.on("exit", (_code, sig) => resolve(sig));
    });
    assert.equal(signal, "SIGKILL");
    host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    assert.ok(host.getExtension("openagent.sample-vsix"));
    await host.activateExtension("openagent.sample-vsix");
    assert.equal(await host.executeCommand("openagent.vsix.hello", "restart"), "vsix hello: restart");
  } finally {
    if (host) await host.terminate();
    env.cleanup();
  }
});

test("observador concorrente mantém publicação durante falha de notificação", async (t) => {
  if (process.platform === "win32") { t.skip("SIGSTOP indisponível no Windows"); return; }
  const env = makeTestEnvironment();
  const vsix = path.join(env.root, "test.vsix");
  fs.writeFileSync(vsix, makeValidVsixBuffer());
  const modulePath = path.resolve("services/extension-host/src/host.ts");
  const script = `
    import fs from "node:fs";
    import { IsolatedExtensionHost } from ${JSON.stringify(modulePath)};
    const host = await IsolatedExtensionHost.spawn({ workspaceRoot: process.argv[2], extensionsDirectory: process.argv[3] }, { execArgv: [] });
    host.addEventListener(() => {
      fs.writeSync(1, "published\\n");
      process.kill(process.pid, "SIGSTOP");
      throw new Error("falha de notificação");
    });
    try { const reg = await host.installVsix(process.argv[1]); if (reg.manifest.version !== "1.0.0") process.exitCode = 1; }
    catch { process.exitCode = 2; }
    finally { await host.terminate(); }
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, vsix, env.workspaceRoot, env.extensionsDirectory], { stdio: ["ignore", "pipe", "ignore"] });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let observer: IsolatedExtensionHost | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve) => child.stdout.once("data", () => resolve())),
      exited.then(() => { throw new Error("Publicador terminou antes da barreira"); }),
    ]);
    observer = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    const registration = observer.getExtension("openagent.sample-vsix");
    assert.ok(registration);
    assert.ok(registration.mainAbsolutePath);
    assert.ok(fs.existsSync(registration.mainAbsolutePath));
    child.kill("SIGCONT");
    assert.deepEqual(await exited, { code: 0, signal: null });
    assert.ok(fs.existsSync(registration.mainAbsolutePath));
    await observer.activateExtension(registration.id);
    assert.equal(await observer.executeCommand("openagent.vsix.hello", "concorrente"), "vsix hello: concorrente");
  } finally {
    child.kill("SIGKILL");
    await exited;
    if (observer) await observer.terminate();
    env.cleanup();
  }
});

test("destino e entrada simbólicos externos não são seguidos", async (t) => {
  if (process.platform === "win32") { t.skip("Criação de symlink requer privilégios no Windows"); return; }
  const env = makeTestEnvironment();
  let host: IsolatedExtensionHost | undefined;
  try {
    const outside = path.join(env.root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "extension.js"), "outside");
    fs.symlinkSync(outside, path.join(env.extensionsDirectory, "openagent.sample-vsix-1.0.0"), "dir");
    const vsix = path.join(env.root, "test.vsix");
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    await assert.rejects(host.installVsix(vsix), (error: unknown) => error instanceof ProtocolError && error.code === "CONFLICT");
    assert.equal(fs.readFileSync(path.join(outside, "extension.js"), "utf8"), "outside");
    assert.equal(host.getExtension("openagent.sample-vsix"), undefined);
  } finally {
    if (host) await host.terminate();
    env.cleanup();
  }
});

test("[LOC-01] atualização versionada: versões subsequentes de VSIX criam diretórios versionados e atualizam registro", async () => {
  const env = makeTestEnvironment();
  let host: IsolatedExtensionHost | undefined;

  try {
    const currentHost = await IsolatedExtensionHost.spawn({
      workspaceRoot: env.workspaceRoot,
      extensionsDirectory: env.extensionsDirectory,
    });
    host = currentHost;

    const v1Path = path.join(env.root, "sample-1.0.0.vsix");
    const v2Path = path.join(env.root, "sample-1.0.1.vsix");

    fs.writeFileSync(v1Path, makeValidVsixBuffer({ version: "1.0.0" }));
    fs.writeFileSync(v2Path, makeValidVsixBuffer({ version: "1.0.1" }));

    const reg1 = await host.installVsix(v1Path);
    assert.equal(reg1.manifest.version, "1.0.0");
    assert.equal(fs.existsSync(path.join(env.extensionsDirectory, "openagent.sample-vsix-1.0.0")), true);

    const reg2 = await host.installVsix(v2Path);
    assert.equal(reg2.manifest.version, "1.0.1");
    assert.equal(fs.existsSync(path.join(env.extensionsDirectory, "openagent.sample-vsix-1.0.1")), true);

    // Catálogo reflete a versão mais recente
    const current = host.getExtension("openagent.sample-vsix");
    assert.ok(current);
    assert.equal(current.manifest.version, "1.0.1");

    await assert.rejects(host.installVsix(v2Path),
      (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.CONFLICT);
    assert.equal(fs.existsSync(path.join(reg2.extensionPath, "extension.js")), true);
  } finally {
    if (host && !host.isTerminated) {
      await host.terminate();
    }
    env.cleanup();
  }
});

test("atualização recusa extensão ativa e em transição sem publicar e permite atualizar após desativar", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const v1 = path.join(env.root, "v1.vsix");
    const v2 = path.join(env.root, "v2.vsix");
    fs.writeFileSync(v1, makeValidVsixBuffer({ version: "1.0.0" }));
    fs.writeFileSync(v2, makeValidVsixBuffer({ version: "2.0.0", commandName: "openagent.vsix.v2" }));
    const original = await host.installVsix(v1);
    const activation = host.activateExtension(original.id);
    assert.equal(original.state, "loading");
    await assert.rejects(host.installVsix(v2), (error: unknown) => error instanceof ProtocolError && error.code === "CONFLICT");
    await assert.rejects(host.activateExtension(original.id), (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_STATE");
    await activation;
    await assert.rejects(host.installVsix(v2), (error: unknown) => error instanceof ProtocolError && error.code === "CONFLICT");
    assert.equal(host.getExtension(original.id), original);
    assert.equal(fs.existsSync(path.join(env.extensionsDirectory, "openagent.sample-vsix-2.0.0")), false);
    assert.equal(await host.executeCommand("openagent.vsix.hello", "v1"), "vsix hello: v1");
    const deactivation = host.deactivateExtension(original.id);
    assert.equal(original.state, "deactivating");
    await assert.rejects(host.installVsix(v2), (error: unknown) => error instanceof ProtocolError && error.code === "CONFLICT");
    await assert.rejects(host.activateExtension(original.id), (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_STATE");
    await deactivation;
    await host.activateExtension(original.id);
    await host.deactivateExtension(original.id);
    const install = host.installVsix(v2);
    await assert.rejects(host.activateExtension(original.id), (error: unknown) => error instanceof ProtocolError && error.code === "CONFLICT");
    const updated = await install;
    assert.equal(updated.manifest.version, "2.0.0");
    await host.activateExtension(original.id);
    assert.equal(await host.executeCommand("openagent.vsix.v2", "v2"), "vsix hello: v2");
    await host.deactivateExtension(original.id);
    await host.activateExtension(original.id);
    assert.equal(await host.executeCommand("openagent.vsix.v2", "again"), "vsix hello: again");
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("falha de publicação libera instalação e preserva extensão desativada", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const v1 = path.join(env.root, "v1.vsix");
    const v2 = path.join(env.root, "v2.vsix");
    fs.writeFileSync(v1, makeValidVsixBuffer());
    fs.writeFileSync(v2, makeValidVsixBuffer({ version: "2.0.0" }));
    const original = await host.installVsix(v1);
    await host.activateExtension(original.id);
    await host.deactivateExtension(original.id);
    const link = fs.linkSync;
    try {
      fs.linkSync = () => { throw new Error("falha publicação"); };
      await assert.rejects(host.installVsix(v2), /falha publicação/);
    } finally {
      fs.linkSync = link;
    }
    assert.equal(host.getExtension(original.id), original);
    await host.activateExtension(original.id);
    assert.equal(await host.executeCommand("openagent.vsix.hello", "preservada"), "vsix hello: preservada");
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

for (const phase of ["activate", "deactivate"] as const) {
  test(`falha de ${phase} limpa worker e permite instalar versão corrigida`, async () => {
    const env = makeTestEnvironment();
    const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    try {
      const source = `
        exports.activate = (context, api) => {
          context.subscriptions.push(api.commands.registerCommand("broken.command", () => "broken"));
          context.subscriptions.push(api.languages.registerCompletionItemProvider("*", { provideCompletionItems() { return []; } }));
          context.subscriptions.push(api.languages.registerHoverProvider("*", { provideHover() { return null; } }));
          ${phase === "activate" ? 'throw new Error("broken activate");' : ""}
        };
        exports.deactivate = () => { ${phase === "deactivate" ? 'throw new Error("broken deactivate");' : ""} };
      `;
      const broken = path.join(env.root, "broken.vsix");
      const fixed = path.join(env.root, "fixed.vsix");
      fs.writeFileSync(broken, makeValidVsixBuffer({ source }));
      fs.writeFileSync(fixed, makeValidVsixBuffer({ version: "2.0.0", commandName: "fixed.command" }));
      const registration = await host.installVsix(broken);
      if (phase === "activate") {
        const activation = host.activateExtension(registration.id);
        await assert.rejects(host.installVsix(fixed), (error: unknown) => error instanceof ProtocolError && error.code === "CONFLICT");
        await assert.rejects(activation, /broken activate/);
      } else {
        await host.activateExtension(registration.id);
        assert.equal(await host.executeCommand("broken.command"), "broken");
        assert.equal(host.getRegisteredCompletionProviders().length, 1);
        assert.equal(host.getRegisteredHoverProviders().length, 1);
        const deactivation = host.deactivateExtension(registration.id);
        await assert.rejects(host.installVsix(fixed), (error: unknown) => error instanceof ProtocolError && error.code === "CONFLICT");
        await assert.rejects(deactivation, /broken deactivate/);
      }
      assert.equal(registration.state, "failed");
      assert.equal(host.getRegisteredCompletionProviders().length, 0);
      assert.equal(host.getRegisteredHoverProviders().length, 0);
      await assert.rejects(host.executeCommand("broken.command"), /não encontrado/);
      await host.installVsix(fixed);
      await host.activateExtension(registration.id);
      assert.equal(await host.executeCommand("fixed.command", "recovery"), "vsix hello: recovery");
      await host.deactivateExtension(registration.id);
    } finally {
      await host.terminate();
      env.cleanup();
    }
  });
}

test("[LOC-01] caminho de erro: arquivo VSIX inexistente ou argumento vazio rejeita com INVALID_STATE sem efeito colateral", async () => {
  const env = makeTestEnvironment();
  let host: IsolatedExtensionHost | undefined;

  try {
    const currentHost = await IsolatedExtensionHost.spawn({
      workspaceRoot: env.workspaceRoot,
      extensionsDirectory: env.extensionsDirectory,
    });
    host = currentHost;

    // Caminho vazio
    await assert.rejects(
      async () => currentHost.installVsix(""),
      (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    // Arquivo inexistente
    const nonExistentPath = path.join(env.root, "non-existent.vsix");
    await assert.rejects(
      async () => currentHost.installVsix(nonExistentPath),
      (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    // Nenhum resíduo deixado
    assert.equal(fs.readdirSync(env.extensionsDirectory).length, 0);
  } finally {
    if (host && !host.isTerminated) {
      await host.terminate();
    }
    env.cleanup();
  }
});

test("[LOC-01] caminho de erro: arquivo corrompido ou truncado rejeita com INVALID_STATE e limpa diretório temporário", async () => {
  const env = makeTestEnvironment();
  let host: IsolatedExtensionHost | undefined;

  try {
    const currentHost = await IsolatedExtensionHost.spawn({
      workspaceRoot: env.workspaceRoot,
      extensionsDirectory: env.extensionsDirectory,
    });
    host = currentHost;

    const corruptPath = path.join(env.root, "corrupted.vsix");
    fs.writeFileSync(corruptPath, Buffer.from("isto-nao-eh-um-arquivo-zip-nem-vsix-valido"));

    await assert.rejects(
      async () => currentHost.installVsix(corruptPath),
      (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    // Diretório limpo
    assert.equal(fs.readdirSync(env.extensionsDirectory).length, 0);
  } finally {
    if (host && !host.isTerminated) {
      await host.terminate();
    }
    env.cleanup();
  }
});

test("[LOC-01] caminho de erro: tentativa de Zip Slip / path traversal rejeita com OUT_OF_SCOPE sem efeito colateral", async () => {
  const env = makeTestEnvironment();
  let host: IsolatedExtensionHost | undefined;

  try {
    const currentHost = await IsolatedExtensionHost.spawn({
      workspaceRoot: env.workspaceRoot,
      extensionsDirectory: env.extensionsDirectory,
    });
    host = currentHost;

    // VSIX com entrada maliciosa tentando escapar do diretório
    const maliciousZip = createVsixArchive({
      "extension/package.json": JSON.stringify({
        name: "evil-vsix",
        publisher: "attacker",
        version: "1.0.0",
        main: "./index.js",
        engines: { vscode: "^1.96.0" },
      }),
      "extension/index.js": "module.exports = {};",
      "extension/../../evil-slip.js": "console.log('pwned');",
    });

    const maliciousPath = path.join(env.root, "malicious.vsix");
    fs.writeFileSync(maliciousPath, maliciousZip);

    await assert.rejects(
      async () => currentHost.installVsix(maliciousPath),
      (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
    );

    // Verifica que o arquivo evil-slip.js NÃO foi gravado
    assert.equal(fs.existsSync(path.join(env.root, "evil-slip.js")), false);
    assert.equal(fs.existsSync(path.join(env.extensionsDirectory, "evil-slip.js")), false);
    // Nenhum resíduo temporário
    assert.equal(fs.readdirSync(env.extensionsDirectory).length, 0);
  } finally {
    if (host && !host.isTerminated) {
      await host.terminate();
    }
    env.cleanup();
  }
});

test("[LOC-01] caminho de erro: manifesto ausente ou inválido no VSIX rejeita com INVALID_STATE", async () => {
  const env = makeTestEnvironment();
  let host: IsolatedExtensionHost | undefined;

  try {
    const currentHost = await IsolatedExtensionHost.spawn({
      workspaceRoot: env.workspaceRoot,
      extensionsDirectory: env.extensionsDirectory,
    });
    host = currentHost;

    // 1. Sem package.json
    const noManifestZip = createVsixArchive({
      "extension/extension.js": "module.exports = {};",
    });
    const noManifestPath = path.join(env.root, "no-manifest.vsix");
    fs.writeFileSync(noManifestPath, noManifestZip);

    await assert.rejects(
      async () => currentHost.installVsix(noManifestPath),
      (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    // 2. package.json com JSON malformado
    const malformedJsonZip = createVsixArchive({
      "extension/package.json": "{ esta quebrado json",
      "extension/extension.js": "module.exports = {};",
    });
    const malformedJsonPath = path.join(env.root, "malformed-json.vsix");
    fs.writeFileSync(malformedJsonPath, malformedJsonZip);

    await assert.rejects(
      async () => currentHost.installVsix(malformedJsonPath),
      (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    // 3. package.json sem engines compatíveis
    const noEnginesZip = createVsixArchive({
      "extension/package.json": JSON.stringify({
        name: "no-engines",
        publisher: "openagent",
        version: "1.0.0",
        main: "./extension.js",
      }),
      "extension/extension.js": "module.exports = {};",
    });
    const noEnginesPath = path.join(env.root, "no-engines.vsix");
    fs.writeFileSync(noEnginesPath, noEnginesZip);

    await assert.rejects(
      async () => currentHost.installVsix(noEnginesPath),
      (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    // 4. package.json com arquivo main inexistente no pacote
    const missingMainZip = createVsixArchive({
      "extension/package.json": JSON.stringify({
        name: "missing-main",
        publisher: "openagent",
        version: "1.0.0",
        main: "./dist/not-found.js",
        engines: { vscode: "^1.96.0" },
      }),
    });
    const missingMainPath = path.join(env.root, "missing-main.vsix");
    fs.writeFileSync(missingMainPath, missingMainZip);

    await assert.rejects(
      async () => currentHost.installVsix(missingMainPath),
      (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    // Nenhum resíduo temporário
    assert.equal(fs.readdirSync(env.extensionsDirectory).length, 0);
  } finally {
    if (host && !host.isTerminated) {
      await host.terminate();
    }
    env.cleanup();
  }
});

test("[LOC-01] caminho de erro: installVsix em host finalizado rejeita com INVALID_STATE", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: env.workspaceRoot,
    extensionsDirectory: env.extensionsDirectory,
  });

  const validPath = path.join(env.root, "valid.vsix");
  fs.writeFileSync(validPath, makeValidVsixBuffer());

  await host.terminate();

  await assert.rejects(
    async () => host.installVsix(validPath),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );

  env.cleanup();
});

test("CRC zero incorreto e entradas ZIP perigosas são rejeitados", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const zero = createVsixArchive({ "extension/package.json": "abc" });
    const central = zero.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zero.writeUInt32LE(0, central + 16);
    const bomb = createVsixArchive({ "extension/package.json": "abc" });
    const bombCentral = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(33 * 1024 * 1024, bombCentral + 24);
    const symlink = createVsixArchive({ "extension/package.json": "abc" });
    const symlinkCentral = symlink.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    symlink.writeUInt32LE(0xa1ff0000, symlinkCentral + 38);
    for (const archive of [zero, bomb, symlink]) {
      const file = path.join(env.root, "adversarial.vsix");
      fs.writeFileSync(file, archive);
      await assert.rejects(host.installVsix(file), (err: unknown) =>
        err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE);
    }
    assert.deepEqual(fs.readdirSync(env.extensionsDirectory), []);
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("identidade hostil e main diretório não são instalados", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const directoryMain = createVsixArchive({
      "extension/package.json": JSON.stringify({ name: "valid", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "dir" }),
      "extension/dir/file.js": "abc",
    });
    for (const archive of [makeValidVsixBuffer({ version: "../../../outside" }), directoryMain]) {
      const file = path.join(env.root, "invalid.vsix");
      fs.writeFileSync(file, archive);
      await assert.rejects(host.installVsix(file), (err: unknown) =>
        err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE);
    }
    assert.deepEqual(fs.readdirSync(env.extensionsDirectory), []);
    assert.equal(fs.existsSync(path.join(env.root, "outside")), false);
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("nome iniciado por dois pontos é aceito como arquivo", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const vsix = path.join(env.root, "valid.vsix");
    fs.writeFileSync(vsix, createVsixArchive({
      "extension/package.json": JSON.stringify({ name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js" }),
      "extension/index.js": "module.exports = {};",
      "extension/..valid": "valid",
    }));
    await host.installVsix(vsix);
    assert.ok(host.getExtension("pub.sample"));
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("marcador reservado e colisões normalizadas são rejeitados antes de publicar", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const common = {
      "extension/package.json": JSON.stringify({ name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js" }),
      "extension/index.js": "module.exports = {};",
    };
    const cases: Record<string, string>[] = [
      { "extension/.publication": "x" },
      { "extension/./.publication/child": "x" },
      { "extension/folder": "x", "extension/folder/./file": "y" },
      { "extension/folder/./file": "y", "extension/folder": "x" },
      { "extension/folder/file": "x", "extension/folder/./file": "y" },
    ];
    for (const entries of cases) {
      const vsix = path.join(env.root, "invalid.vsix");
      fs.writeFileSync(vsix, createVsixArchive({ ...common, ...entries }));
      await assert.rejects(host.installVsix(vsix), (error: unknown) =>
        error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE);
      assert.deepEqual(fs.readdirSync(env.extensionsDirectory), []);
      assert.equal(host.getExtension("pub.sample"), undefined);
    }
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("caminhos longos na extração retornam erro estável sem publicar", async (t) => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    let checked = 0;
    for (const component of ["a".repeat(256), "\u00e9".repeat(128), "b".repeat(1024)]) {
      const probe = path.join(env.root, component);
      try {
        fs.writeFileSync(probe, "probe", { flag: "wx" });
        fs.unlinkSync(probe);
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENAMETOOLONG") throw error;
      }
      checked++;
      for (const entry of [`extension/${component}`, `extension/${component}/file`]) {
        const vsix = path.join(env.root, "long.vsix");
        fs.writeFileSync(vsix, createVsixArchive({
          "extension/package.json": JSON.stringify({ name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js" }),
          "extension/index.js": "module.exports = {};",
          [entry]: "x",
        }));
        await assert.rejects(host.installVsix(vsix), (error: unknown) =>
          error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE);
        assert.deepEqual(fs.readdirSync(env.extensionsDirectory), []);
        assert.equal(host.getExtension("pub.sample"), undefined);
      }
    }
    if (checked === 0) t.skip("O sistema de arquivos aceita os componentes testados.");
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("manifestos inválidos não criam destino nem removem diretórios existentes", async () => {
  const env = makeTestEnvironment();
  const parent = path.join(env.root, "new-parent");
  const extensionsDirectory = path.join(parent, "nested", "extensions");
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory });
  try {
    const validManifest = { name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "./index.js" };
    const cases: Record<string, string>[] = [
      { "extension/index.js": "x" },
      { "extension/package.json": "{", "extension/index.js": "x" },
      { "extension/package.json": JSON.stringify({ ...validManifest, name: "" }), "extension/index.js": "x" },
      { "extension/package.json": JSON.stringify({ ...validManifest, main: "missing.js" }), "extension/index.js": "x" },
      { "extension/package.json": JSON.stringify({ ...validManifest, main: "folder" }), "extension/folder/file.js": "x" },
      { "extension/package.json": JSON.stringify({ ...validManifest, main: "../outside.js" }), "extension/index.js": "x" },
      ...[
        { contributes: { commands: {} } },
        { contributes: { commands: [null] } },
        { contributes: { commands: [{ command: 42 }] } },
        { contributes: [] },
        { activationEvents: ["*", 42] },
        { engines: { vscode: "*", openagent: false } },
      ].map((override) => ({
        "extension/package.json": JSON.stringify({ ...validManifest, ...override }),
        "extension/index.js": "x",
      })),
    ];
    for (const entries of cases) {
      const vsix = path.join(env.root, "invalid-no-root.vsix");
      fs.writeFileSync(vsix, createVsixArchive(entries));
      await assert.rejects(host.installVsix(vsix), (error: unknown) =>
        error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE);
      assert.equal(fs.existsSync(parent), false);
      assert.equal(host.getExtension("pub.sample"), undefined);
    }
    fs.mkdirSync(extensionsDirectory, { recursive: true });
    const sentinel = path.join(extensionsDirectory, "other-owner");
    fs.writeFileSync(sentinel, "preserve");
    await assert.rejects(host.installVsix(path.join(env.root, "invalid-no-root.vsix")));
    assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve");
    assert.deepEqual(fs.readdirSync(extensionsDirectory), ["other-owner"]);
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("caminho final excessivo é rejeitado antes de criar destino", async (t) => {
  if (process.platform !== "linux") { t.skip("Limite de caminho investigado no Linux"); return; }
  const env = makeTestEnvironment();
  const parent = path.join(env.root, ...Array(12).fill("p".repeat(200)));
  const extensionsDirectory = path.join(parent, "extensions");
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory });
  try {
    const vsix = path.join(env.root, "deep.vsix");
    const deep = Array(9).fill("d".repeat(200)).join("/") + "/file";
    fs.writeFileSync(vsix, createVsixArchive({
      "extension/package.json": JSON.stringify({ name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js" }),
      "extension/index.js": "x",
      [`extension/${deep}`]: "x",
    }));
    await assert.rejects(host.installVsix(vsix), (error: unknown) =>
      error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE);
    assert.equal(fs.existsSync(path.join(env.root, "p".repeat(200))), false);
    assert.equal(fs.readdirSync(env.root).some((name) => name.startsWith(".tmp-vsix-probe-")), false);
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("extração inválida concorrente preserva publicação de outro processo", async (t) => {
  if (process.platform === "win32") { t.skip("SIGSTOP indisponível no Windows"); return; }
  const env = makeTestEnvironment();
  const destination = path.join(env.root, "shared", "nested", "extensions");
  const invalid = path.join(env.root, "invalid-race.vsix");
  const valid = path.join(env.root, "valid-race.vsix");
  fs.writeFileSync(valid, makeValidVsixBuffer());
  fs.writeFileSync(invalid, createVsixArchive({
    "extension/package.json": JSON.stringify({ name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js" }),
    "extension/index.js": "x",
    [`extension/${"x".repeat(1024)}`]: "x",
  }));
  const modulePath = path.resolve("services/extension-host/src/vsix-installer.ts");
  const script = `import fs from "node:fs"; import { installVsixPackage } from ${JSON.stringify(modulePath)}; const write = fs.writeFileSync; fs.writeFileSync = (...args) => { if (String(args[0]).includes(".tmp-vsix-")) { fs.writeSync(1, "ready\\n"); process.kill(process.pid, "SIGSTOP"); fs.writeFileSync = write; } return write(...args); }; try { await installVsixPackage(process.argv[1], process.argv[2]); process.exit(3); } catch (e) { process.exit(e.code === "INVALID_STATE" ? 0 : 2); }`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, invalid, destination], { stdio: ["ignore", "pipe", "ignore"] });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  try {
    await Promise.race([new Promise<void>((resolve) => child.stdout.once("data", () => resolve())), exited.then(() => { throw new Error("Processo terminou antes da barreira"); })]);
    assert.equal(fs.existsSync(destination), true);
    const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: destination });
    try {
      const registration = await host.installVsix(valid);
      const sentinel = path.join(destination, "other-owner");
      fs.writeFileSync(sentinel, "preserve");
      child.kill("SIGCONT");
      assert.equal(await exited, 0);
      assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve");
      assert.ok(registration.mainAbsolutePath);
      assert.equal(fs.existsSync(registration.mainAbsolutePath), true);
      assert.equal(host.getExtension(registration.id), registration);
    } finally {
      await host.terminate();
    }
  } finally {
    child.kill("SIGKILL");
    await exited;
    env.cleanup();
  }
});

test("instala VSIX em raiz ausente curta", async (t) => {
  if (process.platform !== "linux") { t.skip("Reprodução de caminho curto em /tmp no Linux"); return; }
  const env = makeTestEnvironment();
  const destination = `/tmp/v${process.pid}`;
  if (fs.existsSync(destination)) { env.cleanup(); t.skip("Destino curto já existe"); return; }
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: destination });
  let installed = false;
  try {
    const vsix = path.join(env.root, "short.vsix");
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    const registration = await host.installVsix(vsix);
    installed = true;
    assert.ok(registration.mainAbsolutePath);
    assert.ok(fs.existsSync(registration.mainAbsolutePath));
  } finally {
    await host.terminate();
    if (installed) fs.rmSync(destination, { recursive: true, force: true });
    env.cleanup();
  }
});

test("sondagem de caminhos preserva raiz ausente e falhas ambientais", async () => {
  const env = makeTestEnvironment();
  const parent = path.join(env.root, "absent-parent");
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: path.join(parent, "extensions") });
  const originalWrite = fs.writeFileSync;
  try {
    const manifest = { name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js" };
    const vsix = path.join(env.root, "probe.vsix");
    for (const entries of [
      { "extension/package.json": JSON.stringify(manifest), "extension/index.js": "ok", [`extension/${"x".repeat(1024)}`]: "x" },
      { "extension/package.json": JSON.stringify({ ...manifest, name: "x".repeat(1024) }), "extension/index.js": "ok" },
    ]) {
      fs.writeFileSync(vsix, createVsixArchive(entries));
      await assert.rejects(host.installVsix(vsix), (error: unknown) =>
        error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE);
      assert.equal(fs.existsSync(parent), false);
      assert.equal(fs.readdirSync(env.root).some((name) => name.startsWith(".tmp-vsix-probe-")), false);
    }
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    const failure = Object.assign(new Error("sem espaço"), { code: "ENOSPC" });
    fs.writeFileSync = ((file: fs.PathOrFileDescriptor, ...args: Parameters<typeof fs.writeFileSync> extends [unknown, ...infer R] ? R : never) => {
      if (String(file).includes(".tmp-vsix-")) throw failure;
      return originalWrite(file, ...args);
    }) as typeof fs.writeFileSync;
    await assert.rejects(host.installVsix(vsix), (error: unknown) => error === failure);
    assert.equal(fs.existsSync(parent), false);
  } finally {
    fs.writeFileSync = originalWrite;
    await host.terminate();
    env.cleanup();
  }
});

test("estágio indisponível preserva erro ambiental e remove diretórios criados", async () => {
  const env = makeTestEnvironment();
  const parent = path.join(env.root, "absent-parent");
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: path.join(parent, "extensions") });
  const originalMkdtemp = fs.mkdtempSync;
  try {
    const vsix = path.join(env.root, "probe-denied.vsix");
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    const failure = Object.assign(new Error("sondagem sem permissão"), { code: "EACCES" });
    fs.mkdtempSync = ((prefix: string, options?: unknown) => {
      if (String(prefix).includes(".tmp-vsix-")) throw failure;
      return originalMkdtemp(prefix, options as BufferEncoding);
    }) as typeof fs.mkdtempSync;
    await assert.rejects(host.installVsix(vsix), (error: unknown) => error === failure);
    assert.equal(fs.existsSync(parent), false);
    assert.equal(host.getExtension("pub.sample"), undefined);
    fs.mkdtempSync = originalMkdtemp;
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    const registration = await host.installVsix(vsix);
    assert.ok(registration.mainAbsolutePath);
    assert.ok(fs.existsSync(registration.mainAbsolutePath));
  } finally {
    fs.mkdtempSync = originalMkdtemp;
    await host.terminate();
    env.cleanup();
  }
});

test("raiz curta ausente instala com todos os nomes hexadecimais ocupados", async () => {
  const env = makeTestEnvironment();
  const root = path.join(env.root, "z", "extensions");
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: root });
  try {
    for (const name of "0123456789abcdef") fs.writeFileSync(path.join(env.root, name), name);
    const vsix = path.join(env.root, "collision.vsix");
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    const registration = await host.installVsix(vsix);
    assert.ok(registration.mainAbsolutePath);
    assert.ok(fs.existsSync(registration.mainAbsolutePath));
    for (const name of "0123456789abcdef") assert.equal(fs.readFileSync(path.join(env.root, name), "utf8"), name);
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("raiz ausente de 4055 bytes aceita pacote válido e rejeita entrada inválida", async (t) => {
  if (process.platform !== "linux") { t.skip("Limite de caminho investigado no Linux"); return; }
  const env = makeTestEnvironment();
  const segments: string[] = [];
  let length = Buffer.byteLength(env.root);
  while (length < 4055) {
    const size = Math.min(200, 4055 - length - 1);
    segments.push("p".repeat(size));
    length += size + 1;
  }
  const root = path.join(env.root, ...segments);
  const first = path.join(env.root, segments[0] ?? "");
  const vsix = path.join(env.root, "long-root.vsix");
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: root });
  try {
    assert.equal(Buffer.byteLength(root), 4055);
    fs.writeFileSync(vsix, createVsixArchive({
      "extension/package.json": JSON.stringify({ name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js" }),
      "extension/index.js": "x",
      [`extension/${"x".repeat(256)}`]: "x",
    }));
    await assert.rejects(host.installVsix(vsix), (error: unknown) =>
      error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE);
    assert.equal(fs.existsSync(first), false);
    fs.writeFileSync(vsix, createVsixArchive({
      "extension/package.json": JSON.stringify({ name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js" }),
      "extension/index.js": "x",
      "extension/..valid": "x",
    }));
    const registration = await host.installVsix(vsix);
    assert.ok(registration.mainAbsolutePath);
    assert.equal(fs.existsSync(registration.mainAbsolutePath), true);
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("campos de caminho inválidos do manifesto não são publicados", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const cases: Record<string, unknown>[] = [
      { main: "index\0.js" },
      { main: "\0index.js" },
      { main: "index.js\0" },
      { main: "" },
      { main: 123 },
      { main: "missing.js" },
      { name: "sample\0bad" },
      { publisher: "pub\0bad" },
      { version: "1.0.0\0bad" },
    ];
    for (const overrides of cases) {
      const vsix = path.join(env.root, "manifest-invalid.vsix");
      fs.writeFileSync(vsix, createVsixArchive({
        "extension/package.json": JSON.stringify({ name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js", ...overrides }),
        "extension/index.js": "module.exports = {};",
      }));
      await assert.rejects(host.installVsix(vsix), (error: unknown) =>
        error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE);
      assert.deepEqual(fs.readdirSync(env.extensionsDirectory), []);
      assert.equal(host.getExtension("pub.sample"), undefined);
    }
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("caminhos longos derivados do manifesto não são publicados", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const manifests = [
      { main: "a".repeat(256) },
      { main: "\u00e9".repeat(128) },
      { main: Array(50).fill("segment".repeat(12)).join("/") },
      { name: "a".repeat(256) },
      { publisher: "b".repeat(256) },
      { name: "a".repeat(125), publisher: "b".repeat(125) },
      { version: `1.0.0+${"a".repeat(250)}` },
    ];
    for (const overrides of manifests) {
      const vsix = path.join(env.root, "manifest-long.vsix");
      fs.writeFileSync(vsix, createVsixArchive({
        "extension/package.json": JSON.stringify({ name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js", ...overrides }),
        "extension/index.js": "module.exports = {};",
      }));
      await assert.rejects(host.installVsix(vsix), (error: unknown) =>
        error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE);
      assert.deepEqual(fs.readdirSync(env.extensionsDirectory), []);
      assert.equal(host.getExtension("pub.sample"), undefined);
    }
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("falha ambiental durante extração não é mascarada e remove estágio", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  const originalWrite = fs.writeFileSync;
  try {
    const vsix = path.join(env.root, "environment.vsix");
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    const failure = Object.assign(new Error("disco cheio"), { code: "ENOSPC" });
    fs.writeFileSync = ((file: fs.PathOrFileDescriptor, ...args: Parameters<typeof fs.writeFileSync> extends [unknown, ...infer R] ? R : never) => {
      if (String(file).includes(".tmp-vsix-")) throw failure;
      return originalWrite(file, ...args);
    }) as typeof fs.writeFileSync;
    await assert.rejects(host.installVsix(vsix), (error: unknown) => error === failure);
    assert.deepEqual(fs.readdirSync(env.extensionsDirectory), []);
  } finally {
    fs.writeFileSync = originalWrite;
    await host.terminate();
    env.cleanup();
  }
});

test("falha de limpeza preserva erro original e não remove conteúdo concorrente", async () => {
  const env = makeTestEnvironment();
  const parent = path.join(env.root, "new-parent");
  const destination = path.join(parent, "extensions");
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: destination });
  const originalWrite = fs.writeFileSync;
  const originalRmdir = fs.rmdirSync;
  const failure = Object.assign(new Error("disco cheio"), { code: "ENOSPC" });
  try {
    const vsix = path.join(env.root, "cleanup.vsix");
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    fs.writeFileSync = ((file: fs.PathOrFileDescriptor, ...args: Parameters<typeof fs.writeFileSync> extends [unknown, ...infer R] ? R : never) => {
      if (String(file).includes(".tmp-vsix-")) {
        originalWrite(path.join(destination, "concurrent"), "preserve");
        throw failure;
      }
      return originalWrite(file, ...args);
    }) as typeof fs.writeFileSync;
    fs.rmdirSync = ((directory: fs.PathLike, ...args: Parameters<typeof fs.rmdirSync> extends [unknown, ...infer R] ? R : never) => {
      if (String(directory) === parent) throw Object.assign(new Error("sem permissão"), { code: "EACCES" });
      return originalRmdir(directory, ...args);
    }) as typeof fs.rmdirSync;
    await assert.rejects(host.installVsix(vsix), (error: unknown) => error === failure);
    assert.equal(fs.readFileSync(path.join(destination, "concurrent"), "utf8"), "preserve");
  } finally {
    fs.writeFileSync = originalWrite;
    fs.rmdirSync = originalRmdir;
    await host.terminate();
    env.cleanup();
  }
});

test("limite efetivo inclui estágio e não deixa raiz ausente", async (t) => {
  if (process.platform !== "linux") { t.skip("Reprodução de limite investigado no Linux"); return; }
  const env = makeTestEnvironment();
  const destination = path.join(env.root, "new-root");
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: destination });
  try {
    const length = 4096 - Buffer.byteLength(destination) - "/.tmp-vsix-XXXXXX/".length + 5;
    const segments: string[] = [];
    let remaining = length;
    while (remaining > 200) {
      segments.push("a".repeat(200));
      remaining -= 201;
    }
    segments.push("b".repeat(remaining));
    const relative = segments.join("/");
    assert.ok(Buffer.byteLength(path.join(destination, relative)) < 4096);
    const vsix = path.join(env.root, "stage-limit.vsix");
    fs.writeFileSync(vsix, createVsixArchive({
      "extension/package.json": JSON.stringify({ name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js" }),
      "extension/index.js": "ok",
      [`extension/${relative}`]: "x",
    }));
    await assert.rejects(host.installVsix(vsix), (error: unknown) =>
      error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE);
    assert.equal(fs.existsSync(destination), false);
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("falha ambiental de publicação não é mascarada", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  const originalLink = fs.linkSync;
  try {
    const vsix = path.join(env.root, "permission.vsix");
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    const failure = Object.assign(new Error("sem permissão"), { code: "EACCES" });
    fs.linkSync = () => { throw failure; };
    await assert.rejects(host.installVsix(vsix), (error: unknown) => error === failure);
    assert.deepEqual(fs.readdirSync(env.extensionsDirectory), []);
  } finally {
    fs.linkSync = originalLink;
    await host.terminate();
    env.cleanup();
  }
});

test("falhas anteriores ao commit preservam versão anterior e catálogo", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const first = path.join(env.root, "first.vsix");
    const second = path.join(env.root, "second.vsix");
    fs.writeFileSync(first, makeValidVsixBuffer());
    fs.writeFileSync(second, makeValidVsixBuffer({ version: "1.0.1" }));
    const existing = await host.installVsix(first);
    const originalRename = fs.linkSync;
    try {
      fs.linkSync = () => { throw new Error("falha simulada de rename"); };
      await assert.rejects(host.installVsix(second), /falha simulada/);
    } finally {
      fs.linkSync = originalRename;
    }
    assert.equal(host.getExtension(existing.id), existing);
    assert.equal(fs.existsSync(path.join(existing.extensionPath, "extension.js")), true);
    assert.equal(fs.existsSync(path.join(env.extensionsDirectory, "openagent.sample-vsix-1.0.1")), false);
    const observer = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    try {
      assert.equal(observer.getExtension(existing.id)?.manifest.version, "1.0.0");
    } finally {
      await observer.terminate();
    }
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("downgrade retorna versão selecionada antes e após reinício", async () => {
  const env = makeTestEnvironment();
  let host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  try {
    const newer = path.join(env.root, "new.vsix");
    const older = path.join(env.root, "old.vsix");
    fs.writeFileSync(newer, makeValidVsixBuffer({ version: "2.0.0" }));
    fs.writeFileSync(older, makeValidVsixBuffer({ version: "1.0.0" }));
    const selected = await host.installVsix(newer);
    assert.equal(await host.installVsix(older), selected);
    assert.equal(host.getExtension(selected.id), selected);
    await host.terminate();
    host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    assert.equal(host.getExtension(selected.id)?.manifest.version, "2.0.0");
  } finally {
    await host.terminate();
    env.cleanup();
  }
});

test("outro host mantém worker ativo até reinício, mesmo com publicação externa", async () => {
  const env = makeTestEnvironment();
  let first = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  let second: IsolatedExtensionHost | undefined;
  try {
    const v1 = path.join(env.root, "v1.vsix");
    const v2 = path.join(env.root, "v2.vsix");
    fs.writeFileSync(v1, makeValidVsixBuffer({ version: "1.0.0" }));
    fs.writeFileSync(v2, makeValidVsixBuffer({ version: "2.0.0", commandName: "new.command" }));
    const old = await first.installVsix(v1);
    await first.activateExtension(old.id);
    second = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    const installed = await second.installVsix(v2);
    assert.equal(installed.manifest.version, "2.0.0");
    assert.equal(first.getExtension(old.id)?.manifest.version, "1.0.0");
    assert.equal(await first.executeCommand("openagent.vsix.hello", "old"), "vsix hello: old");
    await first.deactivateExtension(old.id);
    await first.terminate();
    first = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    assert.equal(first.getExtension(old.id)?.manifest.version, "2.0.0");
    await first.activateExtension(old.id);
    assert.equal(await first.executeCommand("new.command", "new"), "vsix hello: new");
  } finally {
    await first.terminate();
    if (second) await second.terminate();
    env.cleanup();
  }
});

test("falha pós-commit informa publicação e recuperação por outro host", async () => {
  const env = makeTestEnvironment();
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
  const emitWarning = process.emitWarning;
  try {
    const vsix = path.join(env.root, "test.vsix");
    fs.writeFileSync(vsix, makeValidVsixBuffer());
    host.addEventListener(() => { throw new Error("listener"); });
    process.emitWarning = () => { throw new Error("warning unavailable"); };
    const result = await host.installVsix(vsix);
    assert.equal(result.status, "published_recovery_required");
    assert.deepEqual(result.publication, { extensionId: "openagent.sample-vsix", version: "1.0.0" });
    assert.equal(result.recovery, "restart_host");
    assert.match(result.warning ?? "", /warning unavailable/);
    assert.ok(fs.existsSync(path.join(env.extensionsDirectory, "openagent.sample-vsix-1.0.0")));
    const observer = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: env.extensionsDirectory });
    try {
      assert.equal(observer.getExtension("openagent.sample-vsix")?.manifest.version, "1.0.0");
    } finally {
      await observer.terminate();
    }
  } finally {
    process.emitWarning = emitWarning;
    await host.terminate();
    env.cleanup();
  }
});

test("VSIX com caminho longo próximo de PATH_MAX instala em destino curto inexistente e caminho excessivo é rejeitado", async (t) => {
  if (process.platform !== "linux") { t.skip("Reprodução de limite PATH_MAX em /tmp no Linux"); return; }
  const env = makeTestEnvironment();
  const destination = `/tmp/v${process.pid}`;
  if (fs.existsSync(destination)) { env.cleanup(); t.skip("Destino curto já existe"); return; }

  // 1. Caminho longo próximo de PATH_MAX que cabe no destino real (sem falso positivo da sonda)
  // 20 componentes de 200 caracteres + 1 arquivo de 40 caracteres = 4060 bytes de relPath
  const parts = Array(20).fill("a".repeat(200));
  parts.push("f".repeat(40));
  const longRelPath = parts.join("/");

  const manifest = { name: "sample", publisher: "pub", version: "1.0.0", engines: { vscode: "*" }, main: "index.js" };
  const validVsix = path.join(env.root, "long-near-limit.vsix");
  fs.writeFileSync(validVsix, createVsixArchive({
    "extension/package.json": JSON.stringify(manifest),
    "extension/index.js": "module.exports = {};",
    [`extension/${longRelPath}`]: "near-limit-content",
  }));

  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: destination });
  let installed = false;
  try {
    const registration = await host.installVsix(validVsix);
    installed = true;
    assert.ok(registration.mainAbsolutePath);
    assert.ok(fs.existsSync(registration.mainAbsolutePath));
    assert.equal(host.getExtension("pub.sample")?.manifest.version, "1.0.0");
  } finally {
    await host.terminate();
    if (installed) fs.rmSync(destination, { recursive: true, force: true });
  }

  // 2. Caminho que realmente excede PATH_MAX no destino real continua rejeitado com INVALID_STATE
  // No destino real (/tmp/ve<pid>), relPath de 4100 bytes faz path.resolve(destination, relPath) ter ~4115 bytes >= 4096
  const excessiveDestination = `/tmp/ve${process.pid}`;
  if (fs.existsSync(excessiveDestination)) { env.cleanup(); t.skip("Destino excessivo já existe"); return; }

  const excessiveParts = Array(20).fill("e".repeat(200));
  excessiveParts.push("f".repeat(80)); // 20 * 201 + 80 = 4100 bytes
  const excessiveRelPath = excessiveParts.join("/");

  const excessiveVsix = path.join(env.root, "excessive-path.vsix");
  fs.writeFileSync(excessiveVsix, createVsixArchive({
    "extension/package.json": JSON.stringify(manifest),
    "extension/index.js": "module.exports = {};",
    [`extension/${excessiveRelPath}`]: "excessive-content",
  }));

  const hostExcessive = await IsolatedExtensionHost.spawn({ workspaceRoot: env.workspaceRoot, extensionsDirectory: excessiveDestination });
  try {
    await assert.rejects(hostExcessive.installVsix(excessiveVsix), (error: unknown) =>
      error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE);
    assert.equal(fs.existsSync(excessiveDestination), false);
  } finally {
    await hostExcessive.terminate();
    if (fs.existsSync(excessiveDestination)) fs.rmSync(excessiveDestination, { recursive: true, force: true });
    env.cleanup();
  }
});
