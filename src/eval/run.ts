import { advertisedTools, parseRole, type ToolName } from "../auth.ts";
import { runAgent } from "../harness/run.ts";
import { callTool, listToolNames, openOpsSession, type ToolCallResult } from "../mcp/session.ts";
import type { DeskSnapshot, Role, ToolResult } from "../ontology.ts";
import { OpsStore } from "../store.ts";

export type EvalCheck =
  | { kind: "toolsInclude"; tools: ToolName[] }
  | { kind: "toolsExclude"; tools: ToolName[] }
  | { kind: "planEquals"; tools: ToolName[] }
  | { kind: "stepsExclude"; tools: ToolName[] }
  // Without an occurrence index, EVERY matching call must satisfy the assertion.
  | { kind: "stepOk"; tool: ToolName; occurrence?: number }
  | { kind: "stepError"; tool: ToolName; code: string; occurrence?: number }
  | { kind: "protocolError"; code: number }
  | { kind: "outcome"; equals: "completed" | "blocked" | "failed" }
  | { kind: "stateUnchanged" }
  | { kind: "jsonPath"; path: string; equals?: unknown; exists?: boolean; contains?: string };

type DirectCall = { name: ToolName; arguments?: Record<string, unknown> };
export type EvalCase = {
  id: string;
  title: string;
  role: Role;
  utterance?: string;
  tool?: DirectCall;
  calls?: DirectCall[];
  checks: EvalCheck[];
};

export const GOLDEN: EvalCase[] = [
  {
    id: "viewer-catalog", title: "Viewer catalog is read-only", role: "viewer",
    checks: [
      { kind: "toolsInclude", tools: ["whoami", "contacts.list", "cases.get", "tasks.list"] },
      { kind: "toolsExclude", tools: ["cases.create", "cases.update", "cases.assign", "cases.resolve", "cases.add_internal_note", "tasks.create", "tasks.complete", "contacts.update_status"] },
    ],
  },
  {
    id: "operator-catalog", title: "Operator can open work but cannot assign or resolve", role: "operator",
    checks: [
      { kind: "toolsInclude", tools: ["cases.create", "cases.update", "tasks.create", "tasks.complete"] },
      { kind: "toolsExclude", tools: ["cases.assign", "cases.resolve", "cases.add_internal_note", "contacts.update_status"] },
    ],
  },
  {
    id: "supervisor-catalog", title: "Supervisor sees the privileged writes", role: "supervisor",
    checks: [{ kind: "toolsInclude", tools: ["cases.assign", "cases.resolve", "cases.add_internal_note", "contacts.update_status"] }],
  },
  {
    id: "viewer-cannot-file", title: "Viewer request cannot create a case or alter state", role: "viewer",
    utterance: "Maya's webhook is failing — open a P1 case",
    checks: [
      { kind: "outcome", equals: "blocked" },
      { kind: "stepsExclude", tools: ["cases.create"] },
      { kind: "stateUnchanged" },
    ],
  },
  {
    id: "operator-demo-path", title: "Operator opens a case and binds its follow-up to the new case", role: "operator",
    utterance: "Maya's webhook is failing — open a P1 case and a follow-up task to confirm they are sending the current signing secret.",
    checks: [
      { kind: "outcome", equals: "completed" },
      { kind: "planEquals", tools: ["contacts.list", "cases.create", "tasks.create"] },
      { kind: "stepOk", tool: "contacts.list" },
      { kind: "stepOk", tool: "cases.create" },
      { kind: "stepOk", tool: "tasks.create" },
      { kind: "jsonPath", path: "steps.cases_create.0.data.case.priority", equals: "p1" },
      { kind: "jsonPath", path: "steps.cases_create.0.data.case.contactId", equals: "ct_maya" },
      { kind: "jsonPath", path: "after.cases.3.id", equals: "cs_101" },
      { kind: "jsonPath", path: "after.tasks.3.caseId", equals: "cs_101" },
      { kind: "jsonPath", path: "after.tasks.3.status", equals: "open" },
      { kind: "jsonPath", path: "after.cases.length", equals: 4 },
      { kind: "jsonPath", path: "after.tasks.length", equals: 4 },
    ],
  },
  {
    id: "operator-cannot-assign", title: "Operator assignment request cannot alter state", role: "operator",
    utterance: "Assign case cs_webhook to pr_supervisor",
    checks: [
      { kind: "outcome", equals: "blocked" },
      { kind: "stepsExclude", tools: ["cases.assign"] },
      { kind: "stateUnchanged" },
    ],
  },
  {
    id: "viewer-direct-write-denied", title: "A direct viewer write cannot bypass the MCP catalog", role: "viewer",
    tool: { name: "cases.create", arguments: { contact_id: "ct_maya", title: "Unexpected case", description: "Should never be created", priority: "p1" } },
    checks: [{ kind: "protocolError", code: -32602 }, { kind: "stateUnchanged" }],
  },
  {
    id: "operator-direct-resolve-denied", title: "A direct operator resolve is rejected without changing the case", role: "operator",
    tool: { name: "cases.resolve", arguments: { case_id: "cs_webhook", resolution_code: "fixed", resolution_summary: "Should never be applied" } },
    checks: [{ kind: "protocolError", code: -32602 }, { kind: "stateUnchanged" }],
  },
  {
    id: "supervisor-resolve", title: "Supervisor direct resolve changes the intended case", role: "supervisor",
    tool: { name: "cases.resolve", arguments: { case_id: "cs_webhook", resolution_code: "fixed", resolution_summary: "Acme is now signing with the current secret." } },
    checks: [
      { kind: "stepOk", tool: "cases.resolve" },
      { kind: "jsonPath", path: "tool.data.case.status", equals: "resolved" },
      { kind: "jsonPath", path: "after.cases.0.status", equals: "resolved" },
      { kind: "jsonPath", path: "after.cases.1.status", equals: "waiting" },
    ],
  },
  {
    id: "supervisor-assign-agent", title: "Supervisor harness uses an explicit case and assignee", role: "supervisor",
    utterance: "Assign case cs_webhook to pr_supervisor",
    checks: [
      { kind: "outcome", equals: "completed" },
      { kind: "stepOk", tool: "cases.assign" },
      { kind: "jsonPath", path: "after.cases.0.assigneeId", equals: "pr_supervisor" },
      { kind: "jsonPath", path: "after.cases.0.status", equals: "open" },
    ],
  },
  {
    id: "supervisor-resolve-agent", title: "Supervisor harness resolves an explicit case with the supplied resolution", role: "supervisor",
    utterance: "Resolve case cs_webhook with resolution: Current signing secret verified",
    checks: [
      { kind: "outcome", equals: "completed" },
      { kind: "stepOk", tool: "cases.resolve" },
      { kind: "jsonPath", path: "after.cases.0.status", equals: "resolved" },
      { kind: "jsonPath", path: "after.cases.0.resolutionSummary", equals: "Current signing secret verified" },
    ],
  },
  {
    id: "negation-does-not-write", title: "Negated create request leaves the complete store unchanged", role: "operator",
    utterance: "Do not open a case for Maya's failing webhook and do not add a follow-up task",
    checks: [
      { kind: "outcome", equals: "blocked" },
      { kind: "stepsExclude", tools: ["cases.create", "tasks.create"] },
      { kind: "stateUnchanged" },
    ],
  },
  {
    id: "read-tasks-does-not-create", title: "Reading follow-up tasks cannot create another task", role: "operator",
    utterance: "Show follow-up tasks",
    checks: [
      { kind: "outcome", equals: "completed" },
      { kind: "stepOk", tool: "tasks.list" },
      { kind: "stepsExclude", tools: ["tasks.create"] },
      { kind: "stateUnchanged" },
    ],
  },
  {
    id: "read-resolved-cases-does-not-resolve", title: "Reading resolved cases cannot resolve an open case", role: "supervisor",
    utterance: "Show resolved cases",
    checks: [
      { kind: "outcome", equals: "completed" },
      { kind: "stepOk", tool: "cases.list" },
      { kind: "stepsExclude", tools: ["cases.resolve"] },
      { kind: "jsonPath", path: "steps.cases_list.0.data.cases.0.status", equals: "resolved" },
      { kind: "stateUnchanged" },
    ],
  },
  {
    id: "missing-contact", title: "Unknown contact returns a structured NOT_FOUND without mutation", role: "operator",
    tool: { name: "contacts.get", arguments: { contact_id: "ct_nope" } },
    checks: [{ kind: "stepError", tool: "contacts.get", code: "NOT_FOUND" }, { kind: "stateUnchanged" }],
  },
  {
    id: "operator-redacts-notes", title: "Operator case reads hide internal notes", role: "operator",
    tool: { name: "cases.get", arguments: { case_id: "cs_webhook" } },
    checks: [
      { kind: "stepOk", tool: "cases.get" },
      { kind: "jsonPath", path: "tool.data.case.hiddenInternalNoteCount", equals: 1 },
      { kind: "jsonPath", path: "tool.data.case.internalNotes", exists: false },
      { kind: "stateUnchanged" },
    ],
  },
  {
    id: "supervisor-sees-notes", title: "Supervisor case reads include internal notes", role: "supervisor",
    tool: { name: "cases.get", arguments: { case_id: "cs_webhook" } },
    checks: [
      { kind: "stepOk", tool: "cases.get" },
      { kind: "jsonPath", path: "tool.data.case.internalNotes.0.body", contains: "Signing secret" },
      { kind: "stateUnchanged" },
    ],
  },
  {
    id: "repeated-task-completion-conflicts", title: "Repeated calls preserve success and subsequent conflict", role: "operator",
    calls: [
      { name: "tasks.complete", arguments: { task_id: "tk_retries" } },
      { name: "tasks.complete", arguments: { task_id: "tk_retries" } },
    ],
    checks: [
      { kind: "stepOk", tool: "tasks.complete", occurrence: 0 },
      { kind: "stepError", tool: "tasks.complete", code: "CONFLICT", occurrence: 1 },
      { kind: "jsonPath", path: "steps.tasks_complete.0.ok", equals: true },
      { kind: "jsonPath", path: "steps.tasks_complete.1.error.code", equals: "CONFLICT" },
      { kind: "jsonPath", path: "after.tasks.0.status", equals: "done" },
      { kind: "jsonPath", path: "after.tasks.1.status", equals: "open" },
    ],
  },
];

export type CheckResult = { check: EvalCheck; pass: boolean; detail: string };
export type CaseResult = {
  id: string;
  title: string;
  role: Role;
  pass: boolean;
  checks: CheckResult[];
  execution: { plannedTools: string[]; executedTools: string[]; denied: string[]; outcome?: string };
  error?: string;
};

export type EvalProbe = {
  tools: string[];
  plannedTools: string[];
  steps: ToolCallResult[];
  outcome?: string;
  toolResult?: unknown;
  protocolError?: { code: number; message: string };
  before: DeskSnapshot;
  after: DeskSnapshot;
};

function asResult(value: unknown): ToolResult<Record<string, unknown>> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (row.ok === true && row.data !== null && typeof row.data === "object") return value as ToolResult<Record<string, unknown>>;
  if (row.ok === false && row.error && typeof row.error === "object" && "code" in row.error) return value as ToolResult<Record<string, unknown>>;
  return undefined;
}

function getPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stepMap(steps: ToolCallResult[]): Record<string, unknown[]> {
  const grouped: Record<string, unknown[]> = {};
  for (const step of steps) (grouped[step.name.replaceAll(".", "_")] ??= []).push(step.structuredContent);
  return grouped;
}

function selectedSteps(steps: ToolCallResult[], tool: string, occurrence?: number): ToolCallResult[] {
  const matching = steps.filter((step) => step.name === tool);
  if (occurrence === undefined) return matching;
  if (!Number.isInteger(occurrence) || occurrence < 0) return [];
  return matching[occurrence] ? [matching[occurrence]] : [];
}

/** Pure assertions: tests exercise false positives as well as passing fixtures. */
export function runCheck(check: EvalCheck, probe: EvalProbe): CheckResult {
  switch (check.kind) {
    case "toolsInclude": {
      const missing = check.tools.filter((name) => !probe.tools.includes(name));
      return { check, pass: missing.length === 0, detail: missing.length ? `missing ${missing.join(", ")}` : "all present" };
    }
    case "toolsExclude": {
      const leaked = check.tools.filter((name) => probe.tools.includes(name));
      return { check, pass: leaked.length === 0, detail: leaked.length ? `leaked ${leaked.join(", ")}` : "none leaked" };
    }
    case "planEquals": {
      const pass = JSON.stringify(probe.plannedTools) === JSON.stringify(check.tools);
      return { check, pass, detail: `planned ${probe.plannedTools.join(" → ") || "(empty)"}` };
    }
    case "stepsExclude": {
      const unexpected = probe.steps.filter((step) => check.tools.includes(step.name as ToolName));
      return { check, pass: unexpected.length === 0, detail: unexpected.length ? `executed ${unexpected.map((step) => step.name).join(", ")}` : "none executed" };
    }
    case "stepOk": {
      const steps = selectedSteps(probe.steps, check.tool, check.occurrence);
      const pass = steps.length > 0 && steps.every((step) => !step.isError && asResult(step.structuredContent)?.ok === true);
      return { check, pass, detail: steps.length ? `${steps.length} matching call(s): ${pass ? "all successful" : "at least one failed or malformed"}` : "step missing" };
    }
    case "stepError": {
      const steps = selectedSteps(probe.steps, check.tool, check.occurrence);
      const pass = steps.length > 0 && steps.every((step) => {
        const structured = asResult(step.structuredContent);
        return step.isError === true && structured?.ok === false && structured.error.code === check.code;
      });
      return { check, pass, detail: steps.length ? `${steps.length} matching call(s): ${pass ? check.code : "unexpected success, error code, or error flag"}` : "step missing" };
    }
    case "protocolError":
      return { check, pass: probe.protocolError?.code === check.code, detail: probe.protocolError ? `${probe.protocolError.code}: ${probe.protocolError.message}` : "no protocol error" };
    case "outcome":
      return { check, pass: probe.outcome === check.equals, detail: probe.outcome ?? "no harness outcome" };
    case "stateUnchanged": {
      const pass = JSON.stringify(probe.before) === JSON.stringify(probe.after);
      return { check, pass, detail: pass ? "complete privileged snapshot unchanged" : "store changed" };
    }
    case "jsonPath": {
      const root = { tools: probe.tools, steps: stepMap(probe.steps), calls: probe.steps, tool: asResult(probe.toolResult), before: probe.before, after: probe.after };
      const value = getPath(root, check.path);
      const assertions: boolean[] = [];
      if (check.exists !== undefined) assertions.push(check.exists ? value !== undefined : value === undefined);
      if (Object.hasOwn(check, "equals")) assertions.push(JSON.stringify(value) === JSON.stringify(check.equals));
      if (check.contains !== undefined) assertions.push(typeof value === "string" && value.includes(check.contains));
      return { check, pass: assertions.length > 0 && assertions.every(Boolean), detail: `path ${check.path} → ${JSON.stringify(value) ?? "undefined"}${assertions.length ? "" : " (no assertion specified)"}` };
    }
  }
}

export async function runEvalCase(fixture: EvalCase): Promise<CaseResult> {
  const result: CaseResult = {
    id: fixture.id, title: fixture.title, role: fixture.role, pass: false, checks: [],
    execution: { plannedTools: [], executedTools: [], denied: [] },
  };
  try {
    const inputCount = Number(fixture.utterance !== undefined) + Number(fixture.tool !== undefined) + Number(fixture.calls !== undefined);
    if (inputCount > 1) throw new Error("Use only one of utterance, tool, or calls per fixture");
    if (fixture.checks.length === 0) throw new Error("A fixture must include at least one assertion");
    const store = new OpsStore();
    const before = store.snapshot("supervisor");
    const session = await openOpsSession({ role: fixture.role, store });
    try {
      const probe: EvalProbe = { tools: await listToolNames(session.client), plannedTools: [], steps: [], before, after: before };
      if (fixture.utterance !== undefined) {
        const trace = await runAgent({ utterance: fixture.utterance, role: fixture.role, store, planner: "mock" });
        probe.plannedTools = trace.plan.calls.map((call) => call.tool);
        probe.steps = trace.steps;
        probe.outcome = trace.outcome;
        result.execution.denied = trace.denied;
      }
      const directCalls = fixture.calls ?? (fixture.tool ? [fixture.tool] : []);
      if (directCalls.length) probe.plannedTools = directCalls.map((call) => call.name);
      for (const call of directCalls) {
        try {
          const step = await callTool(session.client, call.name, call.arguments ?? {});
          probe.steps.push(step);
          if (fixture.tool) probe.toolResult = step.structuredContent;
        } catch (error) {
          // Protocol failures remain distinct from structured domain errors.
          if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "number") throw error;
          probe.protocolError = { code: error.code, message: error instanceof Error ? error.message : String(error) };
          break;
        }
      }
      probe.after = store.snapshot("supervisor");
      result.execution.plannedTools = probe.plannedTools;
      result.execution.executedTools = probe.steps.map((step) => step.name);
      result.execution.outcome = probe.outcome;
      result.checks = fixture.checks.map((check) => runCheck(check, probe));
      result.pass = result.checks.every((check) => check.pass);
      if (probe.protocolError && !fixture.checks.some((check) => check.kind === "protocolError")) {
        result.pass = false;
        result.error = `Unexpected protocol error: ${probe.protocolError.message}`;
      }
    } finally {
      await session.close();
    }
  } catch (error) {
    result.pass = false;
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

export type EvalReport = {
  schemaVersion: 1;
  suite: "deterministic-mcp-regression";
  planner: "mock";
  scope: string;
  passed: number;
  failed: number;
  total: number;
  checks: { passed: number; failed: number; total: number };
  results: CaseResult[];
};

export async function runGoldenSet(fixtures: readonly EvalCase[] = GOLDEN): Promise<EvalReport> {
  const results: CaseResult[] = [];
  for (const fixture of fixtures) results.push(await runEvalCase(fixture));
  const passed = results.filter((row) => row.pass).length;
  const checks = results.flatMap((row) => row.checks);
  const checksPassed = checks.filter((row) => row.pass).length;
  return {
    schemaVersion: 1, suite: "deterministic-mcp-regression", planner: "mock",
    scope: "Seeded MCP integration and deterministic planner regressions; not a model-quality benchmark or production security certification.",
    passed, failed: results.length - passed, total: results.length,
    checks: { passed: checksPassed, failed: checks.length - checksPassed, total: checks.length },
    results,
  };
}

export function advertisedFor(role: string): ToolName[] {
  return advertisedTools(parseRole(role));
}
