/**
 * Valores medidos de los criterios de E2 para el informe (docs/fem3d/fase-e2.md): el error real
 * frente a cada oráculo, en las FER y en cada prueba metamórfica, no sólo «por debajo de la
 * tolerancia».
 * Uso: bun validacion/e2/resumen.ts → out_resumen.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rigidezBarraLocal, type SeccionBarra } from "../../src/elementos/barra.ts";
import { cargasDeBarra } from "../../src/elementos/cargasBarra.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { errorRelativo, gaussLegendre, resolverDenso } from "../../src/pruebas/densa.ts";
import { erroresOpenSees, erroresPynite, fixture } from "./comparar.ts";
import { erroresMetamorficos, MODELOS_PROPIEDADES } from "./metamorficas.ts";
import { MODELOS_OPENSEES, MODELOS_PYNITE } from "./modelos-oraculo.ts";

const raiz = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const e = (x: number) => x.toExponential(1);
const lineas: string[] = [];
const out = (s: string) => {
  lineas.push(s);
  console.log(s);
};
let peorEq = 0;

out("## Criterio 1a: PyNite 3.2.0 (peor error relativo por grupos; faer y perfil)");
for (const [nombre, f] of Object.entries(MODELOS_PYNITE)) {
  const m = f();
  for (const solver of ["nucleo", "perfil"] as const) {
    const casos = casosValidos(calcular(m, { solver }));
    for (const c of casos) peorEq = Math.max(peorEq, c.equilibrio.fuerzas, c.equilibrio.momentos);
    const [u, r, s] = erroresPynite(nombre, m, casos);
    out(`${nombre} (${solver}): u ${e(u!)} · reacciones ${e(r!)} · esfuerzos en 7 estaciones por barra ${e(s!)}`);
  }
}

out("\n## Criterio 1b: OpenSeesPy 3.8 (peor error relativo por grupos; faer)");
const os = fixture("opensees-e2.json").modelos;
for (const [nombre, f] of Object.entries(MODELOS_OPENSEES)) {
  const m = f();
  const casos = casosValidos(calcular(m));
  for (const c of casos) peorEq = Math.max(peorEq, c.equilibrio.fuerzas, c.equilibrio.momentos);
  for (const v of Object.keys(os[nombre])) {
    const [u, r, s] = erroresOpenSees(nombre, v, m, casos);
    out(`${nombre} [${v}]: u ${e(u!)} · reacciones ${e(r!)} · fuerzas de extremo de los trozos ${e(s!)}`);
  }
}

out("\n## Criterio 2: FER de Timoshenko frente a un modelo de dos barras y a la integral de puntuales");
{
  const T: SeccionBarra = { E: 3e7, G: 1.25e7, A: 0.18, Iy: 0.0054, Iz: 0.00135, J: 0.0037, Avy: 0.15, Avz: 0.15 };
  const L = 2.5;
  const dosBarras = (a: number, F: number[], M: number[]) => {
    const k1 = rigidezBarraLocal(a, T);
    const k2 = rigidezBarraLocal(L - a, T);
    const K = new Float64Array(36);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) K[6 * r + c] = k1[12 * (6 + r) + 6 + c]! + k2[12 * r + c]!;
    const u = resolverDenso(K, [...F, ...M], 6);
    const f = new Float64Array(12);
    for (let p = 0; p < 6; p++) for (let c = 0; c < 6; c++) {
      f[p]! += k1[12 * p + 6 + c]! * u[c]!;
      f[6 + p]! += k2[12 * (6 + p) + c]! * u[c]!;
    }
    return f;
  };
  let peor = 0;
  for (const a of [0.3, 1.1, 2.2]) {
    const { fer } = cargasDeBarra(T, L, [{ tipo: "puntual", x: a, F: [3, -5, 7], M: [2, -4, 6] }]);
    peor = Math.max(peor, errorRelativo(fer, dosBarras(a, [3, -5, 7], [2, -4, 6])));
  }
  out(`puntual (fuerza y momento) en 3 posiciones: ${e(peor)}`);
  const qa = [1.5, -4, 6];
  const qb = [-2, 3, -1];
  const { fer } = cargasDeBarra(T, L, [{ tipo: "distribuida", a: 0.4, b: 1.9, qa: qa as never, qb: qb as never }]);
  const ref = new Float64Array(12);
  const g = gaussLegendre(8, 0.4, 1.9);
  g.x.forEach((xi, p) => {
    const t = (xi - 0.4) / 1.5;
    const f = dosBarras(xi, [0, 1, 2].map((d) => qa[d]! + t * (qb[d]! - qa[d]!)), [0, 0, 0]);
    for (let c = 0; c < 12; c++) ref[c]! += g.w[p]! * f[c]!;
  });
  out(`trapecial parcial frente a ∫ q·FER puntual (Gauss de 8 puntos): ${e(errorRelativo(fer, ref))}`);
}

out("\n## Criterio 3: pruebas metamórficas (peor de u, reacciones y esfuerzos de barra; faer)");
for (const [nombre, f, R] of MODELOS_PROPIEDADES) {
  const m = f();
  for (const c of casosValidos(calcular(m))) peorEq = Math.max(peorEq, c.equilibrio.fuerzas, c.equilibrio.momentos);
  const [giro, ren, inv, sup] = erroresMetamorficos(m, R);
  out(`${nombre}: giro ${e(giro!)} · renumeración ${e(ren!)} · inversión de barras ${e(inv!)} · superposición ${e(sup!)}`);
}

out(`\n## Regla de oro 2: peor equilibrio (ΣF o ΣM relativos) en todos los modelos anteriores: ${e(peorEq)}`);
writeFileSync(join(import.meta.dirname, "out_resumen.txt"), `# validacion/e2/resumen.ts — 2026-10-03\n${lineas.join("\n")}\n`);
