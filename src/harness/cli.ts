#!/usr/bin/env tsx
import { parseRole } from "../auth.ts";
import { listToolCatalog, openOpsSession } from "../mcp/session.ts";
import { desk } from "../store.ts";
import { DEMO_UTTERANCE } from "./planner.ts";
import { formatTrace, runAgent } from "./run.ts";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

async function listTools(): Promise<void> {
  const role = parseRole(arg("--role") ?? process.env.WAYLUCID_ROLE);
  const session = await openOpsSession({ role, store: desk });
  try {
    const catalog = await listToolCatalog(session.client);
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
  if (has("--list-tools") || has("--list")) {
    await listTools();
    return;
  }

  const role = parseRole(arg("--role") ?? process.env.WAYLUCID_ROLE);
  const demo = has("--demo");
  const rest = process.argv.slice(2).filter((value) => !value.startsWith("--") && value !== arg("--role"));
  const utterance = demo ? DEMO_UTTERANCE : rest.join(" ").trim();

  if (!utterance) {
    console.error(`Usage:
  pnpm agent --list-tools [--role operator]
  pnpm agent --demo [--role operator]
  pnpm agent [--role supervisor] "assign Maya's webhook case to Priya and resolve it"

Roles: viewer | operator | supervisor
Planner: mock by default. Set WAYLUCID_LLM=openai|anthropic and the matching API key to use a live model.`);
    process.exit(1);
  }

  desk.reset();
  const trace = await runAgent({ utterance, role, store: desk });
  console.log(formatTrace(trace));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
