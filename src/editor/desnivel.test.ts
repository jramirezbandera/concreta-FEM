/**
 * Fase DN en el editor (`docs/fem3d/desniveles.md`, DN-c):
 * - la columna «desnivel» de Forjados lee y escribe el campo de losas y paños, y vacía no lo escribe;
 * - «Enrasar con…» por arriba (la misma cara superior) y por abajo (la misma cara inferior), con el
 *   número redondeado a 1e-9 y sin el campo si queda en 0; da byte a byte lo que se escribiría a mano
 *   en la tabla, y deshacer (aplicar el objeto de antes) da los bytes de antes;
 * - los forjados con los que se puede enrasar: los de su planta, primero los que tocan su borde.
 */
import { describe, expect, it } from "vitest";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { desnivelEnrasado, enrasar, forjadosParaEnrasar } from "./desnivel.ts";
import { type Proyecto, VERSION_ESQUEMA } from "../agente/proyecto.ts";
import { aplicar } from "./operaciones.ts";
import { serializar } from "./serializar.ts";
import { contexto, DEF_TABLAS } from "./tablas.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function modelo(): ModeloFisico {
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "N0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "T", material: "H", forma: "T", bf: 0.7, hf: 0.05, bw: 0.12, h: 0.3 },
    ],
    pilares: [{ id: "P1", x: 0, y: 0, desde: "N0", hasta: "N1", seccion: "p" }],
    losas: [
      { id: "R", planta: "N1", material: "H", espesor: 0.3, contorno: rect(0, 0, 6, 6), reticular: { intereje: 0.8, nervio: 0.12, capa: 0.05, abacosPilares: { lado: 2 } } },
      { id: "M", planta: "N1", material: "H", espesor: 0.2, contorno: rect(6, 0, 9, 6) },
      { id: "T2", planta: "N1", material: "H", espesor: 0.25, contorno: rect(20, 0, 22, 2), desnivel: -0.1 },
    ],
    panos: [{ id: "F", planta: "N1", contorno: rect(0, 6, 5, 10), direccion: 0, intereje: 0.7, seccion: "T" }],
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [],
  } as ModeloFisico;
}

const tabla = DEF_TABLAS.forjados;

describe("los desniveles en el editor (fase DN)", () => {
  it("la columna «desnivel», en losas y paños", () => {
    const m = modelo();
    const ctx = contexto(m);
    const fM = tabla.fila(m.losas![1] as never, ctx);
    expect(fM.desnivel).toBe("");
    expect(tabla.fila(m.losas![2] as never, ctx).desnivel).toBe("-0,1");
    const leido = tabla.objeto({ ...fM, desnivel: "-0,1" }, ctx);
    expect(leido.ok && (leido.objeto as { desnivel?: number }).desnivel).toBe(-0.1);
    const vacio = tabla.objeto(fM, ctx);
    expect(vacio.ok && "desnivel" in vacio.objeto).toBe(false);
    const fF = tabla.fila(m.panos![0] as never, ctx);
    const pano = tabla.objeto({ ...fF, desnivel: "0,05" }, ctx);
    expect(pano.ok && (pano.objeto as { desnivel?: number }).desnivel).toBe(0.05);
  });

  it("enrasar por abajo y por arriba", () => {
    const m = modelo();
    // la maciza de 20 junto al reticular de 30, por abajo: −0,10 (no −0,09999999999999998)
    expect(desnivelEnrasado(m, "M", "R", "abajo")).toEqual({ ok: true, desnivel: -0.1 });
    expect(desnivelEnrasado(m, "R", "M", "abajo")).toEqual({ ok: true, desnivel: 0.1 });
    expect(desnivelEnrasado(m, "M", "R", "arriba")).toEqual({ ok: true, desnivel: 0 });
    // el paño, con el canto de su vigueta; con una losa con desnivel
    expect(desnivelEnrasado(m, "F", "M", "abajo")).toEqual({ ok: true, desnivel: 0.1 });
    expect(desnivelEnrasado(m, "M", "T2", "arriba")).toEqual({ ok: true, desnivel: -0.1 });
    expect(desnivelEnrasado(m, "M", "T2", "abajo")).toEqual({ ok: true, desnivel: -0.15 });
    expect(desnivelEnrasado(m, "M", "M", "abajo").ok).toBe(false);
    expect(desnivelEnrasado(m, "M", "X", "abajo").ok).toBe(false);
  });

  it("la operación es la de escribirlo en la tabla, y deshacer da los bytes de antes", () => {
    const m = modelo();
    const p: Proyecto = { esquema: VERSION_ESQUEMA, modelo: m };
    const antes = serializar(p);
    const e = enrasar(m, "M", "R", "abajo");
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    const r = aplicar(p, e.operacion);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ctx = contexto(m);
    const aMano = tabla.objeto({ ...tabla.fila(m.losas![1] as never, ctx), desnivel: "-0,1" }, ctx);
    expect(aMano.ok).toBe(true);
    const r2 = aplicar(p, { op: "cambiar", coleccion: "losas", id: "M", objeto: (aMano as unknown as { objeto: never }).objeto });
    expect(r2.ok && serializar(r2.proyecto)).toBe(serializar(r.proyecto));
    // enrasar por arriba con R lo deja sin el campo: los bytes de antes
    const vuelta = enrasar(r.proyecto.modelo, "M", "R", "arriba");
    expect(vuelta.ok).toBe(true);
    if (!vuelta.ok) return;
    const r3 = aplicar(r.proyecto, vuelta.operacion);
    expect(r3.ok && serializar(r3.proyecto)).toBe(antes);
  });

  it("con quién se puede enrasar: los de su planta, primero los que tocan", () => {
    expect(forjadosParaEnrasar(modelo(), "M")).toEqual([
      { id: "R", toca: true },
      { id: "F", toca: false },
      { id: "T2", toca: false },
    ]);
  });
});
