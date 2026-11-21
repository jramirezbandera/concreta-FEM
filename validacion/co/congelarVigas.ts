/**
 * Fase CO2, criterio 14 (docs/fem3d/comprobaciones.md §7): la referencia congelada de las
 * comprobaciones de las vigas de tres modelos, con el armado que se propone de las tablas.
 *
 *   bun validacion/co/congelarVigas.ts     escribe src/comprobaciones/__fixtures__/congelado-co2.json
 *
 * De cada vano se guarda el armado propuesto, si cumple, lo pendiente y cada fila con su
 * aprovechamiento y su estado. No la combinación que manda: entre dos casi iguales (vigas
 * simétricas) cambia con el último bit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { comprobarVigas } from "../../src/comprobaciones/vigas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { porticoVigas } from "./modelosVigas.ts";

const RAIZ = join(import.meta.dirname, "..", "..");

function vivienda(): { modelo: ModeloFisico; opciones?: OpcionesCompilacion } {
  const l = leerProyecto(readFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8"));
  if (!l.valido) throw new Error("la vivienda no se lee");
  return { modelo: l.proyecto.modelo, ...(l.proyecto.opciones ? { opciones: l.proyecto.opciones } : {}) };
}

/** Los tres modelos: pórticos con viento, pórticos cargados con sismo, y la vivienda (vigas planas en un reticular). */
export const MODELOS_CONGELADOS_CO2: Record<string, () => { modelo: ModeloFisico; opciones?: OpcionesCompilacion }> = {
  "portico-viento": () => ({ modelo: porticoVigas() }),
  "portico-cargado-sismo": () => ({ modelo: porticoVigas({ cm: 40, q: 25, sismo: true }) }),
  vivienda,
};

export interface ReferenciaCO2 {
  resumen: { vigas: number; vanos: number; cumplen: number; noCumplen: number; sinArmado: number };
  vanos: { viga: string; vano: number; texto: string | null; cumple: boolean; pendientes: string[]; filas: { id: string; aprovechamiento: number | null; estado: string }[] }[];
}

export function referenciaCO2(m: { modelo: ModeloFisico; opciones?: OpcionesCompilacion }): ReferenciaCO2 {
  const c = compilar(m.modelo, m.opciones);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const q = new Consultas(m.modelo, c, r.casos, m.opciones ?? {}, r.modal);
  const p = comprobarVigas(q, undefined, undefined, { proponer: true, filas: true });
  if (!p.valido) throw new Error(p.diagnosticos.map((d) => d.mensaje).join("\n"));
  const { llamadas: _l, ...resumen } = p.valor.resumen;
  return {
    resumen,
    vanos: p.valor.vigas.flatMap((x) =>
      x.vanos.map((v) => ({
        viga: x.viga,
        vano: v.vano,
        texto: v.texto ?? null,
        cumple: v.cumple,
        pendientes: v.pendientes.map((y) => y.motivo),
        filas: (v.filas ?? []).map((f) => ({ id: f.id, aprovechamiento: f.aprovechamiento, estado: f.estado })),
      })),
    ),
  };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, ReferenciaCO2> = {};
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_CO2)) {
    salida[nombre] = referenciaCO2(f());
    const s = salida[nombre]!;
    const textos = new Map<string, number>();
    for (const t of s.vanos) textos.set(t.texto ?? "sin propuesta", (textos.get(t.texto ?? "sin propuesta") ?? 0) + 1);
    console.log(nombre, JSON.stringify(s.resumen), Object.fromEntries(textos));
  }
  writeFileSync(join(RAIZ, "src", "comprobaciones", "__fixtures__", "congelado-co2.json"), JSON.stringify(salida) + "\n");
}
