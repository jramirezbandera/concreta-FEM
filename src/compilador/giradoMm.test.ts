/**
 * A2-52 (`docs/fem3d/auditoria-2.md` §10.2 y §11): un recuadro de 10 × 6 m con zunchos de 30 y pilares de
 * 30 girados con la planta, con las coordenadas redondeadas al milímetro (lo que da un dibujo real), no
 * compilaba en un tercio de los ángulos (`malla/lado-perdido`, `malla/punto-perdido`, `malla/jacobiano`
 * o `malla/triangulacion`). Tres causas, cada una con sus ángulos:
 * - la esquina de la huella a 1–10 µm de la cara del ancho no iba a ella (`aLasCaras` empezaba en
 *   10·ε_geom y el arreglo une sólo a ε_geom): un lado de micras que la malla perdía (31° enrasada);
 * - proyectada sobre una sola cara, quedaba a micras de la otra viga que acaba en el pilar
 *   (`enEsquinaDeCaras`; 5° y 7° con la losa a 0,27 del eje);
 * - el borde de la planta con sus puntos alineados sólo al redondeo: constrainautor no sigue una arista
 *   obligatoria que «sale de la envolvente» (el marco del respaldo; 27° enrasada).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

type V2 = [number, number];
const mm = (x: number) => Math.round(x * 1000) / 1000;
/** El recuadro girado g°, con la losa a `fuera` del eje de los zunchos, todo al milímetro. */
function recuadro(g: number, fuera: number): ModeloFisico {
  const R: V2[] = [[0, 0], [10, 0], [10, 6], [0, 6]];
  const [c, s] = [Math.cos((g * Math.PI) / 180), Math.sin((g * Math.PI) / 180)];
  const rot = ([x, y]: V2): V2 => [mm(c * x - s * y), mm(s * x + c * y)];
  const ejes = R.map(rot);
  const contorno = ([[-fuera, -fuera], [10 + fuera, -fuera], [10 + fuera, 6 + fuera], [-fuera, 6 + fuera]] as V2[]).map(rot);
  return {
    plantas: [{ id: "N1", altura: null }, { id: "N0", altura: 3 }],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "Z", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
    ],
    pilares: ejes.map((p, i) => ({ id: `P${i}`, x: p[0], y: p[1], desde: "N0", hasta: "N1", seccion: "P30", giro: g })),
    vigas: ejes.map((p, i) => ({ id: `V${i}`, planta: "N1", puntos: [p, ejes[(i + 1) % 4]!], seccion: "Z" })),
    losas: [{ id: "L", planta: "N1", contorno, espesor: 0.3, material: "HA" }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "N1", losa: "L", q: [0, 0, -2] }],
  };
}

describe("A2-52: un recuadro girado con zunchos y las coordenadas al milímetro compila", () => {
  for (const [g, fuera] of [
    [31, 0.15],
    [5, 0.27],
    [7, 0.27],
    [27, 0.15],
  ] as const)
    it(`${g}°, la losa a ${fuera} m del eje`, () => {
      const c = compilar(recuadro(g, fuera));
      expect(c.valido, c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join("\n")).toBe(true);
      if (!c.valido) return;
      expect(c.diagnosticos.some((d) => d.codigo === "malla/calidad")).toBe(false);
      // Calcula (con el equilibrio de cada caso, regla de oro 2) y la sobrecarga es la de toda la losa
      const casos = casosValidos(calcular(c.modelo));
      const caso = casos[c.modelo.casos.findIndex((x) => x.id === "Q")]!;
      const Fz = caso.reacciones.reduce((s, v, i) => (i % 6 === 2 ? s + v : s), 0);
      const area = (10 + 2 * fuera) * (6 + 2 * fuera);
      expect(Math.abs(Fz - 2 * area) / (2 * area)).toBeLessThan(1e-3);
    }, 60_000);
});
