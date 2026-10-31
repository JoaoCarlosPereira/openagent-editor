// Os processos-filhos de extensão ficam rastreados aqui. O host grava no stdin
// comandos JSON com uma linha por operação: { op: "track", pid },
// { op: "forget", pid } e { op: "kill", pid }. Quando o fim do stdin chega
// (host encerrado, inclusive via SIGKILL), todos os pids rastreados recebem
// SIGKILL e o processo encerra. Não há atomicidade: pids registrados por
// último podem não ter sido propagados antes de uma morte abrupta do host.
const tracked = new Set();

function killTracked(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // pid inexistente ou sem permissão: ignora.
    }
  }
}

function handleRequest(raw) {
  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    return;
  }
  if (!request || typeof request !== "object" || !Number.isSafeInteger(request.pid) || request.pid <= 0) {
    return;
  }
  if (request.op === "track") {
    tracked.add(request.pid);
    return;
  }
  if (request.op === "forget") {
    tracked.delete(request.pid);
    return;
  }
  if (request.op === "kill") {
    killTracked([request.pid]);
    tracked.delete(request.pid);
  }
}

process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) !== -1) {
    handleRequest(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
  }
});

const finalize = () => {
  killTracked(tracked);
  tracked.clear();
  process.exit(0);
};

process.stdin.on("end", finalize);
process.stdin.on("error", finalize);
process.stdin.resume();
