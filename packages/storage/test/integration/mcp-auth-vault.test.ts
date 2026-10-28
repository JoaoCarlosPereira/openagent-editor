import assert from "node:assert/strict";
import test from "node:test";
import { ProtocolError } from "@openagent/protocol";
import {
  createInMemorySystemSecretVault,
  createMcpAuthVaultResolver,
  readMcpAuthCredentialFromVault,
  registerMcpAuthCredential,
} from "../../src/secrets/index.js";

test("[MCP-01] registerMcpAuthCredential persiste OAuth/bearer no cofre com secretRef", async () => {
  const vault = createInMemorySystemSecretVault();
  const accessToken = "mcp-oauth-access-token-77";

  const registered = await registerMcpAuthCredential(
    {
      serverId: "remote-mcp",
      kind: "oauth",
      accessToken,
      refreshToken: "refresh-abc",
      tokenType: "Bearer",
    },
    { vault },
  );

  assert.match(registered.secretRef, /^sysvault:memory:openagent-editor\/mcp\/remote-mcp$/);

  const fromVault = await readMcpAuthCredentialFromVault(registered.secretRef, vault);
  assert.deepEqual(fromVault, {
    kind: "oauth",
    accessToken,
    refreshToken: "refresh-abc",
    tokenType: "Bearer",
  });
});

test("[MCP-01] caminho de erro: entrada MCP auth inválida retorna INVALID_STATE", async () => {
  const vault = createInMemorySystemSecretVault();
  await assert.rejects(
    () =>
      registerMcpAuthCredential(
        { serverId: "", kind: "bearer", accessToken: "x" },
        { vault },
      ),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "INVALID_STATE");
      return true;
    },
  );
});

test("[MCP-01] createMcpAuthVaultResolver lê material para transporte HTTP", async () => {
  const vault = createInMemorySystemSecretVault();
  const { secretRef } = await registerMcpAuthCredential(
    { serverId: "svc", kind: "bearer", accessToken: "tok-77" },
    { vault },
  );
  const resolve = createMcpAuthVaultResolver(vault);
  const material = await resolve(secretRef);
  assert.deepEqual(material, {
    kind: "bearer",
    accessToken: "tok-77",
    tokenType: "Bearer",
  });
});
