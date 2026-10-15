/**
 * Referencia congelada de la fase F (`docs/fem3d/franjas.md` §4, criterio 9; regla de oro 1). Para
 * cada modelo físico, lo de C2 (el modelo analítico con la malla y las caras de las franjas, el mapeo
 * y los resultados de los casos) y, de cada franja, su geometría y sus estaciones (s, tipo, lado,
 * ancho en losa, ventana, validez y momentos medios por caso) y la envolvente de Wood–Armer (inferior
 * y superior) en la suma de los casos.
 * Modelos:
 * - la losa plana de H25 (h = 0,75);
 * - su reticular con ábacos (h = 0,75);
 * - pilares mezclados (30 × 50 girados y 40 × 40, 3 × 2 vanos, hueco de escalera) con acciones;
 * - un modelo al azar (semilla 3) con el eje 1 cualquiera;
 * - fase F2: la losa de 3 × 3 vanos con las caras refinadas, y la de H25 sin refinar (`refinoCaras: false`);
 * - fase F3: la de 3 × 3 con dos pilares mayores que el resto de su línea (el metro en su cara propia);
 * - SP-1 y SP-2: un reticular de 2 × 2 vanos con vigas por todos los ejes y ábacos en todos los
 *   pilares (los de borde y de esquina se salen de la losa), con acciones (`spr-abacos.md`).
 * Los números se guardan con 13 cifras significativas, como en C2–C5. El test
 * (src/compilador/congelado-f.test.ts) lo recalcula con el núcleo.
 *
 * Fase LV: los modelos de antes llevan la unión de la losa con las vigas por el eje
 * (`unionLosaViga: "eje"`: los mismos bits que antes de la fase); los terminados en `-lv`, la de la
 * fase (por las caras, por defecto).
 *
 * Sólo se regenera a sabiendas (un cambio validado aparte, o un cambio de los generadores):
 *   bun validacion/f/congelar.ts
 */
import { losa3x3 } from "../f2/convergencia.ts";
import { losa3x3Mezclada } from "../f3/modelos.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import type { ModeloCongelado } from "../c1/congelar.ts";
import { referenciaC2, type ReferenciaC2 } from "../c2/congelar.ts";
import { losaPlanaFisica, OPCIONES_LOSA_PLANA } from "../c2/losaPlana.ts";
import { redondeo } from "../c5/congelar.ts";
import { conAcciones, losaPilaresMezclados, reticularH25 } from "../c5/modelos.ts";
import { edificioReticular } from "../c4/modelos.ts";

export const MODELOS_CONGELADOS_F: Record<string, () => ModeloCongelado> = {
  "h25-plana": () => ({ fisico: { ...losaPlanaFisica(), bandas: undefined }, opciones: { ...OPCIONES_LOSA_PLANA, tamanoMalla: 0.75, unionLosaViga: "eje" } }),
  "h25-reticular": () => ({ fisico: reticularH25(), opciones: { ...OPCIONES_LOSA_PLANA, tamanoMalla: 0.75, unionLosaViga: "eje" } }),
  "pilares-mezclados": () => ({ fisico: conAcciones(losaPilaresMezclados()), opciones: { unionLosaViga: "eje" } }),
  "aleatorio-3": () => ({ fisico: conLosasAleatorias(fisicoAleatorio(3), 3, { eje1: "azar" }), opciones: { unionLosaViga: "eje" } }),
  "losa-3x3-refinada": () => ({ fisico: losa3x3(), opciones: { unionLosaViga: "eje" } }),
  "h25-plana-sin-refinar": () => ({ fisico: { ...losaPlanaFisica(), bandas: undefined }, opciones: { ...OPCIONES_LOSA_PLANA, tamanoMalla: 0.75, refinoCaras: false, unionLosaViga: "eje" } }),
  "losa-3x3-mezclada": () => ({ fisico: losa3x3Mezclada(), opciones: { unionLosaViga: "eje" } }),
  // SP-1 y SP-2: ábacos de pilares de borde, de esquina y atravesados por vigas
  "reticular-2x2-abacos": () => ({ fisico: conAcciones(edificioReticular(1, 2, 2)), opciones: { unionLosaViga: "eje" } }),
  // Fase LV: con la unión de la losa con las vigas por las caras (por defecto)
  "aleatorio-3-lv": () => ({ fisico: conLosasAleatorias(fisicoAleatorio(3), 3, { eje1: "azar" }), opciones: {} }),
  "reticular-2x2-abacos-lv": () => ({ fisico: conAcciones(edificioReticular(1, 2, 2)), opciones: {} }),
};

export interface ReferenciaF {
  c2: ReferenciaC2;
  franjas: Record<string, { t: [number, number]; s: [number, number]; estaciones: { s: number; tipo: string; lado: number; anchoEnLosa: number; ventana: number[] | null; valido: boolean; medios: number[] }[]; wa: (number | null)[][]; diagnosticos: string[] }>;
}

const arr = (v: ArrayLike<number>) => Array.from(v);

export function referenciaF(f: () => ModeloCongelado): ReferenciaF {
  const c2 = referenciaC2(f);
  const { fisico, opciones } = f();
  const r = compilar(fisico, opciones);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo));
  const q = new Consultas(fisico, r, casos, opciones);
  const suma = [casos.map(() => 1)];
  const franjas: ReferenciaF["franjas"] = {};
  const lista = q.franjas();
  if (!lista.valido) throw new Error("sin franjas");
  for (const fr of lista.valor) {
    const e = q.franja(fr.id);
    const w = q.armadoFranja(fr.id, suma);
    if (!e.valido || !w.valido) throw new Error(fr.id);
    franjas[fr.id] = {
      t: [fr.t0, fr.t1],
      s: [fr.s0, fr.s1],
      estaciones: e.valor.estaciones.map((x) => ({ s: x.s, tipo: x.tipo, lado: x.lado, anchoEnLosa: x.anchoEnLosa, ventana: x.ventana ?? null, valido: x.valido, medios: arr(x.medios) })),
      wa: w.valor.map((x) => (Number.isFinite(x.inferior) ? [x.inferior, x.superior] : [null, null])),
      diagnosticos: e.diagnosticos.map((d) => d.codigo),
    };
  }
  return { c2, franjas };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida = Object.fromEntries(Object.entries(MODELOS_CONGELADOS_F).map(([k, f]) => [k, referenciaF(f)]));
  const ruta = join(import.meta.dirname, "..", "..", "src", "compilador", "__fixtures__", "congelado-f.json");
  writeFileSync(ruta, JSON.stringify(salida, redondeo));
  console.log(`Escrito ${ruta}`);
}
