/**
 * Modelos físicos de validación del compilador (C3).
 * - `edificioObjetivoMuros`: el edificio objetivo con losas de C2 (`validacion/c2/modelos.ts`) con un
 *   núcleo de muros alrededor del hueco de la escalera, en los ejes de su vano (de la cimentación a la
 *   cubierta, con una puerta por planta), y un muro de sótano en todo el perímetro, de la cimentación
 *   a N1, con el empuje del terreno.
 */
import type { CargaFisica, ModeloFisico, Muro } from "../../src/compilador/fisico.ts";
import { edificioObjetivoLosas, reticulaEnrasada } from "../c2/modelos.ts";

export function edificioObjetivoMuros(plantas = 7, nx = 9, ny = 7): ModeloFisico {
  const f = edificioObjetivoLosas(plantas, nx, ny);
  const [X, Y] = [6 * nx, 5 * ny];
  const [bx, by] = [6 * Math.min(4, nx - 1), 5 * Math.min(3, ny - 1)];
  // Cotas sobre la base del núcleo (la cimentación, 1,5 m por debajo de N1)
  const zPlanta = (k: number) => (k === 0 ? 0 : 1.5 + 3 * (k - 1));
  const huecos = Array.from({ length: plantas }, (_, k) => ({ desde: 2.4, hasta: 3.4, z0: zPlanta(k), z1: zPlanta(k) + Math.min(2.1, zPlanta(k + 1) - zPlanta(k) - 0.4) }));
  const muros: Muro[] = [
    { id: "NUCLEO", puntos: [[bx, by], [bx + 6, by], [bx + 6, by + 5], [bx, by + 5], [bx, by]], desde: "C", hasta: `N${plantas}`, espesor: 0.25, material: "HA", huecos },
    { id: "SOTANO", puntos: [[0, 0], [X, 0], [X, Y], [0, Y], [0, 0]], desde: "C", hasta: "N1", espesor: 0.3, material: "HA" },
  ];
  const cargas: CargaFisica[] = [...f.cargas!, { tipo: "empuje", id: "TERRENO", caso: "G", muro: "SOTANO", lado: "derecho", z0: 0, z1: 1.5, p0: 15, p1: 0 }];
  return { ...f, muros, cargas };
}

/**
 * La retícula de C2 con la losa enrasada con los pilares de fachada (`reticulaEnrasada`, 3 × 3 vanos
 * y 1 planta) con un núcleo de muros de 25 cm en los ejes del vano central, de la cimentación a N1,
 * con una puerta y el hueco de la escalera dentro: la rejilla alineada (H52) con plantillas de pilar,
 * franja de fachada y la triangulación alrededor del núcleo.
 */
export function reticulaConNucleo(): ModeloFisico {
  const f = reticulaEnrasada(1, 3, 3);
  const muros: Muro[] = [
    { id: "NUCLEO", puntos: [[6, 5], [12, 5], [12, 10], [6, 10], [6, 5]], desde: "C", hasta: "N1", espesor: 0.25, material: "HA", huecos: [{ desde: 2.4, hasta: 3.4, z0: 0, z1: 1.2 }] },
  ];
  return { ...f, losas: f.losas!.map((l) => ({ ...l, huecos: [[[6.6, 5.4], [11.4, 5.4], [11.4, 9.6], [6.6, 9.6]]] })), muros };
}
