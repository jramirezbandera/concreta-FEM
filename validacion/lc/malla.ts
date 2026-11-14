/**
 * Fase LC, LC-e (criterio 4 de `docs/fem3d/losa-cimentacion.md`): el n de la malla de las losas de
 * cimentación, h = min(0,75, l/n). Una retícula de 3 × 3 vanos de 6 m con 16 pilares de 40 × 40
 * (esquina 500 kN, borde 900 y centro 1 500) sobre dos losas de cimentación de 0,7 m que comparten un
 * lado (k = 50 000 y 20 000 kN/m³: l = 2,10 y 2,64 m), con el borde a 0,6 m de los ejes. Frente a la
 * malla fina (n = 12 y n = 16, que tienen que coincidir):
 * - σ máxima y asiento máximo;
 * - las estaciones de cara y de apoyo de las franjas a ≤ 0,5 m de un pilar: Wood–Armer inferior y
 *   superior de 1,35·G, frente a la escala de su franja (el máximo de la franja).
 *
 * Uso: bun validacion/lc/malla.ts → validacion/lc/out_malla.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { CargaFisica, ModeloFisico, OpcionesCompilacion, Pilar } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";

const L = 6;
const N = 3;
const ejes = Array.from({ length: N + 1 }, (_, i) => i * L);

export function reticulaCimentacion(t = 0.7, kA = 50000, kB = 20000, P: readonly number[] = [1500, 900, 500]): ModeloFisico {
  const pilares: Pilar[] = [];
  const cargas: CargaFisica[] = [];
  for (const x of ejes)
    for (const y of ejes) {
      const id = `P${pilares.length + 1}`;
      pilares.push({ id, x, y, desde: "C", hasta: "N1", seccion: "p40" });
      const borde = (x === 0 || x === N * L ? 1 : 0) + (y === 0 || y === N * L ? 1 : 0);
      cargas.push({ tipo: "puntual", id: `F${id}`, caso: "G", planta: "N1", x, y, F: [0, 0, -P[borde]!] });
    }
  const a = -0.6;
  const b = N * L + 0.6;
  const m = (N * L) / 2;
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 30 }],
    secciones: [{ id: "p40", material: "H", forma: "rectangular", b: 0.4, h: 0.4 }],
    pilares,
    losas: [
      { id: "LA", planta: "C", contorno: [[a, a], [m, a], [m, b], [a, b]], espesor: t, material: "H", cimentacion: { balasto: kA } },
      { id: "LB", planta: "C", contorno: [[m, a], [b, a], [b, b], [m, b]], espesor: t, material: "H", cimentacion: { balasto: kB } },
    ],
    casos: [{ id: "G", pesoPropio: true }],
    cargas,
  };
}

interface Medida {
  nudos: number;
  ecuaciones: number;
  sigma: number;
  asiento: number;
  franjas: Map<string, { v: number; escala: number }>;
  /**
   * El máximo de cada franja y cara en toda su longitud: el superior es el de los vanos (en una losa de
   * cimentación, arriba entre pilares); el inferior, el pico junto a la huella rígida de un pilar, que
   * es singular (no converge: entre n = 12 y 16, hasta un 9 %).
   */
  maximos: Map<string, number>;
}

function medir(f: ModeloFisico, op: OpcionesCompilacion): Medida {
  const c = compilar(f, op);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  const casos = casosValidos(calcular(c.modelo));
  const q = new Consultas(f, c, casos, op);
  let sigma = 0;
  let asiento = 0;
  for (const id of ["LA", "LB"]) {
    const t = q.terreno(id);
    if (!t.valido) throw new Error(id);
    t.valor.uz.forEach((w) => {
      sigma = Math.max(sigma, -t.valor.balasto * w);
      asiento = Math.max(asiento, -w);
    });
  }
  const franjas = new Map<string, { v: number; escala: number }>();
  const maximos = new Map<string, number>();
  const fac = [1.35];
  for (const l of ["LA", "LB"]) {
    const fs = q.franjas(l);
    if (!fs.valido) continue;
    for (const fr of fs.valor) {
      const est = q.franja(fr.id);
      const arm = q.armadoFranja(fr.id, [fac]);
      if (!est.valido || !arm.valido) throw new Error(fr.id);
      for (const cara of ["inferior", "superior"] as const) {
        const escala = Math.max(1, ...arm.valor.map((x) => x[cara]));
        maximos.set(`${fr.id} ${cara}`, escala);
        est.valor.estaciones.forEach((x, i) => {
          if (x.tipo !== "apoyo" && x.tipo !== "cara") return;
          for (const p of f.pilares!) {
            const [cc, t] = fr.direccion === 1 ? [p.x, p.y] : [p.y, p.x];
            if (Math.abs(x.s - cc) <= 0.5 && fr.t0 < t + 0.2 && fr.t1 > t - 0.2) franjas.set(`${fr.id} ${x.s.toFixed(3)}:${x.lado} ${cara}`, { v: arm.valor[i]![cara], escala });
          }
        });
      }
    }
  }
  const ecuaciones = c.modelo.nudos.length * 6;
  return { nudos: c.modelo.nudos.length, ecuaciones, sigma, asiento, franjas, maximos };
}

if (import.meta.main) {
  const raiz = join(import.meta.dirname, "..", "..");
  await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const pct = (v: number) => `${(100 * v).toFixed(2).padStart(7)} %`;
  const lineas = [`# validacion/lc/malla.ts — ${new Date().toLocaleDateString("sv-SE")}: retícula 3 × 3 de 6 m sobre dos losas de cimentación; h = min(0,75, l/n)`];
  const comparar = (m: Medida, r: Medida) => {
    const d = [...m.franjas].flatMap(([k, x]) => {
      const y = r.franjas.get(k);
      return y ? [Math.abs(x.v - y.v) / y.escala] : [];
    });
    d.sort((a, b) => a - b);
    // El máximo de cada franja (las de más de 1 kN·m/m), frente al suyo de la referencia
    const dm = (cara: string) => {
      const x = [...m.maximos].flatMap(([k, v]) => {
        const y = r.maximos.get(k);
        return k.endsWith(cara) && y && y > 1 ? [Math.abs(v / y - 1)] : [];
      });
      return x.sort((a, b) => a - b);
    };
    const [sup, inf] = [dm("superior"), dm("inferior")];
    return { maxSup: sup[sup.length - 1] ?? NaN, p90Sup: sup[Math.floor(0.9 * sup.length)] ?? NaN, maxInf: inf[inf.length - 1] ?? NaN, n: d.length, mediana: d[Math.floor(d.length / 2)] ?? NaN, p90: d[Math.floor(0.9 * d.length)] ?? NaN, max: d[d.length - 1] ?? NaN, mas5: d.filter((x) => x > 0.05).length };
  };
  const linea = (nombre: string, m: Medida, r: Medida) => {
    const c = comparar(m, r);
    return `${nombre.padEnd(8)} | ${String(m.nudos).padStart(6)} | ${pct(m.sigma / r.sigma - 1)} | ${pct(m.asiento / r.asiento - 1)} | ${String(c.n).padStart(4)} | ${pct(c.mediana)} | ${pct(c.p90)} | ${pct(c.max)} | ${String(c.mas5).padStart(5)} | ${pct(c.p90Sup)} | ${pct(c.maxSup)} | ${pct(c.maxInf)}`;
  };
  for (const [titulo, f] of [
    ["t = 0,7 m; k = 50 000 y 20 000 kN/m³ (l = 2,10 y 2,64 m); pilares de 1 500 / 900 / 500 kN", reticulaCimentacion()],
    ["t = 0,5 m; k = 120 000 y 60 000 kN/m³ (l = 1,31 y 1,56 m); pilares de 1 000 / 600 / 350 kN", reticulaCimentacion(0.5, 120000, 60000, [1000, 600, 350])],
  ] as const) {
    const ref = medir(f, { mallaCimentacion: 16 });
    const ref12 = medir(f, { mallaCimentacion: 12 });
    lineas.push("", `## ${titulo}`);
    lineas.push(`Referencia (n = 16): ${ref.nudos} nudos, σ máx = ${ref.sigma.toFixed(2)} kN/m², asiento máx = ${(1000 * ref.asiento).toFixed(3)} mm`);
    lineas.push(`malla    |  nudos | σ máx     | asiento   | est. | mediana   | p90       | máx       | > 5 % | sup. p90  | sup. máx  | inf. máx`);
    lineas.push(linea("n = 12", ref12, ref));
    for (const n of [2, 3, 4, 6, 8]) lineas.push(linea(`n = ${n}`, medir(f, { mallaCimentacion: n }), ref));
    lineas.push(linea("h = 0,75", medir(f, { mallaCimentacion: 1 }), ref));
    console.log(lineas.slice(-9).join("\n"));
  }
  const texto = lineas.join("\n");
  console.log(texto);
  writeFileSync(join(import.meta.dirname, "out_malla.txt"), texto + "\n");
}
