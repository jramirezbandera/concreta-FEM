/**
 * Precisión local junto a los pilares (fase HR, criterios 5 y 11; antes en `validacion/lv2/asoma.ts`,
 * LV2-f): en una retícula, el momento de las vigas en las caras de sus pilares y las estaciones de
 * cara y de apoyo de las franjas de armado junto a cada pilar (la superior de 1,35·G + 1,5·Q), con sus
 * escalas (el máximo de la viga o de la franja), para comparar una malla con otra más fina o con una
 * referencia congelada. Los pilares se miden todos: los que atraviesa una viga por su centro (y, entre
 * ellos, los que asoman de ella) y los que no.
 */
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion, Pilar } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import { casosValidos } from "./comparar.ts";
import { nudosRigidosFuera } from "./huellasRigidas.ts";

export interface PilarMedido {
  pilar: Pilar;
  planta: string;
  /** Vigas que pasan por su centro en esa planta. */
  vigas: string[];
  /** Extensión de la huella en X y en Y (rectangular; null si no). */
  extension: [number, number] | null;
  /** Asoma de alguna de sus vigas (su huella es más ancha que el ancho de la viga). */
  asoma: boolean;
}

export interface Valor {
  v: number;
  escala: number;
}

export interface MedidaLocal {
  /** Por «viga pilar fin-izq|fin-der»: el My de la viga en la cara del pilar. */
  vigas: Map<string, Valor>;
  /** Por «franja s:lado tipo»: la superior de ELU en una estación de cara o de apoyo junto a un pilar. */
  franjas: Map<string, Valor>;
  /** Las claves de `franjas` de los pilares que atraviesa una viga (las demás son de pilares sin viga). */
  franjasConViga: Set<string>;
  rigidosFuera: number;
  jacobiano: number;
  nudos: number;
}

/** Extensión en X y en Y de un pilar rectangular (el canto h va según el giro: 0 → X). */
function extension(f: ModeloFisico, p: Pilar): [number, number] | null {
  const sc = f.secciones.find((x) => x.id === p.seccion) as { forma: string; b: number; h: number };
  if (sc.forma !== "rectangular") return null;
  return ((p.giro ?? 0) / 90) % 2 === 1 ? [sc.b, sc.h] : [sc.h, sc.b];
}

/** Vigas (rectas, paralelas a los ejes) que pasan por el centro del pilar, con su dirección (1: X, 2: Y) y ancho, por planta. */
function vigasPor(f: ModeloFisico, p: Pilar) {
  return (f.vigas ?? []).flatMap((v) => {
    if (v.puntos.length !== 2) return [];
    const [[x0, y0], [x1, y1]] = v.puntos as [[number, number], [number, number]];
    const dir = Math.abs(y1 - y0) < 1e-9 ? 1 : Math.abs(x1 - x0) < 1e-9 ? 2 : 0;
    if (!dir) return [];
    const dentro = dir === 1 ? Math.abs(p.y - y0) < 1e-9 && p.x >= Math.min(x0, x1) - 1e-9 && p.x <= Math.max(x0, x1) + 1e-9 : Math.abs(p.x - x0) < 1e-9 && p.y >= Math.min(y0, y1) - 1e-9 && p.y <= Math.max(y0, y1) + 1e-9;
    const b = (f.secciones.find((s) => s.id === v.seccion) as { b?: number } | undefined)?.b ?? 0;
    return dentro ? [{ id: v.id, planta: v.planta, dir, b }] : [];
  });
}

/** Los pilares de cada planta con losa en la que están, con sus vigas. */
export function pilaresMedidos(f: ModeloFisico): PilarMedido[] {
  const plantasConLosa = new Set((f.losas ?? []).map((l) => l.planta));
  const plantas = f.plantas.map((p) => p.id);
  const r: PilarMedido[] = [];
  for (const p of f.pilares ?? []) {
    const e = extension(f, p);
    const vs = vigasPor(f, p);
    const kb = plantas.indexOf(p.desde);
    const kh = plantas.indexOf(p.hasta);
    for (let k = Math.max(0, kh); k <= kb && k < plantas.length; k++) {
      const planta = plantas[k]!;
      if (!plantasConLosa.has(planta)) continue;
      const aqui = vs.filter((v) => v.planta === planta);
      r.push({ pilar: p, planta, vigas: aqui.map((v) => v.id), extension: e, asoma: !!e && aqui.some((v) => (v.dir === 1 ? e[1] : e[0]) > v.b + 0.01) });
    }
  }
  return r;
}

/** Compila, calcula y mide `pilares` (por defecto, todos los de `pilaresMedidos`). */
export function medirLocal(f: ModeloFisico, op: OpcionesCompilacion, pilares: PilarMedido[] = pilaresMedidos(f)): MedidaLocal {
  const c = compilar(f, op);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  const q = new Consultas(f, c, casosValidos(calcular(c.modelo)), op);
  const fac = (f.casos ?? []).map((x) => (x.id === "G" ? 1.35 : x.id === "Q" ? 1.5 : 0));
  const vigas = new Map<string, Valor>();
  const franjas = new Map<string, Valor>();
  const franjasConViga = new Set<string>();
  const rigidosFuera = nudosRigidosFuera(f, c).reduce((a, x) => a + x.nudos.length, 0);
  for (const { pilar: p, vigas: vs } of pilares) {
    for (const v of vs) {
      const pz = q.viga(v);
      if (!pz.valido) throw new Error(v);
      const ext = pz.valor.vanos.map((_, i) => {
        const x = q.vano(v, i, fac);
        if (!x.valido) throw new Error(v);
        return x.valor;
      });
      const escala = Math.max(1, ...ext.flatMap((x) => [Math.abs(x.inicio.esfuerzos[4]!), Math.abs(x.fin.esfuerzos[4]!), Math.abs(x.maxMy.valor), Math.abs(x.minMy.valor)]));
      pz.valor.vanos.forEach((vn, i) => {
        if (vn.apoyoInicio?.objeto === p.id) vigas.set(`${v} ${p.id} fin-izq`, { v: ext[i]!.inicio.esfuerzos[4]!, escala });
        if (vn.apoyoFin?.objeto === p.id) vigas.set(`${v} ${p.id} fin-der`, { v: ext[i]!.fin.esfuerzos[4]!, escala });
      });
    }
  }
  // Franjas: estaciones de cara y de apoyo a ≤ 0,5 m de un pilar, con la ventana sobre su huella
  const plantas = new Set(pilares.map((x) => x.planta));
  for (const l of (f.losas ?? []).filter((x) => plantas.has(x.planta))) {
    const fs = q.franjas(l.id);
    if (!fs.valido) continue;
    for (const fr of fs.valor) {
      const est = q.franja(fr.id);
      const arm = q.armadoFranja(fr.id, [fac]);
      if (!est.valido || !arm.valido) throw new Error(fr.id);
      const apoyos = est.valor.estaciones.flatMap((x, i) => (x.tipo === "apoyo" || x.tipo === "cara" ? [{ x, v: arm.valor[i]!.superior }] : []));
      const escala = Math.max(1, ...apoyos.map((a) => a.v));
      for (const { x, v } of apoyos)
        for (const { pilar: p, planta, extension: e, vigas: vs } of pilares) {
          if (planta !== l.planta || !e) continue;
          const [ex, ey] = e;
          const [cc, t, ancho] = fr.direccion === 1 ? [p.x, p.y, ey] : [p.y, p.x, ex];
          if (Math.abs(x.s - cc) <= 0.5 && fr.t0 < t + ancho / 2 && fr.t1 > t - ancho / 2) {
            const k = `${fr.id} ${x.s.toFixed(3)}:${x.lado} ${x.tipo}`;
            franjas.set(k, { v, escala });
            if (vs.length) franjasConViga.add(k);
          }
        }
    }
  }
  return { vigas, franjas, franjasConViga, rigidosFuera, jacobiano: c.estadisticas.malla.jacobianoMin, nudos: c.modelo.nudos.length };
}

/** Diferencias relativas (a la escala de b) de las claves comunes. */
export function diferenciasLocales(a: ReadonlyMap<string, { v: number }>, b: ReadonlyMap<string, Valor>): { k: string; d: number }[] {
  return [...a].flatMap(([k, x]) => {
    const y = b.get(k);
    return y ? [{ k, d: (x.v - y.v) / y.escala }] : [];
  });
}
