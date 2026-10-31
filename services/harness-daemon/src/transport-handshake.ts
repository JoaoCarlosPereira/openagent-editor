import type net from "node:net";
import {
  assertLocalPeerAuth,
  buildProtocolTransportErrorFrame,
  buildProtocolVersionAck,
  buildWorkspaceTransportAck,
  readProtocolFrame,
  validateProtocolVersionHello,
  validateWorkspaceTransportHello,
  writeProtocolFrame,
} from "@openagent/protocol";
import type { WorkspaceTransportHello } from "@openagent/protocol";
import type { WorkspaceBindingState } from "./workspace-state.js";
import { readPeerCredentialFromSocket } from "./peer-credential.js";
import { serveRpcOnConnection } from "./rpc-connection.js";
import type { SessionRpcContext } from "./sessions/session-rpc-handler.js";

export async function performServerTransportHandshake(
  socket: net.Socket,
  resolveWorkspace: (hello: WorkspaceTransportHello) => WorkspaceBindingState,
  options: { dataRoot: string },
): Promise<void> {
  const versionFrame = await readProtocolFrame(socket);
  const versionParsed = JSON.parse(versionFrame.toString("utf8")) as unknown;
  const versionValidation = validateProtocolVersionHello(versionParsed);
  if (!versionValidation.valid) {
    writeProtocolFrame(
      socket,
      Buffer.from(
        JSON.stringify(
          buildProtocolTransportErrorFrame(
            versionValidation.code,
            versionValidation.errors.join(" "),
          ),
        ),
        "utf8",
      ),
    );
    socket.end();
    return;
  }

  writeProtocolFrame(
    socket,
    Buffer.from(JSON.stringify(buildProtocolVersionAck(versionValidation.value)), "utf8"),
  );

  const workspaceFrame = await readProtocolFrame(socket);
  const workspaceParsed = JSON.parse(workspaceFrame.toString("utf8")) as unknown;
  const workspaceValidation = validateWorkspaceTransportHello(workspaceParsed);
  if (!workspaceValidation.valid) {
    writeProtocolFrame(
      socket,
      Buffer.from(
        JSON.stringify(
          buildProtocolTransportErrorFrame(
            workspaceValidation.code,
            workspaceValidation.errors.join(" "),
          ),
        ),
        "utf8",
      ),
    );
    socket.end();
    return;
  }

  const peer = readPeerCredentialFromSocket(socket);
  const auth = assertLocalPeerAuth(peer, workspaceValidation.value.workspaceId);
  void auth;

  const binding = resolveWorkspace(workspaceValidation.value);
  writeProtocolFrame(
    socket,
    Buffer.from(
      JSON.stringify(
        buildWorkspaceTransportAck({
          type: "workspace.hello",
          workspaceId: binding.workspaceId,
          workspaceRoot: binding.workspaceRoot,
          providerProfileId: binding.providerProfileId,
          mode: binding.mode,
          rulesRef: binding.rulesRef,
          mcpServerIds: binding.mcpServerIds,
          sessionIds: binding.sessionIds,
        }),
      ),
      "utf8",
    ),
  );

  const rpcContext: SessionRpcContext = { dataRoot: options.dataRoot, binding };
  await serveRpcOnConnection(socket, rpcContext);
}
