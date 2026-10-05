/**
 * Forjados aleatorios para las pruebas de C4: sobre un modelo de `fisicoAleatorio`, cada planta
 * (salvo la cimentación) es unidireccional o reticular.
 * - Unidireccional: un paño por vano, dibujado a ejes, con el mismo intereje en toda la planta. La
 *   dirección es 90° en los vanos con una viga secundaria (que las viguetas cruzan) y, en los demás,
 *   0°, 90° o 30°. Algunos vanos tienen un hueco sin brochales (viguetas en voladizo) y, si hay una
 *   viga en voladizo en la fachada x = máx, un balcón a lo largo de ella.
 * - Reticular: una losa con ábacos cuadrados en los pilares (los de fachada se salen de ella), con
 *   su pp o sin él.
 * Cargas: una zona en un vano, un tabique que cruza vanos, una puntual dentro de un vano y, en las
 * unidireccionales, una de superficie sobre un paño. Reproducible por semilla, sin `Math.hypot` ni
 * `**` (COM-12). No es código del compilador.
 */
import type { CargaFisica, Losa, ModeloFisico, PanoUnidireccional, Seccion, Vec2 } from "../compilador/fisico.ts";
import { azar } from "./fisicoAleatorio.ts";

export interface OpcionesForjadosAleatorios {
  /** Tipo de todas las plantas; por defecto, al azar en cada una. */
  tipo?: "unidireccional" | "reticular";
}

export function conForjadosAleatorios(f: ModeloFisico, semilla: number, o: OpcionesForjadosAleatorios = {}): ModeloFisico {
  const r = azar(9000 + semilla);
  const entre = (a: number, b: number) => a + (b - a) * r();
  const red = (x: number, paso = 0.05) => Math.round(x / paso) * paso;
  // Lo que no va a ejes se desplaza 1,23 cm, para que nada caiga justo a ε_snap de otra cosa
  const fuera = (x: number) => red(x) + 0.0123;
  const xs = [...new Set(f.pilares!.map((p) => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(f.pilares!.map((p) => p.y))].sort((a, b) => a - b);
  const [X, Y] = [xs[xs.length - 1]!, ys[ys.length - 1]!];
  const plantas = f.plantas.filter((p) => p.tipo !== "sotano").map((p) => p.id);
  const secciones: Seccion[] = [...f.secciones];
  const panos: PanoUnidireccional[] = [];
  const losas: Losa[] = [];
  const cargas: CargaFisica[] = [...(f.cargas ?? [])];
  let n = 0;
  for (const p of plantas) {
    const tipo = o.tipo ?? (r() < 0.6 ? "unidireccional" : "reticular");
    if (tipo === "unidireccional") {
      const s = red(entre(0.6, 0.8), 0.01);
      const canto = red(entre(0.25, 0.32), 0.01);
      const sec = `T-${p}`;
      secciones.push({ id: sec, material: "HA", forma: "T", bf: s, hf: 0.05, bw: 0.12, h: canto });
      const pp = red(entre(2.8, 4), 0.1);
      for (let i = 0; i + 1 < xs.length; i++)
        for (let j = 0; j + 1 < ys.length; j++) {
          const [x0, x1, y0, y1] = [xs[i]!, xs[i + 1]!, ys[j]!, ys[j + 1]!];
          const secundaria = f.vigas!.some((v) => v.id === `S${i}-${j}-${p}`);
          const u = r();
          const direccion = secundaria ? 90 : u < 0.4 ? 0 : u < 0.8 ? 90 : 30;
          const hueco: Vec2[][] =
            r() < 0.15 && x1 - x0 > 3 && (y1 - y0) / 2 > 2.2
              ? [
                  [
                    [fuera(x0 + 1), fuera(y0 + 0.9)],
                    [fuera(x0 + 2), fuera(y0 + 0.9)],
                    [fuera(x0 + 2), fuera(y0 + 1.8)],
                    [fuera(x0 + 1), fuera(y0 + 1.8)],
                  ],
                ]
              : [];
          panos.push({
            id: `F${i}-${j}-${p}`,
            planta: p,
            contorno: [
              [x0, y0],
              [x1, y0],
              [x1, y1],
              [x0, y1],
            ],
            ...(hueco.length ? { huecos: hueco } : {}),
            direccion,
            intereje: s,
            seccion: sec,
            pp,
          });
        }
      // Balcón a lo largo de la viga en voladizo de la fachada x = máx, si la hay
      const vol = f.vigas!.find((v) => v.id === `V-${p}`);
      if (vol && r() < 0.7) {
        const yv = vol.puntos[0]![1];
        const j = ys.indexOf(yv);
        const [y0, y1] = j > 0 ? [ys[j - 1]!, yv] : [yv, ys[1]!];
        panos.push({
          id: `B-${p}`,
          planta: p,
          contorno: [
            [X, y0],
            [X + 1.2123, y0],
            [X + 1.2123, y1],
            [X, y1],
          ],
          direccion: 0,
          intereje: s,
          seccion: sec,
          pp,
        });
      }
      const dePlanta = panos.filter((x) => x.planta === p);
      const pano = dePlanta[Math.floor(entre(0, dePlanta.length - 1e-9))]!;
      cargas.push({ tipo: "superficie", id: `sp${n++}-${p}`, caso: "Q", planta: p, pano: pano.id, q: [0, 0, -red(entre(1, 3), 0.1)] });
    } else {
      const s = 0.8;
      const h = red(entre(0.3, 0.4), 0.05);
      const abacos: Vec2[][] = f.pilares!.filter((pl) => pl.hasta === p || f.plantas.findIndex((x) => x.id === pl.hasta) <= f.plantas.findIndex((x) => x.id === p)).map((pl) => [
        [pl.x - 1.2, pl.y - 1.2],
        [pl.x + 1.2, pl.y - 1.2],
        [pl.x + 1.2, pl.y + 1.2],
        [pl.x - 1.2, pl.y + 1.2],
      ]);
      losas.push({
        id: `R-${p}`,
        planta: p,
        contorno: [
          [0, 0],
          [X, 0],
          [X, Y],
          [0, Y],
        ],
        espesor: h,
        material: "HA",
        eje1: r() < 0.5 ? 0 : 90,
        reticular: { intereje: s, nervio: 0.12, capa: 0.05, abacos },
        ...(r() < 0.4 ? { pp: red(entre(4, 5), 0.1) } : {}),
      });
    }
    // Una zona en un vano, un tabique que cruza vanos y una puntual dentro de un vano
    const zi = Math.floor(entre(0, xs.length - 1 - 1e-9));
    const zj = Math.floor(entre(0, ys.length - 1 - 1e-9));
    cargas.push({
      tipo: "superficie",
      id: `z${n++}-${p}`,
      caso: "Q",
      planta: p,
      zona: [
        [fuera(xs[zi]! + entre(0.3, 1)), fuera(ys[zj]! + entre(0.3, 1))],
        [fuera(xs[zi + 1]! - entre(0.3, 1)), fuera(ys[zj]! + entre(0.3, 1))],
        [fuera(xs[zi + 1]! - entre(0.3, 1)), fuera(ys[zj + 1]! - entre(0.3, 1))],
        [fuera(xs[zi]! + entre(0.3, 1)), fuera(ys[zj + 1]! - entre(0.3, 1))],
      ],
      q: [0, 0, -red(entre(2, 5), 0.1)],
    });
    const ty = fuera(entre(0.5, Y - 0.5));
    const tabique: [Vec2, Vec2] = [
      [fuera(entre(0.3, X / 3)), ty],
      [fuera(entre((2 * X) / 3, X - 0.3)), fuera(ty + entre(-1, 1))],
    ];
    cargas.push({ tipo: "lineal", id: `t${n++}-${p}`, caso: "G", planta: p, puntos: tabique, q: [0, 0, -red(entre(3, 7), 0.1)] });
    // Un tabique no puede cruzar un hueco (lo que cae en él se perdería): sin ese hueco
    for (let k = 0; k < panos.length; k++) {
      const pa = panos[k]!;
      if (pa.planta !== p || !pa.huecos?.length) continue;
      const h = pa.huecos[0]!;
      const [x0, x1, y0, y1] = [h[0]![0] - 0.1, h[1]![0] + 0.1, h[0]![1] - 0.1, h[2]![1] + 0.1];
      const [A, B] = tabique;
      const cruza = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1].some((t) => {
        const [x, y] = [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])];
        return x >= x0 && x <= x1 && y >= y0 && y <= y1;
      });
      if (cruza) panos[k] = { ...pa, huecos: [] };
    }
    const pi = Math.floor(entre(0, xs.length - 1 - 1e-9));
    const pj = Math.floor(entre(0, ys.length - 1 - 1e-9));
    cargas.push({ tipo: "puntual", id: `pf${n++}-${p}`, caso: "Q", planta: p, x: fuera(xs[pi]! + (xs[pi + 1]! - xs[pi]!) * entre(0.3, 0.7)), y: fuera(ys[pj]! + (ys[pj + 1]! - ys[pj]!) * entre(0.3, 0.7)), F: [0, 0, -red(entre(5, 20), 0.5)] });
  }
  return { ...f, secciones, cargas, ...(panos.length ? { panos } : {}), ...(losas.length ? { losas } : {}) };
}
