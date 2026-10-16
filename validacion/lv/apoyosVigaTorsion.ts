/**
 * Un apoyo lineal que llega a una viga con la unión por las caras (fase LV) apoya el eje de la viga
 * con sus mismas coacciones (`losas.ts`, `apoyosViga.test.ts`). Con sólo uz, la viga gira libre sobre
 * su eje en el apoyo. ¿Habría que coartar también ese giro? Con la sección rígida del enlace, el
 * equivalente exacto de los nudos de la cara apoyados sería uz y el giro de torsión en el eje.
 *
 * Se mide en el modelo de 2 × 2 vanos de `apoyosViga.test.ts` (vigas de 30×50, losa de 20 cm,
 * 5 kN/m² y pp), con tres variantes:
 * - «uz»: lo que hace el compilador;
 * - «uz+giro»: además, el giro de torsión de la viga coartado en el cruce (un apoyo puntual a mano);
 * - «eje»: la unión de antes (`unionLosaViga: "eje"`), con la losa continua sobre la viga: el murete
 *   apoya nudos de la losa hasta el eje, sin sección rígida. Es la referencia física.
 *
 * Magnitudes que convergen: el mx medio de las dos franjas de 1 m que tocan el murete en su estación
 * de apoyo de la cara de la viga (del lado del murete), el torsor y el flector máximos de la viga, la
 * reacción del murete y la flecha máxima. (El máximo en los centroides junto al final de un apoyo
 * lineal no sirve: es un punto singular.)
 *
 *   bun validacion/lv/apoyosVigaTorsion.ts > validacion/lv/out_apoyosVigaTorsion.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ApoyoFisico, ApoyoLineal, ModeloFisico, OpcionesCompilacion, Vec2 } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const X = [0, 5, 10];
const Y = [0, 4, 8];
function modelo(apoyosLineales: ApoyoLineal[], apoyos: ApoyoFisico[] = []): ModeloFisico {
  const pilares = X.flatMap((x, i) => Y.map((y, j) => ({ id: `P${i}${j}`, x, y, desde: "P0", hasta: "P1", seccion: "P30" })));
  const vigas = [...Y.map((y, j) => ({ id: `VX${j}`, planta: "P1", puntos: [[0, y], [10, y]] as Vec2[], seccion: "V30" })), ...X.map((x, i) => ({ id: `VY${i}`, planta: "P1", puntos: [[x, 0], [x, 8]] as Vec2[], seccion: "V30" }))];
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "P0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "P30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "V30", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares,
    vigas,
    losas: [{ id: "L", planta: "P1", contorno: [[0, 0], [10, 0], [10, 8], [0, 8]], espesor: 0.2, material: "H" }],
    apoyosLineales,
    apoyos,
    casos: [{ id: "G", pesoPropio: true }],
    cargas: [{ tipo: "superficie", id: "CM", caso: "G", planta: "P1", losa: "L", q: [0, 0, -5] }],
  };
}
const gdl = (...g: number[]) => [0, 1, 2, 3, 4, 5].map((i) => g.includes(i)) as ApoyoLineal["coartados"];
const al = (p: Vec2[]): ApoyoLineal => ({ id: "AL", planta: "P1", puntos: p, coartados: gdl(2) });

interface Medida {
  franjas: number[];
  T: number;
  M: number;
  R: number;
  flecha: number;
}

/**
 * Medidas con el murete hasta el cruce P con la viga. `franjas`: las de la dirección `dir` (1, según
 * x; 2, según y) que tocan la recta del murete, en la estación de apoyo de la cara del lado del murete.
 */
function medir(f: ModeloFisico, op: OpcionesCompilacion, P: Vec2, viga: string, dir: 1 | 2, recta: number, lado: -1 | 1): Medida {
  const r = compilar(f, op);
  if (!r.valido) throw new Error(JSON.stringify(r.diagnosticos.filter((d) => d.severidad === "error")));
  const cs = casosValidos(calcular(r.modelo));
  const q = new Consultas(f, r, cs, {});
  const fs = q.franjas("L");
  if (!fs.valido) throw new Error("franjas");
  const franjas = fs.valor
    .filter((x) => x.direccion === dir && (Math.abs(x.t0 - recta) < 1e-6 || Math.abs(x.t1 - recta) < 1e-6))
    .map((x) => {
      const e = q.franja(x.id);
      if (!e.valido) return NaN;
      const k = dir === 1 ? 0 : 1;
      const st = e.valor.estaciones.find((s) => s.tipo === "apoyo" && s.lado === lado && Math.abs(s.punto[k] - P[k]) < 0.16);
      return st ? st.medios[0]! : NaN;
    });
  const d = q.diagrama(viga, [1]);
  if (!d.valido) throw new Error(viga);
  const max = (i: number) => Math.max(...d.valor.map((x) => Math.max(Math.abs(x.izquierda[i]!), Math.abs(x.derecha[i]!))));
  const R = q.reacciones("AL");
  const fl = q.flechas("L", [1]);
  return { franjas, T: max(3), M: max(4), R: R.valido ? R.valor.resultante[2]! : NaN, flecha: fl.valido ? fl.valor.maxima.flecha : NaN };
}

const pct = (a: number, b: number) => `${a >= b ? "+" : ""}${((100 * (a - b)) / Math.abs(b)).toFixed(1)} %`;
function tabla(titulo: string, m: Record<"uz" | "uz+giro" | "eje", Medida>): void {
  console.log(`\n## ${titulo}\n`);
  console.log("| | uz | uz+giro | eje | uz − eje | uz+giro − eje |");
  console.log("|---|---|---|---|---|---|");
  const fila = (n: string, v: (x: Medida) => number, dec: number) => {
    const [a, b, c] = [v(m.uz), v(m["uz+giro"]), v(m.eje)];
    console.log(`| ${n} | ${a.toFixed(dec)} | ${b.toFixed(dec)} | ${c.toFixed(dec)} | ${pct(a, c)} | ${pct(b, c)} |`);
  };
  m.uz.franjas.forEach((_, i) => fila(`franja ${i + 1}, mx en la cara (kN·m/m)`, (x) => x.franjas[i]!, 3));
  fila("torsor máximo de la viga (kN·m)", (x) => x.T, 3);
  fila("flector máximo de la viga (kN·m)", (x) => x.M, 3);
  fila("reacción del murete (kN)", (x) => x.R, 3);
  fila("flecha máxima de la losa (mm)", (x) => 1000 * x.flecha, 4);
}

console.log("# Apoyo lineal que llega a una viga: sólo uz frente al giro de torsión coartado y a la unión por el eje");
// Viga interior VY1 (según y; su torsión es ry): el murete según x llega desde un lado hasta su eje
{
  const f = modelo([al([[2, 6], [5, 6]])]);
  const g = modelo([al([[2, 6], [5, 6]])], [{ id: "AP", planta: "P1", x: 5, y: 6, coartados: gdl(4) }]);
  const a = [[5, 6] as Vec2, "VY1", 1, 6, -1] as const;
  tabla("Viga interior (VY1), murete desde un lado hasta su eje", { uz: medir(f, {}, ...a), "uz+giro": medir(g, {}, ...a), eje: medir(f, { unionLosaViga: "eje" }, ...a) });
}
// Viga de borde VX0 (según x; su torsión es rx): el murete según y llega desde la losa hasta su eje
{
  const f = modelo([al([[2, 2], [2, 0]])]);
  const g = modelo([al([[2, 2], [2, 0]])], [{ id: "AP", planta: "P1", x: 2, y: 0, coartados: gdl(3) }]);
  const a = [[2, 0] as Vec2, "VX0", 2, 2, 1] as const;
  tabla("Viga de borde (VX0), murete desde la losa hasta su eje", { uz: medir(f, {}, ...a), "uz+giro": medir(g, {}, ...a), eje: medir(f, { unionLosaViga: "eje" }, ...a) });
}
