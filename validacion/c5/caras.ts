/**
 * Caras comunes de los apoyos (C5-g) frente a la cara de cada pilar: cuánto del lado seguro queda el
 * corte de una banda de pilares en la cara común cuando su pilar es mayor que el de la cara (el corte
 * cae dentro de su huella).
 *
 * Modelo: una planta del edificio objetivo con losa plana (10 × 8 pilares de 30 × 50, girados 0° o
 * 90°, y de 40 × 40; luces de 6 × 5 m; `validacion/c5/malla.ts`). Dos compilaciones:
 * - A: las bandas propuestas, con las caras comunes;
 * - B: las bandas de pilares con la cara de su propio pilar (lo que sembraba C5.2) y las centrales sin
 *   caras. Con trazos exactos, sus cortes también son válidos.
 * En cada cara de banda de pilares, My de A frente a My de B, casos G y Q. Donde las dos caras
 * coinciden (el pilar menor de su línea), la diferencia es sólo de malla: es el control. Los
 * pilares de fachada y de esquina (la losa va a ejes) tienen momentos de apoyo pequeños, de 5 a
 * 15 kN·m, y diferencias relativas grandes: la tabla separa las caras con |My| ≥ 30 kN·m.
 *
 * La referencia de malla es A con h = 0,375 m: dice cuánto de la diferencia es de la malla de cada una.
 *
 * Uso: bun validacion/c5/caras.ts → validacion/c5/out_caras.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { proponerBandas } from "../../src/compilador/bandas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosBandas, type EstacionResultado } from "../../src/compilador/esfuerzosBandas.ts";
import { ejesBanda } from "../../src/compilador/estaciones.ts";
import type { Banda, ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const lineas: string[] = [];
const decir = (l = "") => {
  lineas.push(l);
  console.log(l);
};

const e0 = edificioObjetivoLosas(1);
const f0: ModeloFisico = { ...e0, vigas: [], cargas: e0.cargas!.filter((c) => c.tipo !== "viga") };
const { bandas } = proponerBandas(f0);
const seccion = new Map(f0.secciones.map((s) => [s.id, s]));

/** Semiextensión de la huella de un pilar rectangular a lo largo de d. */
function semiextension(id: string, d: readonly [number, number]): number {
  const p = f0.pilares!.find((x) => x.id === id)!;
  const s = seccion.get(p.seccion)! as { b: number; h: number };
  const g = ((p.giro ?? 0) * Math.PI) / 180;
  const [ez, ey] = [
    [Math.cos(g), Math.sin(g)],
    [Math.sin(g), -Math.cos(g)],
  ] as const;
  return (s.h / 2) * Math.abs(ez[0] * d[0] + ez[1] * d[1]) + (s.b / 2) * Math.abs(ey[0] * d[0] + ey[1] * d[1]);
}

/** Pilar de cada apoyo de una banda de pilares: el que cae en su tramo y dentro de su ancho. */
function pilarDe(b: Banda, a: number, c: number): { id: string; s: number } {
  const { d, n } = ejesBanda(b);
  const tb = b.desde[0] * n[0] + b.desde[1] * n[1];
  for (const p of f0.pilares!) {
    const s = (p.x - b.desde[0]) * d[0] + (p.y - b.desde[1]) * d[1];
    const t = p.x * n[0] + p.y * n[1];
    if (s >= a - 1e-6 && s <= c + 1e-6 && Math.abs(t - tb) <= b.ancho / 2) return { id: p.id, s };
  }
  throw new Error(`sin pilar en ${b.id} [${a}, ${c}]`);
}

const propias: Banda[] = bandas.map((b) => {
  if (b.tipo !== "pilares") {
    const { apoyos: _a, ...x } = b;
    return x;
  }
  const { d, L } = ejesBanda(b);
  const apoyos = b.apoyos!.map(([a, c]): [number, number] => {
    const p = pilarDe(b, a, c);
    const e = semiextension(p.id, d);
    return [Math.max(0, p.s - e), Math.min(L, p.s + e)];
  });
  return { ...b, apoyos };
});

function calcularCon(bs: Banda[], h?: number): EsfuerzosBandas {
  const f = { ...f0, bandas: bs };
  const r = compilar(f, h ? { tamanoMalla: h } : {});
  if (!r.valido) throw new Error(r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join("\n"));
  decir(`  ${r.estadisticas.nudos} nudos, ${r.estadisticas.malla.plantillas} plantillas`);
  return new EsfuerzosBandas(f, r.modelo, casosValidos(calcular(r.modelo)));
}

decir(`# validacion/c5/caras.ts — ${new Date().toISOString().slice(0, 10)}: caras comunes (C5-g) frente a la cara de cada pilar`);
decir();
decir("A, caras comunes:");
const A = calcularCon(bandas);
decir("B, cara de cada pilar en las bandas de pilares:");
const B = calcularCon(propias);
decir("A con h = 0,375 m (referencia de malla):");
const F = calcularCon(bandas, 0.375);
decir();

type Fila = { dentro: number; caso: string; a: number; b: number; fina: number; donde: string };
const filas: Fila[] = [];
let invalidas = 0;
const casos = ["G", "Q"];
for (const [i, b] of bandas.entries()) {
  if (b.tipo !== "pilares") continue;
  const { L } = ejesBanda(b);
  const [ea, eb, ef] = [A.estaciones(b.id)!, B.estaciones(b.id)!, F.estaciones(b.id)!];
  const en = (es: EstacionResultado[], s: number) => es.find((x) => x.tipo === "cara" && Math.abs(x.s - s) < 1e-6);
  b.apoyos!.forEach(([a, c], k) => {
    const [a2, c2] = propias[i]!.apoyos![k]!;
    for (const [sa, sb] of [
      [a, a2],
      [c, c2],
    ] as const) {
      if (!(sa > 1e-6 && sa < L - 1e-6)) continue;
      const [x, y, z] = [en(ea, sa), en(eb, sb), en(ef, sa)];
      if (!x || !y || !z) throw new Error(`${b.id}: sin la estación ${sa} / ${sb}`);
      if (!x.valido || !y.valido || !z.valido) {
        invalidas++;
        continue;
      }
      casos.forEach((caso, q) => filas.push({ dentro: Math.abs(sa - sb), caso, a: x.esfuerzos[6 * q + 4]!, b: y.esfuerzos[6 * q + 4]!, fina: z.esfuerzos[6 * q + 4]!, donde: `${b.id}@${sa.toFixed(2)} (${x.punto.map((v) => v.toFixed(2)).join(", ")})` }));
    }
  });
}
decir(`Caras de bandas de pilares comparadas: ${filas.length / casos.length} (no válidas en A o B: ${invalidas})`);
decir();
decir("cara común dentro de la huella (m) | caso | caras | My_A / My_B medio | mín | máx | caras con |My_A| < |My_B| | con |My_B| ≥ 30 kN·m: caras, medio, mín, máx");
const grupos = new Map<string, Fila[]>();
for (const f of filas) {
  const k = `${f.dentro.toFixed(3)} | ${f.caso}`;
  grupos.set(k, [...(grupos.get(k) ?? []), f]);
}
for (const [k, g] of [...grupos].sort()) {
  const r = g.filter((f) => Math.abs(f.b) > 1).map((f) => f.a / f.b);
  const menos = g.filter((f) => Math.abs(f.a) < Math.abs(f.b)).length;
  const r30 = g.filter((f) => Math.abs(f.b) >= 30).map((f) => f.a / f.b);
  const est = (x: number[]) => (x.length ? `${(x.reduce((s, v) => s + v, 0) / x.length).toFixed(4)} | ${Math.min(...x).toFixed(4)} | ${Math.max(...x).toFixed(4)}` : "— | — | —");
  decir(`${k} | ${g.length} | ${est(r)} | ${menos} | ${r30.length} | ${est(r30)}`);
}
decir();
decir("Malla: frente a A con h = 0,375 m en la misma cara (caso G, |My| ≥ 30 kN·m): medio, mín y máx");
decir();
decir("cara común dentro de la huella (m) | caras | A / A fina | B / A fina (sólo donde coinciden)");
for (const dentro of [...new Set(filas.map((f) => f.dentro.toFixed(3)))].sort()) {
  const g = filas.filter((f) => f.caso === "G" && f.dentro.toFixed(3) === dentro && Math.abs(f.fina) >= 30);
  const est = (x: number[]) => `${(x.reduce((s, v) => s + v, 0) / x.length).toFixed(4)}, ${Math.min(...x).toFixed(4)}, ${Math.max(...x).toFixed(4)}`;
  decir(`${dentro} | ${g.length} | ${est(g.map((f) => f.a / f.fina))} | ${dentro === "0.000" ? est(g.map((f) => f.b / f.fina)) : "—"}`);
}
if (process.argv.includes("--peores")) for (const f of [...filas].filter((f) => f.caso === "Q").sort((x, y) => Math.abs(y.a / y.b - 1) - Math.abs(x.a / x.b - 1)).slice(0, 15)) console.log(f.donde, f.dentro.toFixed(2), f.a.toFixed(1), f.b.toFixed(1), (f.a / f.b).toFixed(3));
writeFileSync(join(import.meta.dirname, "out_caras.txt"), lineas.join("\n") + "\n", { encoding: "utf8" });
