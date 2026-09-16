#!/usr/bin/env tsx
import { listToolCatalog, openOpsSession } from "../mcp/session.ts";
import type { Role } from "../ontology.ts";
import { desk } from "../store.ts";
import { parseAgentCommand } from "./arguments.ts";
import { formatTrace, runAgent } from "./run.ts";

async function listTools(role: Role, json: boolean): Promise<void> {
  const session = await openOpsSession({ role, store: desk });
  try {
    const catalog = await listToolCatalog(session.client);
    if (json) {
      console.log(JSON.stringify({ role, tools: catalog }, null, 2));
      return;
    }
    console.log(`waylucid-ops  role=${role}  ${catalog.length} tools\n`);
    for (const tool of catalog) {
      const hints = tool.annotations
        ? Object.entries(tool.annotations)
            .filter(([, value]) => value)
            .map(([key]) => key.replace(/Hint$/, ""))
            .join(", ")
        : "";
      console.log(`  ${tool.name}${hints ? `  [${hints}]` : ""}`);
      if (tool.description) console.log(`    ${tool.description}`);
    }
  } finally {
    await session.close();
  }
}

async function main(): Promise<void> {
  const command = parseAgentCommand(process.argv.slice(2), process.env.WAYLUCID_ROLE);
  if (command.mode === "help") {
    console.log(`Usage:
  pnpm agent --list-tools [--role operator] [--json]
  pnpm agent --demo [--role operator] [--json]
  pnpm agent [--role supervisor] "assign cs_webhook to pr_supervisor and resolve it"

Roles: viewer | operator | supervisor
Planner: mock by default. Set WAYLUCID_LLM=openai|anthropic and the matching API key to use a live model.
--json emits a machine-readable trace or catalog. Blocked and failed runs exit nonzero.
There is no --dry-run option. Unknown or conflicting options are rejected before execution.`);
    return;
  }
  if (command.mode === "catalog") {
    await listTools(command.role, command.json);
    return;
  }

  desk.reset();
  const trace = await runAgent({ utterance: command.utterance, role: command.role, store: desk });
  console.log(command.json ? JSON.stringify(trace, null, 2) : formatTrace(trace));
  if (trace.outcome !== "completed") process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Agent command failed.");
  process.exit(1);
});
