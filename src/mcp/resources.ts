import type { McpServer } from "@modelcontextprotocol/server";
import { advertisedTools, PRINCIPALS, roleLabel } from "../auth.ts";
import type { Role } from "../ontology.ts";
import type { OpsStore } from "../store.ts";

export function registerResources(server: McpServer, store: OpsStore, role: Role): void {
  server.registerResource(
    "whoami",
    "ops://desk/whoami",
    {
      title: "Connected principal",
      description: "Role and name for this MCP session",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              principal: PRINCIPALS[role],
              label: roleLabel(role),
              advertised_tools: advertisedTools(role),
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "catalog",
    "ops://desk/catalog",
    {
      title: "Tool catalog for this role",
      description: "Names this principal can call",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ role, tools: advertisedTools(role) }, null, 2),
        },
      ],
    }),
  );

  if (role === "supervisor") {
    server.registerResource(
      "snapshot",
      "ops://desk/snapshot",
      {
        title: "Full desk snapshot",
        description: "Supervisor-only dump of contacts, cases, and tasks including internal notes",
        mimeType: "application/json",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(store.snapshot(role), null, 2),
          },
        ],
      }),
    );
  }
}
