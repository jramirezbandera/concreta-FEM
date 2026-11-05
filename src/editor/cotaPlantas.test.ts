/**
 * Escribir la cota de una planta (de la primera prueba de un usuario externo: no veía qué ponía la
 * cimentación a −4,30). Las cotas no se guardan; `moverCota` cambia las alturas y los sótanos:
 * - en general, sólo se mueve ese forjado y las demás cotas se quedan;
 * - 0 hace de una planta la ±0,00 (las de debajo, sótanos), sin tocar las alturas;
 * - la ±0,00 sólo baja: pasa a sótano bajo la de encima, que es la ±0,00 nueva.
 */
import { describe, expect, it } from "vitest";
import { VERSION_ESQUEMA, type Proyecto } from "../agente/proyecto.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import type { ModeloFisico, Planta } from "../compilador/fisico.ts";
import { escribirFila, filas, pegar } from "./edicion.ts";
import { aplicar } from "./operaciones.ts";
import { conCambiosCota, moverCota, plantasEdificio } from "./plantas.ts";

/** Cubierta, dos plantas, planta baja y la cimentación (planta: es la ±0,00). */
const PLANTAS: Planta[] = [
  { id: "N4", altura: null },
  { id: "N3", altura: 3 },
  { id: "N2", altura: 3 },
  { id: "N1", altura: 3.3 },
  { id: "Cim", altura: 4.3 },
];

const modelo = (plantas: Planta[] = PLANTAS): ModeloFisico => ({ plantas, materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }], secciones: [], casos: [{ id: "G", pesoPropio: true }] });
const proyecto = (plantas?: Planta[]): Proyecto => ({ esquema: VERSION_ESQUEMA, modelo: modelo(plantas) });

/** Las plantas tras aplicar todos los cambios. */
function mover(plantas: readonly Planta[], id: string, cota: number): Planta[] {
  const r = moverCota(plantas, id, cota);
  if (!r.ok) throw new Error(r.mensaje);
  return plantas.map((p) => conCambiosCota(p, r.cambios));
}

const redondas = (ps: readonly Planta[]) => cotasPlantas(ps).map((c) => Math.round(c! * 1e9) / 1e9);

describe("moverCota", () => {
  it("mueve sólo ese forjado: cambian las alturas de sus dos tramos y las demás cotas se quedan", () => {
    expect(redondas(PLANTAS)).toEqual([13.6, 10.6, 7.6, 4.3, 0]);
    const ps = mover(PLANTAS, "N2", 8.2);
    expect(redondas(ps)).toEqual([13.6, 10.6, 8.2, 4.3, 0]);
    // Sin el ruido de restar cotas
    expect(ps.find((p) => p.id === "N2")!.altura).toBe(2.4);
    expect(ps.find((p) => p.id === "N1")!.altura).toBe(3.9);
    // La de arriba y la de abajo, sólo un tramo
    expect(redondas(mover(PLANTAS, "N4", 14.5))).toEqual([14.5, 10.6, 7.6, 4.3, 0]);
    expect(mover(PLANTAS, "N4", 14.5)[0]!.altura).toBeNull();
  });

  it("tiene que quedar entre la de encima y la de debajo", () => {
    const r = moverCota(PLANTAS, "N2", 11);
    expect(r).toEqual({ ok: false, mensaje: "Se mueve sólo el forjado de N2, así que su cota tiene que quedar entre la de N1 (+4,30) y la de N3 (+10,60). Para cambiar varias, cambie las alturas." });
    expect(moverCota(PLANTAS, "N2", 4.3).ok).toBe(false);
    expect(moverCota(PLANTAS, "N4", 10.6).ok).toBe(false);
  });

  it("la misma cota no cambia nada", () => {
    expect(moverCota(PLANTAS, "N3", 10.6)).toEqual({ ok: true, cambios: [] });
  });

  it("0 hace de una planta la ±0,00: las de debajo pasan a sótanos y las alturas no cambian", () => {
    const ps = mover(PLANTAS, "N1", 0);
    expect(ps.map((p) => p.tipo ?? "planta")).toEqual(["planta", "planta", "planta", "planta", "sotano"]);
    expect(ps.map((p) => p.altura)).toEqual(PLANTAS.map((p) => p.altura));
    expect(redondas(ps)).toEqual([9.3, 6.3, 3.3, 0, -4.3]);
    // Y de vuelta: la cimentación, sótano, deja de serlo
    const vuelta = mover(ps, "Cim", 0);
    expect(vuelta).toEqual(PLANTAS);
  });

  it("la ±0,00 sólo baja: pasa a sótano a esa profundidad y la ±0,00 es la de encima", () => {
    const nuevo: Planta[] = [{ id: "N1", altura: null }, { id: "Cim", altura: 3 }];
    const ps = mover(nuevo, "Cim", -4.3);
    expect(ps).toEqual([{ id: "N1", altura: null }, { id: "Cim", tipo: "sotano", altura: 4.3 }]);
    expect(redondas(ps)).toEqual([0, -4.3]);
    const r = moverCota(nuevo, "Cim", 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toContain("Cim es la ±0,00 (la planta más baja que no es sótano)");
  });

  it("con un sótano, se mueve como las demás", () => {
    const ps = mover(PLANTAS, "N1", 0);
    expect(redondas(mover(ps, "Cim", -3.5))).toEqual([9.3, 6.3, 3.3, 0, -3.5]);
    expect(moverCota(ps, "Cim", 0.5).ok).toBe(false);
  });
});

describe("la cota en la tabla Plantas", () => {
  it("se escribe en la fila y es un paso: cambia la altura de las dos filas", () => {
    const p = proyecto();
    const f = filas(p.modelo, "plantas").find((x) => x.id === "N2")!.fila;
    expect(f.cota).toBe("7,6");
    const a = escribirFila(p, "plantas", "N2", { ...f, cota: "8,2" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const fs = filas(a.proyecto.modelo, "plantas");
    expect(fs.map((x) => x.fila.cota)).toEqual(["13,6", "10,6", "8,2", "4,3", "0"]);
    // La altura de su fila es la de su tramo de debajo
    expect(fs.map((x) => x.fila.altura)).toEqual(["3", "2,4", "3,9", "4,3", ""]);
  });

  it("la cimentación a −4,30 desde la fila", () => {
    const p = proyecto([{ id: "N1", altura: null }, { id: "Cim", altura: 3 }]);
    const f = filas(p.modelo, "plantas").find((x) => x.id === "Cim")!.fila;
    const a = escribirFila(p, "plantas", "Cim", { ...f, cota: "-4,30" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.proyecto.modelo.plantas).toEqual([{ id: "N1", altura: null }, { id: "Cim", tipo: "sotano", altura: 4.3 }]);
  });

  it("0 en la planta baja: la cimentación pasa a sótano", () => {
    const p = proyecto();
    const f = filas(p.modelo, "plantas").find((x) => x.id === "N1")!.fila;
    const a = escribirFila(p, "plantas", "N1", { ...f, cota: "0" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.proyecto.modelo.plantas.map((x) => x.tipo ?? "planta")).toEqual(["planta", "planta", "planta", "planta", "sotano"]);
  });

  it("lo que no vale, con su causa; la altura y la cota a la vez, no", () => {
    const p = proyecto();
    const f = filas(p.modelo, "plantas").find((x) => x.id === "N2")!.fila;
    const a = escribirFila(p, "plantas", "N2", { ...f, cota: "20" });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errores[0]!.mensaje).toContain("cota: Se mueve sólo el forjado de N2");
    const b = escribirFila(p, "plantas", "N2", { ...f, cota: "8,2", altura: "4" });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errores[0]!.mensaje).toBe("cota: cambie la altura o la cota, no las dos a la vez");
  });

  it("al pegar no cuenta: pegar la tabla con otras cotas no mueve nada", () => {
    const p = proyecto();
    const r = pegar(p.modelo, "plantas", "id\tcota\tnombre\nN2\t99\tSegunda");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = aplicar(p, r.operacion);
    expect(a.ok && cotasPlantas(a.proyecto.modelo.plantas)).toEqual(cotasPlantas(PLANTAS));
  });
});

describe("plantasEdificio con la ±0,00", () => {
  const nuevo = modelo([{ id: "N1", altura: null }, { id: "Cim", altura: 3 }]);
  it("en la primera planta, la cimentación es un sótano a −alturaBaja", () => {
    const r = plantasEdificio(nuevo, { n: 3, alturaBaja: 4.3, altura: 3, cero: "primera" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(redondas(r.plantas)).toEqual([6, 3, 0, -4.3]);
    const a = aplicar({ esquema: VERSION_ESQUEMA, modelo: nuevo }, r.operacion);
    expect(a.ok && a.proyecto.modelo.plantas).toEqual(r.plantas);
  });
  it("en la cimentación (por defecto), como antes", () => {
    const r = plantasEdificio(nuevo, { n: 1, alturaBaja: 4.3, altura: 3 });
    expect(r.ok && redondas(r.plantas)).toEqual([4.3, 0]);
    // Con la misma altura y la ±0,00 en la primera, también hay algo que hacer
    const s = plantasEdificio(nuevo, { n: 1, alturaBaja: 3, altura: 3, cero: "primera" });
    expect(s.ok && s.plantas).toEqual([{ id: "N1", altura: null }, { id: "Cim", altura: 3, tipo: "sotano" }]);
  });
});
