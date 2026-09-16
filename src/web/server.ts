import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createPlaygroundListener } from "./api.ts";
import { sendHttpError } from "./http.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 43123);
const HOST = process.env.HOST ?? "127.0.0.1";

async function main(): Promise<void> {
  if (!["127.0.0.1", "localhost", "::1"].includes(HOST)) {
    throw new Error("The playground uses simulated roles and may only bind to a loopback host.");
  }
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("PORT must be between 1 and 65535");
  const vite = await createViteServer({
    configFile: path.join(repoRoot, "vite.config.ts"),
    server: {
      middlewareMode: true,
      hmr: false,
      allowedHosts: ["localhost"],
      fs: { allow: [repoRoot] },
    },
    appType: "custom",
  });

  const app = createPlaygroundListener({
    fallback: async (req, res, url) => {
      vite.middlewares(req, res, () => {
        void (async () => {
          try {
            const raw = await fs.readFile(path.join(repoRoot, "playground/index.html"), "utf8");
            const html = await vite.transformIndexHtml(url.pathname, raw);
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(html);
          } catch (error) {
            sendHttpError(res, error);
          }
        })();
      });
    },
  });
  const server = createServer(app.listener);
  server.listen(PORT, HOST, () => {
    const address = `http://${HOST === "::1" ? "[::1]" : HOST}:${PORT}`;
    console.error(`waylucid local playground  ${address}`);
    console.error(`mcp streamable http        ${address}/mcp`);
    console.error("Roles are a local simulator, not authentication.");
  });
  const close = () => {
    server.close();
    server.closeAllConnections();
    void Promise.all([app.close(), vite.close()]).then(() => process.exit(0));
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "startup failed");
  process.exit(1);
});
