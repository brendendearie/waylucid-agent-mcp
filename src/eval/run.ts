import { advertisedTools, parseRole, type ToolName } from "../auth.ts";
import { runAgent, type AgentTrace } from "../harness/run.ts";
import { callTool, listToolNames, openOpsSession } from "../mcp/session.ts";
import type { Role, ToolResult } from "../ontology.ts";
import { OpsStore } from "../store.ts";

export type EvalCheck =
  | { kind: "toolsInclude"; tools: ToolName[] }
  | { kind: "toolsExclude"; tools: ToolName[] }
  | { kind: "planEquals"; tools: ToolName[] }
  | { kind: "stepOk"; tool: ToolName }
  | { kind: "stepError"; tool: ToolName; code: string }
  | { kind: "jsonPath"; path: string; equals?: unknown; exists?: boolean; contains?: string };

export type EvalCase = {
  id: string;
  title: string;
  role: Role;
  utterance?: string;
  tool?: { name: ToolName; arguments?: Record<string, unknown> };
  checks: EvalCheck[];
};

export const GOLDEN: EvalCase[] = [
  {
    id: "viewer-catalog",
    title: "Viewer catalog is read-only",
    role: "viewer",
    checks: [
      { kind: "toolsInclude", tools: ["whoami", "contacts.list", "cases.get", "tasks.list"] },
      {
        kind: "toolsExclude",
        tools: ["cases.create", "cases.assign", "cases.resolve", "tasks.create", "contacts.update_status"],
      },
    ],
  },
  {
    id: "operator-catalog",
    title: "Operator can open work but cannot assign or resolve",
    role: "operator",
    checks: [
      { kind: "toolsInclude", tools: ["cases.create", "cases.update", "tasks.create", "tasks.complete"] },
      { kind: "toolsExclude", tools: ["cases.assign", "cases.resolve", "cases.add_internal_note", "contacts.update_status"] },
    ],
  },
  {
    id: "supervisor-catalog",
    title: "Supervisor sees the privileged writes",
    role: "supervisor",
    checks: [
      {
        kind: "toolsInclude",
        tools: ["cases.assign", "cases.resolve", "cases.add_internal_note", "contacts.update_status"],
      },
    ],
  },
  {
    id: "viewer-cannot-file",
    title: "Viewer asking to file a case never gets cases.create",
    role: "viewer",
    utterance: "Maya's webhook is failing — open a P1 case",
    checks: [{ kind: "planEquals", tools: ["contacts.list"] }],
  },
  {
    id: "operator-demo-path",
    title: "Operator demo path opens a case and a follow-up",
    role: "operator",
    utterance:
      "Maya's webhook is failing — open a P1 case and a follow-up task to confirm they are sending the current signing secret.",
    checks: [
      { kind: "planEquals", tools: ["contacts.list", "cases.create", "tasks.create"] },
      { kind: "stepOk", tool: "contacts.list" },
      { kind: "stepOk", tool: "cases.create" },
      { kind: "stepOk", tool: "tasks.create" },
      { kind: "jsonPath", path: "steps.cases_create.data.case.priority", equals: "p1" },
      { kind: "jsonPath", path: "steps.cases_create.data.case.contactId", equals: "ct_maya" },
      { kind: "jsonPath", path: "steps.tasks_create.data.task.status", equals: "open" },
    ],
  },
  {
    id: "operator-cannot-assign",
    title: "Operator assign request is dropped at plan time",
    role: "operator",
    utterance: "assign Maya's webhook case to Priya",
    checks: [{ kind: "planEquals", tools: ["cases.list"] }],
  },
  {
    id: "supervisor-resolve",
    title: "Supervisor can resolve the open webhook case",
    role: "supervisor",
    tool: {
      name: "cases.resolve",
      arguments: {
        case_id: "cs_webhook",
        resolution_code: "fixed",
        resolution_summary: "Acme is now signing with the current secret.",
      },
    },
    checks: [
      { kind: "stepOk", tool: "cases.resolve" },
      { kind: "jsonPath", path: "tool.data.case.status", equals: "resolved" },
    ],
  },
  {
    id: "missing-contact",
    title: "Unknown contact id returns a structured NOT_FOUND",
    role: "operator",
    tool: { name: "contacts.get", arguments: { contact_id: "ct_nope" } },
    checks: [{ kind: "stepError", tool: "contacts.get", code: "NOT_FOUND" }],
  },
  {
    id: "operator-redacts-notes",
    title: "Operator case reads hide internal notes",
    role: "operator",
    tool: { name: "cases.get", arguments: { case_id: "cs_webhook" } },
    checks: [
      { kind: "stepOk", tool: "cases.get" },
      { kind: "jsonPath", path: "tool.data.case.hiddenInternalNoteCount", equals: 1 },
      { kind: "jsonPath", path: "tool.data.case.internalNotes", exists: false },
    ],
  },
  {
    id: "supervisor-sees-notes",
    title: "Supervisor case reads include internal notes",
    role: "supervisor",
    tool: { name: "cases.get", arguments: { case_id: "cs_webhook" } },
    checks: [
      { kind: "stepOk", tool: "cases.get" },
      { kind: "jsonPath", path: "tool.data.case.internalNotes.0.body", contains: "Signing secret" },
    ],
  },
];

export type CheckResult = { check: EvalCheck; pass: boolean; detail: string };

export type CaseResult = {
  id: string;
  title: string;
  pass: boolean;
  checks: CheckResult[];
};

type Probe = {
  tools: string[];
  trace?: AgentTrace;
  toolResult?: unknown;
};

function asResult(value: unknown): ToolResult<Record<string, unknown>> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as { ok?: unknown };
  if (row.ok === true || row.ok === false) return value as ToolResult<Record<string, unknown>>;
  return undefined;
}

function getPath(root: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = root;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stepMap(trace: AgentTrace): Record<string, unknown> {
  const steps: Record<string, unknown> = {};
  for (const step of trace.steps) {
    const structured = asResult(step.structuredContent);
    steps[step.name.replaceAll(".", "_")] = structured && structured.ok ? structured : step.structuredContent;
  }
  return steps;
}

function runCheck(check: EvalCheck, probe: Probe): CheckResult {
  switch (check.kind) {
    case "toolsInclude": {
      const missing = check.tools.filter((name) => !probe.tools.includes(name));
      return {
        check,
        pass: missing.length === 0,
        detail: missing.length ? `missing ${missing.join(", ")}` : "all present",
      };
    }
    case "toolsExclude": {
      const leaked = check.tools.filter((name) => probe.tools.includes(name));
      return {
        check,
        pass: leaked.length === 0,
        detail: leaked.length ? `leaked ${leaked.join(", ")}` : "none leaked",
      };
    }
    case "planEquals": {
      const got = probe.trace?.plan.calls.map((call) => call.tool) ?? [];
      const pass = JSON.stringify(got) === JSON.stringify(check.tools);
      return { check, pass, detail: pass ? got.join(" → ") : `got ${got.join(" → ") || "(empty)"}` };
    }
    case "stepOk": {
      const step = probe.trace?.steps.find((row) => row.name === check.tool);
      const structured = asResult(step?.structuredContent);
      const pass = Boolean(step && !step.isError && structured?.ok);
      return { check, pass, detail: pass ? "ok" : step?.text ?? "step missing" };
    }
    case "stepError": {
      const structured = asResult(probe.toolResult) ?? asResult(
        probe.trace?.steps.find((row) => row.name === check.tool)?.structuredContent,
      );
      const pass = Boolean(structured && !structured.ok && structured.error.code === check.code);
      return {
        check,
        pass,
        detail: pass
          ? check.code
          : `got ${structured && !structured.ok ? structured.error.code : "success or empty"}`,
      };
    }
    case "jsonPath": {
      const root = {
        tools: probe.tools,
        steps: probe.trace ? stepMap(probe.trace) : undefined,
        tool: asResult(probe.toolResult),
      };
      const value = getPath(root, check.path);
      let pass = true;
      let detail = JSON.stringify(value);
      if (check.exists === false) pass = value === undefined;
      if (check.exists === true) pass = value !== undefined;
      if (check.equals !== undefined) pass = JSON.stringify(value) === JSON.stringify(check.equals);
      if (check.contains !== undefined) pass = typeof value === "string" && value.includes(check.contains);
      if (!pass) detail = `path ${check.path} → ${detail}`;
      return { check, pass, detail };
    }
  }
}

export async function runEvalCase(fixture: EvalCase): Promise<CaseResult> {
  const store = new OpsStore();
  const session = await openOpsSession({ role: fixture.role, store });
  try {
    const tools = await listToolNames(session.client);
    const probe: Probe = { tools };
    if (fixture.utterance) {
      probe.trace = await runAgent({
        utterance: fixture.utterance,
        role: fixture.role,
        store,
        planner: "mock",
      });
    }
    if (fixture.tool) {
      const result = await callTool(session.client, fixture.tool.name, fixture.tool.arguments ?? {});
      probe.toolResult = result.structuredContent;
      probe.trace = {
        utterance: fixture.utterance ?? "",
        role: fixture.role,
        plan: {
          planner: "mock",
          rationale: "direct tool call",
          calls: [{ tool: fixture.tool.name, arguments: fixture.tool.arguments ?? {} }],
        },
        steps: [result],
        denied: [],
      };
    }
    const checks = fixture.checks.map((check) => runCheck(check, probe));
    return {
      id: fixture.id,
      title: fixture.title,
      pass: checks.every((row) => row.pass),
      checks,
    };
  } finally {
    await session.close();
  }
}

export async function runGoldenSet(): Promise<{ passed: number; failed: number; results: CaseResult[] }> {
  const results: CaseResult[] = [];
  for (const fixture of GOLDEN) {
    results.push(await runEvalCase(fixture));
  }
  const passed = results.filter((row) => row.pass).length;
  return { passed, failed: results.length - passed, results };
}

export function advertisedFor(role: string): ToolName[] {
  return advertisedTools(parseRole(role));
}
