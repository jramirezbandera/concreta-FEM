/**
 * Fase IG (`docs/fem3d/imperfeccion.md`): lo que la imperfección geométrica global añade a un cálculo.
 * De cada modelo, con ella (por defecto) y sin ella (`aplicar: false`):
 * - θ y de dónde sale; los casos que añade y su fuerza horizontal total;
 * - ecuaciones (las mismas), casos y combinaciones de ELU-PT;
 * - el coeficiente de estabilidad global de sus casos (segundo orden);
 * - los momentos de los pilares en ELU-PT: el mayor |My| y |Mz| de la base y la cabeza de cada tramo, con
 *   y sin la imperfección (lo que sube, en kN·m y en tanto por ciento), y frente al momento de la
 *   excentricidad mínima de la comprobación del pilar, N·máx(h/30; 2 cm) (CE A19 §6.1(4)).
 * El tiempo, como información: alternando las dos variantes, el mínimo de tres pasadas.
 *
 *   bun validacion/ig/medir.ts [vivienda|so|objetivo|reticular …]   → validacion/ig/out_medir.txt (con todos)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { fraccionInclinacion } from "../../src/compilador/imperfeccion.ts";
import { conjuntoCombinaciones, seleccionPorDefecto } from "../../src/agente/combinaciones.ts";
import { envolventes } from "../../src/agente/consultas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";
import { edificioSO } from "../so/modelos.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const MODELOS: Record<string, () => { nombre: string; f: ModeloFisico }> = {
  so: () => ({ nombre: "Edificio de SO (3 plantas, 9 pilares de 40 × 40, sólo barras, viento ±X)", f: edificioSO() }),
  vivienda: () => ({ nombre: "Vivienda de Alhaurín (ejemplos/vivienda: 1 planta y 2 cubiertas reticulares, sin viento)", f: (JSON.parse(readFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8")) as { modelo: ModeloFisico }).modelo }),
  objetivo: () => ({ nombre: "Edificio objetivo con vigas (7 plantas, 80 pilares por planta; viento Vx y Vy)", f: conAcciones(edificioObjetivoLosas(), true) }),
  reticular: () => ({ nombre: "Edificio reticular objetivo (7 plantas; viento Vx y Vy)", f: conAcciones(edificioReticular(), true) }),
};

const lineas: string[] = [];
const di = (t = "") => {
  lineas.push(t);
  console.log(t);
};
const n = (v: number, d = 2) => v.toFixed(d).replace(".", ",");

function calculado(f: ModeloFisico) {
  const t0 = performance.now();
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join("\n"));
  const t1 = performance.now();
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const t2 = performance.now();
  return { c, r, q: new Consultas(f, c, r.casos, {}, r.modal), tCompilar: (t1 - t0) / 1000, tCalcular: (t2 - t1) / 1000 };
}

/** Por tramo de pilar y extremo: el mayor |My| y |Mz| en ELU-PT, y el N de esa combinación. */
function momentosPilares(q: Consultas, f: ModeloFisico): Map<string, { M: number; N: number; h: number }> {
  const cs = q.combinaciones({ situaciones: ["ELU-PT"] });
  if (!cs.valido) throw new Error("sin combinaciones");
  const r = new Map<string, { M: number; N: number; h: number }>();
  for (const p of f.pilares ?? []) {
    const ts = q.pilar(p.id);
    if (!ts.valido) continue;
    for (const t of ts.valor) {
      const s = f.secciones.find((x) => x.id === t.seccion);
      const lados = s?.forma === "rectangular" ? [s.b, s.h] : s?.forma === "circular" ? [s.D, s.D] : [0.3, 0.3];
      for (const [donde, e] of [
        ["base", t.base.esfuerzos],
        ["cabeza", t.cabeza.esfuerzos],
      ] as const) {
        // My flexiona con el canto h (lados[1]) y Mz con el ancho b (lados[0])
        for (const [comp, lado] of [
          [4, lados[1]!],
          [5, lados[0]!],
        ] as const) {
          let mejor = { M: 0, N: 0, h: lado };
          for (const c of cs.valor) {
            const v = q.combinar(e, 6, c.factores);
            if (Math.abs(v[comp]!) > mejor.M) mejor = { M: Math.abs(v[comp]!), N: v[0]!, h: lado };
          }
          r.set(`${p.id}/${t.planta}/${donde}/${comp === 4 ? "My" : "Mz"}`, mejor);
        }
      }
    }
  }
  return r;
}

const percentil = (v: number[], p: number) => {
  const o = [...v].sort((a, b) => a - b);
  return o.length ? o[Math.min(o.length - 1, Math.floor(p * o.length))]! : NaN;
};

const pedidos = process.argv.slice(2);
const cuales = pedidos.length ? pedidos : Object.keys(MODELOS);
for (const id of cuales) {
  const m = MODELOS[id];
  if (!m) throw new Error(`modelo desconocido: ${id} (${Object.keys(MODELOS).join(", ")})`);
  const { nombre, f } = m();
  di(`── ${nombre}`);
  const fSin: ModeloFisico = { ...f, acciones: { ...f.acciones, imperfeccion: { aplicar: false } } };
  let con = calculado(f);
  let sin = calculado(fSin);
  // El tiempo: alternando, el mínimo de tres pasadas (la primera de arriba calienta)
  const t = { sinC: Infinity, sinK: Infinity, conC: Infinity, conK: Infinity };
  for (let pasada = 0; pasada < 3; pasada++) {
    sin = calculado(fSin);
    con = calculado(f);
    [t.sinC, t.sinK, t.conC, t.conK] = [Math.min(t.sinC, sin.tCompilar), Math.min(t.sinK, sin.tCalcular), Math.min(t.conC, con.tCompilar), Math.min(t.conK, con.tCalcular)];
  }
  const i = con.q.imperfeccion();
  if (!i) {
    di("   sin imperfección global");
    continue;
  }
  di(`   θ = ${fraccionInclinacion(i.inclinacion)} (${n(i.inclinacion * 1000, 3)} mm/m): α_h = ${n(i.alfaH, 3)} (l = ${n(i.altura)} m), α_m = ${n(i.alfaM, 3)} (m = ${i.elementos}, bajo ${i.planta})`);
  const ids = con.c.modelo.casos.map((x) => x.id);
  di(`   casos: ${sin.c.modelo.casos.length} → ${ids.length}; ecuaciones: ${sin.r.estadisticas.ecuaciones} → ${con.r.estadisticas.ecuaciones}`);
  for (const c of i.casos) {
    const k = ids.indexOf(c.id);
    const o = ids.indexOf(c.de);
    const H = con.r.casos[k]!.cargas.F[c.direccion === "X" ? 0 : 1]!;
    const P = -con.r.casos[o]!.cargas.F[2];
    const u = con.r.casos[k]!.u;
    let umax = 0;
    for (let v = 0; v < con.c.modelo.nudos.length; v++) umax = Math.max(umax, Math.abs(u[6 * v + (c.direccion === "X" ? 0 : 1)]!));
    di(`   ${c.id.padEnd(12)} H = ${n(H)} kN (θ·${n(P, 0)} kN), desplazamiento máximo ${n(umax * 1000, 3)} mm, equilibrio ${con.r.casos[k]!.equilibrio.fuerzas.toExponential(1)} / ${con.r.casos[k]!.equilibrio.momentos.toExponential(1)}`);
  }
  const cuenta = (q: Consultas) => {
    const g = q.combinacionesGeneradas();
    if (!g.valido) throw new Error("sin combinaciones");
    const porSituacion: Record<string, number> = {};
    for (const c of g.valor) porSituacion[c.situacion] = (porSituacion[c.situacion] ?? 0) + 1;
    return porSituacion;
  };
  const [ca, cb] = [cuenta(sin.q), cuenta(con.q)];
  di(`   combinaciones: ${Object.keys(cb).map((s) => `${s} ${ca[s] ?? 0} → ${cb[s]}`).join("; ")}`);
  const so = con.q.segundoOrden();
  if (so.valido) {
    const deIG = so.valor.maximos.filter((x) => i.casos.some((c) => c.id === x.caso));
    const otros = so.valor.maximos.filter((x) => !i.casos.some((c) => c.id === x.caso));
    const peor = (l: typeof deIG) => (l.length ? l.reduce((a, b) => (b.Q > a.Q ? b : a)) : null);
    const [pi, po] = [peor(deIG), peor(otros)];
    di(`   segundo orden (desplazamientos × ${so.valor.multiplicador}): γz máx. de la imperfección ${pi ? `${n(pi.coeficiente ?? NaN, 3)} (${pi.caso}, ${pi.combinacion})` : "—"}; de las demás hipótesis horizontales ${po ? `${n(po.coeficiente ?? NaN, 3)} (${po.caso})` : "—"}`);
    for (const d of so.diagnosticos) di(`   [${d.severidad}] ${d.codigo}`);
  }
  // Los pilares
  const [ma, mb] = [momentosPilares(sin.q, f), momentosPilares(con.q, f)];
  const sube: number[] = [];
  const subePct: number[] = [];
  const frenteMinima: number[] = [];
  let peor = { clave: "", antes: 0, ahora: 0 };
  for (const [clave, b] of mb) {
    const a = ma.get(clave)!;
    const d = b.M - a.M;
    sube.push(d);
    if (b.M > 1) subePct.push((100 * d) / b.M);
    // El momento de la excentricidad mínima con el axil de esa combinación
    const Mmin = Math.abs(b.N) * Math.max(b.h / 30, 0.02);
    if (Mmin > 0.5) frenteMinima.push(d / Mmin);
    if (d > peor.ahora - peor.antes) peor = { clave, antes: a.M, ahora: b.M };
  }
  di(`   pilares (ELU-PT, el mayor |My| y |Mz| de la base y la cabeza de cada tramo; ${sube.length} valores):`);
  di(`     lo que sube: mediana ${n(percentil(sube, 0.5))} kN·m, percentil 90 ${n(percentil(sube, 0.9))}, máximo ${n(Math.max(...sube))} (${peor.clave}: ${n(peor.antes)} → ${n(peor.ahora)})`);
  di(`     sobre el valor con ella: mediana ${n(percentil(subePct, 0.5), 1)} %, percentil 90 ${n(percentil(subePct, 0.9), 1)} %, máximo ${n(Math.max(...subePct), 1)} %`);
  di(`     frente al momento de la excentricidad mínima, N·máx(h/30; 2 cm): mediana ${n(percentil(frenteMinima, 0.5))}, percentil 90 ${n(percentil(frenteMinima, 0.9))}, máximo ${n(Math.max(...frenteMinima))}`);
  di(`   tiempo (información; mínimo de 3, alternando): compilar ${n(t.sinC)} → ${n(t.conC)} s; calcular ${n(t.sinK)} → ${n(t.conK)} s`);
  // Las envolventes de todas las piezas con las combinaciones por defecto de los esfuerzos (lo que más crece: hay más combinaciones)
  const tEnv = (q: Consultas) => {
    const cj = conjuntoCombinaciones(q, seleccionPorDefecto(q.fisico.casos, "esfuerzos"));
    if (!cj.valido) throw new Error("sin combinaciones");
    const t0 = performance.now();
    const e = envolventes(q, cj.valor);
    if (!e.valido) throw new Error("sin envolventes");
    return { s: (performance.now() - t0) / 1000, combinaciones: cj.valor.factores.length };
  };
  const [ea, eb] = [tEnv(sin.q), tEnv(con.q)];
  di(`   envolventes de todas las piezas (una pasada, con las consultas recién hechas): ${ea.combinaciones} combinaciones, ${n(ea.s, 1)} s → ${eb.combinaciones} combinaciones, ${n(eb.s, 1)} s`);
  di();
}
if (!pedidos.length) writeFileSync(join(import.meta.dirname, "out_medir.txt"), lineas.join("\n") + "\n");
