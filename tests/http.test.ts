import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createPlaygroundListener } from "../src/web/api.ts";
import { MAX_BODY_BYTES } from "../src/web/http.ts";
import { OpsStore } from "../src/store.ts";

describe("local playground HTTP boundary", () => {
  let server: Server;
  let app: ReturnType<typeof createPlaygroundListener>;
  let store: OpsStore;
  let base: string;
  beforeEach(async () => {
    store = new OpsStore();
    app = createPlaygroundListener({ store });
    server = createServer(app.listener);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    server.closeAllConnections();
    await Promise.all([app.close(), new Promise<void>((resolve) => server.close(() => resolve()))]);
  });
  async function post(path: string, body: string, headers: Record<string, string> = {}) {
    return fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  }
  async function raw(path: string, options: { headers?: Record<string, string>; chunks?: string[] } = {}) {
    return new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = request(`${base}${path}`, {
        method: options.chunks ? "POST" : "GET",
        headers: options.headers,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode!, text: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      for (const chunk of options.chunks ?? []) req.write(chunk);
      req.end();
    });
  }

  it("defaults HTTP requests to viewer, with no internal notes", async () => {
    const response = await fetch(`${base}/api/catalog`);
    const catalog = await response.json();
    expect(response.status).toBe(200);
    expect(catalog.role).toBe("viewer");
    expect(catalog.advertised).not.toContain("cases.create");
    const snapshot = await (await fetch(`${base}/api/desk`)).json();
    expect(snapshot.role).toBe("viewer");
    expect(JSON.stringify(snapshot)).not.toContain('"internalNotes"');
  });

  it("allows explicit local demo roles while rejecting unknown or conflicting roles", async () => {
    const response = await fetch(`${base}/api/desk?role=supervisor`);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain('"internalNotes"');
    for (const path of ["/api/desk?role=intern", "/api/desk?role=", "/api/desk?role=viewer&role=supervisor"]) {
      expect((await fetch(`${base}${path}`)).status).toBe(400);
    }
    expect((await fetch(`${base}/api/desk?role=viewer`, { headers: { "x-waylucid-role": "supervisor" } })).status).toBe(400);
    expect((await post("/api/agent?role=viewer", '{"role":"supervisor"}')).status).toBe(400);
  });

  it("restricts reset to the supervisor role and preserves state on denial", async () => {
    store.createCase({ contactId: "ct_maya", title: "Keep this case", description: "Must survive denied reset", priority: "p1" });
    const before = store.snapshot("supervisor");
    for (const role of ["", "?role=viewer", "?role=operator"]) {
      expect((await post(`/api/reset${role}`, "{}")).status).toBe(403);
      expect(store.snapshot("supervisor")).toEqual(before);
    }
    expect((await post("/api/reset?role=supervisor", "{}")).status).toBe(200);
    expect(store.snapshot("supervisor")).toEqual(new OpsStore().snapshot("supervisor"));
  });

  it("rejects malformed Host values without taking down the server", async () => {
    for (const host of ["[", "attacker.example", "localhost:99999", "localhost@attacker.example"]) {
      expect((await raw("/api/health", { headers: { host } })).status).toBe(400);
      expect((await fetch(`${base}/api/health`)).status).toBe(200);
    }
  });

  it("blocks cross-origin and cross-site mutations before reading the body", async () => {
    store.createCase({ contactId: "ct_maya", title: "Survive cross-origin reset", description: "Keep this record", priority: "p2" });
    const before = store.snapshot("supervisor");
    const blockedHeaders: Record<string, string>[] = [{ origin: "https://attacker.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }];
    for (const headers of blockedHeaders) {
      expect((await post("/api/reset?role=supervisor", "{}", headers)).status).toBe(403);
      expect(store.snapshot("supervisor")).toEqual(before);
    }
    expect((await post("/api/reset?role=supervisor", "{}", { origin: base })).status).toBe(200);
  });

  it("returns 400 for invalid JSON and schemas without mutating or leaking stacks", async () => {
    const before = store.snapshot("supervisor");
    for (const body of ["{", "null", "[]", "42", '{"utterance":42}', '{"utterance":""}', '{"role":"intern"}', '{"extra":"field"}']) {
      const response = await post("/api/agent?role=operator", body);
      expect(response.status).toBe(400);
      const error = await response.json();
      expect(error.ok).toBe(false);
      expect(error).not.toHaveProperty("stack");
      expect(store.snapshot("supervisor")).toEqual(before);
    }
    expect((await post("/api/agent", "{}", { "content-type": "text/plain" })).status).toBe(400);
  });

  it("limits both declared and chunked bodies for API and MCP routes", async () => {
    const before = store.snapshot("supervisor");
    const body = JSON.stringify({ utterance: "a".repeat(MAX_BODY_BYTES) });
    for (const path of ["/api/agent", "/mcp"]) {
      expect((await post(path, body)).status).toBe(413);
      const response = await raw(path, {
        headers: { "content-type": "application/json" },
        chunks: [body.slice(0, 40_000), body.slice(40_000)],
      });
      expect(response.status).toBe(413);
      expect(store.snapshot("supervisor")).toEqual(before);
    }
  });

  it("returns a generic 500 without returning the internal exception", async () => {
    vi.spyOn(store, "snapshot").mockImplementationOnce(() => { throw new Error("private implementation detail"); });
    const response = await fetch(`${base}/api/desk`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "internal error" });
  });

  it("serves a real MCP client with a read-only default role", async () => {
    const client = new Client({ name: "http-boundary", version: "1.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      const catalog = await client.listTools();
      expect(catalog.tools.map((tool) => tool.name)).toContain("cases.get");
      expect(catalog.tools.map((tool) => tool.name)).not.toContain("cases.create");
      const before = store.snapshot("supervisor");
      await expect(client.callTool({ name: "cases.create", arguments: { contact_id: "ct_maya", title: "Forbidden case", description: "No viewer mutation" } })).rejects.toThrow();
      expect(store.snapshot("supervisor")).toEqual(before);
    } finally {
      await client.close();
    }
  });
});
