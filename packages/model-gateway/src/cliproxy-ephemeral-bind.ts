import net from "node:net";

/** Reserva uma porta TCP em loopback e libera imediatamente (bind efêmero). */
export function allocateLoopbackPort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Falha ao alocar porta loopback.")));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

export function buildLoopbackOpenAiBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}
