import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import * as z from "zod/v4";
import { advertisedTools, parseRole, PRINCIPALS, ROLES, roleLabel } from "../auth.ts";
import { runGoldenSet } from "../eval/run.ts";
import { DEMO_UTTERANCE } from "../harness/planner.ts";
import { runAgent } from "../harness/run.ts";
import { listToolCatalog, openOpsSession } from "../mcp/session.ts";
import type { Role } from "../ontology.ts";
import { createOpsServer } from "../mcp/create-server.ts";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { desk, type OpsStore } from "../store.ts";
import { guardLocalRequest, HttpError, readBody, readJson, sendHttpError, sendJson as send } from "./http.ts";

export type CatalogResponse = {
  role: Role;
  principal: (typeof PRINCIPALS)[Role];
  label: string;
  tools: Awaited<ReturnType<typeof listToolCatalog>>;
  advertised: string[];
};

function roleFromRequest(req: IncomingMessage, url: URL): Role {
  const header = req.headers["x-waylucid-role"];
  if (Array.isArray(header) || url.searchParams.getAll("role").length > 1) {
    throw new HttpError(400, "provide only one role");
  }
  const query = url.searchParams.get("role");
  if (query !== null && header !== undefined && query !== header) {
    throw new HttpError(400, "conflicting roles");
  }
  return parseRole(query ?? header, "viewer");
}

const agentBodySchema = z.strictObject({
  utterance: z.string().trim().min(1).max(10_000).optional(),
  role: z.enum(ROLES).optional(),
});

export async function catalogFor(role: Role, store: OpsStore = desk): Promise<CatalogResponse> {
  const session = await openOpsSession({ role, store });
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

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, store: OpsStore = desk): Promise<void> {
  const role = roleFromRequest(req, url);

  if (req.method === "GET" && url.pathname === "/api/health") {
    send(res, 200, { ok: true, service: "waylucid-agent-mcp", seed: "harborline" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/catalog") {
    send(res, 200, await catalogFor(role, store));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/desk") {
    send(res, 200, { role, desk: store.snapshot(role) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    if (role !== "supervisor") throw new HttpError(403, "only the supervisor demo role may reset the desk");
    if (!z.strictObject({}).safeParse(await readJson(req)).success) throw new HttpError(400, "reset expects an empty object");
    store.reset();
    send(res, 200, { ok: true, desk: store.snapshot(role) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent") {
    const parsed = agentBodySchema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "invalid agent request: expected utterance and an optional valid role");
    const body = parsed.data;
    if (body.role && (url.searchParams.has("role") || req.headers["x-waylucid-role"] !== undefined) && body.role !== role) {
      throw new HttpError(400, "conflicting roles");
    }
    const utterance = body.utterance ?? DEMO_UTTERANCE;
    const agentRole = parseRole(body.role ?? role);
    const trace = await runAgent({ utterance, role: agentRole, store, planner: "mock" });
    send(res, 200, { trace, desk: store.snapshot(agentRole) });
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

export function createPlaygroundMcpHandler(store: OpsStore = desk) {
  return createMcpHandler(({ authInfo, requestInfo }) => {
    const header = requestInfo?.headers?.get("x-waylucid-role");
    const role = parseRole(authInfo?.token ?? header, "viewer");
    return createOpsServer({ role, store });
  });
}

export async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  handler: ReturnType<typeof createMcpHandler>,
  url: URL,
): Promise<void> {
  const role = roleFromRequest(req, url);
  const body = await readBody(req);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  const method = req.method ?? "GET";
  const request = new Request(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : new Uint8Array(body).buffer,
  });
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

export function createPlaygroundListener(options: {
  store?: OpsStore;
  fallback?: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;
} = {}): { listener: RequestListener; close: () => Promise<void> } {
  const store = options.store ?? desk;
  const mcp = createPlaygroundMcpHandler(store);
  const listener: RequestListener = (req, res) => {
    void (async () => {
      try {
        const url = guardLocalRequest(req);
        if (url.pathname === "/mcp") {
          await handleMcp(req, res, mcp, url);
        } else if (url.pathname.startsWith("/api/")) {
          await handleApi(req, res, url, store);
        } else if (options.fallback) {
          await options.fallback(req, res, url);
        } else {
          send(res, 404, { ok: false, error: "not found" });
        }
      } catch (error) {
        sendHttpError(res, error);
      }
    })();
  };
  return { listener, close: () => mcp.close() };
}
