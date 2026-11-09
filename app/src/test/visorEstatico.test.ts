// @vitest-environment node
/**
 * El visor sin Vite (`app/visorEstatico.ts`, `docs/fem3d/agente.md` §13.4): la app construida y la
 * carpeta del proyecto, con lo de fuera cerrado. La prueba de extremo a extremo, con el paquete de
 * Claude Desktop y Chrome, es `validacion/mcpb/probar.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proyectoNuevo } from "../../../src/editor/plantilla.ts";
import { serializar } from "../../../src/editor/serializar.ts";
import { abrirVisorEstatico, type VisorEstatico } from "../../visorEstatico.ts";

let dir: string;
let v: VisorEstatico;
let origen: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fem-estatico-"));
  const dist = join(dir, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><div id=root></div>");
  writeFileSync(join(dist, "sw.js"), "self.x = 1");
  writeFileSync(join(dist, "assets", "nucleo.wasm"), new Uint8Array([0, 97, 115, 109]));
  writeFileSync(join(dir, "secreto.txt"), "no");
  const obra = join(dir, "obra");
  mkdirSync(obra);
  writeFileSync(join(obra, "proyecto.json"), serializar(proyectoNuevo("prueba")));
  v = await abrirVisorEstatico(dist, join(obra, "proyecto.json"));
  origen = new URL(v.url).origin;
});
afterAll(() => {
  v?.cerrar();
  rmSync(dir, { recursive: true, force: true });
});

describe("visorEstatico", () => {
  it("da la URL que abre el proyecto en 127.0.0.1", () => {
    expect(v.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?proyecto=%2Fproyecto%2Fproyecto\.json$/);
  });
  it("sirve la app, con el WASM como application/wasm", async () => {
    const i = await fetch(`${origen}/`);
    expect(i.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await i.text()).toContain("root");
    const w = await fetch(`${origen}/assets/nucleo.wasm`);
    expect(w.headers.get("content-type")).toBe("application/wasm");
  });
  it("y la carpeta del proyecto en /proyecto/, con las reglas de servidor.ts", async () => {
    const p = await fetch(`${origen}/proyecto/proyecto.json`);
    expect(p.status).toBe(200);
    expect(((await p.json()) as { modelo?: unknown }).modelo).toBeDefined();
    const sinOrigen = await fetch(`${origen}/proyecto/proyecto.json`, { method: "PUT", body: "{}" });
    expect(sinOrigen.status).toBe(403);
  });
  it("no sirve el service worker, ni nada fuera de la app, ni escribe", async () => {
    expect((await fetch(`${origen}/sw.js`)).status).toBe(404);
    expect((await fetch(`${origen}/..%2Fsecreto.txt`)).status).toBe(404);
    expect((await fetch(`${origen}/no-existe.js`)).status).toBe(404);
    expect((await fetch(`${origen}/index.html`, { method: "PUT", body: "x" })).status).toBe(405);
  });
});
