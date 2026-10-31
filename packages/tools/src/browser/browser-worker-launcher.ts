import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import {
  describeSandboxCapability,
  type DescribeSandboxCapabilityOptions,
  type SandboxCapabilitySnapshot,
} from "../sandbox/sandbox-capability.js";
import { WebSocketCdpTransport } from "./cdp-transport.js";

/** Executaveis do Chrome/Chromium tentados em ordem até encontrar um instalado (AUT-01 + ADR-006). */
export const DEFAULT_CHROME_EXECUTABLE_CANDIDATES: readonly string[] = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** Tempo máximo de espera pela saída efetiva do processo após SIGKILL antes de seguir com a limpeza (evita travar terminate() indefinidamente). */
const PROCESS_EXIT_GRACE_PERIOD_MS = 3_000;

/**
 * Aguarda o processo filho emitir "exit" (já encerrado conta como resolvido de imediato).
 * Usa timeout defensivo: se o SO não notificar a saída a tempo (ex.: processo preso em
 * wrapper de sandbox), segue com a limpeza em vez de bloquear terminate() indefinidamente.
 */
function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve();
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", onExit);
  });
}

export interface BrowserWorkerProcess {
  readonly transport: WebSocketCdpTransport;
  /** Nível de isolamento efetivamente aplicado ao processo lançado (ADR-006). */
  readonly sandbox: SandboxCapabilitySnapshot;
  /** Encerra o processo do navegador e limpa o perfil temporário (ADR-006: cancelamento encerra o worker). */
  terminate(): Promise<void>;
}

export interface LaunchBrowserWorkerOptions {
  /** Candidatos de executável, na ordem em que devem ser tentados. */
  executableCandidates?: readonly string[];
  /** Timeout de espera pelo endpoint do DevTools, em ms. */
  startupTimeoutMs?: number;
  /** Somente testes: substitui a detecção real de sandbox nativa. */
  sandboxOptions?: DescribeSandboxCapabilityOptions;
  /**
   * Argumentos extras ao executável do Chromium definidos pelo chamador
   * (ex.: adapter Linux do computer use com Wayland nativo — `--ozone-platform-hint=auto`).
   */
  extraChromiumArgs?: readonly string[];
}

async function resolveExecutable(
  candidates: readonly string[],
): Promise<string> {
  const { access } = await import("node:fs/promises");
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new ProtocolError(
    PROTOCOL_ERROR_CODES.INVALID_STATE,
    "Nenhum executável de Chrome/Chromium encontrado para o worker isolado do navegador.",
    [...candidates],
  );
}

/**
 * Parse do DevToolsActivePort do target isolado (AUT-01/PAD).
 * Tolerante a quebras de linha LF e CRLF (o ramo do Windows grava o arquivo
 * com CRLF; o `\r` residual não pode poluir o caminho do endpoint).
 * Retorna `null` enquanto o arquivo não estiver completo.
 */
export function parseDevToolsActivePort(raw: string): string | null {
  const [port, path] = raw.trim().split(/\r?\n/);
  if (port && path) {
    return `ws://127.0.0.1:${port}${path}`;
  }
  return null;
}

async function readDevToolsEndpoint(
  profileDir: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(join(profileDir, "DevToolsActivePort"), "utf8");
      const endpoint = parseDevToolsActivePort(raw);
      if (endpoint) {
        return endpoint;
      }
    } catch {
      // Arquivo ainda não escrito pelo processo do navegador; tenta novamente.
    }
    await delay(50);
  }
  throw new ProtocolError(
    PROTOCOL_ERROR_CODES.INVALID_STATE,
    "Tempo limite excedido ao aguardar o endpoint do DevTools do worker de navegador.",
  );
}

interface LaunchCommand {
  command: string;
  args: readonly string[];
}

/**
 * Monta o comando real do processo a lançar, aplicando a sandbox nativa do SO detectada por
 * describeSandboxCapability (ADR-006) quando disponível.
 *
 * Quando há isolamento nativo (bwrap/unshare/Seatbelt), o próprio Chrome ainda recebe
 * --no-sandbox: o SUID sandbox helper do Chrome exige o bit setuid root e aborta o processo
 * quando já está dentro de um user namespace não privilegiado criado pelo wrapper externo.
 * Nesse caso --no-sandbox não reduz o isolamento real: ele apenas evita que o Chrome tente (e
 * falhe) criar sua própria sandbox redundante; o isolamento efetivo vem do wrapper do SO. Só cai
 * para executar o Chrome direto, sem nenhum wrapper externo, quando o host está em modo
 * degradado (sandbox nativa indisponível), consistente com o aviso de degradação já anunciado ao
 * usuário na policy antes do consentimento (PER-01).
 */
function buildLaunchCommand(
  executable: string,
  chromeArgs: readonly string[],
  sandbox: SandboxCapabilitySnapshot,
  profileDir: string,
): LaunchCommand {
  if (sandbox.level !== "native") {
    // Degradado: nenhuma sandbox nativa do SO disponível; isola apenas via perfil/processo
    // dedicado do Chrome, com --no-sandbox documentado como fallback (degradationNotice já
    // exposto ao usuário antes do consentimento).
    return { command: executable, args: [...chromeArgs, "--no-sandbox"] };
  }

  if (sandbox.nativePrimitive === "bubblewrap") {
    // Bubblewrap: novo namespace de usuário/PID/IPC/UTS isolado; mantém rede (necessária para
    // navegação real e para o próprio CDP em loopback). Recria /bin,/lib,/lib64,/sbin como
    // symlinks porque hosts com /usr fundido ("merged-usr") os definem assim.
    return {
      command: "bwrap",
      args: [
        "--unshare-user",
        "--unshare-pid",
        "--unshare-ipc",
        "--unshare-uts",
        "--die-with-parent",
        "--ro-bind", "/usr", "/usr",
        "--symlink", "usr/bin", "/bin",
        "--symlink", "usr/lib", "/lib",
        "--symlink", "usr/lib64", "/lib64",
        "--symlink", "usr/sbin", "/sbin",
        "--ro-bind-try", "/opt", "/opt",
        "--ro-bind-try", "/etc", "/etc",
        "--dev", "/dev",
        "--proc", "/proc",
        "--tmpfs", "/tmp",
        "--bind", profileDir, profileDir,
        "--chdir", "/tmp",
        executable,
        ...chromeArgs,
        "--no-sandbox",
      ],
    };
  }

  if (sandbox.nativePrimitive === "unshare") {
    // unshare: isolamento de user/PID namespace sem a granularidade de bind mounts do bwrap.
    return {
      command: "unshare",
      args: [
        "--user", "--map-root-user",
        "--pid", "--fork", "--mount-proc",
        "--",
        executable,
        ...chromeArgs,
        "--no-sandbox",
      ],
    };
  }

  if (sandbox.nativePrimitive === "sandbox-exec") {
    // Seatbelt (macOS): perfil restrito que ainda permite leitura do sistema e acesso à rede.
    const seatbeltProfile = [
      "(version 1)",
      "(deny default)",
      "(allow file-read*)",
      '(allow file-write* (subpath (param "TMPDIR")))',
      "(allow process-exec)",
      "(allow process-fork)",
      "(allow network*)",
      "(allow sysctl-read)",
      "(allow mach-lookup)",
      "(allow iokit-open)",
    ].join("\n");
    return {
      command: "sandbox-exec",
      args: [
        "-D", `TMPDIR=${tmpdir()}`,
        "-p", seatbeltProfile,
        executable,
        ...chromeArgs,
        "--no-sandbox",
      ],
    };
  }

  // Nível nativo reportado sem primitive reconhecido pelo launcher: trata como degradado
  // explícito em vez de assumir isolamento que não sabemos aplicar.
  return { command: executable, args: [...chromeArgs, "--no-sandbox"] };
}

/**
 * AUT-01 + ADR-006: lança um processo de Chrome/Chromium headless isolado (perfil temporário próprio)
 * e conecta via WebSocket CDP. Quando o host expõe sandbox nativa (bubblewrap/unshare no Linux,
 * Seatbelt no macOS), o processo roda dentro dela; caso contrário, cai para executar o Chrome
 * direto com --no-sandbox como fallback documentado e consistente com a degradação anunciada na
 * policy. Cada chamada recebe seu próprio processo e perfil: o isolamento entre runs vem do
 * processo do SO, não apenas do browserContext dentro de um único Chrome compartilhado.
 */
export async function launchBrowserWorker(
  options?: LaunchBrowserWorkerOptions,
): Promise<BrowserWorkerProcess> {
  const executable = await resolveExecutable(
    options?.executableCandidates ?? DEFAULT_CHROME_EXECUTABLE_CANDIDATES,
  );
  const profileDir = await mkdtemp(join(tmpdir(), "openagent-browser-worker-"));
  const sandbox = describeSandboxCapability(options?.sandboxOptions);

  const chromeArgs = [
    ...(options?.extraChromiumArgs ?? []),
    "--headless",
    "--disable-gpu",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ];
  const launch = buildLaunchCommand(executable, chromeArgs, sandbox, profileDir);

  let child: ChildProcess;
  try {
    child = spawn(launch.command, [...launch.args], { stdio: "ignore" });
  } catch (error) {
    await rm(profileDir, { recursive: true, force: true });
    throw error;
  }

  let transport: WebSocketCdpTransport | undefined;
  let terminated = false;
  const terminate = async (): Promise<void> => {
    if (terminated) return;
    terminated = true;
    try {
      await transport?.close();
    } catch {
      // Prioriza encerrar o processo mesmo se o fechamento do transporte falhar.
    }
    if (!child.killed) {
      child.kill("SIGKILL");
    }
    // Aguarda a saída efetiva do processo (ou do wrapper de sandbox que o envolve) antes de
    // remover o perfil temporário: no bwrap/unshare, profileDir fica bind-montado dentro do
    // novo namespace de montagem e só é liberado quando o processo wrapper de fato termina.
    // Remover antes disso pode falhar silenciosamente ou deixar o diretório órfão em disco.
    await waitForChildExit(child, PROCESS_EXIT_GRACE_PERIOD_MS);
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };

  try {
    const endpoint = await readDevToolsEndpoint(
      profileDir,
      options?.startupTimeoutMs ?? 10_000,
    );
    transport = new WebSocketCdpTransport(endpoint);
    await transport.connect();
  } catch (error) {
    await terminate();
    throw error;
  }

  return { transport, sandbox, terminate };
}
