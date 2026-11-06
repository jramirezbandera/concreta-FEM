/**
 * VS1 en la vivienda de Alhaurín el Grande (`ejemplos/vivienda/proyecto.json`): dos cubiertas a
 * 3,40 (CUB) y 4,30 (CUB-S, `escalon`), VS-n. Da las fuerzas por planta, comprueba la identidad de
 * la regla de la pila (en cada punto del ancho, Σ h_trib = z_alta − z_baja/2, así que Σ A es la
 * integral de esa diferencia en el ancho, calculada aquí sin la pila) y el equilibrio de los 8 casos.
 *
 * La zona y la aspereza son de prueba (A, IV): el emplazamiento real lo da el proyectista.
 *
 * Uso: bun validacion/vs/vivienda.ts > validacion/vs/out_vivienda.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { cotasPlantas } from "../../src/compilador/cotas.ts";
import type { ModeloFisico, Vec2 } from "../../src/compilador/fisico.ts";
import { CASOS_VIENTO, calcularViento } from "../../src/compilador/viento.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const proyecto = JSON.parse(readFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8")) as { modelo: ModeloFisico; opciones?: object };
const m: ModeloFisico = { ...proyecto.modelo, acciones: { viento: { zona: "A", aspereza: "IV" } } };

const c = calcularViento(m)!;
if (!c.viento) throw new Error(c.errores.map((e) => e.mensaje).join("; "));
const v = c.viento;
const f = (x: number, d = 3) => x.toFixed(d).replace(".", ",");
console.log(`Vivienda: zona ${v.zona}, qb ${f(v.qb)} kN/m², aspereza ${v.aspereza}; altura ${f(v.altura, 2)} m sobre la rasante`);
for (const d of [v.x, v.y]) {
  console.log(`\nSegún ${d.eje}: fondo ${f(d.profundidad)} m, ancho ${f(d.ancho)} m, esbeltez ${f(d.esbeltez)}, cp ${f(d.cp)}, cs ${f(d.cs)}, e ±${f(d.e)} m`);
  console.log("planta   z (m)    ce      A (m²)   centro (m)   F (kN)");
  for (const p of d.plantas) console.log(`${p.planta.padEnd(8)} ${f(p.z, 2).padStart(5)}  ${f(p.ce)}  ${f(p.area, 3).padStart(8)}   ${f(p.centro, 3).padStart(8)}   ${f(p.F, 3).padStart(7)}`);
  console.log(`Σ F = ${f(d.F)} kN`);
}

// La identidad, sin la pila: por el contorno de cada losa, el intervalo que cubre en el ancho
const cotas = cotasPlantas(m.plantas);
const plantas = m.plantas.map((p, k) => ({ id: p.id, z: cotas[k]! })).filter((p) => p.z > 0);
const intervalos = (eje: 0 | 1, planta: string): [number, number][] =>
  (m.losas ?? [])
    .filter((l) => l.planta === planta)
    .map((l) => [Math.min(...l.contorno.map((q: Vec2) => q[eje])), Math.max(...l.contorno.map((q: Vec2) => q[eje]))] as [number, number]);
for (const [d, t] of [
  [v.x, 1],
  [v.y, 0],
] as const) {
  const cortes = [...new Set(plantas.flatMap((p) => intervalos(t, p.id).flat()))].sort((a, b) => a - b);
  let integral = 0;
  for (let i = 0; i + 1 < cortes.length; i++) {
    const s = (cortes[i]! + cortes[i + 1]!) / 2;
    const zs = plantas.filter((p) => intervalos(t, p.id).some(([a, b]) => s >= a && s <= b)).map((p) => p.z);
    if (zs.length) integral += (Math.max(...zs) - Math.min(...zs) / 2) * (cortes[i + 1]! - cortes[i]!);
  }
  const suma = d.plantas.reduce((s, p) => s + p.area, 0);
  console.log(`\nSegún ${d.eje}: Σ A = ${f(suma, 6)} m², ∫(z_alta − z_baja/2) = ${f(integral, 6)} m², diferencia ${(Math.abs(suma - integral) / integral).toExponential(1)}`);
}

// El equilibrio de los 8 casos
const r = compilar(m, proyecto.opciones);
if (!r.valido) throw new Error(r.diagnosticos.filter((x) => x.severidad === "error").map((x) => x.mensaje).join("; "));
const k = calcular(r.modelo);
if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
console.log("\ncaso      ΣF (kN)    −ΣR (kN)   rel.");
for (const cv of CASOS_VIENTO) {
  const res = k.casos.find((x) => x.id === cv.id)!;
  const d = cv.eje === 0 ? v.x : v.y;
  let R = 0;
  r.modelo.nudos.forEach((_, i) => (R += res.reacciones[6 * i + cv.eje]!));
  console.log(`${cv.id.padEnd(8)} ${f(cv.signo * d.F).padStart(9)}  ${f(-R).padStart(9)}  ${(Math.abs(cv.signo * d.F + R) / d.F).toExponential(1)}`);
}
console.log(`\n${r.estadisticas.nudos} nudos; la hipótesis:\n${r.hipotesis.find((h) => h.startsWith("Viento del DB SE-AE"))}`);
