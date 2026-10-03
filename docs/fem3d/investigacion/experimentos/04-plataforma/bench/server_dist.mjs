// Sirve el dist/ del worktree (solo lectura) como GitHub Pages: sin cabeceras
// propias, y con fallback SPA a index.html. Uso: node server_dist.mjs <puerto>
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const ROOT = normalize("D:/PROGRAMACION/Concreta EST/wt/feat-fem3d/dist");
const PORT = Number(process.argv[2] || 8796);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".zip": "application/zip", ".whl": "application/octet-stream" };
const log = [];
createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  try { const s = await stat(p); if (s.isDirectory()) p = join(p, "index.html"); } catch { p = join(ROOT, "index.html"); }
  try {
    const body = await readFile(p);
    res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
    console.log(new Date().toISOString().slice(11,23), "GET", url.pathname, body.length);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, "127.0.0.1", () => console.log("dist en", PORT));
