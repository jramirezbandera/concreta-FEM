/**
 * A2-14, lo que quedaba (`docs/fem3d/auditoria-2.md` §11): la fuerza de borde de Kirchhoff de los cortes
 * por campos en un borde sobre una viga. Placa de 6 × 6 (y 6 × 4) con carga uniforme, sobre cuatro vigas
 * de borde apoyadas en las esquinas (sus barras comparten los lados de las láminas del borde), con la
 * torsión de las vigas a ×0,1 (D4) y a ×1. Como en `kirchhoff.ts`, por h/t, el cortante exacto del corte
 * (−(carga + reacciones de los nudos con x < x_corte), que incluye las vigas que cruza), el error sin la
 * fuerza de borde en los lados de la viga y con ella entera, y el peso que daría el exacto.
 * Uso: bun validacion/au2/kirchhoffVigas.ts > validacion/au2/out_kirchhoffVigas.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import { CamposLaminas, pesoKirchhoff } from "../../src/motor/campos.ts";
import { Cortes, type Corte } from "../../src/motor/cortes.ts";
import type { CargaLamina } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { Constructor, seccionRectangularTimoshenko } from "../../src/pruebas/constructor.ts";
import { mallaRectangular } from "../../src/pruebas/placa.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const q = -10;
const pct = (v: number, ref: number) => `${(100 * (v / ref - 1)).toFixed(1).padStart(6)} %`;
const pesoDuro = (r: number) => (r * r) / (r * r + 3);
console.log("placa                  t     h    h/t  x      exacto   sin borde  entero  blando  duro   peso exacto");
for (const b of [6, 4])
  for (const [viga, torsion] of [
    ["30×60", 0.1],
    ["30×60", 1],
    ["30×30", 0.1],
    ["60×120", 1],
  ] as const)
    for (const [t, h] of [[0.25, 0.75], [0.25, 0.5], [0.25, 0.25], [0.3, 0.25], [0.25, 0.125], [0.25, 0.1]] as const) {
      const n = Math.round(6 / h);
      const nb = Math.round(b / h);
      const m = new Constructor();
      const g = mallaRectangular(m, { a: 6, b, nx: n, ny: nb, material: { E: 3e7, nu: 0.2, t } });
      const [bv, hv] = viga.split("×").map((s) => Number(s) / 100) as [number, number];
      const sec = seccionRectangularTimoshenko(bv, hv);
      const s = { ...sec, J: sec.J * torsion };
      const bordes: [number, number][] = [];
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= nb; j++) {
          const esquina = (i === 0 || i === n) && (j === 0 || j === nb);
          if (esquina) m.apoyo(g.nudos[i]![j]!, [i === 0 && j === 0, (i === 0 && j === 0) || (i === n && j === 0), true, false, false, false]);
          if (i < n && (j === 0 || j === nb)) {
            bordes.push([g.nudos[i]![j]!, g.nudos[i + 1]![j]!]);
            m.barra(g.nudos[i]![j]!, g.nudos[i + 1]![j]!, s, [0, 0, 1]);
          }
          if (j < nb && (i === 0 || i === n)) {
            bordes.push([g.nudos[i]![j]!, g.nudos[i]![j + 1]!]);
            m.barra(g.nudos[i]![j]!, g.nudos[i]![j + 1]!, s, [0, 0, 1]);
          }
        }
      m.caso("q", [], [], [], g.laminas.flat().map((l): CargaLamina => ({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, q] })));
      const modelo = m.modelo();
      const casos = casosValidos(calcular(modelo));
      const ct = new Cortes(modelo);
      const conPeso = (w: number) => {
        const cl = new CamposLaminas(modelo);
        (cl as unknown as { libres: Map<string, number> }).libres = new Map(bordes.map(([u, v]) => [u < v ? `${u},${v}` : `${v},${u}`, w]));
        return cl;
      };
      const [sin, entero, blando, duro] = [conPeso(0), conPeso(1), conPeso(pesoKirchhoff(h / t)), conPeso(pesoDuro(h / t))];
      const R = casos[0]!.reacciones;
      for (const x0 of [1.2, 2.2]) {
        const x = (Math.floor(x0 / h) + 0.5) * h;
        let Fz = q * b * x;
        modelo.nudos.forEach((nd, v) => {
          if (nd.x < x) Fz += R[6 * v + 2]!;
        });
        const ref = -Fz;
        const c: Corte = { origen: [x, b / 2, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-b / 2 - 0.01, b / 2 + 0.01], metodo: "campos" };
        const [vs, ve, vb, vd] = [sin, entero, blando, duro].map((cl) => ct.cortar(c, casos, cl).esfuerzos[2]!);
        const wExacto = Math.abs(vs! - ve!) > 1e-9 * Math.abs(ref) ? ((vs! - ref) / (vs! - ve!)).toFixed(3) : "—";
        console.log(`${`${viga} T×${torsion} 6×${b}`.padEnd(20)} ${t.toFixed(2)} ${h.toFixed(3)} ${(h / t).toFixed(2)} ${x.toFixed(3)} ${ref.toFixed(2).padStart(8)} ${pct(vs!, ref)} ${pct(ve!, ref)} ${pct(vb!, ref)} ${pct(vd!, ref)}   ${wExacto.padStart(6)}`);
      }
    }
