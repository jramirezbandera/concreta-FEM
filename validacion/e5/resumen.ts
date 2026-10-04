/**
 * Valores medidos de los criterios de E5 para el informe (docs/fem3d/fase-e5.md): el error real de
 * cada prueba, no sólo «por debajo de la tolerancia». La convergencia del SPR, las bandas y el banco
 * tienen sus propias salidas (out_spr.txt, out_spr_variantes.txt, out_bandas.txt, out_banco.txt).
 * Uso: bun validacion/e5/resumen.ts → out_resumen.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DiagramasBarras } from "../../src/motor/barras.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificio } from "../../src/pruebas/edificio.ts";
import { RETICULAR } from "../../src/pruebas/edificio.ts";
import { matrizGiro } from "../../src/pruebas/transformar.ts";
import { laminaPlegada } from "../e3/metamorficas.ts";
import { cortesCompletos, erroresCortesCompletos, erroresMetamorficosCorte, GIRO_CORTES, losaUnidireccional, mensulaPlaca, portico } from "./cortes.ts";
import { BASE_E5, erroresFuerzasNodales, MODELOS_FUERZAS_NODALES } from "./fuerzasNodales.ts";
import { errorEjesMezclados, errorMensulaSpr, errorParcheSpr, erroresMetamorficosCampos, MODELOS_METAMORFICOS_CAMPOS } from "./spr.ts";

const raiz = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const e = (x: number) => x.toExponential(1);
const lineas: string[] = [`# validacion/e5/resumen.ts — ${new Date().toLocaleDateString("sv-SE")}`];
const out = (s: string) => {
  lineas.push(s);
  console.log(s);
};

out("## Criterio 1: fuerzas nodales (k·u autoequilibrado; Σg = P + R + C en cada nudo)");
for (const [nombre, f] of MODELOS_FUERZAS_NODALES) {
  const [elemento, nudo] = erroresFuerzasNodales(f());
  out(`${nombre}: elementos ${e(elemento)} · nudos ${e(nudo)}`);
}

out("");
out("## Criterio 2: corte por fuerzas nodales");
out("Cortes completos frente a −(cargas + reacciones del lado A):");
for (const [nombre, f, cortes] of cortesCompletos()) out(`${nombre} (${cortes.length} cortes): ${e(erroresCortesCompletos(f, cortes).error)}`);
{
  let peor = { My: 0, Vz: 0, otros: 0 };
  for (const [nx, ny] of [[6, 2], [12, 5]] as const) {
    const { modelo, L, b, q } = losaUnidireccional(nx, ny);
    const casos = casosValidos(calcular(modelo));
    const ct = new Cortes(modelo);
    for (let i = 1; i < nx; i++) {
      const x = (i * L) / nx;
      const [N, Vy, Vz, T, My, Mz] = ct.cortar({ origen: [x, b / 2, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-b / 2, b / 2] }, casos).esfuerzos;
      const esc = Math.abs(q) * b * L * L;
      peor = {
        My: Math.max(peor.My, Math.abs(My! + (q * b * x * (L - x)) / 2) / esc),
        Vz: Math.max(peor.Vz, Math.abs(Vz! - q * b * (L / 2 - x)) / esc),
        otros: Math.max(peor.otros, ...[N, Vy, T, Mz].map((v) => Math.abs(v!) / esc)),
      };
    }
  }
  out(`losa unidireccional (mallas 6 × 2 y 12 × 5, todas las líneas): My ${e(peor.My)} · Vz ${e(peor.Vz)} · N, Vy, T, Mz ${e(peor.otros)}`);
}
{
  const [L, b, F] = [3, 1.5, 4];
  const modelo = mensulaPlaca(6, 3, L, b, F);
  const casos = casosValidos(calcular(modelo));
  const ct = new Cortes(modelo);
  let peor = 0;
  for (let i = 1; i < 6; i++) {
    const x = (i * L) / 6;
    const s = ct.cortar({ origen: [x, b / 2, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-b, b] }, casos).esfuerzos;
    peor = Math.max(peor, Math.abs(s[4]! + F * b * (L - x)) / (F * b * L), Math.abs(s[2]! + F * b) / (F * b), Math.abs(s[3]!) / (F * b * L));
  }
  out(`ménsula con ν = 0,3: ${e(peor)}`);
}
{
  const modelo = portico();
  const casos = casosValidos(calcular(modelo));
  const ct = new Cortes(modelo);
  const db = new DiagramasBarras(modelo);
  const pb = db.barra(1);
  const e1 = [pb.R[0]!, pb.R[1]!, pb.R[2]!] as [number, number, number];
  const vz = [pb.R[6]!, pb.R[7]!, pb.R[8]!] as [number, number, number];
  let peor = 0;
  for (const x of [0.3, 1.2, 2.9, 4.4]) {
    const O = [0, 1, 2].map((q) => pb.ip[q]! + x * e1[q]!) as [number, number, number];
    const d = db.diagrama(1, 0, casos[0]!).esfuerzosEn(x, -1);
    const s = ct.cortar({ origen: O, x: e1, vz }, casos).esfuerzos;
    const esc = Math.max(...d.map(Math.abs));
    for (let c = 0; c < 6; c++) peor = Math.max(peor, Math.abs(s[c]! - d[c]!) / esc);
  }
  out(`barra cortada frente a su diagrama (pórtico, 4 secciones): ${e(peor)}`);
}
out("Metamórficas (giro, renumeración, inversión de barras y de láminas):");
for (const [nombre, f, cortes, R] of [
  ["lámina plegada", laminaPlegada, cortesCompletos()[1]![2], GIRO_CORTES],
  ["pórtico", portico, cortesCompletos().find(([n]) => n === "pórtico")![2], GIRO_CORTES],
  ["edificio E3 con muelles", () => edificio({ ...BASE_E5, muelles: true }).modelo, cortesCompletos().find(([n]) => n === "edificio E3 con muelles")![2], matrizGiro([-0.6, 0.2, 0.4], 2.3)],
  ["edificio E3 con diafragma", () => edificio({ ...BASE_E5, diafragma: true }).modelo, cortesCompletos().find(([n]) => n === "edificio E3 con diafragma y huellas")![2], matrizGiro([0, 0, 1], -0.4)],
] as const) {
  out(`${nombre}: ${e(erroresMetamorficosCorte(f, cortes, [...R]))}`);
}

out("");
out("## Criterio 3: campos recuperados (SPR); la convergencia va en out_spr.txt");
for (const [nombre, r] of [
  ["isótropo", errorParcheSpr()],
  ["reticular con el eje 1 a 30°", errorParcheSpr(RETICULAR, 30)],
] as const) {
  out(`patch test de MacNeal–Harder, ${nombre}: N ${e(r.N)} · M ${e(r.M)} · Q ${e(r.Q)}`);
}
out(`ménsula con ν = 0: 8 × 2 ${e(errorMensulaSpr(8, 2))} · 3 × 3 ${e(errorMensulaSpr(3, 3))} · una fila (6 × 1) ${e(errorMensulaSpr(6, 1))}`);
for (const [nombre, f, R] of MODELOS_METAMORFICOS_CAMPOS) {
  const [giro, ren, inv] = erroresMetamorficosCampos(f, R);
  out(`${nombre}: giro ${R ? e(giro) : "—"} · renumeración ${e(ren)} · inversión del orden de nudos ${e(inv)}`);
}
out(`ejes de usuario mezclados en una región isótropa (eje 1 a 37° en la mitad de las láminas): ${e(errorEjesMezclados())}`);

writeFileSync(join(import.meta.dirname, "out_resumen.txt"), lineas.join("\n") + "\n");
