import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createPlaygroundMcpHandler, handleApi, handleMcp } from "./api.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 43123);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main(): Promise<void> {
  const vite = await createViteServer({
    configFile: path.join(repoRoot, "vite.config.ts"),
    server: {
      middlewareMode: true,
      allowedHosts: true,
      fs: { allow: [repoRoot] },
    },
    appType: "custom",
  });

  const mcp = createPlaygroundMcpHandler();

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      try {
        if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
          await handleMcp(req, res, mcp);
          return;
        }
        if (url.pathname.startsWith("/api/")) {
          await handleApi(req, res, url);
          return;
        }
        vite.middlewares(req, res, () => {
          void (async () => {
            try {
              const templatePath = path.join(repoRoot, "playground/index.html");
              const raw = await fs.readFile(templatePath, "utf8");
              const html = await vite.transformIndexHtml(url.pathname, raw);
              res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
              res.end(html);
            } catch (error) {
              const message = error instanceof Error ? error.message : "render failed";
              res.writeHead(500, { "content-type": "text/plain" });
              res.end(message);
            }
          })();
        });
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : "internal error";
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        }
        res.end(message);
      }
    })();
  });

  server.listen(PORT, HOST, () => {
    console.error(`waylucid playground  http://127.0.0.1:${PORT}`);
    console.error(`mcp streamable http  POST http://127.0.0.1:${PORT}/mcp`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
