import { parseArgs } from "node:util";
import { parseRole } from "../auth.ts";
import type { Role } from "../ontology.ts";
import { DEMO_UTTERANCE } from "./planner.ts";

export type AgentCommand =
  | { mode: "help" }
  | { mode: "catalog"; role: Role; json: boolean }
  | { mode: "run"; role: Role; json: boolean; utterance: string };

/** Reject ambiguous or misspelled options before opening a session or planning. */
export function parseAgentCommand(args: string[], envRole?: string): AgentCommand {
  const { values, positionals, tokens } = parseArgs({
    args, strict: true, allowPositionals: true, tokens: true,
    options: {
      role: { type: "string" }, demo: { type: "boolean" },
      "list-tools": { type: "boolean" }, list: { type: "boolean" },
      json: { type: "boolean" }, help: { type: "boolean", short: "h" },
    },
  });
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    const name = token.name === "list" ? "list-tools" : token.name;
    if (seen.has(name)) throw new Error(`Option --${name} was supplied more than once.`);
    seen.add(name);
  }
  if (values.help) return { mode: "help" };
  const role = parseRole(values.role ?? envRole);
  const json = values.json ?? false;
  const utterance = positionals.join(" ").trim();
  if (values["list-tools"] || values.list) {
    if (values.demo || utterance) throw new Error("Choose a catalog request or an agent request, not both.");
    return { mode: "catalog", role, json };
  }
  if (values.demo && utterance) throw new Error("Choose --demo or an utterance, not both.");
  if (!values.demo && !utterance) throw new Error("Supply --demo or an utterance. Use --help for examples.");
  return { mode: "run", role, json, utterance: values.demo ? DEMO_UTTERANCE : utterance };
}
