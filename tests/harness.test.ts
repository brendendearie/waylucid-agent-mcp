import { describe, expect, it } from "vitest";
import { DEMO_UTTERANCE, planWithMock } from "../src/harness/planner.ts";
import { runAgent } from "../src/harness/run.ts";
import { OpsStore } from "../src/store.ts";

describe("agent harness", () => {
  it("plans the demo utterance as list → create case → create task", () => {
    const plan = planWithMock(DEMO_UTTERANCE, "operator");
    expect(plan.calls.map((call) => call.tool)).toEqual(["contacts.list", "cases.create", "tasks.create"]);
  });

  it("drops supervisor tools from an operator plan instead of failing later", () => {
    const plan = planWithMock("resolve the open webhook case", "operator");
    expect(plan.calls.map((call) => call.tool)).toEqual(["cases.list"]);
    expect(plan.rationale).toMatch(/Dropped cases.resolve/);
  });

  it("executes the demo path against a fresh store", async () => {
    const store = new OpsStore();
    const before = store.listCases().length;
    const trace = await runAgent({ utterance: DEMO_UTTERANCE, role: "operator", store, planner: "mock" });
    expect(trace.steps.every((step) => !step.isError)).toBe(true);
    expect(store.listCases().length).toBe(before + 1);
    expect(store.listTasks().some((task) => task.title.includes("signing secret"))).toBe(true);
  });
});
