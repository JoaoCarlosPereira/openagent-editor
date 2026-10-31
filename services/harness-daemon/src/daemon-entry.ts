import { startHarnessDaemon } from "./lifecycle.js";

function readFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<number> {
  const dataRoot = readFlagValue("--data-root");
  const runtimeDirectory = readFlagValue("--runtime-dir");

  const runtime = await startHarnessDaemon({
    ...(dataRoot ? { dataRoot } : {}),
    ...(runtimeDirectory ? { runtimeDirectory } : {}),
  });

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      await runtime.stop();
      resolve();
    };

    process.on("SIGINT", () => {
      void shutdown();
    });
    process.on("SIGTERM", () => {
      void shutdown();
    });
  });

  return 0;
}

main()
  .then((code) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
