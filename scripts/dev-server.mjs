import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const port = Number(process.env.PORT || 4173);

const build = spawnSync(process.execPath, [path.join(root, "scripts", "build.mjs")], {
  cwd: root,
  env: process.env,
  stdio: "inherit"
});
if (build.status !== 0) process.exit(build.status ?? 1);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function safePathname(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  return normalized === "/" ? "/index.html" : normalized;
}

const server = createServer(async (request, response) => {
  try {
    const pathname = safePathname(request.url || "/");
    let filePath = path.join(dist, pathname);
    if (!filePath.startsWith(dist)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = path.join(dist, "index.html");
    const extension = path.extname(filePath);
    response.setHeader("Content-Type", mimeTypes[extension] || "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error.message);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Notas Drive disponible en http://127.0.0.1:${port}`);
  console.log("Detén el servidor con Ctrl+C.");
});
