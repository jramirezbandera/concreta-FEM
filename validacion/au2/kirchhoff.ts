/**
 * A2-14 y AU-18: la fuerza de borde de Kirchhoff de los cortes por campos, frente al cortante exacto
 * del modelo de elementos finitos, −(carga + reacciones de los nudos con x < x_corte), en un corte de
 * borde a borde de una placa de 6 × 6 con carga uniforme:
 * - «apoyada»: en uz en sus cuatro lados (bordes blandos: el corte acaba en dos lados apoyados);
 * - «empotrada»: con uz, rx y ry coartados en sus cuatro lados (bordes «duros», sin la fuerza de
 *   borde: el Mxy de Kirchhoff se anula en un empotramiento, y sale bien sin ella);
 * - «duro»: apoyo simple «duro», con uz y el giro alrededor de la normal a cada lado (sin la fuerza
 *   de borde: lo que queda abierto de A2-14; su peso exacto, 0,77 / 0,25 / 0,08 con h/t = 3 / 1 / 0,5);
 * - «esquinas»: sobre sus cuatro esquinas (bordes libres).
 * Cada una, de 6 × 6 y de 6 × 4.
 * Da, por h/t, el error sin la fuerza de borde, con ella entera, con la de ahora (`pesoKirchhoff`) y
 * el peso que daría el exacto. Uso: bun validacion/au2/kirchhoff.ts > validacion/au2/out_kirchhoff.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import { CamposLaminas, pesoKirchhoff } from "../../src/motor/campos.ts";
import { Cortes, type Corte } from "../../src/motor/cortes.ts";
import type { CargaLamina } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { Constructor } from "../../src/pruebas/constructor.ts";
import { mallaRectangular } from "../../src/pruebas/placa.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const q = -10;
const pct = (v: number, ref: number) => `${(100 * (v / ref - 1)).toFixed(1).padStart(6)} %`;
console.log("placa              t     h    h/t  x      exacto   sin borde  entero    ahora   peso ahora  peso exacto  error/carga");
let peor = 0;
for (const b of [6, 4])
for (const tipo of ["apoyada", "empotrada", "duro", "esquinas"] as const)
  for (const [t, h] of [[0.25, 0.75], [0.25, 0.5], [0.3, 0.5], [0.25, 0.25], [0.3, 0.25], [0.25, 0.125], [0.3, 0.125], [0.25, 0.1], [0.3, 0.1]] as const) {
    const n = Math.round(6 / h);
    const nb = Math.round(b / h);
    const m = new Constructor();
    const g = mallaRectangular(m, { a: 6, b, nx: n, ny: nb, material: { E: 3e7, nu: 0.2, t } });
    const bordes: [number, number][] = [];
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= nb; j++) {
        const borde = i === 0 || j === 0 || i === n || j === nb;
        const esquina = (i === 0 || i === n) && (j === 0 || j === nb);
        // «duro»: sólo el giro alrededor de la normal a cada lado (rx en x = 0 y x = a; ry en y = 0 y y = b)
        const rx = tipo === "empotrada" || (tipo === "duro" && (i === 0 || i === n));
        const ry = tipo === "empotrada" || (tipo === "duro" && (j === 0 || j === nb));
        if (tipo === "esquinas" ? esquina : borde) m.apoyo(g.nudos[i]![j]!, [i === 0 && j === 0, (i === 0 && j === 0) || (i === n && j === 0), true, rx, ry, false]);
        if (i < n && (j === 0 || j === nb)) bordes.push([g.nudos[i]![j]!, g.nudos[i + 1]![j]!]);
        if (j < nb && (i === 0 || i === n)) bordes.push([g.nudos[i]![j]!, g.nudos[i]![j + 1]!]);
      }
    m.caso("q", [], [], [], g.laminas.flat().map((l): CargaLamina => ({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, q] })));
    const modelo = m.modelo();
    const casos = casosValidos(calcular(modelo));
    const ct = new Cortes(modelo);
    const campos = new CamposLaminas(modelo);
    // Sin la fuerza de borde y con ella entera: el mismo integrador con los pesos cambiados
    const sin = new CamposLaminas(modelo);
    const entero = new CamposLaminas(modelo);
    (sin as unknown as { libres: Map<string, number> }).libres = new Map();
    (entero as unknown as { libres: Map<string, number> }).libres = new Map(bordes.map(([u, v]) => [u < v ? `${u},${v}` : `${v},${u}`, 1]));
    const R = casos[0]!.reacciones;
    for (const x0 of [1.2, 2.2]) {
      const x = (Math.floor(x0 / h) + 0.5) * h;
      let Fz = q * b * x;
      modelo.nudos.forEach((nd, v) => {
        if (nd.x < x) Fz += R[6 * v + 2]!;
      });
      const ref = -Fz;
      const c: Corte = { origen: [x, b / 2, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-b / 2, b / 2], metodo: "campos" };
      const [a, s, e] = [campos, sin, entero].map((cl) => ct.cortar(c, casos, cl).esfuerzos[2]!);
      const w = tipo === "empotrada" || tipo === "duro" ? 0 : pesoKirchhoff(h / t);
      const wExacto = Math.abs(s! - e!) > 1e-9 * Math.abs(ref) ? ((s! - ref) / (s! - e!)).toFixed(3) : "—";
      // El error, sobre la carga del cuerpo libre (a media luz de la 6 × 4 el cortante es casi nulo)
      const carga = Math.abs(q * b * x);
      const sobre = Math.abs(a! - ref) / carga;
      if (tipo === "apoyada" || tipo === "esquinas") peor = Math.max(peor, sobre);
      console.log(`${`${tipo} 6×${b}`.padEnd(16)} ${t.toFixed(2)} ${h.toFixed(3)} ${(h / t).toFixed(2)} ${x.toFixed(3)} ${ref.toFixed(2).padStart(8)} ${pct(s!, ref)} ${pct(e!, ref)} ${pct(a!, ref)}   ${w.toFixed(3)}       ${wExacto.padStart(6)}   ${(100 * sobre).toFixed(1).padStart(5)} %`);
    }
  }
console.log(`\nEl mayor error de ahora, sobre la carga del cuerpo libre, en las placas apoyadas y sobre esquinas: ${(100 * peor).toFixed(1)} %`);
