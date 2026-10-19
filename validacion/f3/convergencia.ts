/**
 * Fase F3 (`docs/fem3d/cara-propia.md`), criterios 2 y 3: el metro de cada pilar en su cara.
 *
 * - Criterio 3 (convergencia): el metro centrado en cada pilar con cara, con h = 0,75 (con y sin el
 *   refinamiento) y 0,5, frente a la malla fina (h = 0,1 en la 3 × 3; 0,15 en el edificio, que con
 *   0,1 no cabe), por grupos: las caras en las que la común
 *   cae dentro de la huella («común por dentro»), las propias y las de los pilares a menos de 1 m de
 *   un hueco (F2-9). «Antes» es la estación de F2 en la cara común, que sale sin el enlace de la
 *   huella en el mapeo (el respaldo de F3).
 * - Criterio 2 (equivalencia): en una malla que siembra la cara propia en la ventana (la
 *   triangulación con h = 0,2 y una banda de 0,3 m del lado del vano), el corte recto por la cara
 *   propia (con lo que transmite la huella: los nudos rígidos de F2-9 delante de ella) frente a la
 *   estación en escalón.
 *
 * Uso: bun validacion/f3/convergencia.ts → validacion/f3/out_convergencia.txt (con SOLO=<parte del
 * nombre>, sólo ese modelo, sin escribir la salida).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pilaresEnLosa, semiextension } from "../../src/compilador/bandas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosFranjas } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion, type Vec2 } from "../../src/compilador/fisico.ts";
import { carasFranjas, ejesArmado, tramosRecta } from "../../src/compilador/franjas.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { losa3x3Mezclada } from "./modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const sinVigas = (f: ModeloFisico): ModeloFisico => ({ ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") });

interface Cara {
  /** losa|dirección|lado|pilar */
  clave: string;
  /** Suma de los casos, kN·m/m. */
  m: number;
  s: number;
  grupo: "común por dentro" | "propia" | "junto a un hueco";
  /**
   * En una cara propia, el corte por la cara en la ventana cambia más de un 0,5 % con lo que
   * transmite la huella: tiene nudos rígidos delante de la cara (F2-9), por los que pasa momento
   * que la estación no cuenta (o le faltan láminas con los cuatro nudos rígidos), así que sale baja.
   */
  f29: boolean;
}

/** Una cara de pilar con su recta común y su cara propia. */
interface CaraPilar {
  losa: string;
  planta: string;
  direccion: 1 | 2;
  lado: -1 | 1;
  pilar: string;
  comun: number;
  propia: number;
  tc: number;
  d: Vec2;
  n: Vec2;
  grupo: Cara["grupo"];
}

function carasPilares(f: ModeloFisico, op: OpcionesCompilacion): CaraPilar[] {
  const ctx = validar(f, resolverOpciones(op), new Diagnosticos())!;
  const r: CaraPilar[] = [];
  for (const l of ctx.losas) {
    const pil = new Map(pilaresEnLosa(ctx, l).map((p) => [p.id, p]));
    for (const c of carasFranjas(ctx, l)) {
      const { d, n } = ejesArmado(l.losa)[c.direccion];
      for (const q of c.pilares) {
        const p = pil.get(q.id)!;
        const propia = p.p[0] * d[0] + p.p[1] * d[1] + c.lado * semiextension(p.huella, d);
        const hueco = (l.losa.huecos ?? []).some((h) => {
          const xs = h.map((v) => v[0]);
          const ys = h.map((v) => v[1]);
          const [ex, ey] = [semiextension(p.huella, [1, 0]), semiextension(p.huella, [0, 1])];
          const dx = Math.max(Math.min(...xs) - (p.p[0] + ex), 0, p.p[0] - ex - Math.max(...xs));
          const dy = Math.max(Math.min(...ys) - (p.p[1] + ey), 0, p.p[1] - ey - Math.max(...ys));
          return Math.hypot(dx, dy) < 1;
        });
        r.push({ losa: l.losa.id, planta: l.losa.planta, direccion: c.direccion, lado: c.lado, pilar: q.id, comun: c.s, propia, tc: (q.t0 + q.t1) / 2, d, n, grupo: hueco ? "junto a un hueco" : Math.abs(propia - c.s) > 1e-6 ? "común por dentro" : "propia" });
      }
    }
  }
  return r;
}

/** El metro de cada pilar con cara (la estación con ventana), por su clave; con `antes`, la estación de F2 (sin el enlace de la huella). */
function metros(f: ModeloFisico, op: OpcionesCompilacion, antes = false): { caras: Map<string, Cara>; nudos: number; avisos: string[] } {
  const r = compilar(f, op);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo));
  const ctx = validar(f, resolverOpciones(op), new Diagnosticos())!;
  const mapeo = antes ? { ...r.mapeo, restricciones: [] } : r.mapeo;
  const cortes = new Cortes(r.modelo);
  const ef = new EsfuerzosFranjas(ctx, { modelo: r.modelo, mapeo }, casos, { cortes });
  const z = (planta: string) => ctx.cotas[ctx.planta.get(planta)!]!;
  const huella = (pilar: string, planta: string) => r.modelo.restricciones!.find((_, i) => r.mapeo.restricciones[i]!.pilar === pilar && r.mapeo.restricciones[i]!.planta === planta)?.id;
  /** ¿Cambia el corte por la cara propia, en la ventana (por centroides), con la huella? */
  const conF29 = (cp: CaraPilar, ventana: readonly [number, number]) => {
    const id = huella(cp.pilar, cp.planta);
    if (id === undefined) return false;
    const sx = cp.lado === -1 ? 1 : -1;
    const x: [number, number, number] = [sx * cp.d[0], sx * cp.d[1], 0];
    const sigma = Math.sign(cp.n[0] * -x[1] + cp.n[1] * x[0]);
    const O: Vec2 = [cp.propia * cp.d[0] + ventana[0] * cp.n[0], cp.propia * cp.d[1] + ventana[0] * cp.n[1]];
    const ancho = ventana[1] - ventana[0];
    const m = (restricciones: string[]) => {
      const res = cortes.cortar({ origen: [O[0], O[1], z(cp.planta)], x, vz: [0, 0, 1], y: sigma > 0 ? [0, ancho] : [-ancho, 0], soloLaminas: true, restricciones }, casos);
      return res.valido ? [...Array(casos.length).keys()].reduce((a, k) => a + res.esfuerzos[6 * k + 4]!, 0) : NaN;
    };
    const [sin, con] = [m([]), m([id])];
    // Si el corte recto por la cara propia no sigue la malla (NaN: la estación va por el escalón desde
    // la recta común, F3), no se puede comprobar, y no es F2-9 (antes de la fase HR, NaN contaba como sí)
    if (!Number.isFinite(con) || !Number.isFinite(sin)) return false;
    return !(Math.abs(con / sin - 1) <= 0.005);
  };
  const cps = carasPilares(f, op);
  const caras = new Map<string, Cara>();
  for (const l of ctx.losas)
    for (const fr of ef.franjas(l.losa.id))
      for (const e of ef.estaciones(fr.id)!.estaciones) {
        if (e.tipo !== "cara" || !e.ventana) continue;
        const tc = (e.ventana[0] + e.ventana[1]) / 2;
        const cp = cps.find((x) => x.losa === l.losa.id && x.direccion === fr.direccion && x.lado === e.lado && Math.abs(x.tc - tc) < 1e-6 && (Math.abs(x.comun - e.s) < 1e-6 || Math.abs(x.propia - e.s) < 1e-6));
        if (!cp) continue;
        let m = 0;
        for (let k = 0; k < casos.length; k++) m += e.medios[3 * k]!;
        const clave = `${cp.losa}|${cp.direccion}|${cp.lado}|${cp.pilar}`;
        const enLosa = tramosRecta(l.region, cp.d, cp.n, e.s).reduce((a, [p, q]) => a + Math.max(0, Math.min(q, e.ventana![1]) - Math.max(p, e.ventana![0])), 0);
        caras.set(clave, { clave, m, s: e.s, grupo: cp.grupo, f29: cp.grupo !== "común por dentro" && (e.anchoEnLosa < enLosa - 1e-3 || conF29(cp, e.ventana)) });
      }
  const avisos = [...new Set(r.diagnosticos.filter((d) => d.codigo.startsWith("malla/") || d.codigo === "franja/cara-comun-dentro").map((d) => d.codigo))];
  return { caras, nudos: r.modelo.nudos.length, avisos };
}

/**
 * Criterio 2: en la triangulación con h que siembra, con una banda, la cara propia en la ventana (y
 * los bordes de la ventana del lado del vano; hasta la recta común no se puede, porque está a ε_snap),
 * el corte recto por la cara propia (con la huella) y la estación.
 */
function equivalencia(f: ModeloFisico, op: OpcionesCompilacion, cp: CaraPilar): { recto: number; escalon: number } {
  const [w0, w1] = [cp.tc - 0.5, cp.tc + 0.5];
  // Del lado del vano (s mayores con lado = +1)
  const s0 = cp.propia + cp.lado * 0.3;
  const sm = (s0 + cp.propia) / 2;
  const P = (s: number, t: number): Vec2 => [s * cp.d[0] + t * cp.n[0], s * cp.d[1] + t * cp.n[1]];
  const g: ModeloFisico = { ...f, bandas: [{ id: "B-cara", planta: cp.planta, desde: P(sm, w0), hasta: P(sm, w1), ancho: 0.3 }] };
  const r = compilar(g, op);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo));
  const cortes = new Cortes(r.modelo);
  const ctx = validar(g, resolverOpciones(op), new Diagnosticos())!;
  const ef = new EsfuerzosFranjas(ctx, r, casos, { cortes });
  let escalon = NaN;
  for (const fr of ef.franjas(cp.losa))
    if (fr.direccion === cp.direccion)
      for (const e of ef.estaciones(fr.id)!.estaciones)
        if (e.tipo === "cara" && e.ventana && e.lado === cp.lado && Math.abs(e.s - cp.propia) < 1e-6 && Math.abs((e.ventana[0] + e.ventana[1]) / 2 - cp.tc) < 1e-6) escalon = [...Array(casos.length).keys()].reduce((a, k) => a + e.medios[3 * k]!, 0);
  const huella = r.modelo.restricciones!.find((_, i) => r.mapeo.restricciones[i]!.pilar === cp.pilar && r.mapeo.restricciones[i]!.planta === cp.planta)!.id;
  const z = ctx.cotas[ctx.planta.get(cp.planta)!]!;
  const sx = cp.lado === -1 ? 1 : -1;
  const x: [number, number, number] = [sx * cp.d[0], sx * cp.d[1], 0];
  const y: Vec2 = [-x[1], x[0]];
  const sigma = Math.sign(cp.n[0] * y[0] + cp.n[1] * y[1]);
  const O = P(cp.propia, w0);
  const res = cortes.cortar({ id: "recto", origen: [O[0], O[1], z], x, vz: [0, 0, 1], y: sigma > 0 ? [0, w1 - w0] : [-(w1 - w0), 0], soloLaminas: true, restricciones: [huella] }, casos);
  if (!res.valido) throw new Error(`corte recto no válido: ${res.diagnosticos.map((d) => d.mensaje).join(", ")}`);
  const recto = [...Array(casos.length).keys()].reduce((a, k) => a + res.esfuerzos[6 * k + 4]!, 0) / (w1 - w0);
  return { recto, escalon };
}

/**
 * Criterio 2, el método: en la malla de la plantilla refinada (h = 0,75), que lleva las dos rectas de
 * lado a lado del bloque, los dos cortes con la misma ventana, de un nudo a otro de la malla (sin el
 * reparto de F-6): el recto por la cara propia y el de la recta común, los dos con la huella, con el
 * momento trasladado a la cara propia. Sólo difieren en las dos tiras de losa entre las rectas.
 */
function mismoCorte(f: ModeloFisico, op: OpcionesCompilacion, cp: CaraPilar): { recto: number; escalon: number; ventana: [number, number] } {
  const r = compilar(f, op);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo));
  const cortes = new Cortes(r.modelo);
  const ctx = validar(f, resolverOpciones(op), new Diagnosticos())!;
  const sDe = (q: { x: number; y: number }) => q.x * cp.d[0] + q.y * cp.d[1];
  const tDe = (q: { x: number; y: number }) => q.x * cp.n[0] + q.y * cp.n[1];
  const ts = (s0: number) => new Set(r.modelo.nudos.filter((q) => Math.abs(sDe(q) - s0) < 1e-6 && Math.abs(tDe(q) - cp.tc) < 0.75).map((q) => Math.round(tDe(q) * 1e6)));
  const [propia, comun] = [ts(cp.propia), ts(cp.comun)];
  const enLasDos = [...propia].filter((t) => comun.has(t)).map((t) => t / 1e6);
  // La ventana: los nudos de las dos rectas más alejados del pilar a menos de 0,6 m de su centro
  const w0 = Math.min(...enLasDos.filter((t) => t >= cp.tc - 0.6));
  const w1 = Math.max(...enLasDos.filter((t) => t <= cp.tc + 0.6));
  const huella = r.modelo.restricciones!.find((_, i) => r.mapeo.restricciones[i]!.pilar === cp.pilar && r.mapeo.restricciones[i]!.planta === cp.planta)!.id;
  const z = ctx.cotas[ctx.planta.get(cp.planta)!]!;
  const sx = cp.lado === -1 ? 1 : -1;
  const x: [number, number, number] = [sx * cp.d[0], sx * cp.d[1], 0];
  const y: Vec2 = [-x[1], x[0]];
  const sigma = Math.sign(cp.n[0] * y[0] + cp.n[1] * y[1]);
  const corte = (s0: number) => {
    const O: Vec2 = [s0 * cp.d[0] + w0 * cp.n[0], s0 * cp.d[1] + w0 * cp.n[1]];
    const res = cortes.cortar({ id: `s = ${s0}`, origen: [O[0], O[1], z], x, vz: [0, 0, 1], y: sigma > 0 ? [0, w1 - w0] : [-(w1 - w0), 0], soloLaminas: true, restricciones: [huella] }, casos);
    if (!res.valido) throw new Error(`corte no válido: ${res.diagnosticos.map((d) => d.mensaje).join(", ")}`);
    const dx = (cp.propia - s0) * sx;
    return [...Array(casos.length).keys()].reduce((a, k) => a + res.esfuerzos[6 * k + 4]! - dx * res.esfuerzos[6 * k + 2]!, 0) / (w1 - w0);
  };
  return { recto: corte(cp.propia), escalon: corte(cp.comun), ventana: [w0, w1] };
}

const lineas: string[] = ["# Fase F3: el metro de cada pilar en su cara", ""];
const decir = (s = "") => {
  lineas.push(s);
  console.log(s);
};
const pc = (x: number) => `${(100 * x).toFixed(2)} %`;

decir("## Criterio 3: convergencia frente a la malla fina");
decir();
decir("Caras con demanda (|m| ≥ 20 % de la mayor de la referencia); media y máximo de |error|, y el peor con su signo. Desde la fase HR (sólo la huella es rígida) ninguna cara de la referencia pierde por F2-9 (nudos rígidos delante de la cara o láminas con los cuatro nudos rígidos): se comprueba y se dice cuántas hay, que tienen que ser 0.");
decir();
decir("modelo | malla | estación | grupo | caras | media | máx. | peor | nudos | avisos");
const modelos: [string, ModeloFisico, number][] = [
  ["3 × 3 vanos con P6-5 de 40 × 40 y P12-10 de 30 × 50", losa3x3Mezclada(), 0.1],
  ["edificio objetivo, 1 planta, losa plana", sinVigas(edificioObjetivoLosas(1)), 0.15],
  // El mismo con 4 × 3 vanos (el hueco en el último), para una referencia de 0,1
  ["edificio objetivo reducido (4 × 3 vanos), 1 planta, losa plana", sinVigas(edificioObjetivoLosas(1, 4, 3)), 0.1],
];
for (const [nombre, f, hRef] of modelos) {
  if ((process.env.SOLO && !nombre.includes(process.env.SOLO)) || process.env.CRITERIO === "2") continue;
  const ref = metros(f, { tamanoMalla: hRef });
  const mayor = Math.max(...[...ref.caras.values()].map((c) => Math.abs(c.m)));
  decir(`${nombre} | referencia h = ${String(hRef).replace(".", ",")} | F3 | — | ${ref.caras.size} | — | — | — | ${ref.nudos} | ${ref.avisos.join(", ") || "—"}`);
  for (const [malla, op, antes] of [
    ["h = 0,75 con F3", { tamanoMalla: 0.75 }, false],
    ["h = 0,75 con F3", { tamanoMalla: 0.75 }, true],
    ["h = 0,75 sin refinar", { tamanoMalla: 0.75, refinoCaras: false }, false],
    ["h = 0,5", { tamanoMalla: 0.5 }, false],
  ] as [string, OpcionesCompilacion, boolean][]) {
    const r = metros(f, op, antes);
    const grupos = new Map<string, number[]>();
    const excluidas = new Set<string>();
    for (const [k, c] of r.caras) {
      const v = ref.caras.get(k);
      if (!v || Math.abs(v.m) < 0.2 * mayor) continue;
      // Fase HR: ya no se excluye ninguna; se cuentan (tienen que ser 0)
      if (v.f29) excluidas.add(k);
      grupos.set(c.grupo, [...(grupos.get(c.grupo) ?? []), c.m / v.m - 1]);
      if (process.env.DETALLE && !antes && malla.includes("0,75 con")) console.log(`  ${k} (${c.grupo}): ${c.m.toFixed(2)} frente a ${v.m.toFixed(2)} → ${pc(c.m / v.m - 1)}`);
    }
    for (const g of ["común por dentro", "propia", "junto a un hueco"]) {
      const e = grupos.get(g);
      if (!e) continue;
      const abs = e.map(Math.abs);
      const max = Math.max(...abs);
      decir(`${nombre} | ${malla} | ${antes ? "antes (cara común, F2)" : "F3"} | ${g} | ${e.length} | ${pc(abs.reduce((a, x) => a + x, 0) / abs.length)} | ${pc(max)} | ${pc(e[abs.indexOf(max)]!)} | ${r.nudos} | ${r.avisos.join(", ") || "—"}`);
    }
    if (!antes && malla.includes("0,75 con")) decir(`${nombre} | — | — | caras cuya referencia tiene F2-9 (tienen que ser 0) | ${excluidas.size} | — | — | — | — | ${[...excluidas].join(", ") || "—"}`);
  }
}

decir();
decir("## Criterio 2: el escalón frente al corte recto por la cara propia");
decir();
decir("1. El método: con h = 0,75, en la red de la plantilla refinada (que lleva las dos rectas), los dos cortes con la misma ventana, de nudo a nudo, sin el reparto de F-6.");
decir();
decir("modelo | cara | ventana (m) | recto (kN·m/m) | escalón | diferencia");
for (const [nombre, f, casos] of [
  // P6-5 no: con la esquina bloqueada en las dos direcciones (la transición de esquina de F2), su
  // cara propia no sigue la malla fuera de la huella
  ["3 × 3 mezclada", losa3x3Mezclada(), [["P12-10", 1, -1], ["P12-10", 1, 1]]],
  ["edificio objetivo, 1 planta", sinVigas(edificioObjetivoLosas(1)), [["P42-15", 1, -1], ["P48-10", 1, -1], ["P18-10", 2, 1]]],
] as [string, ModeloFisico, [string, 1 | 2, -1 | 1][]][]) {
  if (process.env.SOLO && !nombre.includes(process.env.SOLO)) continue;
  const op: OpcionesCompilacion = { tamanoMalla: 0.75 };
  const cps = carasPilares(f, op);
  for (const [pilar, dir, lado] of casos) {
    const cp = cps.find((x) => x.pilar === pilar && x.direccion === dir && x.lado === lado)!;
    const { recto, escalon, ventana } = mismoCorte(f, op, cp);
    decir(`${nombre} | ${pilar}, ${dir === 1 ? "x" : "y"} = ${cp.propia.toFixed(2)} | ${ventana.map((t) => t.toFixed(3)).join(" a ")} | ${recto.toFixed(2)} | ${escalon.toFixed(2)} | ${pc(escalon / recto - 1)}`);
  }
}
decir();
decir("2. La estación: en la triangulación con h = 0,2 y una banda de 0,3 m que siembra la cara propia en la ventana (con sus bordes del lado del vano), el corte recto por la cara propia, de borde a borde, y la estación, con el reparto de F-6 en los bordes de la ventana por la recta común.");
decir();
decir("modelo | cara | recto (kN·m/m) | estación | diferencia");
for (const [nombre, f, casos] of [
  ["3 × 3 mezclada", losa3x3Mezclada(), [["P6-5", 1, -1], ["P6-5", 2, 1], ["P12-10", 1, 1]]],
  ["edificio objetivo, 1 planta", sinVigas(edificioObjetivoLosas(1)), [["P42-15", 1, -1], ["P48-10", 1, -1], ["P18-10", 2, 1]]],
] as [string, ModeloFisico, [string, 1 | 2, -1 | 1][]][]) {
  if (process.env.SOLO && !nombre.includes(process.env.SOLO)) continue;
  const op: OpcionesCompilacion = { tamanoMalla: Number(process.env.H_CDT ?? 0.2), rejilla: false };
  const cps = carasPilares(f, op);
  for (const [pilar, dir, lado] of casos) {
    const cp = cps.find((x) => x.pilar === pilar && x.direccion === dir && x.lado === lado)!;
    const { recto, escalon } = equivalencia(f, op, cp);
    decir(`${nombre} | ${pilar}, ${dir === 1 ? "x" : "y"} = ${cp.propia.toFixed(2)} | ${recto.toFixed(2)} | ${escalon.toFixed(2)} | ${pc(escalon / recto - 1)}`);
  }
}
if (!process.env.SOLO) writeFileSync(join(import.meta.dirname, "out_convergencia.txt"), lineas.join("\n") + "\n", { encoding: "utf8" });
