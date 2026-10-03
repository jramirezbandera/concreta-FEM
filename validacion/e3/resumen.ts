/**
 * Valores medidos de los criterios de E3 para el informe (docs/fem3d/fase-e3.md): el error real
 * del elemento, frente a PyNite, en el patch test, en las cargas y en cada prueba metamórfica, no
 * sólo «por debajo de la tolerancia». Navier y los benchmarks tienen sus propias salidas
 * (out_navier.txt, out_benchmarks.txt).
 * Uso: bun validacion/e3/resumen.ts → out_resumen.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { marcoLamina, rigidezLaminaGlobal, rigidezLaminaLocal, seccionLamina, type MultiplicadoresLamina } from "../../src/elementos/lamina.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { ResultantesLaminas } from "../../src/motor/laminas.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos, errorPorGrupos } from "../../src/pruebas/comparar.ts";
import { autovaloresSimetrica, errorRelativo } from "../../src/pruebas/densa.ts";
import { RETICULAR } from "../../src/pruebas/edificio.ts";
import { erroresMetamorficosE3, laminaPlegada, MODELOS_PROPIEDADES_E3 } from "./metamorficas.ts";
import { MODELOS_PYNITE_E3 } from "./modelos-oraculo.ts";
import { parcheMacNealHarder } from "./parche.ts";

const raiz = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const e = (x: number) => x.toExponential(1);
const lineas: string[] = [`# validacion/e3/resumen.ts — ${new Date().toLocaleDateString("sv-SE")}`];
const out = (s: string) => {
  lineas.push(s);
  console.log(s);
};
let peorEq = 0;

out("## Criterio 1: el elemento");
{
  const FORMAS = [
    [0, 0, 1, 0, 1, 1, 0, 1],
    [0, 0, 3, 0, 3, 0.5, 0, 0.5],
    [0, 0, 2, 0, 2.6, 1, 0.6, 1],
    [0, 0, 2, 0, 1.5, 1, 0.5, 1],
    [0, 0, 1.3, 0, 1.5, 1.1, -0.2, 0.8],
  ];
  const MAT = { E: 3e7, nu: 0.2, t: 0.25 };
  const GIRADO: MultiplicadoresLamina = { ...RETICULAR, f11: RETICULAR.f22, f22: RETICULAR.f11, m11: RETICULAR.m22, m22: RETICULAR.m11, v13: RETICULAR.v23, v23: RETICULAR.v13 };
  let e0 = 0;
  let sim90 = 0;
  let modos = Infinity;
  let nulos = 0;
  for (const xy of FORMAS) {
    e0 = Math.max(e0, errorRelativo(rigidezLaminaLocal(xy, seccionLamina(MAT)), rigidezLaminaLocal(xy, MAT)));
    const X: number[] = [];
    for (let k = 0; k < 4; k++) X.push(xy[2 * k]! * 0.8 + 1, xy[2 * k]! * 0.3 + xy[2 * k + 1]! * 0.6, xy[2 * k + 1]! * 0.8 - 2);
    const ma = marcoLamina(X, [1, 0.3, -0.2]);
    if (typeof ma === "string") throw new Error(ma);
    const a = rigidezLaminaGlobal(ma.xy, ma.R, seccionLamina(MAT, RETICULAR));
    const mb = marcoLamina(X, [ma.R[3]!, ma.R[4]!, ma.R[5]!]);
    if (typeof mb === "string") throw new Error(mb);
    sim90 = Math.max(sim90, errorRelativo(rigidezLaminaGlobal(mb.xy, mb.R, seccionLamina(MAT, GIRADO)), a));
    const l = autovaloresSimetrica(a, 24);
    nulos = Math.max(nulos, Math.abs(l[5]!) / l[23]!);
    modos = Math.min(modos, l[6]! / l[23]!);
  }
  out(`sección isótropa sin multiplicadores frente al camino del material isótropo (consistencia interna; frente al código de E0, ver el informe): ${e(e0)}`);
  out(`reticular: 6.º autovalor / máximo ${e(nulos)} (nulos) y 7.º / máximo ${e(modos)} (positivos)`);
  out(`girar el eje 1 90° = intercambiar los multiplicadores de las dos direcciones: ${e(sim90)}`);
  for (const [nombre, mult, angulo] of [
    ["isótropa, ejes de CSI", {}, undefined],
    ["reticular, ejes de CSI", RETICULAR, undefined],
    ["reticular, eje 1 a 30°", RETICULAR, 30],
    ["reticular, eje 1 a −110°", RETICULAR, -110],
  ] as const) {
    const p = parcheMacNealHarder(mult, angulo);
    out(`patch test de MacNeal–Harder, ${nombre}: u ${e(p.u)} · N ${e(p.N)} · M ${e(p.M)} · Q ${e(p.Q)}`);
  }
}

out("\n## Criterio 2a: PyNite 3.2.0 (peor error relativo por grupos; faer y perfil)");
{
  const oraculo = JSON.parse(readFileSync(join(raiz, "src", "motor", "__fixtures__", "pynite-e3.json"), "utf8")).modelos;
  const grupo = (calc: ArrayLike<number>, ref: ArrayLike<number>, c0: number, c1: number) => {
    let d = 0;
    let m = 0;
    for (let i = 0; i < ref.length; i += 8) {
      for (let c = c0; c < c1; c++) {
        d = Math.max(d, Math.abs(calc[i + c]! - ref[i + c]!));
        m = Math.max(m, Math.abs(ref[i + c]!));
      }
    }
    return d / m;
  };
  for (const [nombre, f] of Object.entries(MODELOS_PYNITE_E3)) {
    const modelo = f();
    const rl = new ResultantesLaminas(modelo);
    for (const solver of ["nucleo", "perfil"] as const) {
      const casos = casosValidos(calcular(modelo, { solver }));
      let [u, R, M, Q, Mg, Qg] = [0, 0, 0, 0, 0, 0];
      for (const c of casos) {
        const o = oraculo[nombre][c.id];
        peorEq = Math.max(peorEq, c.equilibrio.fuerzas, c.equilibrio.momentos);
        u = Math.max(u, errorPorGrupos(c.u, o.u));
        R = Math.max(R, errorPorGrupos(c.reacciones, o.reacciones));
        M = Math.max(M, grupo(c.esfuerzosLaminas, o.centroide.flat(), 3, 6));
        Q = Math.max(Q, grupo(c.esfuerzosLaminas, o.centroide.flat(), 6, 8));
        const g = modelo.laminas!.flatMap((_, l) => Array.from(rl.enGauss(l, c.u)));
        Mg = Math.max(Mg, grupo(g, o.gauss.flat(2), 3, 6));
        Qg = Math.max(Qg, grupo(g, o.gauss.flat(2), 6, 8));
      }
      out(`${nombre} (${solver}): u ${e(u)} · reacciones ${e(R)} · M centroide ${e(M)} · Q centroide ${e(Q)} · M Gauss ${e(Mg)} · Q Gauss ${e(Qg)}`);
    }
  }
}

out("\n## Criterio 3: cargas de lámina (equilibrio con la resultante real)");
{
  const casos = casosValidos(calcular(laminaPlegada()));
  for (const c of casos) {
    peorEq = Math.max(peorEq, c.equilibrio.fuerzas, c.equilibrio.momentos);
    out(`lámina plegada, caso ${c.id}: ΣF ${e(c.equilibrio.fuerzas)} · ΣM ${e(c.equilibrio.momentos)}`);
  }
}

out("\n## Criterio 4: pruebas metamórficas (peor error relativo)");
for (const [nombre, f, R] of MODELOS_PROPIEDADES_E3) {
  const m = f();
  for (const c of casosValidos(calcular(m))) peorEq = Math.max(peorEq, c.equilibrio.fuerzas, c.equilibrio.momentos);
  const [giro, ren, inv, sup] = erroresMetamorficosE3(m, R);
  out(`${nombre}: giro ${R ? e(giro!) : "—"} · renumeración ${e(ren!)} · inversión del orden de nudos ${e(inv!)} · superposición ${e(sup!)}`);
}

out(`\nPeor equilibrio (ΣF o ΣM relativos) en todos los cálculos de este resumen: ${e(peorEq)}`);
writeFileSync(join(import.meta.dirname, "out_resumen.txt"), lineas.join("\n") + "\n");
