import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Role } from "../ontology.ts";
import type { OpsStore } from "../store.ts";
import { desk } from "../store.ts";
import { createOpsServer } from "./create-server.ts";

export type OpsSession = {
  role: Role;
  client: Client;
  close: () => Promise<void>;
};

type AuthInfo = {
  token: string;
  clientId: string;
  scopes: string[];
};

function authInfoFor(role: Role): AuthInfo {
  return {
    token: role,
    clientId: `harborline-${role}`,
    scopes: [`role:${role}`],
  };
}

export async function openOpsSession(options: { role: Role; store?: OpsStore } = { role: "operator" }): Promise<OpsSession> {
  const store = options.store ?? desk;
  const handler = createMcpHandler(({ authInfo }) => {
    const role = (authInfo?.clientId?.replace("harborline-", "") ?? options.role) as Role;
    return createOpsServer({ role, store });
  });

  const transport = new StreamableHTTPClientTransport(new URL("http://waylucid.test/mcp"), {
    fetch: (url, init) =>
      handler.fetch(new Request(url, init), {
        authInfo: authInfoFor(options.role),
      }),
  });

  const client = new Client(
    { name: "waylucid-harness", version: "0.1.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  await client.connect(transport);

  return {
    role: options.role,
    client,
    close: async () => {
      await client.close();
      await handler.close();
    },
  };
}

export type ToolCallResult = {
  name: string;
  arguments: Record<string, unknown>;
  isError?: boolean;
  structuredContent: unknown;
  text: string;
};

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResult> {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content
    .map((block) => (block.type === "text" ? block.text : JSON.stringify(block)))
    .join("\n");
  return {
    name,
    arguments: args,
    isError: result.isError === true,
    structuredContent: result.structuredContent,
    text,
  };
}

export async function listToolNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.map((tool) => tool.name).sort();
}

export async function listToolCatalog(client: Client) {
  const { tools } = await client.listTools();
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));
}
