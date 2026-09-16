import { describe, expect, it } from "vitest";
import { GOLDEN, runEvalCase, runGoldenSet } from "../src/eval/run.ts";

describe("golden eval set", () => {
  it("covers the golden catalog and permission cases", () => {
    expect(GOLDEN.map((row) => row.id)).toEqual([
      "viewer-catalog",
      "operator-catalog",
      "supervisor-catalog",
      "viewer-cannot-file",
      "operator-demo-path",
      "operator-cannot-assign",
      "supervisor-resolve",
      "missing-contact",
      "operator-redacts-notes",
      "supervisor-sees-notes",
    ]);
  });

  it("passes every fixture", async () => {
    const { failed, results } = await runGoldenSet();
    const failures = results.filter((row) => !row.pass).map((row) => row.id);
    expect(failures).toEqual([]);
    expect(failed).toBe(0);
  });

  it("fails an inverted fixture so the runner is not a tautology", async () => {
    const result = await runEvalCase({
      id: "inverted",
      title: "viewer should not see cases.create",
      role: "viewer",
      checks: [{ kind: "toolsInclude", tools: ["cases.create"] }],
    });
    expect(result.pass).toBe(false);
  });
});
