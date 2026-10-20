/**
 * Constante de Lebesgue de los planes SPR de cada nudo de región: Λ = Σ|wₛ| con valor = Σ wₛ·vₛ
 * (vₛ, las muestras de sus parches). |valor| ≤ Λ·máx|vₛ|: mide cuánto puede salirse un nudo del
 * rango de los centroides que lo rodean. Por modelo, cuántos nudos superan cada umbral y por qué vía.
 * Uso: bun validacion/abacos/lebesgue.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { edificioObjetivoLosas, reticulaEnrasada } from "../c2/modelos.ts";
import { reticulaConNucleo } from "../c3/modelos.ts";
import { edificioReticular, edificioUnidireccional } from "../c4/modelos.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";

/** Λ y vía de cada plaza (vía: «centro», «vecinos» o «propio-n» con la base de n términos). */
export function lebesgue(campos: CamposLaminas): { L: Float64Array; via: string[] } {
  const C = campos.flexion as any;
  const np = campos.nPlazas;
  const L = new Float64Array(np);
  const via: string[] = [];
  for (let p = 0; p < np; p++) {
    const pl = C.plan(p);
    const w = new Map<number, number>();
    pl.parches.forEach((c: any, i: number) => {
      const n = c.base.n;
      const z = Float64Array.from(pl.pv[i]);
      // (LLᵀ) z = pv
      for (let a = 0; a < n; a++) {
        let s = z[a]!;
        for (let k = 0; k < a; k++) s -= c.L[n * a + k] * z[k]!;
        z[a] = s / c.L[n * a + a];
      }
      for (let a = n - 1; a >= 0; a--) {
        let s = z[a]!;
        for (let k = a + 1; k < n; k++) s -= c.L[n * k + a] * z[k]!;
        z[a] = s / c.L[n * a + a];
      }
      for (let s = 0; s < c.muestras.length; s++) {
        let ws = 0;
        for (let j = 0; j < n; j++) ws += c.p[n * s + j] * z[j]!;
        const m = c.muestras[s];
        w.set(m, (w.get(m) ?? 0) + ws / pl.parches.length);
      }
    });
    let s = 0;
    for (const v of w.values()) s += Math.abs(v);
    L[p] = s;
    via.push(C.borde[p] ? (C.centro(p) ? "centro" : pl.parches.length && C.parchesCentro[p] === null && pl.parches.some((q: any) => q.x !== C.xyPlaza[2 * p] || q.y !== C.xyPlaza[2 * p + 1]) ? "vecinos" : `propio-${pl.parches[0].base.n}/${pl.parches[0].muestras.length}`) : "centro");
  }
  return { L, via };
}

function informe(nombre: string, m: ModeloAnalitico): void {
  const t0 = performance.now();
  const campos = new CamposLaminas(m);
  const { L, via } = lebesgue(campos);
  const umbrales = [1.5, 2, 3, 5, 10];
  const porVia = new Map<string, number[]>();
  via.forEach((v, p) => {
    const k = v.startsWith("propio") ? v.split("/")[0]! : v;
    let a = porVia.get(k);
    if (!a) porVia.set(k, (a = [0, 0, 0, 0, 0, 0, 0]));
    a[0]!++;
    umbrales.forEach((u, i) => {
      if (L[p]! > u) a![i + 1]!++;
    });
    a[6] = Math.max(a[6]!, L[p]!);
  });
  console.log(`\n${nombre}: ${campos.nPlazas} plazas, ${campos.regiones.length} regiones (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  console.log("  vía            nudos   Λ>1,5   Λ>2   Λ>3   Λ>5  Λ>10   Λ máx");
  for (const [k, a] of [...porVia].sort()) console.log(`  ${k.padEnd(12)} ${a.slice(0, 6).map((x) => String(x).padStart(6)).join("")} ${a[6]!.toFixed(2).padStart(8)}`);
}

const modelos: [string, () => ModeloFisico][] = [
  ["muestrario", () => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "ejemplos", "muestrario", "proyecto.json"), "utf8")).modelo],
  ["reticulaEnrasada", () => reticulaEnrasada()],
  ["reticulaConNucleo", () => reticulaConNucleo()],
  ["edificioReticular(2)", () => edificioReticular(2)],
  ["edificioObjetivoLosas(2)", () => edificioObjetivoLosas(2)],
  ["edificioUnidireccional(2)", () => edificioUnidireccional(2)],
];
const congelados = process.argv.includes("--congelados");
if (congelados) {
  modelos.length = 0;
  const { MODELOS_CONGELADOS_C2 } = await import("../c2/congelar.ts");
  const { MODELOS_CONGELADOS_C3 } = await import("../c3/congelar.ts");
  const { MODELOS_CONGELADOS_C4 } = await import("../c4/congelar.ts");
  const { MODELOS_CONGELADOS_C5 } = await import("../c5/congelar.ts");
  const { MODELOS_CONGELADOS_F } = await import("../f/congelar.ts");
  const { MODELOS_CONGELADOS_E5 } = await import("../e5/congelar.ts");
  for (const [n, f] of Object.entries(MODELOS_CONGELADOS_E5)) informe(`E5 ${n}`, f().modelo);
  for (const [fase, lista] of Object.entries({ C2: MODELOS_CONGELADOS_C2, C3: MODELOS_CONGELADOS_C3, C4: MODELOS_CONGELADOS_C4, C5: MODELOS_CONGELADOS_C5, F: MODELOS_CONGELADOS_F }))
    for (const [n, f] of Object.entries(lista)) {
      const { fisico, opciones } = f();
      const c = compilar(fisico, opciones);
      if (c.valido) informe(`${fase} ${n}`, c.modelo);
      else console.log(fase, n, "no compila");
    }
}
for (const [nombre, f] of modelos) {
  const c = compilar(f());
  if (!c.valido) {
    console.log(nombre, "no compila");
    continue;
  }
  informe(nombre, c.modelo);
}
