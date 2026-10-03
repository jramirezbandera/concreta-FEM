// Servidor estático mínimo para los experimentos (sin cabeceras COOP/COEP,
// como GitHub Pages). Uso: node server.mjs <puerto> [--coi]
// Con --coi añade COOP/COEP para comparar (crossOriginIsolated = true).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const PORT = Number(process.argv[2] || 8794);
const COI = process.argv.includes("--coi");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".whl": "application/octet-stream",
  ".zip": "application/zip",
  ".css": "text/css",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    let p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!p.startsWith(ROOT)) throw new Error("fuera");
    const s = await stat(p);
    if (s.isDirectory()) p = join(p, "index.html");
    const body = await readFile(p);
    const h = { "Content-Type": MIME[extname(p)] || "application/octet-stream", "Cache-Control": "no-cache" };
    if (COI) {
      h["Cross-Origin-Opener-Policy"] = "same-origin";
      h["Cross-Origin-Embedder-Policy"] = "require-corp";
    }
    res.writeHead(200, h);
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("404");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`sirviendo ${ROOT} en http://127.0.0.1:${PORT}${COI ? " (COOP/COEP)" : ""}`));
