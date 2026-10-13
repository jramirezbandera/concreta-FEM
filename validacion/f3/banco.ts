/**
 * Fase F3, criterios 4 y 8 (`docs/fem3d/cara-propia.md`): tamaño y tiempo del edificio objetivo de 7
 * plantas con losa plana (h = 0,75): compilar, calcular y las estaciones de todas sus franjas.
 *
 * Uso: bun validacion/f3/banco.ts [raíz]. Sin raíz, mide este árbol y escribe la tabla en
 * validacion/f3/out_banco.txt (la comparación con F2 se añade a mano). Con la raíz de otro árbol de
 * trabajo (el commit de F2), mide aquel código y sólo escribe en pantalla.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const raiz = process.argv[2] ?? join(import.meta.dirname, "..", "..");
const de = (ruta: string) => import(join(raiz, ruta));
const { compilar, VERSION_COMPILADOR } = await de("src/compilador/compilar.ts");
const { EsfuerzosFranjas } = await de("src/compilador/esfuerzosFranjas.ts");
const { resolverOpciones } = await de("src/compilador/fisico.ts");
const { validar } = await de("src/compilador/validar.ts");
const { calcular } = await de("src/motor/calcular.ts");
const { Diagnosticos } = await de("src/motor/diagnosticos.ts");
const { iniciarNucleo } = await de("src/nucleo/index.ts");
const { casosValidos } = await de("src/pruebas/comparar.ts");
const { edificioObjetivoLosas } = await de("validacion/c2/modelos.ts");

await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const base = edificioObjetivoLosas(7);
const f = { ...base, vigas: [], cargas: base.cargas.filter((c: { tipo: string }) => c.tipo !== "viga") };
const lineas = [`# Fase F3: tamaño y tiempo del edificio objetivo (7 plantas, losa plana, h = 0,75)`, "", "compilador | nudos | ecuaciones | perfil móvil (≤ 200 000) | plantillas (refinadas) | avisos de malla | compilar (s) | calcular (s) | franjas (s) | total (s)"];
const tiempos: number[][] = [];
let fila = "";
for (let i = 0; i < 3; i++) {
  let t = performance.now();
  const r = compilar(f, {});
  const tc = (performance.now() - t) / 1000;
  if (!r.valido) throw new Error("no compila");
  t = performance.now();
  const c = calcular(r.modelo);
  const tk = (performance.now() - t) / 1000;
  const casos = casosValidos(c);
  t = performance.now();
  const ef = new EsfuerzosFranjas(validar(f, resolverOpciones({}), new Diagnosticos())!, r, casos);
  let n = 0;
  for (const fr of ef.franjas()) n += ef.estaciones(fr.id)!.estaciones.length;
  const tf = (performance.now() - t) / 1000;
  tiempos.push([tc, tk, tf, tc + tk + tf]);
  const avisos = [...new Set(r.diagnosticos.filter((d: { codigo: string }) => d.codigo.startsWith("malla/")).map((d: { codigo: string }) => d.codigo))];
  fila = `${VERSION_COMPILADOR} | ${r.modelo.nudos.length} | ${c.estadisticas.ecuaciones} | ${c.estadisticas.ecuaciones <= 200000 ? "cabe" : "NO cabe"} | ${r.estadisticas.malla.plantillas} (${r.estadisticas.malla.plantillasRefinadas}) | ${avisos.join(", ") || "—"}`;
  console.log(`  repetición ${i + 1}: ${n} estaciones`);
}
const mediana = (k: number) => tiempos.map((x) => x[k]!).sort((a, b) => a - b)[1]!.toFixed(2);
lineas.push(`${fila} | ${mediana(0)} | ${mediana(1)} | ${mediana(2)} | ${mediana(3)}`);
lineas.push("", "Tiempos: la mediana de tres, en este equipo (Bun).");
console.log(lineas.join("\n"));
if (!process.argv[2]) writeFileSync(join(import.meta.dirname, "out_banco.txt"), lineas.join("\n") + "\n", { encoding: "utf8" });
