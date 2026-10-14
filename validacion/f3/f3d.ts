/**
 * F3-d (`docs/fem3d/fase-f3.md` §4): el metro de todos los pilares cuenta lo que transmite su huella
 * por sus nudos delante de la cara (los de F2-9), no sólo el de los pilares mayores (el escalón).
 *
 * - A. Cuánto mueve la referencia congelada de F: cada estación de sus modelos con F3-d y sin él
 *   (`huellaDelante: false`, la estación de F3).
 * - B. Junto al hueco del edificio, donde F2-9 pesa más: el metro de cada pilar con cara, con h = 0,75
 *   y 0,5, con y sin F3-d, frente a la malla fina con F3-d (h = 0,15 en el edificio, que con 0,1 no
 *   cabe; 0,1 en el reducido y en la 3 × 3), por grupos. Las caras en las que F3-d mueve la
 *   referencia (con nudos rígidos delante en la malla fina, F3-5) van aparte: su referencia es la de
 *   un pilar 5 cm mayor, así que no es la buena; se dan con la de h = 0,15 en la 3 × 3, que no los
 *   tiene, para verlo.
 * - C. Lo que deja F2-9 con F3-d: en la 3 × 3 con h = 0,1, las caras con nudos rígidos delante,
 *   frente a las mallas que no los tienen (h = 0,15 a 0,75).
 *
 * Uso: bun validacion/f3/f3d.ts → validacion/f3/out_f3d.txt (con SOLO=A, B o C, sólo esa parte, y
 * con MODELO=<parte del nombre>, sólo ese modelo en B; así no se escribe la salida).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pilaresEnLosa, semiextension } from "../../src/compilador/bandas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosFranjas } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { carasFranjas, ejesArmado } from "../../src/compilador/franjas.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { MODELOS_CONGELADOS_F } from "../f/congelar.ts";
import { losa3x3Mezclada } from "./modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const lineas: string[] = ["# F3-d: el metro de todos los pilares con lo que transmite su huella", ""];
const decir = (s = "") => {
  lineas.push(s);
  console.log(s);
};
const pc = (x: number) => `${(100 * x).toFixed(2)} %`;
const parte = (p: string) => !process.env.SOLO || process.env.SOLO === p;

/** Compila, calcula y prepara las franjas con F3-d y sin él. */
function preparar(f: ModeloFisico, op: OpcionesCompilacion) {
  const r = compilar(f, op);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo));
  const ctx = validar(f, resolverOpciones(op), new Diagnosticos())!;
  const cortes = new Cortes(r.modelo);
  return {
    r,
    casos,
    ctx,
    con: new EsfuerzosFranjas(ctx, r, casos, { cortes }),
    sin: new EsfuerzosFranjas(ctx, r, casos, { cortes, huellaDelante: false }),
  };
}

if (parte("A")) {
  decir("## A. La referencia congelada de F");
  decir();
  decir("Cada estación de cada franja, con F3-d y sin él (la de F3). «Cambian»: las estaciones con algún momento medio distinto en algún bit; la diferencia, en mx (la suma de los casos), relativa a la mayor |mx| de cara del modelo.");
  decir();
  decir("modelo | estaciones | cambian | pilares | mayor diferencia | dónde | avisos nuevos");
  for (const [nombre, fm] of Object.entries(MODELOS_CONGELADOS_F)) {
    const { fisico, opciones } = fm();
    const { ctx, casos, con, sin } = preparar(fisico, opciones ?? {});
    const nc = casos.length;
    const mx = (m: Float64Array) => [...Array(nc).keys()].reduce((a, k) => a + m[3 * k]!, 0);
    let total = 0;
    let cambian = 0;
    const pilares = new Set<string>();
    const mayor = Math.max(...con.franjas().flatMap((fr) => con.estaciones(fr.id)!.estaciones.filter((e) => e.tipo === "cara" && e.valido).map((e) => Math.abs(mx(e.medios)))));
    let peor = { d: 0, donde: "—" };
    const avisos = new Set<string>();
    for (const l of ctx.losas)
      for (const fr of con.franjas(l.losa.id)) {
        const a = con.estaciones(fr.id)!.estaciones;
        const b = sin.estaciones(fr.id)!.estaciones;
        if (a.length !== b.length) throw new Error(`${nombre} ${fr.id}: ${a.length} ≠ ${b.length} estaciones`);
        a.forEach((e, j) => {
          total++;
          const o = b[j]!;
          for (const d of e.diagnosticos) if (!o.diagnosticos.some((x) => x.codigo === d.codigo)) avisos.add(d.codigo);
          if (e.s !== o.s || e.anchoEnLosa !== o.anchoEnLosa || e.medios.some((v, q) => !Object.is(v, o.medios[q]))) {
            cambian++;
            e.piezas.forEach((p) => pilares.add(p));
            const d = (mx(e.medios) - mx(o.medios)) / mayor;
            if (Math.abs(d) > Math.abs(peor.d)) peor = { d, donde: `${fr.id} s = ${e.s.toFixed(3)} (${e.piezas.join(", ")}): ${mx(o.medios).toFixed(2)} → ${mx(e.medios).toFixed(2)} kN·m/m` };
          }
        });
      }
    decir(`${nombre} | ${total} | ${cambian} | ${[...pilares].sort().join(", ") || "—"} | ${pc(peor.d)} | ${peor.donde} | ${[...avisos].join(", ") || "—"}`);
  }
  decir();
}

/** Una cara de pilar: su clave y su grupo. */
interface CaraPilar {
  clave: string;
  losa: string;
  direccion: 1 | 2;
  lado: -1 | 1;
  tc: number;
  comun: number;
  propia: number;
  grupo: "común por dentro" | "propia" | "junto a un hueco";
}

function carasPilares(f: ModeloFisico, op: OpcionesCompilacion): CaraPilar[] {
  const ctx = validar(f, resolverOpciones(op), new Diagnosticos())!;
  const r: CaraPilar[] = [];
  for (const l of ctx.losas) {
    const pil = new Map(pilaresEnLosa(ctx, l).map((p) => [p.id, p]));
    for (const c of carasFranjas(ctx, l)) {
      const { d } = ejesArmado(l.losa)[c.direccion];
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
        r.push({ clave: `${l.losa.id}|${c.direccion}|${c.lado}|${q.id}`, losa: l.losa.id, direccion: c.direccion, lado: c.lado, tc: (q.t0 + q.t1) / 2, comun: c.s, propia, grupo: hueco ? "junto a un hueco" : Math.abs(propia - c.s) > 1e-6 ? "común por dentro" : "propia" });
      }
    }
  }
  return r;
}

/** El metro de cada pilar con cara (suma de los casos), con F3-d y sin él. */
function metros(f: ModeloFisico, op: OpcionesCompilacion) {
  const { r, ctx, casos, con, sin } = preparar(f, op);
  const cps = carasPilares(f, op);
  const leer = (ef: EsfuerzosFranjas) => {
    const m = new Map<string, number>();
    for (const l of ctx.losas)
      for (const fr of ef.franjas(l.losa.id))
        for (const e of ef.estaciones(fr.id)!.estaciones) {
          if (e.tipo !== "cara" || !e.ventana) continue;
          const tc = (e.ventana[0] + e.ventana[1]) / 2;
          const cp = cps.find((x) => x.losa === l.losa.id && x.direccion === fr.direccion && x.lado === e.lado && Math.abs(x.tc - tc) < 1e-6 && (Math.abs(x.comun - e.s) < 1e-6 || Math.abs(x.propia - e.s) < 1e-6));
          if (cp) m.set(cp.clave, [...Array(casos.length).keys()].reduce((a, k) => a + e.medios[3 * k]!, 0));
        }
    return m;
  };
  const avisos = [...new Set([...r.diagnosticos, ...ctx.losas.flatMap((l) => con.franjas(l.losa.id).flatMap((fr) => con.estaciones(fr.id)!.estaciones.flatMap((e) => e.diagnosticos)))].filter((d) => d.codigo.startsWith("malla/") || d.codigo.startsWith("franja/cara-")).map((d) => d.codigo))];
  return { con: leer(con), sin: leer(sin), grupo: new Map(cps.map((c) => [c.clave, c.grupo])), nudos: r.modelo.nudos.length, avisos };
}

if (parte("B")) {
  const sinVigas = (f: ModeloFisico): ModeloFisico => ({ ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") });
  decir("## B. Convergencia, con el hueco del edificio");
  decir();
  decir("El metro de cada pilar con cara y demanda (|m| ≥ 20 % de la mayor de la referencia), frente a la malla fina con F3-d; media y máximo de |error|, y el peor con su signo. «Cambian»: las caras en las que F3-d mueve la estación (tienen nudos de la huella delante). «Ref. con F2-9»: las caras en las que F3-d mueve la referencia (sus nudos rígidos delante la hacen la de un pilar 5 cm mayor).");
  decir();
  decir("modelo | malla | F3-d | grupo | caras | cambian | media | máx. | peor | nudos | avisos");
  const modelos: [string, ModeloFisico, number][] = [
    ["3 × 3 mezclada", losa3x3Mezclada(), 0.1],
    ["edificio objetivo reducido (4 × 3 vanos, hueco en el último)", sinVigas(edificioObjetivoLosas(1, 4, 3)), 0.1],
    ["edificio objetivo, 1 planta, losa plana", sinVigas(edificioObjetivoLosas(1)), 0.15],
  ];
  for (const [nombre, f, hRef] of modelos) {
    if (process.env.MODELO && !nombre.includes(process.env.MODELO)) continue;
    const ref = metros(f, { tamanoMalla: hRef });
    const mayor = Math.max(...[...ref.con.values()].map(Math.abs));
    // La referencia misma: cuántas caras mueve F3-d y cuánto
    const dRef = [...ref.con].filter(([k, v]) => v !== ref.sin.get(k)).map(([k, v]) => ({ k, d: v / ref.sin.get(k)! - 1 }));
    const peorRef = dRef.reduce((a, x) => (Math.abs(x.d) > Math.abs(a.d) ? x : a), { k: "—", d: 0 });
    decir(`${nombre} | referencia h = ${String(hRef).replace(".", ",")} | sí | — | ${ref.con.size} | ${dRef.length} | — | — | ${pc(peorRef.d)} (${peorRef.k}, frente a sin F3-d) | ${ref.nudos} | ${ref.avisos.join(", ") || "—"}`);
    for (const [malla, op] of [
      ["h = 0,75", { tamanoMalla: 0.75 }],
      ["h = 0,5", { tamanoMalla: 0.5 }],
    ] as [string, OpcionesCompilacion][]) {
      const r = metros(f, op);
      for (const conF3d of [false, true]) {
        const m = conF3d ? r.con : r.sin;
        for (const g of ["común por dentro", "propia", "junto a un hueco", "ref. con F2-9"]) {
          const e: { k: string; e: number }[] = [];
          let cambian = 0;
          for (const [k, v] of m) {
            const w = ref.con.get(k);
            const refF29 = w !== ref.sin.get(k);
            if ((g === "ref. con F2-9" ? !refF29 : refF29 || r.grupo.get(k) !== g) || w === undefined || Math.abs(w) < 0.2 * mayor) continue;
            if (r.con.get(k) !== r.sin.get(k)) cambian++;
            e.push({ k, e: v / w - 1 });
            if (process.env.DETALLE && conF3d && g !== "propia" && g !== "común por dentro") console.log(`  ${malla} ${k}: ${r.sin.get(k)!.toFixed(2)} → ${v.toFixed(2)}, referencia ${w.toFixed(2)} (sin F3-d ${ref.sin.get(k)!.toFixed(2)})`);
          }
          if (!e.length) continue;
          const abs = e.map((x) => Math.abs(x.e));
          const i = abs.indexOf(Math.max(...abs));
          decir(`${nombre} | ${malla} | ${conF3d ? "sí" : "no"} | ${g} | ${e.length} | ${cambian} | ${pc(abs.reduce((a, x) => a + x, 0) / abs.length)} | ${pc(abs[i]!)} | ${pc(e[i]!.e)} (${e[i]!.k.split("|").slice(1).join(" ")}) | ${r.nudos} | ${r.avisos.join(", ") || "—"}`);
        }
      }
    }
  }
  decir();
}

if (parte("C")) {
  decir("## C. Lo que deja F2-9 con F3-d");
  decir();
  decir("La 3 × 3 mezclada con h = 0,1: las caras con nudos rígidos delante (F3-5), sin F3-d y con él, y las mismas con las mallas que no los tienen. Suma de los casos, kN·m/m.");
  decir();
  decir("cara | h = 0,1 sin F3-d | h = 0,1 con F3-d | h = 0,15 | h = 0,2 | h = 0,5 | h = 0,75 | 0,1 con F3-d frente a 0,15");
  const f = losa3x3Mezclada();
  const r10 = metros(f, { tamanoMalla: 0.1 });
  const otras = [0.15, 0.2, 0.5, 0.75].map((h) => metros(f, { tamanoMalla: h }));
  for (const [k, v] of r10.con) {
    if (v === r10.sin.get(k)) continue;
    if (otras.some((o) => o.con.get(k) !== o.sin.get(k))) throw new Error(`${k}: con h ≥ 0,15 también tiene nudos delante`);
    decir(`${k.split("|").slice(1).join(" ")} | ${r10.sin.get(k)!.toFixed(2)} | ${v.toFixed(2)} | ${otras.map((o) => o.con.get(k)!.toFixed(2)).join(" | ")} | ${pc(v / otras[0]!.con.get(k)! - 1)}`);
  }
  decir();
}

if (!process.env.SOLO && !process.env.MODELO) writeFileSync(join(import.meta.dirname, "out_f3d.txt"), lineas.join("\n") + "\n", { encoding: "utf8" });
