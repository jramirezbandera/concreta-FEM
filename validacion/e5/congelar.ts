/**
 * Referencia congelada de E5 (regla de oro 1): cortes por fuerzas nodales y por campos, y los
 * campos recuperados por SPR, de tres modelos: un edificio de E3 con diafragma y huellas, la lámina
 * plegada y la losa plana de H25 con huella (malla de 0,3 m). El test
 * (src/motor/congelado-e5.test.ts) los recalcula y compara a 1e-9.
 *
 * Sólo se regenera a sabiendas (un cambio de los cortes o del SPR que se ha validado aparte):
 *   bun validacion/e5/congelar.ts
 * Guarda los esfuerzos de cada corte en todos los casos (con NaN donde el corte no da valor) y los
 * valores nodales recuperados de todas las plazas en el primer caso.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../src/motor/calcular.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import { Cortes, type Corte } from "../../src/motor/cortes.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { edificio } from "../../src/pruebas/edificio.ts";
import { laminaPlegada } from "../e3/metamorficas.ts";
import { cortesLosaPlana, losaPlana } from "./bandas.ts";
import { BASE_E5 } from "./fuerzasNodales.ts";

const grande = [-100, 100] as const;

/** Modelos congelados de E5 y sus cortes. */
export const MODELOS_CONGELADOS_E5: Record<string, () => { modelo: ModeloAnalitico; cortes: Corte[] }> = {
  "e3-diafragma": () => ({
    modelo: edificio({ ...BASE_E5, diafragma: true }).modelo,
    cortes: [
      { id: "planta 1", origen: [5, 4, 3], x: [0, 0, 1], vz: [1, 0, 0], y: grande, z: grande },
      { id: "x = 2", origen: [2, 0.37, 1.1], x: [1, 0, 0], vz: [0, 0, 1], y: grande, z: grande },
      { id: "x = 5 (huellas)", origen: [5, 0.37, 1.1], x: [1, 0, 0], vz: [0, 0, 1], y: grande, z: grande },
      { id: "franja con diafragma", origen: [2, 2, 3], x: [1, 0, 0], vz: [0, 0, 1], y: [-1, 1] },
      { id: "franja por campos", origen: [2.3, 6, 6], x: [1, 0, 0], vz: [0, 0, 1], y: [-1.5, 1.5], metodo: "campos" },
    ],
  }),
  "lamina-plegada": () => ({
    modelo: laminaPlegada(),
    cortes: [
      { id: "x = 2", origen: [2, 0.37, 1.1], x: [1, 0, 0], vz: [0, 0, 1], y: grande, z: grande },
      { id: "z = 1", origen: [0, 0, 1], x: [0, 0, 1], vz: [1, 0, 0], y: grande, z: grande },
      { id: "franja de la losa", origen: [2, 0, 3], x: [1, 0, 0], vz: [0, 0, 1], y: [0, 2] },
      { id: "franja por campos", origen: [2.4, 0, 3], x: [1, 0, 0], vz: [0, 0, 1], y: [0, 3], metodo: "campos" },
    ],
  }),
  "losa-plana": () => ({
    modelo: losaPlana(0.3),
    cortes: [...cortesLosaPlana("fuerzas-nodales", 6.3), ...cortesLosaPlana("campos", 3.1)],
  }),
};

export interface ReferenciaE5 {
  /** Por corte: los 6 esfuerzos de cada caso (null donde NaN). */
  cortes: Record<string, (number | null)[]>;
  /** Valores nodales recuperados (8 por plaza) del primer caso. */
  campos: number[];
}

/** Calcula lo que se congela de un modelo. */
export function referenciaE5(f: () => { modelo: ModeloAnalitico; cortes: Corte[] }, solver: "nucleo" | "perfil" = "nucleo"): ReferenciaE5 {
  const { modelo, cortes } = f();
  const casos = casosValidos(calcular(modelo, { solver }));
  const ct = new Cortes(modelo);
  const campos = new CamposLaminas(modelo);
  const out: ReferenciaE5 = { cortes: {}, campos: Array.from(campos.nodales(casos[0]!.u)) };
  for (const c of cortes) {
    const r = ct.cortar(c, casos, campos);
    if (!r.valido) throw new Error(`corte ${c.id}: ${r.diagnosticos.map((d) => d.mensaje).join(" | ")}`);
    out.cortes[c.id!] = Array.from(r.esfuerzos, (v) => (Number.isNaN(v) ? null : v));
  }
  return out;
}

if (import.meta.main) {
  const raiz = join(import.meta.dirname, "..", "..");
  await iniciarNucleo(readFileSync(join(raiz, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, ReferenciaE5> = {};
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_E5)) salida[nombre] = referenciaE5(f);
  const ruta = join(raiz, "src", "motor", "__fixtures__", "congelado-e5.json");
  writeFileSync(ruta, JSON.stringify({ generado: "bun validacion/e5/congelar.ts", ...salida }));
  console.log(`escrito ${ruta}`);
}
