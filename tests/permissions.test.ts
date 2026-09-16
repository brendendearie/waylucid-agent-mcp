import { describe, expect, it } from "vitest";
import { advertisedTools, can, parseRole } from "../src/auth.ts";

describe("permission matrix", () => {
  it("defaults unknown roles to operator", () => {
    expect(parseRole("intern")).toBe("operator");
    expect(parseRole(undefined)).toBe("operator");
  });

  it("keeps privileged writes off the operator catalog", () => {
    expect(advertisedTools("operator")).toContain("cases.create");
    expect(advertisedTools("operator")).not.toContain("cases.resolve");
    expect(can("operator", "cases.assign")).toBe(false);
    expect(can("supervisor", "cases.assign")).toBe(true);
  });

  it("is strictly nested: viewer ⊂ operator ⊂ supervisor", () => {
    const viewer = new Set(advertisedTools("viewer"));
    const operator = new Set(advertisedTools("operator"));
    const supervisor = new Set(advertisedTools("supervisor"));
    for (const name of viewer) expect(operator.has(name)).toBe(true);
    for (const name of operator) expect(supervisor.has(name)).toBe(true);
    expect(supervisor.size).toBeGreaterThan(operator.size);
  });
});
