/**
 * Fase PB (`docs/fem3d/pilares-borde.md`): la precisión junto a los pilares de borde, con el código de
 * una carpeta del repositorio (la de ahora o un árbol de trabajo en el commit de antes, HR-8).
 *
 * Por cada tamaño de malla, la envolvente de las combinaciones persistentes (ELU) de:
 * - las vigas: My en las dos caras de los pilares (a medio canto del pilar de su eje), el mínimo y el
 *   máximo, y el máximo positivo del vano;
 * - las franjas: Wood–Armer superior e inferior de sus estaciones de cara y de apoyo.
 * Escribe `out_<nombre>.json` (lo compara `comparar.ts`).
 *
 *   bun validacion/pb/medir.ts <raíz del código> <nombre> <modelo> <h> [<h> ...]
 *
 * Un h de menos de 2·ε_snap, con su ε_snap: `0.0625/0.025`; con más opciones de compilación, detrás
 * de un «+» en JSON: `0.75+{"franjas":false}`.
 *
 * Modelos: `ej11` (el ejemplo 11 de VS5 sin viento ni sismo), `ej11-acc` (con ellos, como en VS5),
 * `ej11-pf` (el segundo, con punto fijo), `2x2` (`recuadros(2, 2)` de `modelos.ts`, maciza de 30) y
 * `2x2-<opciones JSON>`. Las situaciones, en `PB_SIT` (por defecto `ELU-PT`; `ELU-PT,ELU-SIS`, las dos).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { modelo } from "../sombra/ejemplo11/modelo.ts";
import { recuadros } from "./modelos.ts";

const [raizArg, nombre, cual, ...hs] = process.argv.slice(2);
if (!raizArg || !nombre || !cual || !hs.length) throw new Error("bun validacion/pb/medir.ts <raíz> <nombre> <modelo> <h> [<h> ...]");
const raiz = resolve(raizArg);
const AQUI = import.meta.dirname;
// Los módulos de esa carpeta, con los tipos de los de ésta (la API es la misma)
const { sha256 } = (await import(join(raiz, "src/compilador/huella.ts"))) as typeof import("../../src/compilador/huella.ts");
const { iniciarNucleo } = (await import(join(raiz, "src/nucleo/index.ts"))) as typeof import("../../src/nucleo/index.ts");
const { Sesion } = (await import(join(raiz, "src/visor/sesion.ts"))) as typeof import("../../src/visor/sesion.ts");
const WASM = readFileSync(join(raiz, "src/nucleo/pkg/nucleo_bg.wasm"));
await iniciarNucleo(WASM);

function modeloDe(c: string): ModeloFisico {
  if (c === "ej11" || c === "ej11-pf" || c === "ej11-acc") {
    const m = structuredClone(modelo(c === "ej11-pf" ? "pf" : "cype").modelo);
    if (c !== "ej11-acc") delete m.acciones;
    return m;
  }
  if (c.startsWith("2x2")) return recuadros(2, 2, c.length > 4 ? JSON.parse(c.slice(4)) : {});
  throw new Error(`modelo ${c}`);
}

type Fila = Record<string, number>;
const salida: Record<string, { nudos: number; ecuaciones: number; avisos: string[]; vigas: Fila; franjas: Fila; segundos: number }> = {};
for (const h of hs) {
  const t0 = performance.now();
  const [hh, mas] = h.split("+");
  const [th, te] = hh!.split("/");
  const proyecto = { esquema: "concreta-fem/proyecto@1", nombre: `PB ${cual}`, modelo: modeloDe(cual), opciones: { tamanoMalla: Number(th), ...(te ? { epsSnap: Number(te) } : {}), ...(mas ? JSON.parse(mas) : {}) } };
  const a = Sesion.abrir(JSON.stringify(proyecto), sha256(new Uint8Array(WASM)));
  if (!a.valido) throw new Error(JSON.stringify(a.diagnosticos));
  const s = a.sesion;
  const k = await s.calcular();
  if (!k.ok) throw new Error(JSON.stringify(k.diagnosticos));
  const q = s.q!;
  const c = s.compilacion;
  if (!c.valido) throw new Error("no compila");
  const situaciones = (process.env.PB_SIT ?? "ELU-PT").split(",") as ("ELU-PT" | "ELU-SIS")[];
  const conj = s.conjunto({ tipo: "situaciones", situaciones }, "esfuerzos");
  if (!conj.valido) throw new Error("conjunto");
  const F = conj.valor.factores;

  // Vigas: caras de los pilares y vano
  const vigas: Fila = {};
  const fis = q.fisico;
  const pilarEn = (x: number, y: number) => (fis.pilares ?? []).find((p) => Math.hypot(p.x - x, p.y - y) < 1e-6);
  // Cada pilar, de esquina, de borde o interior, por la caja de los pilares
  const xs = (fis.pilares ?? []).map((p) => p.x);
  const ys = (fis.pilares ?? []).map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const tipo = (id: string | undefined) => {
    const p = (fis.pilares ?? []).find((x) => x.id === id);
    if (!p) return "sin-pilar";
    const n = (Math.abs(p.x - x0) < 1e-6 || Math.abs(p.x - x1) < 1e-6 ? 1 : 0) + (Math.abs(p.y - y0) < 1e-6 || Math.abs(p.y - y1) < 1e-6 ? 1 : 0);
    return ["interior", "borde", "esquina"][n]!;
  };
  for (const v of fis.vigas ?? []) {
    const [A, B] = [v.puntos[0]!, v.puntos[v.puntos.length - 1]!];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const ds = F.map((fc) => {
      const d = q.diagrama(v.id, fc);
      if (!d.valido) throw new Error(JSON.stringify(d.diagnosticos));
      return d.valor;
    });
    const en = (est: readonly { s: number; izquierda: Float64Array; derecha: Float64Array }[], x: number) => {
      for (let i = 0; i + 1 < est.length; i++) {
        const [e0, e1] = [est[i]!, est[i + 1]!];
        if (x >= e0.s - 1e-9 && x <= e1.s + 1e-9 && e1.s > e0.s) {
          const w = (x - e0.s) / (e1.s - e0.s);
          return e0.derecha.map((y, j) => y * (1 - w) + e1.izquierda[j]! * w);
        }
      }
      return est[est.length - 1]!.izquierda;
    };
    const medio = (P: readonly number[]) => {
      const p = pilarEn(P[0]!, P[1]!);
      const sc = p && (fis.secciones ?? []).find((x) => x.id === p.seccion);
      return sc && "b" in sc ? Math.max(Number(sc.b), Number((sc as { h?: number }).h ?? sc.b)) / 2 : 0.15;
    };
    const [c0, c1] = [medio(A), L - medio(B)];
    const [pA, pB] = [pilarEn(A[0]!, A[1]!)?.id, pilarEn(B[0]!, B[1]!)?.id];
    vigas[`${v.id}@${pA}@${tipo(pA)}@cara`] = Math.min(...ds.map((e) => en(e, c0)[4]!));
    vigas[`${v.id}@${pB}@${tipo(pB)}@cara`] = Math.min(...ds.map((e) => en(e, c1)[4]!));
    vigas[`${v.id}@${pA}@${tipo(pA)}@caramax`] = Math.max(...ds.map((e) => en(e, c0)[4]!));
    vigas[`${v.id}@${pB}@${tipo(pB)}@caramax`] = Math.max(...ds.map((e) => en(e, c1)[4]!));
    vigas[`${v.id}@@vano@vano`] = Math.max(...ds.flatMap((e) => e.filter((x) => x.s > c0 && x.s < c1).map((x) => Math.max(x.izquierda[4]!, x.derecha[4]!))));
  }

  // Franjas: estaciones de cara y de apoyo
  const franjas: Fila = {};
  for (const l of fis.losas ?? []) {
    const fs = q.franjas(l.id);
    if (!fs.valido) throw new Error(JSON.stringify(fs.diagnosticos));
    for (const f of fs.valor) {
      const r = q.franja(f.id);
      const w = q.armadoFranja(f.id, F);
      if (!r.valido || !w.valido) continue;
      r.valor.estaciones.forEach((e, i) => {
        if (e.tipo === "paso" || !e.valido) return;
        // La estación de cara, por su pilar; la de apoyo, por su pieza
        const t = e.tipo === "cara" ? e.piezas.map(tipo).sort()[0] ?? "sin-pilar" : "apoyo";
        const clave = `${f.id}:${e.tipo}:${e.s.toFixed(3)}:${e.lado ?? 0}@${e.piezas.join("+")}@${t}`;
        franjas[`${clave}@sup`] = w.valor[i]!.superior;
        franjas[`${clave}@inf`] = w.valor[i]!.inferior;
      });
    }
  }
  const avisos = c.diagnosticos.filter((d) => d.codigo.startsWith("malla/")).map((d) => `${d.codigo} [${(d.ids ?? []).join(",")}]`);
  const segundos = (performance.now() - t0) / 1000;
  salida[h] = { nudos: c.modelo.nudos.length, ecuaciones: (s as unknown as { cabecera?: { estadisticas: { ecuaciones: number } } }).cabecera?.estadisticas.ecuaciones ?? 0, avisos, vigas, franjas, segundos };
  console.log(`${nombre} ${cual} h = ${h}: ${c.modelo.nudos.length} nudos, ${Object.keys(vigas).length / 5} vigas, ${Object.keys(franjas).length / 2} estaciones, ${segundos.toFixed(1)} s; ${avisos.length ? avisos.join("; ") : "sin avisos de malla"}`);
  writeFileSync(join(AQUI, `out_${nombre}.json`), JSON.stringify(salida));
}
