// @vitest-environment node
/**
 * Criterio 4 de V2a (`docs/fem3d/visor.md` §6.3), en el servidor local: sólo se escribe el proyecto
 * abierto, sólo desde la página del visor, sólo si no cambió en el disco y sólo un proyecto válido.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proyectoNuevo } from "../../../src/editor/plantilla.ts";
import { serializar } from "../../../src/editor/serializar.ts";
import { manejadorCarpeta } from "../../servidor.ts";

let dir: string;
let servidor: Server;
let base: string;
let host: string;
const TEXTO = serializar(proyectoNuevo("prueba"));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fem-v2a-"));
  writeFileSync(join(dir, "proyecto.json"), TEXTO);
  writeFileSync(join(dir, "otro.json"), TEXTO);
  mkdirSync(join(dir, ".fem"));
  const m = manejadorCarpeta(dir, "proyecto.json");
  servidor = createServer((req, res) => {
    if (!req.url?.startsWith("/proyecto/")) return res.writeHead(404).end();
    req.url = req.url.slice("/proyecto".length);
    m(req, res);
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const p = (servidor.address() as { port: number }).port;
  host = `127.0.0.1:${p}`;
  base = `http://${host}/proyecto/`;
});

afterAll(() => {
  servidor.close();
  rmSync(dir, { recursive: true, force: true });
});

const etag = async (f = "proyecto.json") => (await fetch(base + f, { method: "HEAD" })).headers.get("etag")!;
const put = (f: string, cuerpo: string, cab: Record<string, string>) => fetch(base + f, { method: "PUT", body: cuerpo, headers: { origin: `http://${host}`, ...cab } });

describe("PUT del servidor local", () => {
  it("escribe el proyecto con el sello que se leyó, y devuelve el nuevo", async () => {
    const s = await etag();
    const nuevo = TEXTO.replace('"prueba"', '"cambiado"');
    const r = await put("proyecto.json", nuevo, { "if-match": s });
    expect(r.status).toBe(200);
    expect(readFileSync(join(dir, "proyecto.json"), "utf8")).toBe(nuevo);
    expect(r.headers.get("etag")).toBe(await etag());
    // Sin temporales sueltos
    expect(readdirSync(dir).filter((x) => x.endsWith(".tmp"))).toEqual([]);
  });

  it("si el fichero cambió en el disco desde que se leyó, 412 y no se escribe", async () => {
    const s = await etag();
    await new Promise((r) => setTimeout(r, 20));
    const fuera = TEXTO.replace('"prueba"', '"desde-fuera"');
    writeFileSync(join(dir, "proyecto.json"), fuera);
    const r = await put("proyecto.json", TEXTO, { "if-match": s });
    expect(r.status).toBe(412);
    expect(readFileSync(join(dir, "proyecto.json"), "utf8")).toBe(fuera);
    // Sobrescribir después de avisar
    const f = await put("proyecto.json", TEXTO, { "x-forzar": "si" });
    expect(f.status).toBe(200);
    expect(readFileSync(join(dir, "proyecto.json"), "utf8")).toBe(TEXTO);
  });

  it("sin If-Match no se escribe", async () => {
    expect((await put("proyecto.json", TEXTO, {})).status).toBe(412);
  });

  it("otro fichero, uno fuera de la carpeta o dentro de .fem/: 403", async () => {
    expect((await put("otro.json", TEXTO, { "x-forzar": "si" })).status).toBe(403);
    expect((await put("..%2Fproyecto.json", TEXTO, { "x-forzar": "si" })).status).toBe(403);
    expect((await put(".fem%2Fproyecto.json", TEXTO, { "x-forzar": "si" })).status).toBe(403);
    expect(existsSync(join(dir, ".fem", "proyecto.json"))).toBe(false);
  });

  it("desde otra web (otro Origin, o sin él) o con otro Host: 403", async () => {
    const s = await etag();
    for (const cab of [{ origin: "http://evil.example" }, { origin: "null" }, {}] as Record<string, string>[])
      expect((await fetch(base + "proyecto.json", { method: "PUT", body: TEXTO, headers: { "if-match": s, ...cab } })).status).toBe(403);
  });

  it("un texto que no es un proyecto válido: 422 y no se escribe", async () => {
    const antes = readFileSync(join(dir, "proyecto.json"), "utf8");
    const r = await put("proyecto.json", '{"esquema":"concreta-fem/proyecto@1","modelo":{"plantas":"no"}}', { "x-forzar": "si" });
    expect(r.status).toBe(422);
    expect(readFileSync(join(dir, "proyecto.json"), "utf8")).toBe(antes);
  });

  it("GET y HEAD siguen como en V1", async () => {
    expect((await fetch(base + "proyecto.json")).status).toBe(200);
    expect((await fetch(base + "no-existe.json", { method: "HEAD" })).headers.get("x-existe")).toBe("no");
    expect((await fetch(base + "..%2F..%2Fsecreto", {})).status).toBe(404);
  });
});
