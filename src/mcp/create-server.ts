import { McpServer } from "@modelcontextprotocol/server";
import { parseRole } from "../auth.ts";
import type { Role } from "../ontology.ts";
import { desk, OpsStore } from "../store.ts";
import { registerResources } from "./resources.ts";
import { registerTools } from "./tools.ts";

export const SERVER_NAME = "waylucid-ops";
export const SERVER_VERSION = "0.1.0";

export type CreateServerOptions = {
  role?: Role | string;
  store?: OpsStore;
};

export function createOpsServer(options: CreateServerOptions = {}): McpServer {
  const role = parseRole(options.role);
  const store = options.store ?? desk;
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    description: [
      `Harborline ops desk as ${role}.`,
      "Fictional seed data for this public reference.",
      "Use only advertised tools. Do not invent ids — list or search first.",
      "Internal notes are supervisor-only and must never be paraphrased to a customer.",
    ].join(" "),
  });
  registerTools(server, store, role);
  registerResources(server, store, role);
  return server;
}

export function roleFromEnv(): Role {
  return parseRole(process.env.WAYLUCID_ROLE);
}
