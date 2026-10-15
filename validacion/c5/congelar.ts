/**
 * Referencia congelada de C5 (criterio 9, regla de oro 1). Para cada modelo físico, lo de C2 (el
 * modelo analítico con la malla y sus caras de banda, el mapeo y los resultados de los casos) y lo de
 * C5:
 * - las bandas que propone el compilador;
 * - las estaciones de cada banda (s, tipo, ancho en losa, validez, esfuerzos, momentos medios y, en un
 *   reticular, el momento por nervio) y, con acciones, la envolvente de Wood–Armer (a) en ELU-PT;
 * - los machones y dinteles de los muros;
 * - consultas: los tramos de unos pilares, sus reacciones, las plantas y, con acciones, las flechas
 *   de cada losa en la primera combinación ELS-C.
 * Modelos:
 * - pilares mezclados (30 × 50 girados y 40 × 40, 3 × 2 vanos, hueco de escalera) con acciones;
 * - la losa de H25 como reticular con ábacos (h = 0,5);
 * - ETABS 15c de 3 plantas con dinteles de 60 in (h = 20 in);
 * - un modelo al azar (semilla 3) con el eje 1 cualquiera.
 * Los números se guardan con 13 cifras significativas, como en C2–C4. El test
 * (src/compilador/congelado-c5.test.ts) lo recalcula con el núcleo.
 *
 * Fase LV: los modelos llevan la unión de la losa con las vigas de antes, por el eje
 * (`unionLosaViga: "eje"`: los mismos bits que antes de la fase). Las bandas del Anejo I ya no se
 * usan en la app (fase F); la unión por las caras se congela en C2–C4 y F.
 *
 * Sólo se regenera a sabiendas (un cambio validado aparte, o un cambio de los generadores):
 *   bun validacion/c5/congelar.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import { woodArmerEstacion } from "../../src/compilador/esfuerzosBandas.ts";
import type { Banda } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import type { ModeloCongelado } from "../c1/congelar.ts";
import { OPCIONES_LOSA_PLANA } from "../c2/losaPlana.ts";
import { referenciaC2, type ReferenciaC2 } from "../c2/congelar.ts";
import { fisicoEtabs } from "../c3/etabs15.ts";
import { IN } from "../e6/csi.ts";
import { murosEtabs15 } from "../e6/etabs15.ts";
import { conAcciones, conPropuesta, losaPilaresMezclados, reticularH25 } from "./modelos.ts";

export const MODELOS_CONGELADOS_C5: Record<string, () => ModeloCongelado> = {
  "pilares-mezclados": () => ({ fisico: conAcciones(conPropuesta(losaPilaresMezclados())), opciones: { franjas: false, unionLosaViga: "eje" } }),
  "reticular-h25": () => ({ fisico: conPropuesta(reticularH25()), opciones: { franjas: false, ...OPCIONES_LOSA_PLANA, tamanoMalla: 0.5, unionLosaViga: "eje" } }),
  "etabs-15c-3-60": () => ({ fisico: fisicoEtabs(murosEtabs15().find((m) => m.id === "15c-3-60")!), opciones: { franjas: false, tamanoMalla: 20 * IN, unionLosaViga: "eje" } }),
  "aleatorio-3": () => ({ fisico: conPropuesta(conLosasAleatorias(fisicoAleatorio(3), 3, { eje1: "azar" })), opciones: { franjas: false, unionLosaViga: "eje" } }),
};

export interface ReferenciaC5 {
  c2: ReferenciaC2;
  bandas: Banda[];
  estaciones: Record<string, { s: number; tipo: string; anchoEnLosa: number; valido: boolean; esfuerzos: number[]; medios: number[]; nervio: number[] | null; wa: number[] | null }[]>;
  muros: Record<string, { machones: unknown[]; dinteles: unknown[] }>;
  consultas: { pilares: Record<string, unknown>; reacciones: Record<string, number[]>; plantas: Record<string, unknown>; flechas: Record<string, unknown> };
}

const arr = (v: ArrayLike<number>) => Array.from(v);

export function referenciaC5(f: () => ModeloCongelado): ReferenciaC5 {
  const c2 = referenciaC2(f);
  const { fisico, opciones } = f();
  const r = compilar(fisico, opciones);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo));
  const q = new Consultas(fisico, r, casos, opciones);
  const elu = q.combinaciones({ situaciones: ["ELU-PT"] });
  const els = q.combinaciones({ situaciones: ["ELS-C"] });
  const estaciones: ReferenciaC5["estaciones"] = {};
  for (const b of fisico.bandas ?? []) {
    const e = q.banda(b.id);
    if (!e.valido) throw new Error(b.id);
    estaciones[b.id] = e.valor.map((s) => {
      const w = elu.valido && s.valido ? woodArmerEstacion(s, elu.valor.map((x) => x.factores)).envolvente.valores : null;
      return { s: s.s, tipo: s.tipo, anchoEnLosa: s.anchoEnLosa, valido: s.valido, esfuerzos: arr(s.esfuerzos), medios: arr(s.medios), nervio: s.nervio ? arr(s.nervio.momentos) : null, wa: w ? [w.inferiorX, w.inferiorY, w.superiorX, w.superiorY] : null };
    });
  }
  const muros: ReferenciaC5["muros"] = {};
  const corte = (c: { esfuerzos: Float64Array; valido: boolean }) => ({ esfuerzos: arr(c.esfuerzos), valido: c.valido });
  for (const w of fisico.muros ?? []) {
    const m = q.machones(w.id);
    const d = q.dinteles(w.id);
    if (!m.valido || !d.valido) throw new Error(w.id);
    muros[w.id] = {
      machones: m.valor.map((x) => ({ id: x.id, desde: x.desde, hasta: x.hasta, base: corte(x.base), cabeza: corte(x.cabeza) })),
      dinteles: d.valor.map((x) => ({ id: x.id, desde: x.desde, hasta: x.hasta, inicio: corte(x.inicio), centro: corte(x.centro), fin: corte(x.fin) })),
    };
  }
  const pilares: Record<string, unknown> = {};
  const reacciones: Record<string, number[]> = {};
  for (const p of (fisico.pilares ?? []).slice(0, 4)) {
    const t = q.pilar(p.id);
    if (t.valido) pilares[p.id] = t.valor.map((x) => ({ planta: x.planta, longitud: x.longitud, base: arr(x.base.esfuerzos), cabeza: arr(x.cabeza.esfuerzos) }));
    const rr = q.reacciones(p.id);
    if (rr.valido) reacciones[p.id] = arr(rr.valor.resultante);
  }
  const plantas: Record<string, unknown> = {};
  for (const p of fisico.plantas) {
    const x = q.planta(p.id);
    if (x.valido) plantas[p.id] = { cota: x.valor.cota, maestro: x.valor.maestro ? arr(x.valor.maestro.u) : null };
  }
  const flechas: Record<string, unknown> = {};
  if (els.valido)
    for (const l of fisico.losas ?? []) {
      const x = q.flechas(l.id, els.valor[0]!.factores);
      if (x.valido) flechas[l.id] = { maxima: [x.valor.maxima.nudo, x.valor.maxima.flecha], recuadros: x.valor.recuadros.map((k) => (k.maxima ? [k.maxima.nudo, k.maxima.flecha] : null)) };
    }
  return { c2, bandas: [...(fisico.bandas ?? [])], estaciones, muros, consultas: { pilares, reacciones, plantas, flechas } };
}

/** Los números con 13 cifras significativas (y NaN como null, como en JSON). */
export const redondeo = (_k: string, v: unknown) => (typeof v === "number" && v !== 0 && Number.isFinite(v) ? Number(v.toPrecision(13)) : v);

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida = Object.fromEntries(Object.entries(MODELOS_CONGELADOS_C5).map(([k, f]) => [k, referenciaC5(f)]));
  const ruta = join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-c5.json");
  writeFileSync(ruta, JSON.stringify(salida, redondeo));
  console.log(`Escrito ${ruta}`);
}
