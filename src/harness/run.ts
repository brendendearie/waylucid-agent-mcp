import type { Role } from "../ontology.ts";
import type { OpsStore } from "../store.ts";
import { callTool, listToolCatalog, openOpsSession, type ToolCallResult } from "../mcp/session.ts";
import { detectProvider, planWithLlm } from "./llm.ts";
import { planWithMock, type Plan } from "./planner.ts";
import { PlanValidationError, validatePlan } from "./validation.ts";

export type AgentTrace = {
  utterance: string;
  role: Role;
  plan: Plan;
  steps: ToolCallResult[];
  denied: string[];
  /** Optional for callers constructing legacy/direct-tool traces; runAgent always sets it. */
  outcome?: "completed" | "blocked" | "failed";
  issue?: { code: string; message: string; stepIndex?: number };
};

type Binding = { id?: string; problem?: string };
type Bindings = Record<string, Binding>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function bindFrom(result: ToolCallResult, bindings: Bindings): void {
  const structured = asRecord(result.structuredContent);
  const data = asRecord(structured?.data);
  if (result.isError || structured?.ok !== true || !data) return;
  for (const [singular, plural] of [["contact", "contacts"], ["case", "cases"], ["task", "tasks"]] as const) {
    const direct = asRecord(data[singular]);
    const listed = data[plural];
    if (direct) {
      bindings[`$${singular}.id`] = typeof direct.id === "string" ? { id: direct.id } : { problem: `The ${singular} response has no ID.` };
    } else if (Array.isArray(listed)) {
      const only = listed.length === 1 ? asRecord(listed[0]) : undefined;
      // Replace old bindings even when the new lookup is empty or ambiguous.
      bindings[`$${singular}.id`] = only && typeof only.id === "string"
        ? { id: only.id }
        : { problem: `${result.name} returned ${listed.length} matches. Specify exactly one ${singular} ID before continuing.` };
    }
  }
}

function resolveArgs(args: Record<string, unknown>, bindings: Bindings): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => {
    if (typeof value !== "string" || !/^\$(?:contact|case|task)\.id$/.test(value)) return [key, value];
    const binding = bindings[value];
    if (!binding?.id) throw new PlanValidationError(binding?.problem ?? `${value} has no successful lookup result.`, "TARGET_UNRESOLVED");
    return [key, binding.id];
  }));
}

export async function runAgent(options: {
  utterance: string;
  role: Role;
  store?: OpsStore;
  planner?: "mock" | "openai" | "anthropic";
}): Promise<AgentTrace> {
  const planner = options.planner ?? detectProvider();
  const trace: AgentTrace = {
    utterance: options.utterance, role: options.role,
    plan: { planner, rationale: "Planning has not completed.", calls: [] },
    steps: [], denied: [], outcome: "failed",
  };
  const session = await openOpsSession({ role: options.role, store: options.store });
  try {
    const catalog = await listToolCatalog(session.client);
    const rawPlan = planner === "mock" ? planWithMock(options.utterance, options.role) : await planWithLlm({
      provider: planner, utterance: options.utterance, role: options.role, tools: catalog,
    });
    trace.plan = validatePlan(rawPlan, catalog);
    trace.denied = trace.plan.denied ?? [];
    if (trace.plan.blockedReason || trace.denied.length) {
      trace.outcome = "blocked";
      trace.issue = { code: trace.denied.length ? "TOOL_NOT_ALLOWED" : "CLARIFICATION_REQUIRED", message: trace.plan.blockedReason ?? "The workflow contains an unavailable tool." };
      return trace;
    }
    if (!trace.plan.calls.length) {
      trace.outcome = "blocked";
      trace.issue = { code: "EMPTY_PLAN", message: "No executable action was planned. Clarify the request." };
      return trace;
    }

    const bindings: Bindings = {};
    for (const [index, call] of trace.plan.calls.entries()) {
      let result: ToolCallResult;
      try {
        result = await callTool(session.client, call.tool, resolveArgs(call.arguments, bindings));
      } catch (error) {
        trace.outcome = error instanceof PlanValidationError ? "blocked" : "failed";
        trace.issue = { code: error instanceof PlanValidationError ? error.code : "TOOL_CALL_FAILED", message: error instanceof Error ? error.message : "Tool invocation failed.", stepIndex: index };
        return trace;
      }
      trace.steps.push(result);
      const structured = asRecord(result.structuredContent);
      if (result.isError || structured?.ok !== true) {
        const issue = asRecord(structured?.error);
        trace.outcome = "failed";
        trace.issue = {
          code: typeof issue?.code === "string" ? issue.code : "TOOL_RESULT_FAILED",
          message: typeof issue?.message === "string" ? issue.message : `${call.tool} did not return a successful structured result.`,
          stepIndex: index,
        };
        return trace;
      }
      bindFrom(result, bindings);
    }
    trace.outcome = "completed";
    return trace;
  } catch (error) {
    trace.outcome = error instanceof PlanValidationError ? "blocked" : "failed";
    trace.issue = { code: error instanceof PlanValidationError ? error.code : "PLANNING_FAILED", message: error instanceof Error ? error.message : "Planning failed." };
    return trace;
  } finally {
    await session.close();
  }
}

export function formatTrace(trace: AgentTrace): string {
  const lines = [`role=${trace.role}  planner=${trace.plan.planner}  outcome=${trace.outcome ?? "unknown"}`, trace.plan.rationale];
  if (trace.denied.length) lines.push(`denied (not advertised): ${trace.denied.join(", ")}`);
  if (trace.issue) lines.push(`${trace.issue.code}: ${trace.issue.message}`);
  for (const step of trace.steps) {
    lines.push(`${step.isError ? "ERR " : "ok  "}${step.name}  ${JSON.stringify(step.arguments)}`);
    lines.push(step.text.split("\n").map((line) => `    ${line}`).join("\n"));
  }
  return lines.join("\n");
}
