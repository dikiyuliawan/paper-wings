/**
 * A tiny zero dependency static file server.
 *
 *   node scripts/serve.js [port]
 *
 * The game is a plain static site, so this is all it needs.
 */

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || process.env.PORT || 5174);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    const filePath = path.join(
      root,
      path.normalize(pathname).replace(/^([/\\])+/, ""),
    );
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const stats = await fsp.stat(filePath).catch(() => null);
    if (!stats || !stats.isFile()) {
      response
        .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
        .end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type":
        MIME[path.extname(filePath).toLowerCase()] ||
        "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    response
      .writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
      .end("Server error");
    console.error(error);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `\n  Port ${port} is already in use. Try: node scripts/serve.js ${port + 1}\n`,
    );
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(port, () => {
  console.log(`\n  Paper Wings is running at http://localhost:${port}\n`);
});
