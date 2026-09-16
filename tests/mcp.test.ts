import { afterEach, describe, expect, it } from "vitest";
import { advertisedTools } from "../src/auth.ts";
import { callTool, listToolCatalog, listToolNames, openOpsSession, type OpsSession } from "../src/mcp/session.ts";
import { OpsStore } from "../src/store.ts";

describe("MCP server", () => {
  const sessions: OpsSession[] = [];

  afterEach(async () => {
    while (sessions.length) {
      await sessions.pop()?.close();
    }
  });

  async function connect(role: "viewer" | "operator" | "supervisor") {
    const session = await openOpsSession({ role, store: new OpsStore() });
    sessions.push(session);
    return session;
  }

  it("lists the role-appropriate catalog", async () => {
    const viewer = await connect("viewer");
    const supervisor = await connect("supervisor");
    expect(await listToolNames(viewer.client)).toEqual([...advertisedTools("viewer")].sort());
    const supervisorTools = await listToolNames(supervisor.client);
    expect(supervisorTools).toContain("cases.resolve");
    expect(supervisorTools).toContain("contacts.update_status");
  });

  it("narrows cases.update so operators cannot send tags", async () => {
    const session = await connect("operator");
    const catalog = await listToolCatalog(session.client);
    const update = catalog.find((tool) => tool.name === "cases.update");
    const schema = JSON.stringify(update?.inputSchema ?? {});
    expect(schema).not.toMatch(/"tags"/);
    expect(schema).toMatch(/case_id/);
  });

  it("includes tags on the supervisor cases.update schema", async () => {
    const session = await connect("supervisor");
    const catalog = await listToolCatalog(session.client);
    const update = catalog.find((tool) => tool.name === "cases.update");
    expect(JSON.stringify(update?.inputSchema ?? {})).toMatch(/"tags"/);
  });

  it("creates a case through the protocol and returns structured output", async () => {
    const session = await connect("operator");
    const listed = await callTool(session.client, "contacts.list", { query: "Maya" });
    expect(listed.isError).toBeFalsy();
    const created = await callTool(session.client, "cases.create", {
      contact_id: "ct_maya",
      title: "Telemetry gap after deploy",
      description: "Opened from the MCP protocol test.",
      priority: "p1",
    });
    expect(created.isError).toBeFalsy();
    const structured = created.structuredContent as { ok: boolean; data: { case: { contactId: string } } };
    expect(structured.ok).toBe(true);
    expect(structured.data.case.contactId).toBe("ct_maya");
  });

  it("does not advertise cases.create to a viewer", async () => {
    const session = await connect("viewer");
    const names = await listToolNames(session.client);
    expect(names).not.toContain("cases.create");
    await expect(
      callTool(session.client, "cases.create", {
        contact_id: "ct_maya",
        title: "Should not work",
        description: "Viewers must not file cases.",
        priority: "p2",
      }),
    ).rejects.toThrow(/not found/i);
  });
});
