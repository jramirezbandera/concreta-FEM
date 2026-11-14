/**
 * Fase LC2 (`docs/fem3d/losa-cimentacion.md` §9): la losa de cimentación en el editor.
 * - La tabla Forjados tiene el tipo «cimentación» (una losa maciza con `cimentacion`) con las columnas
 *   balasto, horizontal y σ admisible: cada losa sale igual de su fila, y lo que no aplica a otro tipo
 *   tiene que ir vacío.
 * - El balasto admite su unidad escrita y, sin ella, no deja pasar un número que no es un terreno.
 * - La herramienta Forjado con el tipo cimentación da byte a byte lo de su fila de la tabla, sin
 *   zunchos, y sin balasto dice qué falta.
 */
import { describe, expect, it } from "vitest";
import type { Proyecto } from "../agente/proyecto.ts";
import { compilar } from "../compilador/compilar.ts";
import type { Losa, ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { escribirFila } from "./edicion.ts";
import { aplicar } from "./operaciones.ts";
import { proyectoNuevo } from "./plantilla.ts";
import { serializar } from "./serializar.ts";
import { indiceEnganches } from "./dibujo/enganches.ts";
import { ESTADO_INICIAL, paso, type ContextoHerramienta, type EstadoHerramienta, type Plantillas } from "./dibujo/herramientas.ts";
import { contexto, DEF_TABLAS, filaConValor, leerBalasto } from "./tablas.ts";

const def = DEF_TABLAS.forjados;
const rect = (a: number, b: number): Vec2[] => [
  [0, 0],
  [a, 0],
  [a, b],
  [0, b],
];

function modelo(losas: Losa[]): ModeloFisico {
  const p = proyectoNuevo("lc2").modelo;
  return { ...p, losas };
}

describe("LC2: la tabla Forjados con el tipo cimentación", () => {
  const losas: Losa[] = [
    { id: "LC1", planta: "Cim", contorno: rect(10, 6), espesor: 0.6, material: "HA-30", cimentacion: { balasto: 40000 } },
    { id: "LC2", planta: "Cim", contorno: rect(10, 6), espesor: 0.8, material: "HA-30", cimentacion: { balasto: 25000, horizontal: { kh: 8000 }, tensionAdmisible: 200 } },
    { id: "LC3", planta: "Cim", contorno: rect(10, 6), espesor: 0.8, material: "HA-30", cimentacion: { balasto: 25000, horizontal: "coartado" } },
  ];
  const m = modelo(losas);
  const ctx = contexto(m);
  it("cada losa sale igual de su fila, con su tipo y sus tres columnas", () => {
    for (const l of losas) {
      const f = def.fila(l as never, ctx);
      expect(f.tipo).toBe("cimentacion");
      const o = def.objeto(f, ctx);
      expect(o.ok ? o.objeto : o.errores, l.id).toStrictEqual(l);
    }
    const f2 = def.fila(losas[1] as never, ctx);
    expect([f2.balasto, f2.horizontal, f2.tension]).toEqual(["25000", "8000", "200"]);
    expect(def.fila(losas[2] as never, ctx).horizontal).toBe("coartado");
    expect(def.fila(losas[0] as never, ctx).horizontal).toBe("");
  });
  it("el balasto es obligatorio; en otro tipo, sus columnas tienen que ir vacías", () => {
    const f = { ...def.fila(losas[0] as never, ctx), balasto: "" };
    const o = def.objeto(f, ctx);
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.errores.some((e) => e.columna === "balasto" && e.mensaje === "falta el dato")).toBe(true);
    const maciza = { ...def.fila(losas[0] as never, ctx), tipo: "maciza" };
    const om = def.objeto(maciza, ctx);
    expect(om.ok).toBe(false);
    if (!om.ok) expect(om.errores.map((e) => e.columna)).toContain("balasto");
    // Cambiar el tipo a maciza vacía lo que deja de aplicar
    const cambiada = filaConValor(def, def.fila(losas[1] as never, ctx), "tipo", "maciza");
    expect([cambiada.balasto, cambiada.horizontal, cambiada.tension]).toEqual(["", "", ""]);
    const ok = def.objeto(cambiada, ctx);
    expect(ok.ok ? (ok.objeto as unknown as Losa).cimentacion : "error").toBeUndefined();
  });
  it("el pp por defecto de una cimentación es γ·canto, como en una maciza", () => {
    const c = def.columnas.find((x) => x.clave === "pp")!;
    expect(c.defecto!(def.fila(losas[0] as never, ctx), ctx)).toBe("15 = γ·canto");
  });
});

describe("LC2: el balasto con su unidad", () => {
  it("kN/m³, MN/m³ y kg/cm³; sin unidad, lo que no es un terreno pide la suya", () => {
    expect(leerBalasto("40000")).toBe(40000);
    expect(leerBalasto("40 000")).toBe(40000);
    expect(leerBalasto("50 MN/m³")).toBe(50000);
    expect(leerBalasto("50 MN/m3")).toBe(50000);
    expect(leerBalasto("12000 kN/m³")).toBe(12000);
    expect(leerBalasto("5 kg/cm³")).toBeCloseTo(49033.25, 9);
    const r = leerBalasto("5");
    expect(typeof r).toBe("string");
    expect(r as string).toMatch(/kg\/cm³/);
    expect(leerBalasto("0")).toBeTypeOf("string");
    expect(leerBalasto("-3 MN/m³")).toBeTypeOf("string");
  });
  it("en la tabla, «4 kg/cm³» entra en kN/m³ y «4» no entra", () => {
    const m = modelo([]);
    const ctx = contexto(m);
    const fila = { id: "LC", planta: "Cim", tipo: "cimentacion", contorno: "0 0; 10 0; 10 6; 0 6", espesor: "0,6", material: "HA-30", balasto: "4 kg/cm³" };
    const o = def.objeto(fila, ctx);
    expect(o.ok ? (o.objeto as unknown as Losa).cimentacion!.balasto : o.errores).toBeCloseTo(39226.6, 9);
    const mal = def.objeto({ ...fila, balasto: "4" }, ctx);
    expect(mal.ok).toBe(false);
    // El tipo, también con su tilde (escrito o pegado)
    const tilde = def.objeto({ ...fila, tipo: "Cimentación" }, ctx);
    expect(tilde.ok ? (tilde.objeto as unknown as Losa).cimentacion!.balasto : tilde.errores).toBeCloseTo(39226.6, 9);
    expect(def.columnas.find((c) => c.clave === "tipo")!.opciones!(ctx).find((o) => o.valor === "cimentacion")!.texto).toBe("cimentación");
  });
});

describe("LC2: la herramienta Forjado de tipo cimentación", () => {
  const conTabla = (p: Proyecto, fila: Record<string, string>) => {
    const a = escribirFila(p, "forjados", null, fila);
    if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
    return a.proyecto;
  };
  /** Dos pilares que arrancan en la cimentación. */
  function base(): Proyecto {
    const p0 = proyectoNuevo("lc2");
    return { ...p0, modelo: { ...p0.modelo, secciones: [{ id: "P30", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.3 }], pilares: [{ id: "P1", x: 2, y: 3, desde: "Cim", hasta: "N1", seccion: "P30" }, { id: "P2", x: 8, y: 3, desde: "Cim", hasta: "N1", seccion: "P30" }] } };
  }
  const dibujar = (p: Proyecto, plantillas: Plantillas) => {
    const ctx: ContextoHerramienta = { modelo: p.modelo, planta: "Cim", indice: indiceEnganches(p.modelo, "Cim"), plantillas };
    let e: EstadoHerramienta = ESTADO_INICIAL;
    for (const q of rect(10, 6)) e = paso("forjado", e, { tipo: "punto", p: q }, ctx).estado;
    return paso("forjado", e, { tipo: "terminar" }, ctx);
  };
  it("da lo de su fila de la tabla, sin zunchos, y compila con los pilares apoyados en ella", () => {
    const p = base();
    const r = dibujar(p, { pilar: {}, viga: {}, forjado: { modo: "poligono", tipo: "cimentacion", espesor: 0.6, material: "HA-30", balasto: 40000, kh: 8000, tensionAdmisible: 200 } });
    expect(r.error).toBeUndefined();
    const a = aplicar(p, r.hecho!.operacion);
    if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
    const t = conTabla(p, { planta: "Cim", tipo: "cimentacion", contorno: "0 0; 10 0; 10 6; 0 6", espesor: "0,6", material: "HA-30", balasto: "40000", horizontal: "8000", tension: "200" });
    expect(serializar(a.proyecto)).toBe(serializar(t));
    expect(a.proyecto.modelo.vigas ?? []).toEqual([]);
    const c = compilar(a.proyecto.modelo, a.proyecto.opciones);
    expect(c.valido, c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join(" ")).toBe(true);
    if (c.valido) expect(Object.keys(c.mapeo.cimentacion ?? {})).toEqual(["L1"]);
  });
  it("sin balasto, dice qué falta", () => {
    const r = dibujar(base(), { pilar: {}, viga: {}, forjado: { modo: "poligono", tipo: "cimentacion", espesor: 0.6, material: "HA-30" } });
    expect(r.error).toBe("Escriba en Propiedades el balasto del terreno (kN/m³).");
  });
});
