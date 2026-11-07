/**
 * Viga alineada a una cara sin pilares (de la prueba de uso: calcar una viga perimetral por la línea
 * de un DXF con «Cara izq.» la dejaba centrada en la línea). En un tramo sin pilar, lo dibujado es la
 * cara del lado elegido y el eje va b/2 más allá, como en el Muro (`piezas.ts`).
 */
import { describe, expect, it } from "vitest";
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { proyectoNuevo } from "../plantilla.ts";
import { alinearACara, ESTADO_INICIAL, paso, type ContextoHerramienta, type EstadoHerramienta, type Evento, type Plantillas } from "./herramientas.ts";
import { indiceEnganches } from "./enganches.ts";

const SECCIONES = [{ id: "V30x50", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.5 }];

function modelo(): ModeloFisico {
  const p = proyectoNuevo("cara");
  return { ...p.modelo, secciones: SECCIONES as unknown as ModeloFisico["secciones"] };
}

describe("Viga con una cara en lo dibujado", () => {
  it("un tramo sin pilar: la cara izquierda o derecha en la línea", () => {
    const m = modelo();
    const pts = [{ p: [0, 0] as Vec2 }, { p: [5, 0] as Vec2 }];
    // De izquierda a derecha, la izquierda es +Y: con la cara izquierda en y = 0, el eje en y = −0,15
    expect(alinearACara(m, "N1", pts, "izquierda", 0.3)).toEqual([[0, -0.15], [5, -0.15]]);
    expect(alinearACara(m, "N1", pts, "derecha", 0.3)).toEqual([[0, 0.15], [5, 0.15]]);
  });

  it("un contorno a izquierdas con la cara derecha en él: la viga por dentro, con las esquinas a inglete", () => {
    const m = modelo();
    const esquinas: Vec2[] = [[0, 0], [6, 0], [6, 4], [0, 4], [0, 0]];
    const cerca = (a: Vec2, b: Vec2) => expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-12);
    // A izquierdas, la derecha es fuera: con esa cara en el contorno, el eje a 0,15 por dentro
    const d = alinearACara(m, "N1", esquinas.map((p) => ({ p })), "derecha", 0.3);
    ([[0, 0.15], [5.85, 0.15], [5.85, 3.85], [0.15, 3.85], [0.15, 0]] as Vec2[]).forEach((q, k) => cerca(d[k]!, q));
    // Con la izquierda, por fuera
    const i = alinearACara(m, "N1", esquinas.map((p) => ({ p })), "izquierda", 0.3);
    ([[0, -0.15], [6.15, -0.15], [6.15, 4.15], [-0.15, 4.15], [-0.15, 0]] as Vec2[]).forEach((q, k) => cerca(i[k]!, q));
  });

  it("con la herramienta: la viga creada lleva el eje desplazado", () => {
    const m = modelo();
    const plantillas: Plantillas = { pilar: {}, viga: { seccion: "V30x50", alinear: "izquierda" } };
    const ctx: ContextoHerramienta = { modelo: m, planta: "N1", indice: indiceEnganches(m, "N1"), plantillas } as ContextoHerramienta;
    let e: EstadoHerramienta = ESTADO_INICIAL;
    let hecho: unknown;
    for (const ev of [{ tipo: "punto", p: [0, 0] }, { tipo: "punto", p: [5, 0] }, { tipo: "terminar" }] as Evento[]) {
      const r = paso("viga", e, ev, ctx);
      e = r.estado;
      hecho = r.hecho ?? hecho;
    }
    const op = (hecho as { operacion: { objeto: { puntos: Vec2[] } } }).operacion;
    expect(op.objeto.puntos).toEqual([[0, -0.15], [5, -0.15]]);
  });
});
