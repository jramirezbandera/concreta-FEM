/**
 * VS3 en la vivienda de Alhaurín el Grande (`ejemplos/vivienda/proyecto.json`): el sismo del programa
 * en un proyecto real, con dos cubiertas a cotas distintas (dos diafragmas) y una pérgola.
 *
 * El emplazamiento es de prueba (no es el del municipio: lo da el anejo 1 de la norma, y el terreno,
 * el estudio geotécnico): ab = 0,10 g, K = 1,0, terreno II y μ = 2.
 *
 * `bun validacion/vs3/vivienda.ts` → validacion/vs3/out_vivienda.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conjuntoCombinaciones } from "../../src/agente/combinaciones.ts";
import { deriva, envolventes, sismo } from "../../src/agente/consultas.ts";
import type { Proyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));

// (con una ruta, ese proyecto: para medir el versionado si el del árbol de trabajo está a medias)
const p = JSON.parse(readFileSync(process.argv[2] ?? join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8")) as Proyecto;
const f = { ...p.modelo, acciones: { ...p.modelo.acciones, sismo: { ab: 0.1, K: 1.0, terreno: "II" as const, mu: 2 } } };
const c = compilar(f, p.opciones);
if (!c.valido) throw new Error(c.diagnosticos.filter((d) => d.severidad === "error").map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
const t0 = performance.now();
const r = calcular(c.modelo);
if (!r.valido || !r.modal) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
const tCalculo = (performance.now() - t0) / 1000;
const q = new Consultas(f, c, r.casos, p.opciones, r.modal);
const s = sismo(q, { todos: true });
if (!s.valido) throw new Error(s.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
const v = s.valor;
const n = (x: number, d = 1) => x.toFixed(d).replace(".", ",");
const lineas = [
  "# VS3: el sismo del programa en la vivienda (emplazamiento de prueba: ab = 0,10 g, K = 1,0, terreno II, μ = 2)",
  "",
  `${c.estadisticas.nudos} nudos, ${r.estadisticas.ecuaciones} ecuaciones, ${r.casos.length} casos y ${r.modal.modos.length} modos (${n(tCalculo, 2)} s). Casos lógicos: ${q.fisico.casos.map((x) => x.id).join(", ")}.`,
  `Emplazamiento: C = ${n(v.emplazamiento.C, 2)}, S = ${n(v.emplazamiento.S, 4)}, ac = ${n(v.emplazamiento.ac, 4)} g, TA = ${n(v.emplazamiento.TA, 3)} s, TB = ${n(v.emplazamiento.TB, 3)} s; ν = ${n(v.nu, 2)}. Peso sísmico: ${n(v.peso, 0)} kN.`,
  "",
  "dirección | T dominante, s | su masa, % | cortante en la base, kN | entre el peso | desplazamiento máximo, mm (por μ) | θ máxima | método simplificado, con el periodo del modo dominante",
  ...v.direcciones.map((d) => `${d.eje} | ${n(d.dominante.T, 3)} | ${n(100 * d.dominante.masaEfectiva)} | ${n(d.cortanteBasal)} | ${n(d.coeficienteSismico, 4)} | ${n(1000 * d.desplazamientoMaximo, 2)} | ${n(d.thetaMaxima, 4)} | ${d.simplificado.map((x) => `${n(x.cortanteBasal)} kN (el modal, ×${n(x.frente, 3)})`).join("; ")}`),
  "",
  "dirección | planta | cota, m | masa, t | cortante, kN | fuerza equivalente, kN | excentricidad, m | par, kN·m | desplazamiento, mm | θ",
  ...v.direcciones.flatMap((d) => d.plantas.map((x) => `${d.eje} | ${x.plantas.join(", ")} | ${n(x.cota, 2)} | ${n(x.masa)} | ${n(x.cortante)} | ${n(x.fuerza)} | ${n(x.excentricidad, 3)} | ${n(x.par)} | ${n(1000 * x.desplazamiento, 2)} | ${n(x.theta, 4)}`)),
  "",
  "dirección | modo | T, s | αᵢ | masa, % | cortante en la base, kN",
  ...v.direcciones.flatMap((d) => d.modos.map((m) => `${d.eje} | ${m.modo} | ${n(m.T, 4)} | ${n(m.alfa, 3)} | ${n(100 * m.masaEfectiva)} | ${n(m.cortanteBasal)}`)),
  "",
];
// La regla de combinación: la del articulado (los modos a menos del 10 %, en valor absoluto), la cuadrática completa y la raíz de la suma de los cuadrados sin más
const cqc = sismo(new Consultas({ ...f, acciones: { ...f.acciones, sismo: { ...f.acciones.sismo, regla: "cqc" as const } } }, c, r.casos, p.opciones, r.modal));
if (!cqc.valido) throw new Error("sin la cqc");
lineas.push(
  "dirección | cortante en la base con la regla del articulado, kN | con la cuadrática completa (C.3.6.2.4), kN | con la raíz de la suma de los cuadrados sin más, kN",
  ...v.direcciones.map((d, i) => `${d.eje} | ${n(d.cortanteBasal)} | ${n(cqc.valor.direcciones[i]!.cortanteBasal)} | ${n(Math.hypot(...d.modos.map((m) => m.cortanteBasal)))}`),
  "",
);
// Los pilares: los extremos con la persistente y con la sísmica
for (const situaciones of [["ELU-PT"], ["ELU-SIS"]] as const) {
  const cj = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: [...situaciones] });
  if (!cj.valido) throw new Error(cj.diagnosticos.map((d) => d.mensaje).join("\n"));
  const e = envolventes(q, cj.valor, { tipo: "pilar" });
  if (!e.valido) throw new Error("sin envolventes");
  lineas.push(`Pilares, ${situaciones.join(", ")} (${cj.valor.factores.length} combinaciones):`);
  for (const g of e.valor.grupos) lineas.push(`  bajo ${g.planta}: ` + Object.entries(g.extremos).map(([k, x]) => `${k} ${n(x.v)} (${x.pieza}, ${x.comb})`).join("; "));
  if (situaciones[0] === "ELU-SIS") {
    const dv = deriva(q, cj.valor);
    if (dv.valido) for (const x of dv.valor) lineas.push(`  desplome bajo ${x.planta}: ${x.desplome ? `1/${n(1 / x.desplome.v, 0)} (${x.desplome.pieza}, ${x.desplome.comb})` : "—"}`);
  }
  lineas.push("");
}
if (s.diagnosticos.length) lineas.push("Avisos:", ...s.diagnosticos.map((d) => `  ${d.codigo}: ${d.mensaje}`), "");
writeFileSync(join(import.meta.dirname, "out_vivienda.txt"), lineas.join("\n"));
console.log(lineas.join("\n"));
