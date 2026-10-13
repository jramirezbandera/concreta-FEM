/**
 * Validación de la fase F (`docs/fem3d/franjas.md` §4): lo que se mide fuera de los tests.
 * - criterio 2: la placa de Navier de E3 (6 × 4 m apoyada, q = −10 kN/m²), la media de cada franja
 *   en cada estación de paso frente a la media de la serie de Mindlin en su ancho (Gauss de 8 puntos
 *   en la serie, que es suave en t), sobre el mayor |M| de la serie;
 * - criterio 4: convergencia (h = 0,75 frente a 0,375) de la mayor demanda de cada franja, en las
 *   caras y en los vanos, en la losa plana de H25 y en su reticular con ábacos; y la posición: correr
 *   las franjas media franja, con la mayor demanda superior en las caras de cada pilar;
 * - criterio 5: la malla del edificio objetivo de 7 plantas con losa plana, con vigas y reticular,
 *   con y sin las caras;
 * - criterio 7: el tiempo de las franjas de una planta y del edificio entero (las dos direcciones,
 *   Wood–Armer en todas las combinaciones ELU-PT) frente al cálculo.
 *
 * Uso: bun validacion/f/validar.ts [--rapido] → validacion/f/out_validacion.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import { EsfuerzosFranjas } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import type { ResultadoCaso } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { navierMindlin } from "../../src/pruebas/navier.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { losaPlanaFisica, OPCIONES_LOSA_PLANA } from "../c2/losaPlana.ts";
import { navierFisico } from "../c2/navier.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones, reticularH25 } from "../c5/modelos.ts";
import { A, B, CASOS_NAVIER, placaNavier } from "../e3/navier.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const rapido = process.argv.includes("--rapido");
/** Con «--solo=4», sólo ese criterio (y no se escribe el fichero de salida). */
const solo = process.argv.find((a) => a.startsWith("--solo="))?.slice(7);
const hacer = (c: string) => !solo || solo === c;
const lineas: string[] = [];
const decir = (s = "") => {
  console.log(s);
  lineas.push(s);
};
const pc = (x: number, n = 2) => `${(100 * x).toFixed(n)} %`;
const medir = <T>(f: () => T): [T, number] => {
  const t0 = performance.now();
  const r = f();
  return [r, (performance.now() - t0) / 1000];
};

interface Calculado {
  ef: EsfuerzosFranjas;
  casos: ResultadoCaso[];
  nudos: number;
  ecuaciones: number;
  tCalc: number;
}

function calculado(f: ModeloFisico, op: OpcionesCompilacion = {}, desfase = 0): Calculado {
  const r = compilar(f, op);
  if (!r.valido) throw new Error(r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join("\n"));
  const [c, tCalc] = medir(() => calcular(r.modelo));
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(c);
  const ctx = validar(f, resolverOpciones(op), new Diagnosticos())!;
  return { ef: new EsfuerzosFranjas(ctx, r, casos, { cortes: new Cortes(r.modelo), desfase }), casos, nudos: r.modelo.nudos.length, ecuaciones: c.estadisticas.ecuaciones, tCalc };
}

// ─── Criterio 2: Navier ───────────────────────────────────────────────────────────────────────
decir("# Fase F: validación de las franjas de armado");
if (hacer("2")) {
decir();
decir("## Criterio 2: placa de Navier (E3, 6 × 4 m apoyada en su contorno, q = −10 kN/m²)");
decir();
decir("Media de cada franja en cada estación de paso frente a la media de la serie de Mindlin en su ancho; error sobre el mayor |M| de la serie en la placa.");
decir();
decir("placa | h (m) | franjas X / Y | estaciones | mayor |M| serie (kN·m/m) | error máx. X | error máx. Y | error máx. a > 0,5 m del borde");
const GL8 = [
  [-0.9602898564975363, 0.1012285362903763],
  [-0.7966664774136267, 0.2223810344533745],
  [-0.525532409916329, 0.3137066458778873],
  [-0.1834346424956498, 0.362683783378362],
  [0.1834346424956498, 0.362683783378362],
  [0.525532409916329, 0.3137066458778873],
  [0.7966664774136267, 0.2223810344533745],
  [0.9602898564975363, 0.1012285362903763],
] as const;
for (const caso of CASOS_NAVIER.slice(0, 2)) {
  for (const h of rapido ? [0.25] : [0.25, 0.125]) {
    const c = calculado(navierFisico(caso), { tamanoMalla: h });
    const p = placaNavier(caso);
    let mMax = 0;
    for (let i = 0; i <= 24; i++) for (let j = 0; j <= 16; j++) mMax = Math.max(mMax, Math.abs(navierMindlin(p, (A * i) / 24, (B * j) / 16, 101)[1]), Math.abs(navierMindlin(p, (A * i) / 24, (B * j) / 16, 101)[2]));
    const err = { 1: 0, 2: 0, int: 0 };
    let n = 0;
    const fs = c.ef.franjas("L");
    for (const f of fs) {
      for (const e of c.ef.estaciones(f.id)!.estaciones) {
        if (e.tipo !== "paso" || !e.valido) continue;
        // Media de la serie en el ancho de la franja: M en sus ejes (Mx en X, My en Y)
        let m = 0;
        for (const [g, w] of GL8) {
          const t = (f.t0 + f.t1) / 2 + (g * (f.t1 - f.t0)) / 2;
          const [x, y] = f.direccion === 1 ? [e.s, t] : [t, e.s];
          const v = navierMindlin(p, x, y, 101);
          m += (w / 2) * (f.direccion === 1 ? v[1] : v[2]);
        }
        const d = Math.abs(e.medios[0]! - m) / mMax;
        err[f.direccion] = Math.max(err[f.direccion], d);
        const dentro = e.s > 0.5 && e.s < (f.direccion === 1 ? A : B) - 0.5;
        if (dentro) err.int = Math.max(err.int, d);
        n++;
      }
    }
    decir(`${caso.nombre} | ${h} | ${fs.filter((f) => f.direccion === 1).length} / ${fs.filter((f) => f.direccion === 2).length} | ${n} | ${mMax.toFixed(3)} | ${pc(err[1])} | ${pc(err[2])} | ${pc(err.int)}`);
  }
}

}

// ─── Criterio 4: convergencia y posición ─────────────────────────────────────────────────────
interface Demandas {
  /** Por franja: mayor demanda inferior en las de paso, y la superior de cada cara o apoyo (por su s y su lado). */
  porFranja: Map<string, { caras: Map<string, number>; vano: number }>;
  /** Por pilar y dirección: mayor demanda superior en las caras de las franjas que lo tocan. */
  porPilar: Map<string, number>;
}

function demandas(c: Calculado, combs: number[][]): Demandas {
  const porFranja = new Map<string, { caras: Map<string, number>; vano: number }>();
  const porPilar = new Map<string, number>();
  for (const f of c.ef.franjas()) {
    const r = c.ef.estaciones(f.id)!;
    const env = c.ef.envolvente(f.id, combs)!;
    let vano = 0;
    const caras = new Map<string, number>();
    r.estaciones.forEach((e, i) => {
      if (!e.valido) return;
      if (e.tipo === "paso") vano = Math.max(vano, env[i]!.inferior);
      else caras.set(`${e.tipo}${e.s.toFixed(6)}:${e.lado}`, env[i]!.superior);
      if (e.tipo === "cara")
        for (const p of e.piezas) {
          const k = `${p}:${f.direccion}`;
          porPilar.set(k, Math.max(porPilar.get(k) ?? 0, env[i]!.superior));
        }
    });
    porFranja.set(f.id, { caras, vano });
  }
  return { porFranja, porPilar };
}

if (hacer("4")) {
decir();
decir("## Criterio 4: convergencia y posición");
decir();
decir("Demanda de Wood–Armer con la suma de los casos: la superior de cada cara o apoyo (los que hay con las dos mallas: el recorte de las caras junto a otros pilares y a los vuelos depende de h) y la mayor inferior de los vanos de cada franja. Se comparan las de al menos el 20 % de la mayor de la losa.");
decir();
decir("losa | nudos h = 0,75 / 0,375 | caras y apoyos: comparadas, media / máx. | vanos: media / máx. | posición: pilares con demanda | media / máx. al correr media franja");
for (const [nombre, f, op] of [
  ["H25 losa plana (2 × 2 vanos, pilares en el borde)", losaPlanaFisica(), { ...OPCIONES_LOSA_PLANA }],
  ["H25 reticular con ábacos", reticularH25(), { ...OPCIONES_LOSA_PLANA }],
  ["losa plana de 3 × 3 vanos con vuelos de 0,5 m", losa3x3(), {}],
] as [string, ModeloFisico, OpcionesCompilacion][]) {
  const sinBandas = { ...f, bandas: undefined };
  const c1 = calculado(sinBandas, { ...op, tamanoMalla: 0.75 });
  const c2 = rapido ? c1 : calculado(sinBandas, { ...op, tamanoMalla: 0.375 });
  const combs = [c1.casos.map(() => 1)];
  const d1 = demandas(c1, combs);
  const d2 = demandas(c2, combs);
  const resumen = (ds: number[]) => `${pc(ds.reduce((a, b) => a + b, 0) / Math.max(1, ds.length), 1)} / ${pc(Math.max(0, ...ds), 1)}`;
  const difVanos = () => {
    const max = Math.max(...[...d2.porFranja.values()].map((x) => x.vano));
    const ds: number[] = [];
    for (const [id, v] of d2.porFranja) if (v.vano >= 0.2 * max) ds.push(Math.abs(d1.porFranja.get(id)!.vano / v.vano - 1));
    return resumen(ds);
  };
  const difCaras = () => {
    const max = Math.max(...[...d2.porFranja.values()].flatMap((x) => [...x.caras.values()]));
    const ds: number[] = [];
    for (const [id, v] of d2.porFranja)
      for (const [k, x] of v.caras) {
        const y = d1.porFranja.get(id)!.caras.get(k);
        if (y !== undefined && x >= 0.2 * max) ds.push(Math.abs(y / x - 1));
      }
    return `${ds.length}, ${resumen(ds)}`;
  };
  // Posición: las mismas franjas corridas media franja (la malla no cambia: las caras van de lado a lado)
  const ctx = validar(sinBandas, resolverOpciones({ ...op, tamanoMalla: 0.75 }), new Diagnosticos())!;
  const r = compilar(sinBandas, { ...op, tamanoMalla: 0.75 });
  if (!r.valido) throw new Error("no compila");
  const corrida: Calculado = { ...c1, ef: new EsfuerzosFranjas(ctx, r, c1.casos, { desfase: 0.5 }) };
  const dc = demandas(corrida, combs);
  const ps: number[] = [];
  const maxP = Math.max(...d1.porPilar.values());
  for (const [k, v] of d1.porPilar) {
    if (v < 0.2 * maxP) continue;
    const w = dc.porPilar.get(k);
    if (w !== undefined) ps.push(w / v - 1);
  }
  decir(`${nombre} | ${c1.nudos} / ${c2.nudos} | ${difCaras()} | ${difVanos()} | ${ps.length} | ${pc(ps.reduce((a, b) => a + b, 0) / Math.max(1, ps.length), 1)} / ${pc(Math.min(0, ...ps), 1)} … ${pc(Math.max(0, ...ps), 1)}`);
}

}

/** La losa plana de los tests (`franjas.test.ts`): 3 × 3 vanos de 6 × 5 m, 16 pilares de 30 × 30 y vuelos de 0,5 m. */
function losa3x3(): ModeloFisico {
  const pilares = [];
  for (const x of [0, 6, 12, 18]) for (const y of [0, 5, 10, 15]) pilares.push({ id: `P${x}-${y}`, x, y, desde: "C", hasta: "P1", seccion: "p" });
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "C", tipo: "sotano", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares,
    losas: [{ id: "L", planta: "P1", contorno: [[-0.5, -0.5], [18.5, -0.5], [18.5, 15.5], [-0.5, 15.5]], espesor: 0.25, material: "HA" }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -10] }],
  };
}

// ─── Criterio 5: malla ───────────────────────────────────────────────────────────────────────
const sinVigas = (f: ModeloFisico): ModeloFisico => ({ ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") });
const plantas = rapido ? 2 : 7;
if (hacer("5")) {
decir();
decir("## Criterio 5: malla del edificio objetivo (7 plantas, h = 0,75)");
decir();
decir("modelo | sin caras: nudos / ecuaciones | con caras: nudos / ecuaciones | crecimiento (ecuaciones) | perfil móvil (≤ 200 000) | avisos de malla sin / con");
for (const [nombre, f] of [
  ["losa plana", sinVigas(edificioObjetivoLosas(plantas))],
  ["maciza con vigas", edificioObjetivoLosas(plantas)],
  ["reticular con ábacos (V2 de C4)", edificioReticular(plantas)],
] as [string, ModeloFisico][]) {
  const fila: string[] = [];
  const avisos: number[] = [];
  let eqs: number[] = [];
  for (const franjas of [false, true]) {
    const r = compilar(f, { franjas });
    if (!r.valido) throw new Error(`${nombre}: no compila`);
    const c = calcular(r.modelo);
    if (!c.valido) throw new Error(`${nombre}: no calcula`);
    fila.push(`${r.modelo.nudos.length} / ${c.estadisticas.ecuaciones}`);
    eqs.push(c.estadisticas.ecuaciones);
    avisos.push(r.diagnosticos.filter((d) => d.codigo.startsWith("malla/")).length);
  }
  decir(`${nombre} | ${fila[0]} | ${fila[1]} | ×${(eqs[1]! / eqs[0]!).toFixed(2)} | ${eqs[1]! <= 200_000 ? "cabe" : "no cabe"} | ${avisos[0]} / ${avisos[1]}`);
  eqs = [];
}

}

// ─── Criterio 7: rendimiento ─────────────────────────────────────────────────────────────────
if (hacer("7")) {
decir();
decir("## Criterio 7: rendimiento en el edificio objetivo (losa plana y con vigas, 7 plantas)");
decir();
decir("modelo | franjas | estaciones | combinaciones ELU-PT | calcular (s) | primera planta (s) | otra planta (s) | edificio entero (s) | franjas / cálculo");
for (const [nombre, f] of [
  ["losa plana", conAcciones(sinVigas(edificioObjetivoLosas(plantas)))],
  ["maciza con vigas", conAcciones(edificioObjetivoLosas(plantas))],
] as [string, ModeloFisico][]) {
  const r = compilar(f);
  if (!r.valido) throw new Error("no compila");
  const [c, tCalc] = medir(() => calcular(r.modelo));
  if (!c.valido) throw new Error("no calcula");
  const q = new Consultas(f, r, casosValidos(c));
  const elu = q.combinaciones({ situaciones: ["ELU-PT"] });
  if (!elu.valido) throw new Error("sin combinaciones");
  const combs = elu.valor.map((x) => x.factores);
  let estaciones = 0;
  const planta = (l: string) => {
    for (const fr of q.franjas(l).valido ? (q.franjas(l) as { valor: { id: string }[] }).valor : []) {
      const e = q.franja(fr.id);
      if (!e.valido) throw new Error(fr.id);
      estaciones += e.valor.estaciones.length;
      q.armadoFranja(fr.id, combs);
    }
  };
  const losas = f.losas!.map((l) => l.id);
  const [, t1] = medir(() => planta(losas[0]!));
  const [, t2] = medir(() => planta(losas[1]!));
  const [, tResto] = medir(() => losas.slice(2).forEach(planta));
  const nf = q.franjas().valido ? (q.franjas() as { valor: unknown[] }).valor.length : 0;
  const total = t1 + t2 + tResto;
  decir(`${nombre} | ${nf} | ${estaciones} | ${combs.length} | ${tCalc.toFixed(1)} | ${t1.toFixed(2)} | ${t2.toFixed(2)} | ${total.toFixed(1)} | ${pc(total / tCalc, 0)}`);
}

}

if (!rapido && !solo) writeFileSync(join(import.meta.dirname, "out_validacion.txt"), lineas.join("\n") + "\n", { encoding: "utf8" });
