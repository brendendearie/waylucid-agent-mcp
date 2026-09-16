import type { IncomingMessage, ServerResponse } from "node:http";
import { InvalidRoleError } from "../auth.ts";

export const MAX_BODY_BYTES = 64 * 1024;

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

export function sendHttpError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const status = error instanceof HttpError ? error.status : error instanceof InvalidRoleError ? 400 : 500;
  const message = error instanceof HttpError || error instanceof InvalidRoleError ? error.message : "internal error";
  sendJson(res, status, { ok: false, error: message });
}

/** The role selector is a local simulator, not an authentication mechanism. */
export function guardLocalRequest(req: IncomingMessage): URL {
  const host = req.headers.host;
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) {
    throw new HttpError(400, "a loopback Host header is required");
  }
  const requestPath = req.url ?? "/";
  if (!requestPath.startsWith("/") || requestPath.startsWith("//") || requestPath.includes("\\")) {
    throw new HttpError(400, "invalid request URL");
  }
  let url: URL;
  try {
    url = new URL(requestPath, `http://${host}`);
  } catch {
    throw new HttpError(400, "invalid request URL");
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== url.origin) {
    throw new HttpError(403, "cross-origin requests are not allowed");
  }
  if (req.headers["sec-fetch-site"] === "cross-site") {
    throw new HttpError(403, "cross-site requests are not allowed");
  }
  return url;
}

export function readBody(req: IncomingMessage): Promise<Buffer> {
  const declaredLength = req.headers["content-length"];
  if (declaredLength !== undefined && Number(declaredLength) > MAX_BODY_BYTES) {
    req.resume();
    return Promise.reject(new HttpError(413, "request body exceeds 64 KiB"));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    const fail = (error: HttpError) => {
      if (finished) return;
      finished = true;
      chunks.length = 0;
      reject(error);
    };
    req.on("data", (chunk: Buffer) => {
      if (finished) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new HttpError(413, "request body exceeds 64 KiB"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (finished) return;
      finished = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("aborted", () => fail(new HttpError(400, "request aborted")));
    req.on("error", () => fail(new HttpError(400, "could not read request")));
  });
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const body = await readBody(req);
  if (body.length === 0) return {};
  if (req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new HttpError(400, "request body must use application/json");
  }
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}
