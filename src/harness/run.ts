import type { Role } from "../ontology.ts";
import type { OpsStore } from "../store.ts";
import { callTool, listToolCatalog, openOpsSession, type ToolCallResult } from "../mcp/session.ts";
import { detectProvider, planWithLlm } from "./llm.ts";
import { planWithMock, type Plan } from "./planner.ts";

export type AgentTrace = {
  utterance: string;
  role: Role;
  plan: Plan;
  steps: ToolCallResult[];
  denied: string[];
};

type Bindings = {
  contactId?: string;
  caseId?: string;
  taskId?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function bindFrom(result: ToolCallResult, bindings: Bindings): void {
  const structured = asRecord(result.structuredContent);
  const data = asRecord(structured?.data);
  if (!data) return;
  const contact = asRecord(data.contact);
  const createdCase = asRecord(data.case);
  const task = asRecord(data.task);
  const contacts = data.contacts;
  if (contact?.id && typeof contact.id === "string") bindings.contactId = contact.id;
  if (Array.isArray(contacts) && contacts[0] && typeof contacts[0] === "object") {
    const id = (contacts[0] as { id?: unknown }).id;
    if (typeof id === "string") bindings.contactId = id;
  }
  if (createdCase?.id && typeof createdCase.id === "string") bindings.caseId = createdCase.id;
  if (task?.id && typeof task.id === "string") bindings.taskId = task.id;
}

function resolveArgs(args: Record<string, unknown>, bindings: Bindings): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === "$contact.id") resolved[key] = bindings.contactId ?? value;
    else if (value === "$case.id") resolved[key] = bindings.caseId ?? value;
    else if (value === "$task.id") resolved[key] = bindings.taskId ?? value;
    else resolved[key] = value;
  }
  return resolved;
}

export async function runAgent(options: {
  utterance: string;
  role: Role;
  store?: OpsStore;
  planner?: "mock" | "openai" | "anthropic";
}): Promise<AgentTrace> {
  const session = await openOpsSession({ role: options.role, store: options.store });
  try {
    const catalog = await listToolCatalog(session.client);
    const advertised = new Set(catalog.map((tool) => tool.name));
    const planner = options.planner ?? detectProvider();
    const plan =
      planner === "mock"
        ? planWithMock(options.utterance, options.role)
        : await planWithLlm({
            provider: planner,
            utterance: options.utterance,
            role: options.role,
            tools: catalog,
          });

    const denied = plan.calls.filter((call) => !advertised.has(call.tool)).map((call) => call.tool);
    const steps: ToolCallResult[] = [];
    const bindings: Bindings = {};

    for (const call of plan.calls) {
      if (!advertised.has(call.tool)) continue;
      const result = await callTool(session.client, call.tool, resolveArgs(call.arguments, bindings));
      bindFrom(result, bindings);
      steps.push(result);
    }

    return {
      utterance: options.utterance,
      role: options.role,
      plan: { ...plan, planner },
      steps,
      denied,
    };
  } finally {
    await session.close();
  }
}

export function formatTrace(trace: AgentTrace): string {
  const lines: string[] = [];
  lines.push(`role=${trace.role}  planner=${trace.plan.planner}`);
  lines.push(trace.plan.rationale);
  if (trace.denied.length) {
    lines.push(`denied (not advertised): ${trace.denied.join(", ")}`);
  }
  for (const step of trace.steps) {
    const flag = step.isError ? "ERR " : "ok  ";
    lines.push(`${flag}${step.name}  ${JSON.stringify(step.arguments)}`);
    lines.push(indent(step.text));
  }
  return lines.join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
