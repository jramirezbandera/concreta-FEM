// Exploración de las variantes de la membrana con drilling frente a ASDShellQ4 (criterio 2).
//   bun spike/e0/membrana/explorar.ts          γ y estabilización de la variante elegida
//   bun spike/e0/membrana/explorar.ts todas    las cinco variantes de la formulación
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rigidezDkmq, type MaterialLamina } from "../../../src/elementos/dkmq.ts";
import { expandir, GDL_FLEXION, GDL_MEMBRANA } from "../../../src/elementos/lamina.ts";
import { rigidezMembrana, type OpcionesMembrana } from "./membrana-variantes.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { autovaloresSimetrica } from "../../../src/pruebas/densa.ts";
import { macnealHarder, muro, vigaEnMuro } from "./modelos.ts";

const raiz = join(import.meta.dirname, "..", "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src/nucleo/pkg/nucleo_bg.wasm")));
const os = JSON.parse(readFileSync(join(raiz, "src/elementos/__fixtures__/membrana-opensees.json"), "utf8"));

const variantes: [string, OpcionesMembrana][] = (process.argv[2] === "todas"
  ? [
      ["completa γ=G", { gamma: 1 }],
      ["completa γ=G/1000", { gamma: 1e-3 }],
      ["reducida γ=G", { integracionDrilling: "reducida" }],
      ["completa+incomp γ=G", { incompatibles: true }],
      ["reducida+incomp γ=G", { integracionDrilling: "reducida", incompatibles: true }],
    ]
  : [
      ["incomp-en-ω γ=G α=1e-2", { incompatibles: true, incompatiblesEnGiro: true, estabilizacion: 1e-2 }],
      ["incomp-en-ω γ=G/10 α=1e-2", { incompatibles: true, incompatiblesEnGiro: true, gamma: 0.1, estabilizacion: 1e-2 }],
      ["incomp-en-ω γ=G/1000 α=1e-2", { incompatibles: true, incompatiblesEnGiro: true, gamma: 1e-3, estabilizacion: 1e-2 }],
      ["sin incomp γ=G α=1e-2", { estabilizacion: 1e-2 }],
      ["sin incomp γ=G/10 α=1e-2", { gamma: 0.1, estabilizacion: 1e-2 }],
      ["sin incomp γ=G/1000 α=1e-2", { gamma: 1e-3, estabilizacion: 1e-2 }],
    ]) as [string, OpcionesMembrana][];

const lamina = (xy: ArrayLike<number>, mat: MaterialLamina, op: OpcionesMembrana) => {
  const k = new Float64Array(576);
  expandir(k, rigidezDkmq(xy, mat), GDL_FLEXION);
  expandir(k, rigidezMembrana(xy, mat, op), GDL_MEMBRANA);
  return k;
};

const pct = (a: number, b: number) => `${((a / b - 1) * 100).toFixed(1).padStart(6)} %`;
for (const [nombre, op] of variantes) {
  console.log(`\n== ${nombre}`);
  for (const xy of [[0, 0, 1, 0, 1, 1, 0, 1], [0, 0, 2, 0, 1.5, 1, 0.3, 0.8]]) {
    const lam = autovaloresSimetrica(rigidezMembrana(xy, { E: 1, nu: 0.3, t: 1 }, op), 12);
    const nulos = [...lam].filter((l) => Math.abs(l) < 1e-10 * lam[11]!).length;
    console.log(`  modos de energía nula: ${nulos}   (λ4/λmax = ${(lam[3]! / lam[11]!).toExponential(2)})`);
  }
  const ref = os.muro.timoshenko_mm / 1e3;
  for (const m of os.muro.mallas.slice(0, 3)) {
    const d = muro(m.nx, m.ny, op, lamina);
    console.log(`  muro ${m.nx}x${m.ny}: ${(d * 1e3).toFixed(4)} mm | vs ASD ${pct(d, m.ASDShellQ4)} | vs Timoshenko ${pct(d, ref)}`);
  }
  for (const c of os.macneal_harder.casos) {
    const d = macnealHarder(c.forma, c.carga, op, lamina);
    const r = os.macneal_harder.referencia[c.carga];
    console.log(`  MH ${c.forma.padEnd(13)} ${c.carga.padEnd(8)}: ${(d / r).toFixed(4)} (ASD ${(c.ASDShellQ4 / r).toFixed(4)}, DKGQ ${(c.ShellDKGQ / r).toFixed(4)})`);
  }
  for (const c of os.viga_en_muro.casos) {
    const r = vigaEnMuro(c.n, c.embebida, op, lamina);
    console.log(`  viga n=${String(c.n).padStart(2)} emb=${String(c.embebida).padStart(2)}: punta ${(r.punta * 1e3).toFixed(3).padStart(9)} mm | ASD ${(c.ASDShellQ4.punta * 1e3).toFixed(3).padStart(9)} | ${pct(r.punta, c.ASDShellQ4.punta)} | ΣF ${r.equilibrio.fuerzas.toExponential(1)} ΣM ${r.equilibrio.momentos.toExponential(1)}`);
  }
}
