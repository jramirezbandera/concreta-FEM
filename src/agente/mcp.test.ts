/**
 * El servidor MCP (`cli/mcp.ts`, `docs/fem3d/agente.md` §13.3): el protocolo (initialize, lista de
 * herramientas, recursos), las órdenes con la misma salida que la CLI, el fichero (leer, editar y
 * escribir con su sello, sin pisar lo que cambió) y, por stdio, un intercambio de punta a punta.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { atender, HERRAMIENTAS, llamar, VERSIONES_PROTOCOLO } from "../../cli/mcp.ts";
import { ejecutar } from "../../cli/ordenes.ts";
import { leerProyecto, type Proyecto } from "./proyecto.ts";
import { serializar } from "../editor/serializar.ts";

const REPO = resolve(import.meta.dirname, "..", "..");
const EJEMPLO = readFileSync(join(REPO, ".claude", "skills", "fem", "ejemplo.json"), "utf8");
const carpetas: string[] = [];
afterAll(() => carpetas.forEach((d) => rmSync(d, { recursive: true, force: true })));
function obra(): string {
  const d = mkdtempSync(join(tmpdir(), "fem-mcp-"));
  carpetas.push(d);
  const f = join(d, "proyecto.json");
  writeFileSync(f, EJEMPLO);
  return f;
}
const json = (r: Awaited<ReturnType<typeof llamar>>, i = 0) => JSON.parse((r.content[i] as { text: string }).text) as Record<string, unknown>;

describe("servidor MCP", () => {
  it("initialize con la versión del cliente, las instrucciones (la skill) y la lista de herramientas", async () => {
    const r = (await atender({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "prueba", version: "1" } } }))!;
    const res = r.result as { protocolVersion: string; serverInfo: { name: string }; instructions: string; capabilities: Record<string, unknown> };
    expect(res.protocolVersion).toBe("2025-03-26");
    expect(res.serverInfo.name).toBe("concreta-fem");
    expect(res.instructions).toContain("Antes de escribir el fichero");
    expect(res.instructions).not.toMatch(/^---/);
    expect(((await atender({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }))!.result as { protocolVersion: string }).protocolVersion).toBe(VERSIONES_PROTOCOLO[0]);
    // Las notificaciones no se contestan
    expect(await atender({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const l = (await atender({ jsonrpc: "2.0", id: 3, method: "tools/list" }))!.result as { tools: { name: string; inputSchema: { type: string } }[] };
    expect(l.tools.map((t) => t.name)).toEqual(HERRAMIENTAS.map((h) => h.name));
    for (const t of l.tools) {
      expect(t.name).toMatch(/^[a-z_]{1,64}$/);
      expect(t.inputSchema.type).toBe("object");
    }
    expect((await atender({ jsonrpc: "2.0", id: 4, method: "nada" }))!.error).toMatchObject({ code: -32601 });
    const rec = (await atender({ jsonrpc: "2.0", id: 5, method: "resources/read", params: { uri: "fem://ejemplo" } }))!.result as { contents: { text: string }[] };
    expect(rec.contents[0]!.text).toBe(EJEMPLO);
  });

  it("validar da lo mismo que la CLI, y una ruta relativa se rechaza", async () => {
    const f = obra();
    const r = await llamar("validar", { proyecto: f });
    expect(r.isError).toBeUndefined();
    const cli = await ejecutar(["validar", f]);
    expect(json(r)).toMatchObject({ ...JSON.parse(JSON.stringify(cli.json)), ok: true });
    expect((await llamar("validar", { proyecto: "proyecto.json" })).isError).toBe(true);
  });

  it("leer, editar y escribir con el sello: lo que cambió desde la lectura no se pisa", async () => {
    const f = obra();
    const l = await llamar("leer_proyecto", { proyecto: f });
    const { sello } = json(l) as { sello: string };
    const p = (leerProyecto((l.content[1] as { text: string }).text) as { proyecto: Proyecto }).proyecto;
    const a = p.modelo.pilares![0]!;
    const e = await llamar("editar", { proyecto: f, sello, operaciones: [{ op: "cambiar", coleccion: "pilares", id: a.id, objeto: { ...a, x: a.x + 0.1 } }] });
    expect(e.isError).toBeUndefined();
    const escrito = readFileSync(f, "utf8");
    expect((leerProyecto(escrito) as { proyecto: Proyecto }).proyecto.modelo.pilares![0]!.x).toBe(a.x + 0.1);
    expect(readFileSync(`${f}.bak`, "utf8")).toBe(EJEMPLO);
    // El sello de antes ya no vale: ni editar ni escribir
    expect((await llamar("editar", { proyecto: f, sello, operaciones: [{ op: "datos", nombre: "x" }] })).isError).toBe(true);
    expect((await llamar("escribir_proyecto", { proyecto: f, sello, texto: EJEMPLO })).isError).toBe(true);
    expect((await llamar("escribir_proyecto", { proyecto: f, texto: EJEMPLO })).isError).toBe(true);
    expect(readFileSync(f, "utf8")).toBe(escrito);
    // Con el sello nuevo, sí; en la forma canónica
    const s2 = (json(e) as { sello: string }).sello;
    expect((await llamar("escribir_proyecto", { proyecto: f, sello: s2, texto: EJEMPLO })).isError).toBeUndefined();
    expect(readFileSync(f, "utf8")).toBe(serializar((leerProyecto(EJEMPLO) as { proyecto: Proyecto }).proyecto));
    // Una operación que rompería una referencia no se aplica
    const b = await llamar("editar", { proyecto: f, operaciones: [{ op: "borrar", ids: [p.modelo.secciones[0]!.id] }] });
    expect(b.isError).toBe(true);
    // Un fichero nuevo, sin sello; uno que no cumple el esquema, no
    const nuevo = join(f, "..", "otro.json");
    expect((await llamar("escribir_proyecto", { proyecto: nuevo, texto: "{}" })).isError).toBe(true);
    expect(existsSync(nuevo)).toBe(false);
    expect((await llamar("escribir_proyecto", { proyecto: nuevo, texto: EJEMPLO })).isError).toBeUndefined();
  });

  it("render devuelve las PNG y la lista de figuras", async () => {
    const f = obra();
    const r = await llamar("render", { proyecto: f, vista: ["modelo"], imagenes: 1 });
    expect(r.isError).toBeUndefined();
    expect(json(r)).toMatchObject({ ok: true, carpetaProyecto: join(f, "..") });
    expect(r.content.filter((c) => c.type === "image")).toHaveLength(1);
    expect(r.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
  }, 60_000);

  it("por stdio: initialize y tools/list, una línea por mensaje y nada más por la salida", async () => {
    const p = spawn(process.execPath.includes("bun") ? process.execPath : "bun", [join(REPO, "cli", "mcp.ts")], { stdio: ["pipe", "pipe", "pipe"] });
    const lineas: string[] = [];
    let resto = "";
    const esperar = (n: number) =>
      new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error(`sin respuesta: ${resto}`)), 30_000);
        const mirar = () => {
          if (lineas.length >= n) {
            clearTimeout(t);
            res();
          }
        };
        p.stdout.on("data", (d: Buffer) => {
          resto += d.toString();
          let i: number;
          while ((i = resto.indexOf("\n")) >= 0) {
            lineas.push(resto.slice(0, i));
            resto = resto.slice(i + 1);
          }
          mirar();
        });
      });
    const listo = esperar(2);
    p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } })}\n`);
    p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
    await listo;
    p.stdin.end();
    const [a, b] = lineas.map((x) => JSON.parse(x) as { id: number; result: Record<string, unknown> });
    expect(a!.id).toBe(1);
    expect(a!.result.protocolVersion).toBe("2025-06-18");
    expect(b!.id).toBe(2);
    expect((b!.result.tools as unknown[]).length).toBe(HERRAMIENTAS.length);
    await new Promise((r) => p.on("exit", r));
    expect(lineas).toHaveLength(2);
  }, 60_000);
});
