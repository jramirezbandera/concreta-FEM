/**
 * Fase CO3, criterio 14 (docs/fem3d/comprobaciones.md §7): la referencia congelada de las
 * comprobaciones de las losas de cuatro modelos, con el armado que se propone de las tablas.
 *
 *   bun validacion/co/congelarLosas.ts     escribe src/comprobaciones/__fixtures__/congelado-co3.json
 *
 * De cada losa se guarda el armado propuesto (los rectángulos de los refuerzos y de los cercos, al
 * micrómetro), si cumple, lo pendiente y cada fila con su sección, lo que la arma, su aprovechamiento
 * y su estado. No la combinación ni la estación que mandan: entre dos casi iguales (una planta
 * simétrica) cambian con el último bit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import type { ArmadoForjado } from "../../src/comprobaciones/armado.ts";
import { comprobarLosas } from "../../src/comprobaciones/losas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { losaEnDosApoyos, losaPlana } from "./modelosLosas.ts";

const RAIZ = join(import.meta.dirname, "..", "..");

function vivienda(): { modelo: ModeloFisico; opciones?: OpcionesCompilacion } {
  const l = leerProyecto(readFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8"));
  if (!l.valido) throw new Error("la vivienda no se lee");
  return { modelo: l.proyecto.modelo, ...(l.proyecto.opciones ? { opciones: l.proyecto.opciones } : {}) };
}

/** Los cuatro modelos: una losa en flexión cilíndrica, una losa plana maciza con sismo, una reticular y la vivienda. */
export const MODELOS_CONGELADOS_CO3: Record<string, () => { modelo: ModeloFisico; opciones?: OpcionesCompilacion }> = {
  "losa-dos-apoyos": () => ({ modelo: losaEnDosApoyos() }),
  "losa-plana-sismo": () => ({ modelo: losaPlana({ sismo: true }) }),
  "losa-reticular": () => ({ modelo: losaPlana({ reticular: true }) }),
  vivienda,
};

export interface ReferenciaCO3 {
  resumen: { losas: number; cumplen: number; noCumplen: number; sinArmado: number };
  losas: { losa: string; armado: ArmadoForjado | null; cumple: boolean; pendientes: string[]; sinRefuerzo: string[]; filas: { id: string; seccion: string; armado: string; aprovechamiento: number | null; estado: string }[] }[];
}

const micras = (x: [number, number]): [number, number] => [Math.round(x[0] * 1e6) / 1e6, Math.round(x[1] * 1e6) / 1e6];
const redondeado = (a: ArmadoForjado): ArmadoForjado => ({
  ...a,
  ...(a.refuerzos ? { refuerzos: a.refuerzos.map((r) => ({ ...r, s: micras(r.s), t: micras(r.t) })) } : {}),
  ...(a.cercos ? { cercos: a.cercos.map((r) => ({ ...r, s: micras(r.s), t: micras(r.t) })) } : {}),
});

export function referenciaCO3(m: { modelo: ModeloFisico; opciones?: OpcionesCompilacion }): ReferenciaCO3 {
  const c = compilar(m.modelo, m.opciones);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const q = new Consultas(m.modelo, c, r.casos, m.opciones ?? {}, r.modal);
  const p = comprobarLosas(q, undefined, undefined, { proponer: true, filas: true });
  if (!p.valido) throw new Error(p.diagnosticos.map((d) => d.mensaje).join("\n"));
  const { llamadas: _l, ...resumen } = p.valor.resumen;
  return {
    resumen,
    losas: p.valor.losas.map((l) => ({
      losa: l.losa,
      armado: l.armado ? redondeado(l.armado) : null,
      cumple: l.cumple,
      pendientes: l.pendientes.map((y) => y.motivo),
      sinRefuerzo: (l.sinRefuerzo ?? []).map((y) => y.zona),
      filas: (l.filas ?? []).map((f) => ({ id: f.id, seccion: f.seccion, armado: f.armado, aprovechamiento: f.aprovechamiento, estado: f.estado })),
    })),
  };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, ReferenciaCO3> = {};
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_CO3)) {
    salida[nombre] = referenciaCO3(f());
    const s = salida[nombre]!;
    console.log(nombre, JSON.stringify(s.resumen), s.losas.map((l) => `${l.losa}: ${l.armado?.refuerzos?.length ?? 0} refuerzos, ${l.armado?.cercos?.length ?? 0} zonas de cercos, ${l.filas.length} filas`).join("; "));
  }
  writeFileSync(join(RAIZ, "src", "comprobaciones", "__fixtures__", "congelado-co3.json"), JSON.stringify(salida) + "\n");
}
