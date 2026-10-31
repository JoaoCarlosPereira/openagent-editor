import http from "node:http";

const port = Number(process.env.OPENAGENT_CLIPROXY_PORT);
const accessToken = process.env.OPENAGENT_CLIPROXY_ACCESS_TOKEN ?? "";

if (!Number.isFinite(port) || port <= 0) {
  console.error("OPENAGENT_CLIPROXY_PORT inválido");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/v1/models") {
    if (req.headers.authorization !== `Bearer ${accessToken}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "gpt-test" }, { id: "other-model" }] }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, "127.0.0.1", () => {
  if (process.send) {
    process.send({ ready: true, port });
  }
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
