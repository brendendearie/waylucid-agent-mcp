import type { IncomingMessage, ServerResponse } from "node:http";
import { advertisedTools, parseRole, PRINCIPALS, roleLabel } from "../auth.ts";
import { runGoldenSet } from "../eval/run.ts";
import { DEMO_UTTERANCE } from "../harness/planner.ts";
import { runAgent } from "../harness/run.ts";
import { listToolCatalog, openOpsSession } from "../mcp/session.ts";
import type { Role } from "../ontology.ts";
import { createOpsServer } from "../mcp/create-server.ts";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { desk } from "../store.ts";

export type CatalogResponse = {
  role: Role;
  principal: (typeof PRINCIPALS)[Role];
  label: string;
  tools: Awaited<ReturnType<typeof listToolCatalog>>;
  advertised: string[];
};

function roleFromRequest(req: IncomingMessage, url: URL): Role {
  const header = req.headers["x-waylucid-role"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  return parseRole(url.searchParams.get("role") ?? fromHeader);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(json);
}

export async function catalogFor(role: Role): Promise<CatalogResponse> {
  const session = await openOpsSession({ role, store: desk });
  try {
    const tools = await listToolCatalog(session.client);
    return {
      role,
      principal: PRINCIPALS[role],
      label: roleLabel(role),
      tools,
      advertised: advertisedTools(role),
    };
  } finally {
    await session.close();
  }
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const role = roleFromRequest(req, url);

  if (req.method === "GET" && url.pathname === "/api/health") {
    send(res, 200, { ok: true, service: "waylucid-agent-mcp", seed: "harborline" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/catalog") {
    send(res, 200, await catalogFor(role));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/desk") {
    send(res, 200, { role, desk: desk.snapshot(role) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    desk.reset();
    send(res, 200, { ok: true, desk: desk.snapshot(role) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent") {
    const body = (await readJson(req)) as { utterance?: string; role?: string };
    const utterance = body.utterance?.trim() || DEMO_UTTERANCE;
    const agentRole = parseRole(body.role ?? role);
    const trace = await runAgent({ utterance, role: agentRole, store: desk, planner: "mock" });
    send(res, 200, { trace, desk: desk.snapshot(agentRole) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/eval") {
    const report = await runGoldenSet();
    send(res, 200, report);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/demo") {
    send(res, 200, { utterance: DEMO_UTTERANCE });
    return;
  }

  send(res, 404, { ok: false, error: "not found" });
}

export function createPlaygroundMcpHandler() {
  return createMcpHandler(({ authInfo, requestInfo }) => {
    const header = requestInfo?.headers?.get("x-waylucid-role");
    const role = parseRole(authInfo?.token ?? header);
    return createOpsServer({ role, store: desk });
  });
}

export async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  handler: ReturnType<typeof createMcpHandler>,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks);
  const url = `http://127.0.0.1${req.url ?? "/mcp"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  const method = req.method ?? "GET";
  const request = new Request(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
  const role = parseRole(headers.get("x-waylucid-role"));
  const response = await handler.fetch(request, {
    authInfo: {
      token: role,
      clientId: `harborline-${role}`,
      scopes: [`role:${role}`],
    },
  });
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}
