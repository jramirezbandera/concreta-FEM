/**
 * Modelos físicos de validación de C4 (no son código del compilador): el edificio objetivo de C2
 * (`validacion/c2/modelos.ts`: 10 × 8 pilares con luces de 6 × 5 m, vigas por todos los ejes y
 * secundarias según Y a media luz, 7 plantas) con sus forjados cambiados (H52):
 * - V2, reticular 30+5 (canto 0,35, nervios de 12 cm cada 82 cm) con ábacos de 2,5 × 2,5 m en todos
 *   los pilares (los de fachada se salen de la losa) y el hueco de la escalera;
 * - V3, unidireccional: un paño por vano con viguetas según X (cruzan la secundaria) cada 0,70 m,
 *   T bruta 25+5 y pp 3,5 kN/m²; el vano de la escalera no tiene forjado.
 * Las cargas son las de C2 (peso propio, resto, sobrecarga con una zona más cargada, tabiquería y
 * viento), con las de superficie sobre toda la planta.
 */
import type { CargaFisica, ModeloFisico, PanoUnidireccional, Vec2 } from "../../src/compilador/fisico.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** V2: reticular con ábacos. */
export function edificioReticular(plantas = 7, nx = 9, ny = 7): ModeloFisico {
  const f = edificioObjetivoLosas(plantas, nx, ny);
  const abacos = f.pilares!.map((p) => rect(p.x - 1.25, p.y - 1.25, p.x + 1.25, p.y + 1.25));
  return {
    ...f,
    losas: f.losas!.map((l) => ({ ...l, espesor: 0.35, reticular: { intereje: 0.82, nervio: 0.12, capa: 0.05, abacos } })),
  };
}

/** V3: unidireccional con viguetas como barras. */
export function edificioUnidireccional(plantas = 7, nx = 9, ny = 7): ModeloFisico {
  const f = edificioObjetivoLosas(plantas, nx, ny);
  const [X, Y] = [6 * nx, 5 * ny];
  // El vano de la escalera, el de C2: sin forjado
  const [bi, bj] = [Math.min(4, nx - 1), Math.min(3, ny - 1)];
  const ids = Array.from({ length: plantas }, (_, k) => `N${k + 1}`);
  const panos: PanoUnidireccional[] = [];
  for (const p of ids)
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        if (i === bi && j === bj) continue;
        panos.push({ id: `F${i}-${j}-${p}`, planta: p, contorno: rect(6 * i, 5 * j, 6 * i + 6, 5 * j + 5), direccion: 0, intereje: 0.7, seccion: "T25", pp: 3.5 });
      }
  // Las cargas de superficie de las losas, sobre toda la planta (zona)
  const cargas: CargaFisica[] = f.cargas!.map((c) => (c.tipo === "superficie" && c.losa ? { tipo: "superficie", id: c.id, caso: c.caso, planta: c.planta, zona: rect(0, 0, X, Y), q: c.q } : c));
  const { losas: _l, ...resto } = f;
  void _l;
  return {
    ...resto,
    secciones: [...f.secciones, { id: "T25", material: "HA", forma: "T", bf: 0.7, hf: 0.05, bw: 0.12, h: 0.3 }],
    panos,
    cargas,
  };
}
