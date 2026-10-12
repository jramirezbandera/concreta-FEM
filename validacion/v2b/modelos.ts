/**
 * Proyectos de validación de V2b (`docs/fem3d/visor.md` §7.3): los modelos de C3, C4 y C5 con
 * muros, empujes, reticular, paños, apoyos lineales y bandas, en tamaño pequeño para los tests.
 * - `muros`: el edificio objetivo de C3 (2 plantas, 6 × 5 vanos, para que el núcleo no toque el muro de sótano) con núcleo con puertas, muro de
 *   sótano y su empuje;
 * - `nucleo`: la retícula enrasada con núcleo de C3;
 * - `reticular` y `unidireccional`: V2 y V3 de C4 (2 plantas, 4 × 3 vanos);
 * - `bandas`: el reticular de H25 con las bandas propuestas (C5);
 * - `variado`: lo que falta en los demás: un reticular con casetón perdido, pp y multiplicadores
 *   dados, un paño con hueco, un apoyo lineal y una banda del usuario (con los apoyos de sus pilares).
 */
import type { Proyecto } from "../../src/agente/proyecto.ts";
import { VERSION_ESQUEMA } from "../../src/agente/proyecto.ts";
import { apoyosBanda } from "../../src/compilador/bandas.ts";
import type { Banda, ModeloFisico, Vec2 } from "../../src/compilador/fisico.ts";
import { edificioObjetivoMuros, reticulaConNucleo } from "../c3/modelos.ts";
import { edificioReticular, edificioUnidireccional } from "../c4/modelos.ts";
import { conPropuesta, reticularH25 } from "../c5/modelos.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function variado(): ModeloFisico {
  const f = edificioReticular(2, 3, 2);
  const [l1, l2] = f.losas!;
  const { reticular: _r, ...maciza } = l2!;
  const r: ModeloFisico = {
    ...f,
    losas: [
      { ...l1!, pp: 5.2, reticular: { ...l1!.reticular!, caseton: "perdido", multiplicadores: { m11: 0.32, m22: 0.27, m12: 0.12, v13: 0.2 } } },
      // La planta de arriba, con un paño unidireccional en un vano en vez de la losa
      { ...maciza, contorno: rect(6, 0, 18, 10), espesor: 0.25 },
    ],
    secciones: [...f.secciones, { id: "T25", material: "HA", forma: "T", bf: 0.7, hf: 0.05, bw: 0.12, h: 0.3 }],
    panos: [{ id: "F1", nombre: "vano de la escalera", planta: l2!.planta, contorno: rect(0, 0, 6, 10), huecos: [rect(2, 2.5, 3, 3.5)], direccion: 90, intereje: 0.7, seccion: "T25", pp: 3.5 }],
    apoyosLineales: [{ id: "AL1", planta: l1!.planta, puntos: [[0, 0], [18, 0]], coartados: [false, false, true, false, false, false] }],
  };
  const b: Banda = { id: "B1", planta: l1!.planta, desde: [0, 5], hasta: [18, 5], ancho: 2.5, tipo: "pilares", origen: "usuario" };
  return { ...r, bandas: [{ ...b, apoyos: apoyosBanda(r, b)! }] };
}

export const MODELOS_V2B: Readonly<Record<string, () => ModeloFisico>> = {
  muros: () => edificioObjetivoMuros(2, 6, 5),
  nucleo: reticulaConNucleo,
  reticular: () => edificioReticular(2, 4, 3),
  unidireccional: () => edificioUnidireccional(2, 4, 3),
  bandas: () => conPropuesta(reticularH25()),
  variado,
};

export const proyectoV2b = (nombre: string): Proyecto => ({ esquema: VERSION_ESQUEMA, modelo: MODELOS_V2B[nombre]!() });
