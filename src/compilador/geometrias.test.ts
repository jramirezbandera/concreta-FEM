/**
 * G: el compilador con plantas no ortogonales (rombo, circular con vigas curvas, abanico, dos alas
 * en ángulo y triangular, con huecos, giradas y con pilares circulares) y con retículas al azar en
 * las que entra la rejilla (huecos junto a pilares, voladizos, fachadas enrasadas, chaflanes):
 * todas compilan, con y sin rejilla, sin errores, sin respaldo de la triangulación y sin el aviso
 * de calidad de malla (G-4). La precisión frente a la malla fina se mide en
 * `validacion/geom/sondeo.ts`.
 *
 * G-4 se cumple con la unión de la losa con las vigas de antes (`unionLosaViga: "eje"`) y, desde la
 * fase LV2 (`refinamiento-vigas.md` §18, criterio 4), también con la unión por las caras: el
 * refinamiento de Delaunay llega ya a la triangulación junto a las vigas (antes la tapaba el círculo
 * diametral del eje de cada viga dentro de su ancho: abanicos de jacobiano 0,11–0,19 junto a las
 * vigas curvas, los pilares que asoman y las cuñas de 25–30° entre vigas). Con `refinoEsquinas:
 * false` (la malla de LV1) sigue habiendo aviso en 20 de los 44 modelos, y se exige sólo ≥ 0,1.
 *
 * Con muros al azar en las 24 retículas, quedan tres con el aviso (astillas de milímetros en la
 * esquina de una huella pegada a un muro o al borde enrasado, §18) y el jacobiano no baja de 0,14.
 */
import { describe, expect, it } from "vitest";
import { edificioGeometria, FAMILIAS, type OpcionesGeometria } from "../pruebas/geometrias.ts";
import { nudosRigidosFuera } from "../pruebas/huellasRigidas.ts";
import { conMurosAleatorios } from "../pruebas/murosAleatorios.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

const VARIANTES: OpcionesGeometria[] = [{}, { hueco: true }, { giro: 23 }, { circulares: true }];

function compila(f: ModeloFisico, rejilla: boolean) {
  let r: ReturnType<typeof compilar> | undefined;
  for (const union of ["eje", "cara"] as const) {
    r = compilar(f, { rejilla, unionLosaViga: union });
    const errores = r.diagnosticos.filter((d) => d.severidad === "error").map((d) => `${d.codigo}: ${d.mensaje}`);
    expect(errores, union).toEqual([]);
    expect(r.valido, union).toBe(true);
    expect(r.diagnosticos.filter((d) => d.codigo === "malla/sin-rejilla" || d.codigo === "malla/empates"), union).toEqual([]);
    // G-4: con el refinamiento de Delaunay, ningún cuadrilátero con el jacobiano bajo (criterio 4 de LV2)
    expect(r.diagnosticos.filter((d) => d.codigo === "malla/calidad").map((d) => d.mensaje), union).toEqual([]);
    // Fase HR, criterio 1: ningún nudo rígido fuera de la huella de un pilar
    if (r.valido) expect(nudosRigidosFuera(f, r).filter((x) => x.nudos.length).map((x) => `${x.pilar}@${x.planta}: ${x.nudos.length}`), union).toEqual([]);
    if (union === "cara") {
      // La malla de LV1, sin el refinamiento junto a las vigas: sólo se exige que no baje de 0,1
      const lv1 = compilar(f, { rejilla, unionLosaViga: union, refinoEsquinas: false });
      expect(lv1.valido, "LV1").toBe(true);
      if (lv1.valido) expect(lv1.estadisticas.malla.jacobianoMin, "LV1").toBeGreaterThanOrEqual(0.1);
    }
  }
  return r!;
}

/** La retícula al azar con los muros al azar de C3 (su sección «vb» y su caso «V», que la retícula no tiene). */
function reticulaConMuros(semilla: number): ModeloFisico {
  const f = reticulaAleatoria(semilla);
  const conVb = { ...f, secciones: [...f.secciones, { id: "vb", material: "HA", forma: "rectangular" as const, b: 0.3, h: 0.5 }], casos: [...f.casos, { id: "V" }] };
  return conMurosAleatorios(conVb, semilla);
}

describe("G: plantas no ortogonales", () => {
  for (const fam of FAMILIAS)
    it(`${fam}: compila en sus variantes, con y sin rejilla`, () => {
      for (const v of VARIANTES) for (const rejilla of [true, false]) compila(edificioGeometria(fam, v), rejilla);
    });
});

describe("G: retículas al azar", () => {
  it("24 retículas compilan con y sin rejilla, y la rejilla entra en casi todas", () => {
    let conRejilla = 0;
    for (let s = 1; s <= 24; s++) {
      const r = compila(reticulaAleatoria(s), true);
      if (r.valido && r.estadisticas.malla.laminasRejilla > 0) conRejilla++;
      compila(reticulaAleatoria(s), false);
    }
    expect(conRejilla).toBeGreaterThanOrEqual(20);
  });

  it("24 retículas con muros compilan, y con la unión por las caras sólo tres tienen el aviso de calidad (§18)", () => {
    const conAviso: number[] = [];
    for (let s = 1; s <= 24; s++) {
      const r = compilar(reticulaConMuros(s));
      expect(r.diagnosticos.filter((d) => d.severidad === "error"), `retícula ${s}`).toEqual([]);
      expect(r.valido, `retícula ${s}`).toBe(true);
      if (r.valido) expect(r.estadisticas.malla.jacobianoMin, `retícula ${s}`).toBeGreaterThanOrEqual(0.1);
      if (r.diagnosticos.some((d) => d.codigo === "malla/calidad")) conAviso.push(s);
    }
    expect(conAviso).toEqual([7, 11, 21]);
  });
});
