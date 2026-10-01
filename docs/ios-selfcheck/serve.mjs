// Мини-сервер стенда самопроверки: статика apps/web/dist + SPA-fallback + прокси /api и /health на api.
// Повторяет раскладку nginx прода (один origin). Запуск: node serve.mjs <distDir> <port> <apiPort>
import { createServer, request as httpRequest } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const [distDir, portArg, apiPortArg] = process.argv.slice(2);
if (!distDir || !portArg || !apiPortArg) {
  console.error("usage: node serve.mjs <distDir> <port> <apiPort>");
  process.exit(2);
}
const port = Number(portArg);
const apiPort = Number(apiPortArg);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
    const proxied = httpRequest(
      { host: "127.0.0.1", port: apiPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${apiPort}` } },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    proxied.on("error", () => {
      res.writeHead(502).end("bad gateway");
    });
    req.pipe(proxied);
    return;
  }
  let file = normalize(join(distDir, decodeURIComponent(url.pathname)));
  if (!file.startsWith(distDir)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, "index.html");
  } catch {
    // SPA-fallback только для навигации; отсутствующий ассет — честный 404
    if (extname(file) !== "") {
      res.writeHead(404).end("not found");
      return;
    }
    file = join(distDir, "index.html");
  }
  try {
    const body = await readFile(file);
    const name = file.split("/").pop();
    const noCache = name === "sw.js" || name === "index.html" || name === "manifest.webmanifest";
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": noCache ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
server.listen(port, "127.0.0.1", () => console.log(`[serve] http://127.0.0.1:${port} -> api :${apiPort}`));
