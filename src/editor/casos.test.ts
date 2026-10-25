/**
 * GE2 y GE3 (`docs/fem3d/gestores.md` §3.4 y §3.5), la parte pura:
 * - Los casos típicos son lo que se escribiría en la tabla Casos (la misma fila da el mismo objeto).
 * - El juego de hipótesis reutiliza lo que ya está (el peso propio, una acción igual) y crea lo demás
 *   con ids libres; el resultado genera las combinaciones CTE (el viento, una familia de cuatro).
 * - Añadir plantas encima o debajo deja las alturas y las cotas que da CYPECAD, en un paso.
 */
import { describe, expect, it } from "vitest";
import type { Proyecto } from "../agente/proyecto.ts";
import { generarCombinaciones, type CasoCarga } from "../combinaciones/generador.ts";
import { psiDe } from "../combinaciones/psi.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { CASOS_TIPICOS, casosDelJuego, casoTipico, crearCasos, describirCaso, JUEGO_DEFECTO, psiCaso } from "./casos.ts";
import { comoUna } from "./gestores.ts";
import { aplicar, type Operacion } from "./operaciones.ts";
import { insertarPlantas } from "./plantas.ts";
import { proyectoNuevo } from "./plantilla.ts";
import { referenciasRotas } from "./referencias.ts";
import { contexto, DEF_TABLAS } from "./tablas.ts";

const aplicado = (p: Proyecto, o: Operacion | readonly Operacion[]): Proyecto => {
  const r = aplicar(p, Array.isArray(o) ? comoUna(o) : (o as Operacion));
  if (!r.ok) throw new Error(r.errores.map((e) => e.mensaje).join("\n"));
  return r.proyecto;
};

describe("GE2: casos típicos", () => {
  it("cada típico es lo que da su fila en la tabla Casos", () => {
    const def = DEF_TABLAS.casos;
    const ctx = contexto(proyectoNuevo().modelo);
    for (const t of CASOS_TIPICOS) {
      const l = def.objeto(def.fila(t.caso as never, ctx), ctx);
      expect(l.ok ? l.objeto : l.errores, t.clave).toEqual(t.caso);
    }
  });

  it("el juego por defecto reutiliza G y Q de la plantilla y crea el viento en cuatro direcciones", () => {
    const p = proyectoNuevo();
    const c = crearCasos(p.modelo, casosDelJuego(JUEGO_DEFECTO).map((t) => t.caso));
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.reutilizados).toEqual(["G", "Q"]);
    expect(c.nuevos).toEqual(["W+X", "W-X", "W+Y", "W-Y"]);
    expect(c.ids).toEqual(["G", "Q", "W+X", "W-X", "W+Y", "W-Y"]);
    const q = aplicado(p, c.operaciones);
    expect(referenciasRotas(q.modelo)).toEqual([]);
    // Un segundo juego igual no crea nada
    const otra = crearCasos(q.modelo, casosDelJuego(JUEGO_DEFECTO).map((t) => t.caso));
    expect(otra.ok && otra.operaciones).toEqual([]);

    // Las combinaciones CTE: en ninguna van dos vientos a la vez
    const casos: CasoCarga[] = q.modelo.casos!.map((x) => {
      const { psi, ...a } = x.accion!;
      return { ...a, ...(psi !== undefined ? { psi: psiDe(psi) } : {}), id: x.id };
    });
    const elu = generarCombinaciones(casos, { situaciones: ["ELU-PT"] });
    expect(elu.length).toBeGreaterThan(0);
    for (const k of elu) expect([2, 3, 4, 5].filter((i) => k.factores[i] !== 0).length).toBeLessThanOrEqual(1);
    expect(elu.some((k) => k.factores[2] !== 0)).toBe(true);
  });

  it("con todo: cargas muertas, nieve de altura y sismo; ids libres si el propuesto está cogido", () => {
    let p = proyectoNuevo();
    // Un pilar «EX» ocupa el id del sismo X: los ids son únicos en todo el modelo
    p = aplicado(p, [
      { op: "crear", coleccion: "secciones", objeto: { id: "P30x30", forma: "rectangular", b: 0.3, h: 0.3, material: "HA-30" } },
      { op: "crear", coleccion: "pilares", objeto: { id: "EX", x: 0, y: 0, desde: "Cim", hasta: "N1", seccion: "P30x30" } },
    ]);
    const j = { ...JUEGO_DEFECTO, cargasMuertas: true, uso: "C" as const, nieve: "mas-de-1000" as const, viento: false, sismo: true };
    const c = crearCasos(p.modelo, casosDelJuego(j).map((t) => t.caso));
    if (!c.ok) throw new Error(c.mensaje);
    expect(c.nuevos).toEqual(["CM", "QC", "S", "EX-2", "EY"]);
    const q = aplicado(p, c.operaciones);
    expect(q.modelo.casos!.find((x) => x.id === "S")!.accion).toEqual({ tipo: "S", psi: "nieve-mas-de-1000", duracion: "media" });
    expect(q.modelo.casos!.find((x) => x.id === "EX-2")!.accion).toEqual({ tipo: "E", direccion: "X" });
  });

  it("el peso propio va a un caso: el típico G reutiliza el que lo lleve, aunque se llame de otra forma", () => {
    const p = aplicado(proyectoNuevo(), { op: "cambiar", coleccion: "casos", id: "G", objeto: { id: "PP", nombre: "Peso propio", pesoPropio: true, accion: { tipo: "G" } } });
    const c = crearCasos(p.modelo, [casoTipico("G")!.caso]);
    expect(c.ok && c.ids).toEqual(["PP"]);
  });

  it("describe cada caso en pocas palabras, con sus ψ", () => {
    const d = (k: string) => describirCaso(casoTipico(k)!.caso);
    expect(d("G")).toBe("G · peso propio");
    expect(d("CM")).toBe("G · permanente");
    expect(d("QA")).toBe("Q · uso A");
    expect(d("S1000")).toBe("S · nieve > 1000 m");
    expect(d("W-Y")).toBe("W · viento -Y · familia W");
    expect(d("EX")).toBe("E · sismo X");
    expect(describirCaso({ id: "X" })).toBe("sin acción: fuera de las combinaciones");
    expect(psiCaso(casoTipico("QA")!.caso)).toBe("0,7 / 0,5 / 0,3");
    expect(psiCaso(casoTipico("G")!.caso)).toBeNull();
  });
});

describe("GE3: añadir plantas", () => {
  const cotas = (p: Proyecto) => Object.fromEntries(p.modelo.plantas.map((x, i) => [x.id, cotasPlantas(p.modelo.plantas)[i]]));

  it("encima de la de arriba: las nuevas encima, con su altura", () => {
    const p = proyectoNuevo();
    const r = insertarPlantas(p.modelo, { n: 2, altura: 3, donde: "encima", de: "N1" });
    if (!r.ok) throw new Error(r.mensaje);
    expect(r.ids).toEqual(["N2", "N3"]);
    const q = aplicado(p, r.operacion);
    expect(q.modelo.plantas).toEqual(r.plantas);
    expect(q.modelo.plantas.map((x) => [x.id, x.altura])).toEqual([["N3", null], ["N2", 3], ["N1", 3], ["Cim", 3]]);
    expect(cotas(q)).toEqual({ N3: 9, N2: 6, N1: 3, Cim: 0 });
  });

  it("encima de una intermedia: lo de encima sube n·h y conserva su altura", () => {
    const p = proyectoNuevo();
    const r = insertarPlantas(p.modelo, { n: 1, altura: 4, donde: "encima", de: "Cim", tipo: "sotano" });
    if (!r.ok) throw new Error(r.mensaje);
    const q = aplicado(p, r.operacion);
    expect(q.modelo.plantas).toEqual([{ id: "N1", altura: null }, { id: "N2", tipo: "sotano", altura: 3 }, { id: "Cim", altura: 4 }]);
    expect(q.modelo.plantas).toEqual(r.plantas);
  });

  it("debajo: entre ella y la de debajo, o debajo del todo", () => {
    const p = proyectoNuevo();
    const r = insertarPlantas(p.modelo, { n: 1, altura: 2.5, donde: "debajo", de: "N1", prefijo: "E" });
    if (!r.ok) throw new Error(r.mensaje);
    const q = aplicado(p, r.operacion);
    expect(q.modelo.plantas.map((x) => [x.id, x.altura])).toEqual([["N1", null], ["E1", 2.5], ["Cim", 3]]);
    expect(cotas(q)).toEqual({ N1: 5.5, E1: 3, Cim: 0 });
    const s = insertarPlantas(p.modelo, { n: 2, altura: 1, donde: "debajo", de: "Cim" });
    if (!s.ok) throw new Error(s.mensaje);
    const t = aplicado(p, s.operacion);
    expect(t.modelo.plantas.map((x) => [x.id, x.altura])).toEqual([["N1", null], ["Cim", 3], ["N2", 1], ["N3", 1]]);
    expect(t.modelo.plantas).toEqual(s.plantas);
  });

  it("lo que no vale se dice", () => {
    const m = proyectoNuevo().modelo;
    expect(insertarPlantas(m, { n: 0, altura: 3, donde: "encima", de: "N1" }).ok).toBe(false);
    expect(insertarPlantas(m, { n: 1, altura: 0, donde: "encima", de: "N1" }).ok).toBe(false);
    expect(insertarPlantas(m, { n: 1, altura: 3, donde: "encima", de: "N9" }).ok).toBe(false);
  });
});
