/**
 * Puerta de MA (criterio 1, `docs/fem3d/modelado.md` §3 y §9): compara el proyecto de un agente con
 * `ejemplos/vivienda/proyecto.json`.
 *
 * - **Pilares:** cada pilar del ejemplo con el más cercano del agente: distancia, sección, planta de
 *   su base y de su cabeza. Criterio: ≤ 1 cm.
 * - **Losas:** por planta, cuántas, de qué tipo, su canto, sus nervios y su área.
 * - **Ábacos** (los que usa el cálculo, `abacosLosa`, con los de los pilares y los unidos): cada uno
 *   del ejemplo con el más cercano del agente en su planta, por la caja. Criterio: los mismos.
 * - **Cargas por planta y caso** (las del resumen, con el peso propio): criterio ≤ 0,5 %.
 *
 *   bun validacion/ma/puerta/comparar.ts <proyecto del agente>… > validacion/ma/puerta/out_comparar.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resumen } from "../../../src/agente/consultas.ts";
import { leerProyecto, type Proyecto } from "../../../src/agente/proyecto.ts";
import { abacosLosa } from "../../../src/compilador/abacos.ts";
import { compilar } from "../../../src/compilador/compilar.ts";
import type { Vec2 } from "../../../src/compilador/fisico.ts";
import { areaConSigno } from "../../../src/compilador/poligonos.ts";

const leer = (ruta: string): Proyecto => {
  const r = leerProyecto(readFileSync(ruta, "utf8"));
  if (!r.valido) throw new Error(`${ruta} no es válido: ${JSON.stringify(r.diagnosticos).slice(0, 400)}`);
  return r.proyecto;
};
const ejemplo = leer(join(import.meta.dirname, "..", "..", "..", "ejemplos", "vivienda", "proyecto.json"));

const caja = (p: readonly Vec2[]) => p.reduce(([x0, y0, x1, y1], q) => [Math.min(x0, q[0]), Math.min(y0, q[1]), Math.max(x1, q[0]), Math.max(y1, q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const cotaDe = (p: Proyecto) => {
  const ps = p.modelo.plantas;
  const z: number[] = new Array(ps.length).fill(0);
  for (let i = ps.length - 2; i >= 0; i--) z[i] = z[i + 1]! + (ps[i + 1]!.altura ?? 0);
  return new Map(ps.map((x, i) => [x.id, z[i]!]));
};
const f2 = (x: number) => x.toFixed(2);
const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : Infinity) : (100 * (a - b)) / Math.abs(b));

function comparar(ruta: string): string[] {
  const o: string[] = [`## ${ruta}`, ""];
  const ag = leer(ruta);
  const [ze, za] = [cotaDe(ejemplo), cotaDe(ag)];
  const cotaA = (id: string) => za.get(id) ?? NaN;
  const cotaE = (id: string) => ze.get(id) ?? NaN;
  let malos = 0;

  // Pilares
  const pe = ejemplo.modelo.pilares ?? [];
  const pa = ag.modelo.pilares ?? [];
  let dmax = 0;
  const lejos: string[] = [];
  const otros: string[] = [];
  for (const p of pe) {
    let mejor = pa[0];
    let d = Infinity;
    for (const q of pa) {
      const e = Math.hypot(q.x - p.x, q.y - p.y);
      if (e < d) [d, mejor] = [e, q];
    }
    if (!mejor) continue;
    dmax = Math.max(dmax, d);
    if (d > 0.01) lejos.push(`${p.id} ${(100 * d).toFixed(1)} cm`);
    const secA = ag.modelo.secciones.find((s) => s.id === mejor!.seccion);
    const secE = ejemplo.modelo.secciones.find((s) => s.id === p.seccion);
    const misma = secA?.forma === "rectangular" && secE?.forma === "rectangular" && secA.b === secE.b && secA.h === secE.h;
    if (!misma || cotaA(mejor.desde) !== cotaE(p.desde) || cotaA(mejor.hasta) !== cotaE(p.hasta)) otros.push(`${p.id}→${mejor.id} (${secA ? `${secA.id}` : "?"}, de ${f2(cotaA(mejor.desde))} a ${f2(cotaA(mejor.hasta))}; en el ejemplo de ${f2(cotaE(p.desde))} a ${f2(cotaE(p.hasta))})`);
  }
  const okP = pa.length === pe.length && dmax <= 0.01 && !otros.length;
  if (!okP) malos++;
  o.push(`Pilares: ${pa.length} (ejemplo ${pe.length}); distancia máxima ${(100 * dmax).toFixed(1)} cm${lejos.length ? `; a más de 1 cm: ${lejos.join(", ")}` : ""}${otros.length ? `; sección o plantas distintas: ${otros.join("; ")}` : ""} → ${okP ? "pasa" : "NO pasa"}`);

  // Losas y ábacos, por la cota de su planta
  for (const le of ejemplo.modelo.losas ?? []) {
    const z = cotaE(le.planta);
    const las = (ag.modelo.losas ?? []).filter((l) => Math.abs(cotaA(l.planta) - z) < 1e-6);
    if (las.length !== 1) {
      malos++;
      o.push(`Losa a +${f2(z)}: el agente tiene ${las.length} → NO pasa`);
      continue;
    }
    const la = las[0]!;
    const [re, ra] = [le.reticular!, la.reticular];
    const datos = ra && ra.intereje === re.intereje && ra.nervio === re.nervio && ra.capa === re.capa && la.espesor === le.espesor && la.pp === le.pp;
    const area = (l: typeof le) => Math.abs(areaConSigno(l.contorno)) - (l.huecos ?? []).reduce((s, h) => s + Math.abs(areaConSigno(h)), 0);
    o.push(`Losa a +${f2(z)}: ${la.id}, ${ra ? "reticular" : "maciza"} ${la.espesor} m${ra ? `, ${ra.intereje}/${ra.nervio}/${ra.capa}, casetón ${ra.caseton ?? "(por defecto)"}` : ""}, pp ${la.pp ?? "(calculado)"}; área ${area(la).toFixed(2)} m² (ejemplo ${area(le).toFixed(2)}, a ejes de los zunchos) → datos ${datos ? "iguales" : "DISTINTOS"}`);
    if (!datos) malos++;
    const [ae, aa] = [abacosLosa(ejemplo.modelo, le)!.abacos, ra ? (abacosLosa(ag.modelo, la)?.abacos ?? []) : []];
    let peor = 0;
    for (const a of ae) {
      const ca = caja(a);
      let d = Infinity;
      for (const b of aa) {
        const cb = caja(b);
        d = Math.min(d, Math.max(...ca.map((v, i) => Math.abs(v - cb[i]!))));
      }
      peor = Math.max(peor, d);
    }
    const okA = aa.length === ae.length && peor <= 0.01;
    if (!okA) malos++;
    o.push(`  ábacos: ${aa.length} (ejemplo ${ae.length}); peor diferencia de caja ${Number.isFinite(peor) ? `${(100 * peor).toFixed(1)} cm` : "—"}${ra?.abacosPilares ? `, con abacosPilares ${JSON.stringify(ra.abacosPilares)}` : ""}${ra?.abacos?.length ? `, ${ra.abacos.length} dados` : ""} → ${okA ? "pasa" : "NO pasa"}`);
  }

  // Cargas por planta y caso
  const cargas = (p: Proyecto, z: Map<string, number>) => {
    const c = compilar(p.modelo, p.opciones);
    if (!c.valido) throw new Error(`no compila: ${c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join(" | ")}`);
    const r = resumen(p, c);
    if (!r.valido) throw new Error("sin resumen");
    const m = new Map<string, number>();
    for (const pl of r.valor.plantas) for (const [k, v] of Object.entries(pl.cargas ?? {})) m.set(`${f2(z.get(pl.id)!)}|${k}`, v);
    return m;
  };
  const [ce, ca] = [cargas(ejemplo, ze), cargas(ag, za)];
  let peorC = 0;
  const filas: string[] = [];
  for (const [k, v] of ce) {
    const w = ca.get(k) ?? 0;
    const d = pct(w, v);
    peorC = Math.max(peorC, Math.abs(d));
    const [z, caso] = k.split("|");
    filas.push(`+${z} ${caso}: ${w.toFixed(2)} kN (ejemplo ${v.toFixed(2)}; ${d >= 0 ? "+" : ""}${d.toFixed(2)} %)`);
  }
  for (const k of ca.keys()) if (!ce.has(k)) filas.push(`${k}: sólo en el agente`);
  const okC = peorC <= 0.5;
  if (!okC) malos++;
  o.push(`Cargas por planta y caso: peor ${peorC.toFixed(2)} % → ${okC ? "pasa" : "NO pasa"}`, ...filas.map((x) => `  ${x}`));
  o.push("", `**${malos ? `NO pasa (${malos})` : "Pasa"}**`, "");
  return o;
}

for (const r of process.argv.slice(2)) {
  try {
    console.log(comparar(r).join("\n"));
  } catch (e) {
    console.log(`## ${r}\n\n${(e as Error).message}\n`);
  }
}
