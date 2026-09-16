import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("stdio MCP server", () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it("starts, lists operator tools, and answers whoami", async () => {
    client = new Client({ name: "stdio-smoke", version: "0.1.0" });
    await client.connect(
      new StdioClientTransport({
        command: path.join(repoRoot, "node_modules/.bin/tsx"),
        args: ["src/mcp/stdio.ts"],
        cwd: repoRoot,
        env: { ...process.env, WAYLUCID_ROLE: "operator" },
      }),
    );

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("whoami");
    expect(names).toContain("cases.create");
    expect(names).not.toContain("cases.resolve");

    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { ok: boolean; data: { principal: { role: string } } };
    expect(structured.ok).toBe(true);
    expect(structured.data.principal.role).toBe("operator");
  });
});
