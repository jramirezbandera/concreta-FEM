/**
 * Convergencia de los esfuerzos de las vigas de borde embebidas en la losa del reticular del usuario
 * (RETICULAR/, 2026-10-08): el modelo importado (malla de 1 m) refinado ×2 y ×4 en el motor (cada
 * lámina en 4; cada viga que sigue un lado de lámina, partida en su punto medio), frente a SAP2000
 * en la malla de 1 m. Caso DEAD; vigas 29 (vano de esquina) y 27 (vano central), en y = −9.
 *
 * Uso: bun validacion/e6/sap2000/reticular-vigas.ts <reticular.s2k exportado con resultados>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../../src/motor/calcular.ts";
import { DiagramasBarras } from "../../../src/motor/barras.ts";
import type { BarraAnalitica, CargaBarra, CargaLamina, LaminaAnalitica, ModeloAnalitico } from "../../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { importarS2k } from "./importar.ts";
import { leerTablas, num } from "./s2k.ts";

const RUTA = process.argv[2];
if (!RUTA) {
  console.error("Uso: bun validacion/e6/sap2000/reticular-vigas.ts <reticular.s2k>");
  process.exit(1);
}
await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const t = leerTablas(readFileSync(RUTA, "latin1"));
const imp = importarS2k(t);
const kDead = imp.patrones.indexOf("DEAD");

function refinar(m: ModeloAnalitico): ModeloAnalitico {
  const nudos = [...m.nudos];
  const medio = new Map<string, number>();
  const punto = (a: number, b: number) => {
    const clave = a < b ? `${a},${b}` : `${b},${a}`;
    if (!medio.has(clave)) {
      const [p, q] = [nudos[a]!, nudos[b]!];
      medio.set(clave, nudos.length);
      nudos.push({ id: `m${nudos.length}`, x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: (p.z + q.z) / 2 });
    }
    return medio.get(clave)!;
  };
  const laminas: LaminaAnalitica[] = [];
  const hijasL: number[][] = [];
  for (const l of m.laminas!) {
    const [a, b, c, d] = l.nudos;
    const [ab, bc, cd, da] = [punto(a, b), punto(b, c), punto(c, d), punto(d, a)];
    const centro = nudos.length;
    const P = [a, b, c, d].map((v) => nudos[v]!);
    nudos.push({ id: `c${centro}`, x: P.reduce((s, p) => s + p.x, 0) / 4, y: P.reduce((s, p) => s + p.y, 0) / 4, z: P.reduce((s, p) => s + p.z, 0) / 4 });
    const h: number[] = [];
    for (const ns of [[a, ab, centro, da], [ab, b, bc, centro], [centro, bc, c, cd], [da, centro, cd, d]] as const) {
      h.push(laminas.length);
      laminas.push({ ...l, id: `${l.id}.${h.length}`, nudos: ns });
    }
    hijasL.push(h);
  }
  const barras: BarraAnalitica[] = [];
  const hijasB: number[][] = [];
  for (const b of m.barras!) {
    const [i, j] = b.nudos;
    const clave = i < j ? `${i},${j}` : `${j},${i}`;
    const mid = medio.get(clave);
    if (mid === undefined) {
      hijasB.push([barras.length]);
      barras.push(b);
      continue;
    }
    if (b.offsets || b.liberaciones) throw new Error(`la barra ${b.id} tiene offsets o liberaciones`);
    hijasB.push([barras.length, barras.length + 1]);
    barras.push({ ...b, id: `${b.id}.1`, nudos: [i, mid] }, { ...b, id: `${b.id}.2`, nudos: [mid, j] });
  }
  const casos = m.casos!.map((c) => ({
    ...c,
    laminas: (c.laminas ?? []).flatMap((q: CargaLamina) => {
      if (q.tipo !== "superficie") throw new Error("sólo cargas de superficie");
      return hijasL[q.lamina]!.map((l) => ({ ...q, lamina: l }));
    }),
    barras: (c.barras ?? []).flatMap((q: CargaBarra) => {
      const hs = hijasB[q.barra]!;
      if (hs.length === 1) return [{ ...q, barra: hs[0]! }];
      if (q.tipo !== "distribuida") throw new Error("sólo cargas distribuidas en barras partidas");
      const [p, r] = m.barras![q.barra]!.nudos.map((v) => m.nudos[v]!);
      const L = Math.hypot(r!.x - p!.x, r!.y - p!.y, r!.z - p!.z);
      const uniforme = (q.qa ?? [0, 0, 0]).every((x, k) => Math.abs(x - (q.qb ?? q.qa)![k]!) < 1e-12);
      if (!uniforme || (q.a ?? 0) > 1e-9 || Math.abs((q.b ?? L) - L) > 1e-9) throw new Error("sólo distribuidas uniformes en toda la barra");
      return hs.map((h) => ({ ...q, barra: h, a: 0, b: L / 2 }));
    }),
  }));
  return { ...m, nudos, laminas, barras, casos };
}

// Esfuerzos de SAP2000 de una barra en sus estaciones (las del extremo final de cada trozo)
const sapBarra = (frame: string) =>
  (t.get("ELEMENT FORCES - FRAMES") ?? [])
    .filter((f) => f.Frame === frame && f.OutputCase === "DEAD")
    .map((f) => ({ s: num(f, "Station"), V2: num(f, "V2"), T: num(f, "T"), M3: num(f, "M3") }));

// Esfuerzos del motor a lo largo de una recta horizontal (vigas cuyos dos nudos están en ella)
function aLoLargo(m: ModeloAnalitico, r: ReturnType<typeof calcular>, y: number, x0: number, x1: number) {
  if (!r.valido) throw new Error("no válido");
  const diag = new DiagramasBarras(m);
  const out: { x: number; V2: number; T: number; M3: number }[] = [];
  m.barras!.forEach((b, i) => {
    const [p, q] = b.nudos.map((v) => m.nudos[v]!);
    if (Math.abs(p!.y - y) > 1e-9 || Math.abs(q!.y - y) > 1e-9 || Math.abs(p!.z - q!.z) > 1e-9) return;
    if (Math.min(p!.x, q!.x) < x0 - 1e-9 || Math.max(p!.x, q!.x) > x1 + 1e-9) return;
    const L = Math.abs(q!.x - p!.x);
    const d = diag.diagrama(i, kDead, r.casos[kDead]!);
    for (const [x, lado] of [[0, 1], [L, -1]] as const) {
      const e = d.esfuerzosEn(x, lado);
      const X = p!.x + (Math.sign(q!.x - p!.x) * x);
      out.push({ x: X, V2: e[2]!, T: e[3]!, M3: e[4]! });
    }
  });
  return out;
}

const modelos = [imp.modelo, refinar(imp.modelo)];
modelos.push(refinar(modelos[1]!));
const resultados = modelos.map((m) => ({ m, r: calcular(m) }));
for (const [frame, y, x0, x1] of [["29", -9, 9, 15], ["27", -9, -3, 3]] as const) {
  const fila = (t.get("CONNECTIVITY - FRAME") ?? []).find((f) => f.Frame === frame)!;
  console.log(`\n## Viga ${frame} (nudos ${fila.JointI}–${fila.JointJ}), y = ${y}, x de ${x0} a ${x1}; caso DEAD`);
  const sap = sapBarra(frame);
  const xi = Number((t.get("JOINT COORDINATES") ?? []).find((f) => f.Joint === fila.JointI)!.GlobalX!.replace(",", "."));
  const xj = Number((t.get("JOINT COORDINATES") ?? []).find((f) => f.Joint === fila.JointJ)!.GlobalX!.replace(",", "."));
  const dir = Math.sign(xj - xi);
  console.log("x | SAP M3 | motor M3 h=1 / 0,5 / 0,25 | SAP T | motor T h=1 / 0,5 / 0,25 | SAP V2 | motor V2 h=1 / 0,5 / 0,25");
  const porX = resultados.map(({ m, r }) => aLoLargo(m, r, y, x0, x1));
  for (let k = 0; k <= 6; k++) {
    const x = xi + dir * k;
    const s = sap.filter((f) => Math.abs(f.s - k) < 1e-6);
    const sv = (c: "M3" | "T" | "V2") => s.map((f) => f[c].toFixed(2)).join("/");
    const mv = (c: "M3" | "T" | "V2") => porX.map((lst) => lst.filter((f) => Math.abs(f.x - x) < 1e-6).map((f) => f[c].toFixed(2)).join("/")).join(" ; ");
    console.log(`${x} | ${sv("M3")} | ${mv("M3")} | ${sv("T")} | ${mv("T")} | ${sv("V2")} | ${mv("V2")}`);
  }
}
