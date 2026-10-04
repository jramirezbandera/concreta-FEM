/**
 * Muros aleatorios para las pruebas de C3, sobre un modelo de `fisicoAleatorio` (con o sin las
 * losas de `conLosasAleatorias`):
 * - un muro de sótano en la fachada y = 0, de la cimentación a N1, con una ventana a veces y un
 *   empuje del terreno (lado derecho, y < 0) en el caso V;
 * - un núcleo cerrado en el primer vano (en x y en y), de la cimentación a la cubierta, con una puerta
 *   por planta en su primer tramo, todas con el mismo ancho;
 * - en cada planta, una viga que acaba en la esquina del núcleo en el plano de su primer tramo
 *   (C3-e);
 * - si hay dos plantas o más, un muro de N1 a N2 apeado sobre la viga de la fachada y = máx, en su
 *   último vano.
 * Reproducible por semilla, sin `Math.hypot` ni `**` (COM-12). No es código del compilador.
 */
import type { CargaFisica, ModeloFisico, Muro, Viga } from "../compilador/fisico.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { azar } from "./fisicoAleatorio.ts";

export function conMurosAleatorios(f: ModeloFisico, semilla: number): ModeloFisico {
  const r = azar(9000 + semilla);
  const entre = (a: number, b: number) => a + (b - a) * r();
  const red = (x: number, paso = 0.05) => Math.round(x / paso) * paso;
  // Lejos de los múltiplos de 5 cm de los ejes, para que nada caiga justo a ε_snap de otra cosa
  const fuera = (x: number) => red(x) + 0.0173;
  const xs = [...new Set(f.pilares!.map((p) => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(f.pilares!.map((p) => p.y))].sort((a, b) => a - b);
  const plantas = f.plantas.filter((p) => p.tipo !== "sotano").map((p) => p.id);
  const np = plantas.length;
  const cotas = cotasPlantas(f.plantas) as number[];
  const cota = (id: string) => cotas[f.plantas.findIndex((p) => p.id === id)]!;
  const zC = cota("C");
  const muros: Muro[] = [];
  const vigas: Viga[] = [...(f.vigas ?? [])];
  const cargas: CargaFisica[] = [...(f.cargas ?? [])];

  // Muro de sótano en y = 0
  const Hs = cota("N1") - zC;
  const sotano: Muro = { id: "MS", puntos: [[xs[0]!, 0], [xs[xs.length - 1]!, 0]], desde: "C", hasta: "N1", espesor: red(entre(0.25, 0.35), 0.01), material: "HA" };
  if (r() < 0.5) {
    const s0 = fuera(xs[1]! + entre(0.6, 1.2));
    sotano.huecos = [{ desde: s0, hasta: fuera(s0 + entre(0.8, 1.4)), z0: red(0.3 * Hs, 0.01), z1: red(0.7 * Hs, 0.01) }];
  }
  muros.push(sotano);
  cargas.push({ tipo: "empuje", id: "E-MS", caso: "V", muro: "MS", lado: "derecho", z0: 0, z1: red(Hs * entre(0.6, 1), 0.01), p0: red(entre(15, 40), 0.5), p1: 0 });

  // Núcleo en el primer vano, con una puerta por planta en su primer tramo
  const cx0 = fuera(xs[0]! + entre(1, 1.4));
  const cx1 = fuera(cx0 + entre(1.6, 2.2));
  const cy0 = fuera(ys[0]! + entre(1, 1.4));
  const cy1 = fuera(cy0 + entre(1.6, 2.2));
  const niveles = ["C", ...[...plantas].reverse()];
  // Las puertas, una encima de otra (como en un núcleo real)
  const ancho = red(entre(0.8, 1.1), 0.01);
  const huecos = niveles.slice(0, -1).map((p, k) => {
    const z0 = cota(p) - zC;
    const H = cota(niveles[k + 1]!) - cota(p);
    return { desde: 0.3, hasta: 0.3 + ancho, z0, z1: z0 + red(Math.min(2.1, 0.75 * H), 0.01) };
  });
  muros.push({ id: "NUC", puntos: [[cx0, cy0], [cx1, cy0], [cx1, cy1], [cx0, cy1], [cx0, cy0]], desde: "C", hasta: plantas[0]!, espesor: red(entre(0.2, 0.3), 0.01), material: "HA", huecos });
  // Vigas que acaban en la esquina del núcleo en el plano de su primer tramo (C3-e)
  for (const p of plantas) vigas.push({ id: `VN-${p}`, planta: p, puntos: [[xs[0]!, cy0], [cx0, cy0]], seccion: "vb" });

  // Muro apeado sobre la viga de la fachada y = máx, en su último vano
  if (np >= 2) muros.push({ id: "MA", puntos: [[xs[xs.length - 2]!, ys[ys.length - 1]!], [xs[xs.length - 1]!, ys[ys.length - 1]!]], desde: "N1", hasta: "N2", espesor: 0.2, material: "HA", base: "ninguno" });
  return { ...f, vigas, muros, cargas };
}
