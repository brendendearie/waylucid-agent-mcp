import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GOLDEN, runCheck, runEvalCase, runGoldenSet, type EvalProbe } from "../src/eval/run.ts";
import type { ToolCallResult } from "../src/mcp/session.ts";
import { OpsStore } from "../src/store.ts";

function step(ok: boolean): ToolCallResult {
  return {
    name: "tasks.complete", arguments: { task_id: "tk_retries" }, isError: !ok,
    structuredContent: ok ? { ok: true, data: { task: { status: "done" } } } : { ok: false, error: { code: "CONFLICT", message: "already done" } },
    text: ok ? "done" : "already done",
  };
}

function probe(steps: ToolCallResult[] = []): EvalProbe {
  const snapshot = new OpsStore().snapshot("supervisor");
  return { tools: [], plannedTools: [], steps, before: snapshot, after: structuredClone(snapshot) };
}

describe("golden eval set", () => {
  it("covers permissions, successful workflows, redaction, and no-write regressions with unique ids", () => {
    const ids = GOLDEN.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      "viewer-catalog", "operator-demo-path", "supervisor-resolve-agent", "viewer-direct-write-denied",
      "operator-redacts-notes", "negation-does-not-write", "read-tasks-does-not-create",
      "read-resolved-cases-does-not-resolve", "repeated-task-completion-conflicts",
    ]));
    expect(GOLDEN.every((fixture) => fixture.checks.length > 0)).toBe(true);
  });

  it("passes every fixture and reports its limited evidence scope", async () => {
    const report = await runGoldenSet();
    expect(report.results.filter((row) => !row.pass)).toEqual([]);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(GOLDEN.length);
    expect(report.total).toBe(GOLDEN.length);
    expect(report.checks.failed).toBe(0);
    expect(report.checks.total).toBe(GOLDEN.flatMap((fixture) => fixture.checks).length);
    expect(report.planner).toBe("mock");
    expect(report.scope).toContain("not a model-quality benchmark");
  });

  it("fails an inverted fixture so the runner is not a tautology", async () => {
    const result = await runEvalCase({
      id: "inverted", title: "viewer should not see cases.create", role: "viewer",
      checks: [{ kind: "toolsInclude", tools: ["cases.create"] }],
    });
    expect(result.pass).toBe(false);
  });

  it("detects a real write when the fixture incorrectly expects no change", async () => {
    const result = await runEvalCase({
      id: "mutation-negative-control", title: "completion is a mutation", role: "operator",
      tool: { name: "tasks.complete", arguments: { task_id: "tk_retries" } },
      checks: [{ kind: "stepOk", tool: "tasks.complete" }, { kind: "stateUnchanged" }],
    });
    expect(result.pass).toBe(false);
    expect(result.checks.map((check) => check.pass)).toEqual([true, false]);
  });

  it("rejects assertion-free fixtures and continues after a fixture failure", async () => {
    const report = await runGoldenSet([
      { id: "invalid", title: "empty checks", role: "viewer", checks: [] },
      { id: "valid", title: "catalog still executes", role: "viewer", checks: [{ kind: "toolsInclude", tools: ["whoami"] }] },
    ]);
    expect(report.failed).toBe(1);
    expect(report.passed).toBe(1);
    expect(report.results[0].error).toContain("at least one assertion");
    expect(report.results[1].pass).toBe(true);
  });

  it("does not silently swallow an unexpected protocol error", async () => {
    const result = await runEvalCase({
      id: "unexpected-protocol", title: "forbidden direct tool", role: "viewer",
      tool: { name: "cases.resolve", arguments: { case_id: "cs_webhook" } },
      checks: [{ kind: "stateUnchanged" }],
    });
    expect(result.pass).toBe(false);
    expect(result.error).toContain("Unexpected protocol error");
  });
});

describe("eval assertion semantics", () => {
  it("does not let a first successful call mask a later failure", () => {
    expect(runCheck({ kind: "stepOk", tool: "tasks.complete" }, probe([step(true), step(false)])).pass).toBe(false);
    expect(runCheck({ kind: "stepOk", tool: "tasks.complete", occurrence: 0 }, probe([step(true), step(false)])).pass).toBe(true);
  });

  it("does not let an expected error mask another successful occurrence", () => {
    expect(runCheck({ kind: "stepError", tool: "tasks.complete", code: "CONFLICT" }, probe([step(false), step(true)])).pass).toBe(false);
    expect(runCheck({ kind: "stepError", tool: "tasks.complete", code: "CONFLICT", occurrence: 1 }, probe([step(true), step(false)])).pass).toBe(true);
  });

  it("preserves every repeated result under its occurrence index", () => {
    const repeated = probe([step(true), step(false)]);
    expect(runCheck({ kind: "jsonPath", path: "steps.tasks_complete.0.ok", equals: true }, repeated).pass).toBe(true);
    expect(runCheck({ kind: "jsonPath", path: "steps.tasks_complete.1.error.code", equals: "CONFLICT" }, repeated).pass).toBe(true);
    expect(runCheck({ kind: "jsonPath", path: "steps.tasks_complete.length", equals: 2 }, repeated).pass).toBe(true);
  });

  it("requires an actual matching step, including for expected errors", () => {
    expect(runCheck({ kind: "stepOk", tool: "tasks.complete" }, probe()).pass).toBe(false);
    expect(runCheck({ kind: "stepError", tool: "tasks.complete", code: "CONFLICT" }, probe()).pass).toBe(false);
    expect(runCheck({ kind: "stepOk", tool: "tasks.complete", occurrence: 2 }, probe([step(true)])).pass).toBe(false);
  });

  it("requires both structured error and MCP error flag", () => {
    const malformed = step(false);
    malformed.isError = false;
    expect(runCheck({ kind: "stepError", tool: "tasks.complete", code: "CONFLICT" }, probe([malformed])).pass).toBe(false);
  });

  it("combines JSON assertions instead of overwriting previous failures", () => {
    expect(runCheck({ kind: "jsonPath", path: "steps.tasks_complete.0.ok", exists: false, equals: true }, probe([step(true)])).pass).toBe(false);
    expect(runCheck({ kind: "jsonPath", path: "missing" }, probe()).pass).toBe(false);
  });

  it("checks privileged state too, not only a redacted snapshot", () => {
    const value = probe();
    value.after.cases[0].internalNotes![0].body = "unexpected modification";
    expect(runCheck({ kind: "stateUnchanged" }, value).pass).toBe(false);
  });
});

describe("eval CLI", () => {
  const cli = fileURLToPath(new URL("../src/eval/cli.ts", import.meta.url));

  it("emits a standalone JSON report to stdout", () => {
    const child = spawnSync(process.execPath, ["--import", "tsx", cli, "--json"], { encoding: "utf8" });
    expect(child.status, child.stderr).toBe(0);
    const report = JSON.parse(child.stdout);
    expect(report.schemaVersion).toBe(1);
    expect(report.suite).toBe("deterministic-mcp-regression");
    expect(report.total).toBe(GOLDEN.length);
    expect(report.failed).toBe(0);
  });

  it("rejects unknown options with a nonzero status and no fake report", () => {
    const child = spawnSync(process.execPath, ["--import", "tsx", cli, "--unknown"], { encoding: "utf8" });
    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    expect(child.stderr).toContain("Usage:");
  });
});
