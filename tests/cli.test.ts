import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseAgentCommand } from "../src/harness/arguments.ts";
import { DEMO_UTTERANCE } from "../src/harness/planner.ts";

describe("agent command parsing", () => {
  it.each([
    ["--dry-run", "--demo"], ["--demoo"], ["--role"],
    ["--role", "viewer", "--role", "supervisor", "--demo"],
    ["--demo", "list tasks"], ["--list-tools", "--demo"],
    ["--list", "open a case for Maya"], ["--list", "--list-tools"], [],
  ])("rejects invalid or conflicting arguments before executing: %j", (...args: string[]) => {
    expect(() => parseAgentCommand(args)).toThrow();
  });

  it("keeps utterances intact and supports explicit role precedence", () => {
    expect(parseAgentCommand(["--role=viewer", "--json", "show cases"], "supervisor"))
      .toEqual({ mode: "run", role: "viewer", json: true, utterance: "show cases" });
    expect(parseAgentCommand(["--demo"], "operator"))
      .toEqual({ mode: "run", role: "operator", json: false, utterance: DEMO_UTTERANCE });
    expect(parseAgentCommand(["--list", "--role", "viewer", "--json"]))
      .toEqual({ mode: "catalog", role: "viewer", json: true });
  });

  function invoke(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", "src/harness/cli.ts", ...args], {
      cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 10_000,
      env: { ...process.env, WAYLUCID_LLM: "mock", WAYLUCID_ROLE: "operator" },
    });
  }

  it("never runs a demo while silently ignoring --dry-run", () => {
    const result = invoke(["--demo", "--dry-run"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown option");
  });

  it("emits parseable traces with completed and blocked exit statuses", () => {
    for (const role of ["operator", "viewer"]) {
      const result = invoke(["--role", role, "--demo", "--json"]);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(role === "operator" ? 0 : 1);
      const trace = JSON.parse(result.stdout);
      expect(trace.outcome).toBe(role === "operator" ? "completed" : "blocked");
      expect(trace.steps).toHaveLength(role === "operator" ? 3 : 0);
    }
  });

  it("offers side-effect-free help and JSON catalogs", () => {
    const help = invoke(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage:");
    const catalog = invoke(["--list-tools", "--role", "viewer", "--json"]);
    expect(catalog.status).toBe(0);
    const result = JSON.parse(catalog.stdout);
    expect(result.role).toBe("viewer");
    expect(result.tools.every((tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint)).toBe(true);
  });
});
