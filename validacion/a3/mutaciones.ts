/**
 * Criterio 1 de A3 (`docs/fem3d/agente.md` §8): las comprobaciones de sensatez detectan las
 * mutaciones graves. Cada mutación inyecta en un modelo de referencia un error típico de modelado;
 * se detecta si la revisión da algún aviso de sensatez que el modelo sin mutar no da (mismo código y
 * mismos objetos), o si el compilador o el motor la rechazan.
 *
 *   bun validacion/a3/mutaciones.ts > validacion/a3/out_mutaciones.txt
 */
import type { CargaFisica, ModeloFisico } from "../../src/compilador/fisico.ts";
import type { Revision } from "../../src/agente/revision.ts";
import { fisico1022 } from "../c1/modelos.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { reticulaConNucleo } from "../c3/modelos.ts";
import { edificioReticular, edificioUnidireccional } from "../c4/modelos.ts";
import { prepararNucleo, proyectoDe, revisarProyecto } from "./revisar.ts";

export interface Mutacion {
  id: number;
  nombre: string;
  /** El modelo mutado y qué se ha tocado, o null si no se puede aplicar a este modelo. */
  aplicar: (f: ModeloFisico) => { modelo: ModeloFisico; que: string } | null;
}

const copia = (f: ModeloFisico): ModeloFisico => structuredClone(f) as ModeloFisico;
const tipoDe = (f: ModeloFisico, caso: string) => f.casos.find((c) => c.id === caso);
const gravitatorio = (f: ModeloFisico, caso: string) => {
  const c = tipoDe(f, caso);
  const t = c?.accion?.tipo ?? (c?.pesoPropio ? "G" : null);
  return t === null || ["G", "Q", "S"].includes(t);
};
/** Componente vertical (índice en su vector) de una carga, si va hacia abajo. */
function abajo(c: CargaFisica): { campo: "q" | "F"; i: number } | null {
  if (c.tipo === "superficie" || c.tipo === "lineal" || c.tipo === "viga") return c.q[2] < 0 ? { campo: "q", i: 2 } : null;
  if (c.tipo === "puntual") return c.F && c.F[2] < 0 ? { campo: "F", i: 2 } : null;
  if (c.tipo === "pilar") return c.ejes === "global" ? (c.q[2] < 0 ? { campo: "q", i: 2 } : null) : c.q[0] < 0 ? { campo: "q", i: 0 } : null;
  return null;
}
/** Planta intermedia: ni la más alta ni la más baja, o la segunda si no hay más. */
const intermedia = (f: ModeloFisico) => f.plantas[Math.max(1, Math.min(f.plantas.length - 2, Math.floor((f.plantas.length - 1) / 2)))]!;

export const MUTACIONES: Mutacion[] = [
  {
    id: 1,
    nombre: "carga de superficie en N/m² (×1000)",
    aplicar: (f0) => {
      const f = copia(f0);
      // La de superficie de un caso variable; si no hay, la primera carga
      const c = (f.cargas ?? []).find((x) => x.tipo === "superficie" && !tipoDe(f, x.caso)?.pesoPropio) ?? (f.cargas ?? []).find((x) => x.tipo === "superficie") ?? f.cargas?.[0];
      if (!c) return null;
      const x = c as unknown as Record<string, unknown>;
      for (const k of ["q", "qb", "F", "M"]) if (Array.isArray(x[k])) x[k] = (x[k] as number[]).map((v) => v * 1000);
      if (c.tipo === "empuje") [c.p0, c.p1] = [c.p0 * 1000, c.p1 * 1000];
      return { modelo: f, que: `${c.id} (${c.tipo}, caso ${c.caso})` };
    },
  },
  {
    id: 2,
    nombre: "carga vertical con el signo cambiado",
    aplicar: (f0) => {
      const f = copia(f0);
      const c = (f.cargas ?? []).find((x) => gravitatorio(f, x.caso) && abajo(x));
      if (!c) return null;
      const a = abajo(c)!;
      const v = [...((c as unknown as Record<string, number[]>)[a.campo]!)];
      v[a.i] = -v[a.i]!;
      (c as unknown as Record<string, number[]>)[a.campo] = v;
      return { modelo: f, que: `${c.id} (${c.tipo}, caso ${c.caso})` };
    },
  },
  {
    id: 3,
    nombre: "pilar interior quitado",
    aplicar: (f0) => {
      const ps = f0.pilares ?? [];
      if (ps.length < 3) return null;
      const [x0, x1, y0, y1] = [Math.min(...ps.map((p) => p.x)), Math.max(...ps.map((p) => p.x)), Math.min(...ps.map((p) => p.y)), Math.max(...ps.map((p) => p.y))];
      // El más interior: el de mayor distancia a la caja de los pilares (en un pórtico plano, a sus extremos en x)
      const dentro = (p: (typeof ps)[number]) => Math.min(p.x - x0, x1 - p.x, ...(y1 > y0 ? [p.y - y0, y1 - p.y] : []));
      const p = [...ps].sort((a, b) => dentro(b) - dentro(a))[0]!;
      if (!(dentro(p) > 0)) return null;
      const f = copia(f0);
      f.pilares = f.pilares!.filter((x) => x.id !== p.id);
      f.cargas = (f.cargas ?? []).filter((c) => !(c.tipo === "pilar" && c.pilar === p.id));
      return { modelo: f, que: p.id };
    },
  },
  {
    id: 4,
    nombre: "ningún caso de peso propio",
    aplicar: (f0) => {
      const c = f0.casos.find((x) => x.pesoPropio);
      if (!c) return null;
      const f = copia(f0);
      f.casos = f.casos.map(({ pesoPropio: _pp, ...x }) => x);
      return { modelo: f, que: c.id };
    },
  },
  {
    id: 5,
    nombre: "espesor de losa en cm",
    aplicar: (f0) => {
      if (!f0.losas?.length) return null;
      const f = copia(f0);
      const l = f.losas![0]! as { espesor: number; id: string };
      l.espesor *= 100;
      return { modelo: f, que: `${l.id}: ${l.espesor}` };
    },
  },
  {
    id: 6,
    nombre: "canto de viga en cm",
    aplicar: (f0) => {
      const ids = new Set((f0.vigas ?? []).map((v) => v.seccion));
      const s0 = f0.secciones.find((s) => ids.has(s.id) && (s.forma === "rectangular" || s.forma === "T" || (s.forma === "general" && s.h !== undefined)));
      if (!s0) return null;
      const f = copia(f0);
      const s = f.secciones.find((x) => x.id === s0.id)! as { h: number; id: string };
      s.h *= 100;
      return { modelo: f, que: `${s.id}: h = ${s.h}` };
    },
  },
  {
    id: 7,
    nombre: "altura de planta en cm",
    aplicar: (f0) => {
      if (f0.plantas.length < 2) return null;
      const f = copia(f0);
      const p = intermedia(f);
      (p as { altura: number | null }).altura = p.altura! * 100;
      return { modelo: f, que: `${p.id}: ${p.altura}` };
    },
  },
  {
    id: 8,
    nombre: "las cargas de uso de una planta, en el caso G",
    aplicar: (f0) => {
      const g = f0.casos.find((c) => c.pesoPropio) ?? f0.casos.find((c) => c.accion?.tipo === "G");
      const q = f0.casos.find((c) => c !== g && gravitatorio(f0, c.id) && (f0.cargas ?? []).some((x) => x.caso === c.id && abajo(x)));
      const conLosas = f0.plantas.filter((p) => [...(f0.losas ?? []), ...(f0.panos ?? [])].some((x) => x.planta === p.id));
      if (!g || !q || conLosas.length < 3) return null;
      // Una planta con losas que no sea la más alta
      const p = conLosas[Math.floor(conLosas.length / 2)]!;
      const f = copia(f0);
      let n = 0;
      f.cargas = (f.cargas ?? []).map((c) => {
        const planta = "planta" in c ? c.planta : c.tipo === "viga" ? f.vigas?.find((v) => v.id === c.viga)?.planta : undefined;
        if (c.caso !== q.id || planta !== p.id) return c;
        n++;
        return { ...c, caso: g.id };
      });
      return n ? { modelo: f, que: `${n} cargas de ${q.id} en ${p.id}, a ${g.id}` } : null;
    },
  },
  {
    id: 9,
    nombre: "carga duplicada",
    aplicar: (f0) => {
      const c = f0.cargas?.[0];
      if (!c) return null;
      const f = copia(f0);
      f.cargas = [...f.cargas!, { ...structuredClone(c), id: `${c.id}-bis` }];
      return { modelo: f, que: c.id };
    },
  },
  {
    id: 10,
    nombre: "fck en kN/m²",
    aplicar: (f0) => {
      const m0 = f0.materiales.find((m) => m.tipo === "hormigon");
      if (!m0) return null;
      const f = copia(f0);
      const m = f.materiales.find((x) => x.id === m0.id)! as { fck: number; id: string };
      m.fck *= 1000;
      return { modelo: f, que: `${m.id}: ${m.fck}` };
    },
  },
  {
    id: 11,
    nombre: "pp de losa en kN/m³",
    aplicar: (f0) => {
      const f = copia(f0);
      const gamma = (id: string) => {
        const m = f.materiales.find((x) => x.id === id);
        return m?.tipo === "hormigon" ? (m.peso ?? 25) : m?.tipo === "acero" ? (m.peso ?? 78.5) : (m?.peso ?? 25);
      };
      const l = f.losas?.[0] as { pp?: number; material: string; id: string } | undefined;
      if (l) {
        l.pp = gamma(l.material);
        return { modelo: f, que: `${l.id}: pp = ${l.pp}` };
      }
      const pn = f.panos?.[0] as { pp: number; seccion: string; id: string } | undefined;
      if (!pn) return null;
      pn.pp = 25;
      return { modelo: f, que: `${pn.id}: pp = 25` };
    },
  },
];

export const MODELOS: { nombre: string; f: () => ModeloFisico }[] = [
  { nombre: "1-022", f: fisico1022 },
  { nombre: "retícula con núcleo", f: reticulaConNucleo },
  { nombre: "edificio con losas (3 plantas, 4 × 3 vanos)", f: () => edificioObjetivoLosas(3, 4, 3) },
  { nombre: "edificio unidireccional (3, 4 × 3)", f: () => edificioUnidireccional(3, 4, 3) },
  { nombre: "edificio reticular (3, 4 × 3)", f: () => edificioReticular(3, 4, 3) },
];

const clave = (d: { codigo: string; ids?: string[] }) => `${d.codigo}|${[...(d.ids ?? [])].sort().join(",")}`;

/** Los avisos de la revisión mutada que la base no da, por código. */
export function nuevos(base: Revision, mutada: Revision): Map<string, string[]> {
  const ya = new Set(base.avisos.map(clave));
  const r = new Map<string, string[]>();
  for (const a of mutada.avisos) if (!ya.has(clave(a))) r.set(a.codigo, [...(r.get(a.codigo) ?? []), a.mensaje]);
  return r;
}

if (import.meta.main) {
  await prepararNucleo();
  let [aplicadas, detectadas] = [0, 0];
  const fallos: string[] = [];
  for (const m of MODELOS) {
    const f = m.f();
    const base = revisarProyecto(proyectoDe(f));
    if (!base.valido) throw new Error(`${m.nombre}: ${base.errores.map((e) => e.mensaje).join("; ")}`);
    console.log(`\n== ${m.nombre}: ${base.revision.avisos.length} avisos sin mutar (${[...new Set(base.revision.avisos.map((a) => a.codigo))].join(", ") || "ninguno"})`);
    for (const mu of MUTACIONES) {
      const x = mu.aplicar(f);
      if (!x) {
        console.log(`  ${String(mu.id).padStart(2)}. ${mu.nombre}: no aplica`);
        continue;
      }
      aplicadas++;
      const r = revisarProyecto(proyectoDe(x.modelo));
      let texto: string;
      if (!r.valido) {
        detectadas++;
        texto = `DETECTADA: la rechaza ${r.errores[0]?.codigo ?? "?"} (${r.errores[0]?.mensaje.slice(0, 90) ?? ""})`;
      } else {
        const n = nuevos(base.revision, r.revision);
        if (n.size) {
          detectadas++;
          texto = `DETECTADA por ${[...n.entries()].map(([c, ms]) => `${c} (${ms.length})`).join(", ")}\n        ${[...n.values()][0]![0]}`;
        } else {
          texto = "NO DETECTADA";
          fallos.push(`${m.nombre}: ${mu.nombre}`);
        }
      }
      console.log(`  ${String(mu.id).padStart(2)}. ${mu.nombre} [${x.que}]: ${texto}`);
    }
  }
  console.log(`\nMutaciones aplicadas: ${aplicadas}; detectadas: ${detectadas}${fallos.length ? `; sin detectar:\n  ${fallos.join("\n  ")}` : "."}`);
}
