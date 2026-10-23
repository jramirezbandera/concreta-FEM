/**
 * La sesión diferida del visor (`Sesion.abrir(…, { diferir: true })`): tras editar, la app dibuja lo
 * que sólo necesita el modelo físico sin esperar a la compilación (en el edificio objetivo con vigas,
 * ~3 s). Se comprueba que:
 * - la huella sin compilar es la de la compilación;
 * - la planta y el alzado del modelo y de las cargas, el alámbrico, las cargas en el 3D, elegir y la
 *   ventana, y el sólido sin paños no compilan, y dan lo mismo que la sesión compilada;
 * - el estado sin compilar dice `compilando` y lo que da es lo del estado completo;
 * - tras compilar, el estado es el de la sesión compilada; y lo que necesita la compilación (los
 *   diagnósticos, el sólido con paños) compila solo;
 * - el atendedor del worker contesta `abrir` con `diferir` sin compilar y `compilar` con el estado.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compilar } from "../compilador/compilar.ts";
import { sha256 } from "../compilador/huella.ts";
import { ejesDe } from "../compilador/ejes.ts";
import { leerProyecto } from "../agente/proyecto.ts";
import { Atendedor } from "./atender.ts";
import { Sesion } from "./sesion.ts";
import { solido } from "./solido.ts";
import type { Escena } from "../agente/render/escena.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const MOTOR = sha256(new Uint8Array(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"))));
const PROYECTOS: [string, string][] = [
  ["ejemplo", ".claude/skills/fem/ejemplo.json"],
  ["1022", "validacion/a2/agente/1022/proyecto.json"],
  ["nucleo", "validacion/a2/agente/nucleo/proyecto.json"],
  ["vivienda", "ejemplos/vivienda/proyecto.json"],
  ["muestrario (paños)", "ejemplos/muestrario/proyecto.json"],
];

const abrir = (texto: string, diferir: boolean): Sesion => {
  const a = Sesion.abrir(texto, MOTOR, { diferir });
  if (!a.valido) throw new Error(JSON.stringify(a.diagnosticos));
  return a.sesion;
};
const valor = <T>(r: { valido: true; valor: T } | { valido: false; diagnosticos: unknown }): T => {
  if (!r.valido) throw new Error(JSON.stringify(r.diagnosticos));
  return r.valor;
};

describe.each(PROYECTOS)("sesión diferida con %s", (_nombre, ruta) => {
  const texto = readFileSync(join(RAIZ, ruta), "utf8");

  it("dibuja el modelo físico sin compilar, igual que compilada; compila al pedir el estado, con el mismo", () => {
    const d = abrir(texto, true);
    const c = abrir(texto, false);
    expect(d.compilada).toBe(false);
    expect(c.compilada).toBe(true);
    // La huella sin compilar es la de la compilación
    expect(d.huella).toBe(c.huella);
    expect(d.huella).toBe(compilar(d.proyecto.modelo, d.proyecto.opciones).huella);

    // El estado sin compilar: lo que da es lo del completo
    const e0 = d.estado({ sinCompilar: true });
    const ec = c.estado();
    expect(e0.compilando).toBe(true);
    expect(ec.compilando).toBeUndefined();
    expect(e0.compila).toBe(false);
    for (const k of ["huella", "nombre", "descripcion", "casos", "ejes", "vistas"] as const) expect(e0[k], k).toEqual(ec[k]);
    expect(e0.plantas.map(({ avisos: _, errores: __, ...p }) => p)).toEqual(ec.plantas.map(({ avisos: _, errores: __, ...p }) => p));
    expect(ec.diagnosticos).toEqual(expect.arrayContaining(e0.diagnosticos));

    // Lo que sólo necesita el modelo físico
    const f = d.proyecto.modelo;
    const caso = f.casos[0]?.id;
    for (const p of f.plantas) {
      expect(valor(d.escenaA4(p.id, { vista: "modelo" }))).toEqual(valor(c.escenaA4(p.id, { vista: "modelo" })));
      expect(valor(d.escena(p.id, { vista: "modelo" }))).toEqual(valor(c.escena(p.id, { vista: "modelo" })));
      if (caso) expect(valor(d.escenaA4(p.id, { vista: "cargas", caso }))).toEqual(valor(c.escenaA4(p.id, { vista: "cargas", caso })));
      const fu = { tipo: "planta" as const, planta: p.id, vista: { vista: "modelo" as const } };
      const caja = (valor(d.escenaA4(p.id, { vista: "modelo" })) as Escena).caja;
      expect(d.ventana(fu, caja, "toca")).toEqual(c.ventana(fu, caja, "toca"));
      const centro = [(caja[0] + caja[2]) / 2, (caja[1] + caja[3]) / 2] as const;
      expect(d.elegir(fu, centro, 1)).toEqual(c.elegir(fu, centro, 1));
    }
    const eje = ejesDe(f).ejes[0];
    if (eje) {
      expect(valor(d.alzado({ eje: eje.id }))).toEqual(valor(c.alzado({ eje: eje.id })));
      if (caso) expect(valor(d.alzadoA4({ eje: eje.id }, undefined, undefined, { caso }))).toEqual(valor(c.alzadoA4({ eje: eje.id }, undefined, undefined, { caso })));
    }
    if (caso) expect(valor(d.cargas3D(caso))).toEqual(valor(c.cargas3D(caso)));
    expect(d.origen3D).toEqual(c.origen3D);
    if (!f.panos?.length) expect(d.solido()).toEqual(c.solido());
    expect(d.compilada).toBe(false);

    // Lo que necesita la compilación compila solo, y el estado es el de la sesión compilada
    if (f.panos?.length) {
      expect(d.solido()).toEqual(c.solido());
      expect(d.compilada).toBe(true);
    }
    expect(d.estado()).toEqual(ec);
    expect(d.compilada).toBe(true);
    expect(d.estado({ sinCompilar: true })).toEqual(ec);
  }, 120_000);

  it("el sólido sin paños no depende de la compilación", () => {
    const l = leerProyecto(texto);
    if (!l.valido) throw new Error("no válido");
    const f = l.proyecto.modelo;
    if (f.panos?.length) return;
    const c = compilar(f, l.proyecto.opciones);
    if (!c.valido) throw new Error("no compila");
    const o = abrir(texto, true).origen3D;
    expect(solido(f, o, null)).toEqual(solido(f, o, c));
  }, 120_000);
});

describe("sesión diferida de un modelo que no compila", () => {
  it("dibuja sin compilar y, al compilar, dice que no compila con la misma huella", () => {
    const l = leerProyecto(readFileSync(join(RAIZ, ".claude/skills/fem/ejemplo.json"), "utf8"));
    if (!l.valido) throw new Error("no válido");
    // Una viga con una sección que no existe: pasa el esquema, no compila
    const p = structuredClone(l.proyecto);
    p.modelo.vigas![0]!.seccion = "NO-EXISTE";
    const texto = JSON.stringify(p);
    const d = abrir(texto, true);
    const planta = p.modelo.plantas.find((x) => x.altura !== null)!.id;
    expect(valor(d.escenaA4(planta, { vista: "modelo" })).primitivas.length).toBeGreaterThan(0);
    expect(d.compilada).toBe(false);
    const e = d.estado();
    expect(e.compila).toBe(false);
    expect(e.compilando).toBeUndefined();
    expect(e.diagnosticos.some((x) => x.severidad === "error")).toBe(true);
    expect(e.huella).toBe(d.estado({ sinCompilar: true }).huella);
    expect(e).toEqual(abrir(texto, false).estado());
  });
});

describe("el atendedor del worker con diferir", () => {
  it("abrir con diferir contesta sin compilar; compilar da el estado completo", async () => {
    const texto = readFileSync(join(RAIZ, "validacion/a2/agente/1022/proyecto.json"), "utf8");
    const at = new Atendedor(MOTOR);
    const a = await at.atender({ tipo: "abrir", texto, diferir: true });
    if (!a.ok) throw new Error("no abre");
    const e0 = a.valor as ReturnType<Sesion["estado"]>;
    expect(e0.compilando).toBe(true);
    const huella = at.huella;
    expect(huella).toBe(e0.huella);
    const planta = e0.plantas.find((x) => x.altura !== null)!.id;
    expect((await at.atender({ tipo: "escena", planta, vista: { vista: "modelo" } })).ok).toBe(true);
    const k = await at.atender({ tipo: "compilar" });
    if (!k.ok) throw new Error("no compila");
    expect(k.valor).toEqual(abrir(texto, false).estado());
    expect(at.huella).toBe(huella);
    // Sin diferir, como siempre: abrir compila
    const b = await new Atendedor(MOTOR).atender({ tipo: "abrir", texto });
    expect(b.ok && b.valor).toEqual(k.valor);
  }, 120_000);
});
