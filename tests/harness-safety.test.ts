import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectProvider, planWithLlm } from "../src/harness/llm.ts";
import { DEMO_UTTERANCE, planWithMock } from "../src/harness/planner.ts";
import { runAgent } from "../src/harness/run.ts";
import { validatePlan } from "../src/harness/validation.ts";
import { OpsStore } from "../src/store.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function mockOpenAi(plan: unknown) {
  vi.stubEnv("OPENAI_API_KEY", "test-placeholder-no-network");
  const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const createCase = { tool: "cases.create", arguments: { contact_id: "ct_maya", title: "Test issue", description: "Test description", priority: "p2" } };
const whoamiCatalog = [{ name: "whoami", inputSchema: { type: "object", properties: {}, additionalProperties: false } }];

describe("bounded mock commands", () => {
  it.each([
    "Do not open a case for Maya",
    "Never resolve cs_webhook",
    "Don’t open a case for Maya",
    "If Maya calls, open a case for Maya",
    "Could you show an example of opening a case for Maya?",
    "Maya's webhook is failing",
    "assign Maya's webhook case to Priya and resolve it",
    "pause Maya only after approval",
    "open a case for Maya under no circumstances",
    "open a case for Maya and delete all tasks",
    "open a P1 case for Maya after approval",
    "Maya's webhook is failing — open a P1 case and delete all tasks",
  ])("blocks unsafe or unsupported commands without writes: %s", async (utterance) => {
    const store = new OpsStore();
    const before = store.snapshot("supervisor");
    const trace = await runAgent({ utterance, role: "supervisor", planner: "mock", store });
    expect(trace.outcome).toBe("blocked");
    expect(trace.steps).toEqual([]);
    expect(store.snapshot("supervisor")).toEqual(before);
  });

  it.each(["list follow-up tasks", "show resolved cases", "show assignment tasks"])("keeps read commands read-only: %s", async (utterance) => {
    const store = new OpsStore();
    const before = store.snapshot("supervisor");
    const trace = await runAgent({ utterance, role: "supervisor", planner: "mock", store });
    expect(trace.outcome).toBe("completed");
    expect(trace.steps.every((step) => step.name.endsWith(".list"))).toBe(true);
    expect(store.snapshot("supervisor")).toEqual(before);
  });

  it("filters resolved reads correctly", () => {
    expect(planWithMock("show resolved cases", "supervisor").calls).toEqual([{ tool: "cases.list", arguments: { status: "resolved" } }]);
  });

  it("accepts the complete short creation command with a literal follow-up", async () => {
    const store = new OpsStore();
    const before = store.listCases().length;
    const trace = await runAgent({ utterance: "open a P1 case for Maya and a follow-up task", role: "operator", planner: "mock", store });
    expect(trace.outcome).toBe("completed");
    expect(trace.plan.calls.map((call) => call.tool)).toEqual(["contacts.list", "cases.create", "tasks.create"]);
    expect(store.listCases()).toHaveLength(before + 1);
  });

  it("accepts an exact pause command without arbitrary suffixes", async () => {
    const store = new OpsStore();
    const trace = await runAgent({ utterance: "pause contact Maya Chen", role: "supervisor", planner: "mock", store });
    expect(trace.outcome).toBe("completed");
    expect(store.getContact("ct_maya").status).toBe("paused");
    expect(store.getContact("ct_jordan").status).toBe("active");
  });

  it("executes an explicit supervisor target, not the first listed case", async () => {
    const store = new OpsStore();
    const trace = await runAgent({ utterance: "assign cs_invoice to pr_operator and resolve it", role: "supervisor", store, planner: "mock" });
    expect(trace.outcome).toBe("completed");
    expect(store.getCase("cs_invoice").status).toBe("resolved");
    expect(store.getCase("cs_invoice").assigneeId).toBe("pr_operator");
    expect(store.getCase("cs_webhook").status).toBe("open");
  });

  it("retains the user's explicit resolution summary", async () => {
    const store = new OpsStore();
    const trace = await runAgent({ utterance: "Resolve case cs_webhook with resolution: Current signing secret verified", role: "supervisor", store, planner: "mock" });
    expect(trace.outcome).toBe("completed");
    expect(store.getCase("cs_webhook").resolutionSummary).toBe("Current signing secret verified");
  });

  it("binds and completes an explicit task ID", async () => {
    const store = new OpsStore();
    const trace = await runAgent({ utterance: "complete tk_retries", role: "operator", store, planner: "mock" });
    expect(trace.outcome).toBe("completed");
    expect(store.getTask("tk_retries").status).toBe("done");
    expect(store.getTask("tk_credit").status).toBe("open");
  });

  it("reports blocked permissions and runs no partial workflow", async () => {
    const trace = await runAgent({ utterance: DEMO_UTTERANCE, role: "viewer", planner: "mock", store: new OpsStore() });
    expect(trace.outcome).toBe("blocked");
    expect(trace.denied).toContain("cases.create");
    expect(trace.steps).toEqual([]);
  });
});

describe("whole-plan validation and execution", () => {
  it("treats currency in free text as literal data, not an ID reference", async () => {
    mockOpenAi({ rationale: "Explicit credit issue", calls: [{ ...createCase, arguments: { ...createCase.arguments, title: "$100 credit dispute", description: "$100 was charged twice" } }] });
    const store = new OpsStore();
    const trace = await runAgent({ utterance: "open the credit dispute", role: "operator", planner: "openai", store });
    expect(trace.outcome).toBe("completed");
    expect(store.listCases().some((row) => row.title === "$100 credit dispute")).toBe(true);
  });

  it("validates later calls before allowing the first write", async () => {
    mockOpenAi({ rationale: "Two writes", calls: [createCase, { tool: "tasks.create", arguments: { case_id: "$case.id", title: "x" } }] });
    const store = new OpsStore();
    const before = store.snapshot("supervisor");
    const trace = await runAgent({ utterance: "open a case and task", role: "operator", planner: "openai", store });
    expect(trace.outcome).toBe("blocked");
    expect(trace.issue?.code).toBe("INVALID_PLAN");
    expect(trace.steps).toEqual([]);
    expect(store.snapshot("supervisor")).toEqual(before);
  });

  it("rejects the whole plan when any tool is unavailable", async () => {
    mockOpenAi({ rationale: "Unauthorized write", calls: [{ tool: "whoami", arguments: {} }, createCase] });
    const trace = await runAgent({ utterance: "open case", role: "viewer", planner: "openai", store: new OpsStore() });
    expect(trace.issue?.code).toBe("TOOL_NOT_ALLOWED");
    expect(trace.outcome).toBe("blocked");
    expect(trace.steps).toEqual([]);
  });

  it.each([
    { case_id: "$case.id", title: "   " },
    { case_id: "$case.id", title: "Follow up", due_at: "tomorrow" },
    { case_id: "$case.id", title: "Follow up", due_at: "2026-02-30T12:00:00Z" },
    { case_id: "$case.id", title: "Follow up", undeclared: true },
  ])("rejects invalid later arguments before the first write: %j", async (args) => {
    mockOpenAi({ rationale: "Validate the entire workflow", calls: [createCase, { tool: "tasks.create", arguments: args }] });
    const store = new OpsStore();
    const before = store.snapshot("supervisor");
    const trace = await runAgent({ utterance: "create work", role: "operator", planner: "openai", store });
    expect(trace.outcome).toBe("blocked");
    expect(trace.steps).toEqual([]);
    expect(store.snapshot("supervisor")).toEqual(before);
  });

  it("bounds the maximum number of planned calls", () => {
    expect(() => validatePlan({ planner: "mock", rationale: "Too many calls", calls: Array.from({ length: 17 }, () => ({ tool: "whoami", arguments: {} })) }, whoamiCatalog)).toThrow(/Invalid plan shape/);
  });

  it("blocks an ambiguous contact list before writing", async () => {
    mockOpenAi({ rationale: "Ambiguous lookup", calls: [
      { tool: "contacts.list", arguments: {} },
      { ...createCase, arguments: { ...createCase.arguments, contact_id: "$contact.id" } },
    ] });
    const store = new OpsStore();
    const before = store.snapshot("supervisor");
    const trace = await runAgent({ utterance: "create a case", role: "operator", planner: "openai", store });
    expect(trace.outcome).toBe("blocked");
    expect(trace.issue?.code).toBe("TARGET_UNRESOLVED");
    expect(trace.issue?.message).toMatch(/3 matches/);
    expect(trace.steps.map((step) => step.name)).toEqual(["contacts.list"]);
    expect(store.snapshot("supervisor")).toEqual(before);
  });

  it("clears stale bindings after an empty second lookup", async () => {
    mockOpenAi({ rationale: "A new lookup replaces the old one", calls: [
      { tool: "contacts.get", arguments: { contact_id: "ct_maya" } },
      { tool: "contacts.list", arguments: { query: "nonexistent-person" } },
      { ...createCase, arguments: { ...createCase.arguments, contact_id: "$contact.id" } },
    ] });
    const store = new OpsStore();
    const before = store.snapshot("supervisor");
    const trace = await runAgent({ utterance: "create a case", role: "operator", planner: "openai", store });
    expect(trace.outcome).toBe("blocked");
    expect(trace.issue?.message).toMatch(/0 matches/);
    expect(store.snapshot("supervisor")).toEqual(before);
  });

  it("stops after a failed prerequisite even when later calls have direct IDs", async () => {
    mockOpenAi({ rationale: "Lookup then create", calls: [{ tool: "contacts.get", arguments: { contact_id: "ct_missing" } }, createCase] });
    const store = new OpsStore();
    const before = store.snapshot("supervisor");
    const trace = await runAgent({ utterance: "create a case", role: "operator", planner: "openai", store });
    expect(trace.outcome).toBe("failed");
    expect(trace.issue?.code).toBe("NOT_FOUND");
    expect(trace.steps).toHaveLength(1);
    expect(store.snapshot("supervisor")).toEqual(before);
  });

  it("reports partial execution honestly and stops remaining writes", async () => {
    mockOpenAi({ rationale: "A later lookup fails", calls: [createCase, { tool: "contacts.get", arguments: { contact_id: "ct_missing" } }, createCase] });
    const store = new OpsStore();
    const count = store.listCases().length;
    const trace = await runAgent({ utterance: "create cases", role: "operator", planner: "openai", store });
    expect(trace.outcome).toBe("failed");
    expect(trace.issue?.stepIndex).toBe(1);
    expect(trace.steps).toHaveLength(2);
    expect(store.listCases()).toHaveLength(count + 1);
  });

  it("rejects references without preceding matching lookups", () => {
    const catalog = [{ name: "tasks.complete", inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] } }];
    expect(() => validatePlan({ planner: "mock", rationale: "No task lookup", calls: [{ tool: "tasks.complete", arguments: { task_id: "$task.id" } }] }, catalog)).toThrow(/preceding matching lookup/);
  });

  it("exits nonzero for a blocked CLI workflow", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/harness/cli.ts", "--role", "supervisor", "resolve the case"], {
      encoding: "utf8", env: { ...process.env, WAYLUCID_LLM: "mock" }, timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/outcome=blocked/);
  });
});

describe("optional model adapters without real API calls", () => {
  it("does not enable a paid model from ambient keys", () => {
    vi.stubEnv("WAYLUCID_LLM", "");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    expect(detectProvider()).toBe("mock");
    vi.stubEnv("WAYLUCID_LLM", "anthropic");
    expect(detectProvider()).toBe("anthropic");
  });

  it.each([null, { rationale: 17, calls: [null] }, { rationale: "Invalid arguments", calls: [{ tool: "whoami", arguments: null }] }, { rationale: "Unknown tool", calls: [{ tool: "root.shell", arguments: {} }] }])("rejects malformed provider plans: %j", async (plan) => {
    mockOpenAi(plan);
    await expect(planWithLlm({ provider: "openai", utterance: "whoami", role: "viewer", tools: whoamiCatalog })).rejects.toThrow();
  });

  it("validates a valid OpenAI response and attaches a timeout signal", async () => {
    const fetch = mockOpenAi({ rationale: "Identity lookup", calls: [{ tool: "whoami", arguments: {} }] });
    const plan = await planWithLlm({ provider: "openai", utterance: "whoami", role: "viewer", tools: whoamiCatalog });
    expect(plan.calls[0]?.tool).toBe("whoami");
    expect(fetch).toHaveBeenCalledWith("https://api.openai.com/v1/chat/completions", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("validates the Anthropic adapter through its actual message envelope", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ rationale: "Identity lookup", calls: [{ tool: "whoami", arguments: {} }] }) }] }))));
    const plan = await planWithLlm({ provider: "anthropic", utterance: "whoami", role: "viewer", tools: whoamiCatalog });
    expect(plan.planner).toBe("anthropic");
    expect(plan.calls).toHaveLength(1);
  });

  it("aborts a stalled model request", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    })));
    const assertion = expect(planWithLlm({ provider: "openai", utterance: "whoami", role: "viewer", tools: whoamiCatalog, timeoutMs: 10 })).rejects.toThrow(/timed out after 10 ms/);
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });

  it("does not echo untrusted provider error bodies", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider-secret-debug-body", { status: 429 })));
    await expect(planWithLlm({ provider: "openai", utterance: "whoami", role: "viewer", tools: whoamiCatalog })).rejects.toThrow("OpenAI request failed (HTTP 429).");
  });
});
