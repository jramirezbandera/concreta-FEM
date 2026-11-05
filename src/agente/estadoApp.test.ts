/**
 * Lo que se mira en la app, para el agente (`docs/fem3d/agente.md` §13): el formato de
 * `.fem/app.json` y `fem seleccion`, que lo lee con cada objeto tal como está en el fichero.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ejecutar } from "../../cli/ordenes.ts";
import { huellaSinCompilar } from "../compilador/compilar.ts";
import { claveEstadoApp, leerEstadoApp, seleccionApp, textoEstadoApp } from "./estadoApp.ts";
import { leerProyecto, type Proyecto } from "./proyecto.ts";

const EJEMPLO = readFileSync(new URL("../../.claude/skills/fem/ejemplo.json", import.meta.url), "utf8");
const P = (leerProyecto(EJEMPLO) as { proyecto: Proyecto }).proyecto;
const HUELLA = huellaSinCompilar(P.modelo, P.opciones);
const pilar = P.modelo.pilares![0]!.id;
const viga = P.modelo.vigas![0]!.id;
const base = { proyecto: "proyecto.json", huella: HUELLA, sinGuardar: false, espacio: "modelo", planta: P.modelo.plantas[0]!.id, elegidos: [viga, pilar] };
const carpetas: string[] = [];
afterAll(() => carpetas.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("el estado de la app", () => {
  it("ida y vuelta, y la clave no depende de la fecha", () => {
    const t = textoEstadoApp(base, new Date("2026-11-05T10:00:00Z"));
    expect(leerEstadoApp(t)).toEqual({ esquema: "concreta-fem/app@1", fecha: "2026-11-05T10:00:00.000Z", ...base });
    expect(claveEstadoApp(base)).toBe(claveEstadoApp({ ...base }));
    expect(claveEstadoApp(base)).not.toBe(claveEstadoApp({ ...base, elegidos: [pilar] }));
    expect(leerEstadoApp("{}")).toBeNull();
    expect(leerEstadoApp("no")).toBeNull();
  });

  it("lo elegido, con cada objeto del fichero; lo que no está y la versión distinta se avisan", () => {
    const e = leerEstadoApp(textoEstadoApp(base, new Date("2026-11-05T10:00:00Z")))!;
    const s = seleccionApp(e, P, HUELLA, new Date("2026-11-05T10:00:30Z"));
    expect(s.elegidos.map((x) => [x.id, x.coleccion])).toEqual([[viga, "vigas"], [pilar, "pilares"]]);
    expect(s.elegidos[1]!.objeto).toEqual(P.modelo.pilares![0]);
    expect(s).toMatchObject({ antiguedad: 30, alDia: true, avisos: [], noEnElFichero: [] });
    const otra = seleccionApp({ ...e, elegidos: ["NUEVO"], huella: "x" }, P, HUELLA, new Date());
    expect(otra.alDia).toBe(false);
    expect(otra.noEnElFichero).toEqual(["NUEVO"]);
    expect(otra.avisos.length).toBe(2);
    expect(seleccionApp({ ...e, sinGuardar: true }, P, HUELLA, new Date()).avisos[0]).toContain("sin guardar");
  });

  it("fem seleccion lee .fem/app.json junto al proyecto", async () => {
    const d = mkdtempSync(join(tmpdir(), "fem-app-"));
    carpetas.push(d);
    const ruta = join(d, "proyecto.json");
    writeFileSync(ruta, EJEMPLO);
    const sin = await ejecutar(["seleccion", ruta]);
    expect(sin.codigo).toBe(1);
    expect(JSON.stringify(sin.json)).toContain("Pasar a una carpeta");
    mkdirSync(join(d, ".fem"));
    writeFileSync(join(d, ".fem", "app.json"), textoEstadoApp(base, new Date()));
    const r = await ejecutar(["seleccion", ruta]);
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ ok: true, valor: { planta: base.planta, alDia: true, elegidos: [{ id: viga, coleccion: "vigas" }, { id: pilar, coleccion: "pilares" }] }, diagnosticos: [] });
    writeFileSync(join(d, ".fem", "app.json"), textoEstadoApp({ ...base, proyecto: "otro.json" }, new Date()));
    expect((await ejecutar(["seleccion", ruta])).codigo).toBe(1);
  });
});
