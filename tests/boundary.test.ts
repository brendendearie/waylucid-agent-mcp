import { afterEach, describe, expect, it, vi } from "vitest";
import { INVALID_PARAMS, ProtocolError } from "@modelcontextprotocol/client";
import { advertisedTools, parseRole, ROLES, TOOL_NAMES, type ToolName } from "../src/auth.ts";
import { callTool, openOpsSession, type OpsSession } from "../src/mcp/session.ts";
import { OpsStore } from "../src/store.ts";

const validArgs: Record<ToolName, Record<string, unknown>> = {
  whoami: {},
  "contacts.list": {},
  "contacts.get": { contact_id: "ct_maya" },
  "contacts.update_status": { contact_id: "ct_maya", status: "paused" },
  "cases.list": {},
  "cases.get": { case_id: "cs_webhook" },
  "cases.create": { contact_id: "ct_maya", title: "Boundary case", description: "A valid attempted write", priority: "p1" },
  "cases.update": { case_id: "cs_webhook", title: "Changed title" },
  "cases.assign": { case_id: "cs_webhook", assignee_id: "pr_supervisor" },
  "cases.resolve": { case_id: "cs_webhook", resolution_code: "fixed", resolution_summary: "A valid resolution" },
  "cases.add_internal_note": { case_id: "cs_webhook", body: "A private note" },
  "tasks.list": {},
  "tasks.get": { task_id: "tk_rotate" },
  "tasks.create": { case_id: "cs_webhook", title: "A valid task" },
  "tasks.complete": { task_id: "tk_retries" },
};

describe("protocol boundary", () => {
  const sessions: OpsSession[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    while (sessions.length) await sessions.pop()!.close();
  });
  async function connect(role: (typeof ROLES)[number], store = new OpsStore()) {
    const session = await openOpsSession({ role, store });
    sessions.push(session);
    return { session, store };
  }
  async function expectRejected(
    session: OpsSession,
    tool: string,
    args: Record<string, unknown>,
    reason: "validation" | "unavailable" | "not-found" = "validation",
  ) {
    let result;
    try {
      result = await callTool(session.client, tool, args);
    } catch (error) {
      // A broken transport is not evidence that the permission boundary held.
      expect(reason).toBe("unavailable");
      expect(error).toBeInstanceOf(ProtocolError);
      expect((error as ProtocolError).code).toBe(INVALID_PARAMS);
      expect((error as ProtocolError).message).toBe(`Tool ${tool} not found`);
      return;
    }
    expect(result.isError).toBe(true);
    expect(reason).not.toBe("unavailable");
    if (reason === "validation") {
      expect(result.text).toContain(`Input validation error: Invalid arguments for tool ${tool}:`);
    } else {
      expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }
  }

  for (const role of ROLES) {
    for (const tool of TOOL_NAMES.filter((name) => !advertisedTools(role).includes(name))) {
      it(`${role} cannot directly call ${tool} or change state`, async () => {
        const { session, store } = await connect(role);
        const before = store.snapshot("supervisor");
        await expectRejected(session, tool, validArgs[tool], "unavailable");
        expect(store.snapshot("supervisor")).toEqual(before);
      });
    }
  }

  it("does not count a transport failure as a permission denial", async () => {
    const { session } = await connect("viewer");
    vi.spyOn(session.client, "callTool").mockRejectedValueOnce(new Error("transport disconnected"));
    await expect(expectRejected(session, "cases.create", validArgs["cases.create"], "unavailable")).rejects.toThrow();
  });

  for (const forbidden of [
    { tags: ["privileged"] },
    { assignee_id: "pr_supervisor" },
    { assigneeId: "pr_supervisor" },
    { status: "resolved" },
    { resolutionCode: "fixed" },
    { internalNotes: [{ body: "injected note" }] },
  ]) {
    it(`rejects operator update field ${Object.keys(forbidden)[0]} atomically`, async () => {
      const { session, store } = await connect("operator");
      const before = store.snapshot("supervisor");
      await expectRejected(session, "cases.update", { case_id: "cs_webhook", title: "Must not change", ...forbidden });
      expect(store.snapshot("supervisor")).toEqual(before);
    });
  }

  it("rejects unknown fields on every advertised input schema", async () => {
    const { session, store } = await connect("supervisor");
    const before = store.snapshot("supervisor");
    for (const tool of TOOL_NAMES) {
      await expectRejected(session, tool, { ...validArgs[tool], unexpected: "reject me" });
      expect(store.snapshot("supervisor")).toEqual(before);
    }
  });

  for (const role of ["viewer", "operator"] as const) {
    it(`${role} cannot obtain internal notes through reads or resources`, async () => {
      const { session, store } = await connect(role);
      const secret = "BOUNDARY_PRIVATE_SENTINEL";
      store.addInternalNote("cs_webhook", secret, "pr_supervisor");
      for (const [tool, args] of [["cases.list", {}], ["cases.get", { case_id: "cs_webhook" }]] as const) {
        const result = await callTool(session.client, tool, args);
        expect(result.isError).toBe(false);
        expect(JSON.stringify(result)).not.toContain(secret);
        expect(JSON.stringify(result)).not.toContain('"internalNotes"');
      }
      const resources = await session.client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).not.toContain("ops://desk/snapshot");
      await expect(session.client.readResource({ uri: "ops://desk/snapshot" })).rejects.toThrow();
      expect(JSON.stringify(store.snapshot(role))).not.toContain(secret);
    });
  }

  it("operator mutation responses also redact internal notes", async () => {
    const { session, store } = await connect("operator");
    store.addInternalNote("cs_webhook", "BOUNDARY_PRIVATE_SENTINEL", "pr_supervisor");
    const result = await callTool(session.client, "cases.update", validArgs["cases.update"]);
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result)).not.toContain("BOUNDARY_PRIVATE_SENTINEL");
    expect(JSON.stringify(result)).not.toContain('"internalNotes"');
  });

  it("rejects unknown assignees without changing the case", async () => {
    const { session, store } = await connect("supervisor");
    const before = store.snapshot("supervisor");
    for (const assignee_id of ["", "pr_missing"]) {
      await expectRejected(session, "cases.assign", { case_id: "cs_webhook", assignee_id }, "not-found");
      expect(store.snapshot("supervisor")).toEqual(before);
    }
    expect(() => store.assignCase("cs_webhook", "pr_missing")).toThrow(/principal/);
    expect(store.snapshot("supervisor")).toEqual(before);
  });

  it("rejects invalid timestamps and accepts timezone-qualified timestamps", async () => {
    const { session, store } = await connect("operator");
    const before = store.snapshot("supervisor");
    for (const due_at of ["tomorrow", "2026-02-30T12:00:00Z", "2026-09-15T12:00:00", ""]) {
      await expectRejected(session, "tasks.create", { ...validArgs["tasks.create"], due_at });
      expect(store.snapshot("supervisor")).toEqual(before);
    }
    expect(() => store.createTask({ caseId: "cs_webhook", title: "Invalid date", dueAt: "tomorrow" })).toThrow(/ISO-8601/);
    expect(store.snapshot("supervisor")).toEqual(before);
    const accepted = await callTool(session.client, "tasks.create", { ...validArgs["tasks.create"], due_at: "2026-09-15T12:00:00-07:00" });
    expect(accepted.isError).toBe(false);
  });

  it("preserves the explicit CLI default but never converts an unknown role to a writer", () => {
    expect(parseRole(undefined)).toBe("operator");
    expect(parseRole(undefined, "viewer")).toBe("viewer");
    for (const role of ["intern", "", 42, {}, []]) expect(() => parseRole(role)).toThrow(/role must be/);
  });
});
