import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { advertisedTools } from "../auth.ts";
import { createOpsServer, roleFromEnv } from "./create-server.ts";

const role = roleFromEnv();
const tools = advertisedTools(role);

void serveStdio(() => createOpsServer({ role }));
console.error(`waylucid-ops mcp  role=${role}  tools=${tools.length}  (${tools.join(", ")})`);
